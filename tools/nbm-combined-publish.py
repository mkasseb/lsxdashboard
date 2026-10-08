#!/usr/bin/env python3
"""Validate independent NBM products, then publish changed pairs in one Git transaction."""
import argparse
from datetime import datetime, timedelta
import importlib.util
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent.parent

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'tools'/file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value

daily = module('daily_publish', 'nbm-publish.py')
hourly = module('hourly_publish', 'nbm-hourly-publish.py')
PRODUCTS = {'daily': daily, 'hourly': hourly.publisher}
MANIFEST = 'data/nbm-publication.json'
PATHS = tuple(path for p in PRODUCTS.values() for path in p.PATHS)+(MANIFEST,)


def publication_window(now):
    return now.replace(hour=(now.hour//6)*6, minute=0, second=0, microsecond=0)


def budget(repo, head, now):
    raw = daily.read_at(repo, head, MANIFEST)
    if raw is None:
        if daily.git(repo, 'rev-parse', '--is-shallow-repository').stdout.strip() != b'false':
            raise ValueError('Complete history required for budget bootstrap')
        if daily.git(repo, 'log', '-1', '--format=%H', head, '--', MANIFEST).stdout.strip():
            raise ValueError('Established publication budget manifest is missing')
        return None
    value = json.loads(raw)
    if set(value) != {'schema', 'preparedAt', 'windowStart'} or value['schema'] != 1:
        raise ValueError('Invalid publication budget manifest')
    published, window = daily.stamp(value['preparedAt']), daily.stamp(value['windowStart'])
    if published.tzinfo is None or window.tzinfo is None or published > now or publication_window(published) != window:
        raise ValueError('Invalid or future publication budget')
    return (window+timedelta(hours=6)).isoformat() if window == publication_window(now) else None


def seed(repo, directory, head, now=None):
    outcomes = {'nextPublicationWindow': budget(repo, head, now or datetime.now(daily.UTC))}
    for name, p in PRODUCTS.items():
        try:
            p.seed(repo, directory, head)
            outcomes[name] = {'status': 'ready'}
        except Exception as error:
            outcomes[name] = {'status': 'failed', 'error': f'{type(error).__name__}: {error}'}
    directory.mkdir(parents=True, exist_ok=True)
    (directory/'nbm-seed-status.json').write_text(json.dumps(outcomes)+'\n')
    return outcomes


def publish(repo, directory, expected_head, now=None, before_push=None):
    now = now or datetime.now(daily.UTC)
    daily.git(repo, 'fetch', '--no-tags', 'origin', 'refs/heads/main')
    head = daily.git(repo, 'rev-parse', 'FETCH_HEAD').stdout.decode().strip()
    if daily.git(repo, 'diff', '--name-only', expected_head, head, '--', 'tools/', 'assets/forecast-range.js', 'assets/hourly-range.js', '.github/').stdout:
        raise ValueError('Publisher or validation code changed; start a fresh run')
    files, outcomes = {}, {}
    for name, p in PRODUCTS.items():
        try:
            candidate, data, status, digest = p.candidate(directory, now)
            previous = [p.read_at(repo, head, path) for path in p.PATHS]
            if any(x is not None for x in previous) and any(x is None for x in previous):
                raise ValueError('Incomplete previous pair')
            audit = dict(run=data['run'], sha256=digest)
            if previous == [candidate[path] for path in p.PATHS]:
                outcomes[name] = dict(status='unchanged', **audit)
                continue
            if not status['changed']:
                raise ValueError('Unchanged candidate differs from remote')
            if previous[0]:
                old = json.loads(previous[0])
                if daily.stamp(old['run']) > daily.stamp(data['run']) or (old['run'] == data['run'] and
                        daily.stamp(old['retrievedAt']) >= daily.stamp(data['retrievedAt'])):
                    raise ValueError('Refusing cycle/revision rollback')
            files.update(candidate)
            outcomes[name] = dict(status='changed', **audit)
        except Exception as error:
            # A bad product never contributes bytes, even if its sibling is publishable.
            outcomes[name] = dict(status='failed', error=f'{type(error).__name__}: {error}')
    failed = any(x['status'] == 'failed' for x in outcomes.values())
    audit = dict(parent=head, products=outcomes, degraded=failed,
                 workflowRun=os.environ.get('GITHUB_RUN_ID', 'local-test'),
                 workflowAttempt=os.environ.get('GITHUB_RUN_ATTEMPT', '1'))
    if not files:
        return dict(status='failed' if failed else 'unchanged', **audit)
    next_window = budget(repo, head, now)
    if next_window:
        return dict(status='deferred', nextPublicationWindow=next_window, **audit)
    files[MANIFEST] = (json.dumps(dict(schema=1, preparedAt=now.isoformat(),
                                      windowStart=publication_window(now).isoformat()), sort_keys=True)+'\n').encode()
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ | {'GIT_INDEX_FILE': str(Path(tmp)/'index'),
                            'GIT_AUTHOR_NAME': 'github-actions[bot]', 'GIT_COMMITTER_NAME': 'github-actions[bot]',
                            'GIT_AUTHOR_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com',
                            'GIT_COMMITTER_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com'}
        daily.git(repo, 'read-tree', head, env=env)
        for path, raw in files.items():
            blob = daily.git(repo, 'hash-object', '-w', '--stdin', data=raw).stdout.decode().strip()
            daily.git(repo, 'update-index', '--add', '--cacheinfo', f'100644,{blob},{path}', env=env)
        tree = daily.git(repo, 'write-tree', env=env).stdout.decode().strip()
        changes = daily.git(repo, 'diff', '--name-only', '-z', head, tree).stdout.decode().split('\0')[:-1]
        if not changes or set(changes) - set(files) or set(files) - set(PATHS):
            raise ValueError('Unexpected publication paths')
        message = 'Refresh NBM daily and hourly guidance\n\n'+json.dumps(audit, sort_keys=True)+'\n'
        commit = daily.git(repo, 'commit-tree', tree, '-p', head, data=message.encode(), env=env).stdout.decode().strip()
        if before_push:
            before_push()
        # One normal fast-forward push, no force/rebase/retry after a race or rejection.
        daily.git(repo, 'push', '--porcelain', 'origin', f'{commit}:refs/heads/main')
        return dict(status='published', commit=commit, **audit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--seed', action='store_true')
    args = parser.parse_args()
    try:
        result = seed(ROOT, args.directory, args.expected_head) if args.seed else publish(ROOT, args.directory, args.expected_head)
        print(json.dumps(result, indent=2))
        if args.seed and os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('eligible='+str(result['nextPublicationWindow'] is None).lower()+'\n')
        if not args.seed and os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('verifiable='+str(result['status'] in ('published', 'unchanged') and not result.get('degraded')).lower()+'\n')
        # Partial publication is real, but a failed product must remain visible in Actions.
        if not args.seed and (result['status'] == 'failed' or result.get('degraded')):
            raise SystemExit(1)
    except Exception as error:
        print(json.dumps(dict(status='failed', error=f'{type(error).__name__}: {error}')))
        raise SystemExit(1)
