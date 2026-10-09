#!/usr/bin/env python3
"""Publish validated NBM files with one ordinary fast-forward push; never force or merge."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PATHS = ('data/nbm-range.json', 'data/nbm-receipt.json')
UTC = timezone.utc
MAX_FILE_BYTES = 2_000_000


def git(repo, *args, data=None, env=None, check=True):
    return subprocess.run(['git', '-C', str(repo), *args], input=data, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=env, check=check, timeout=60)


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def read_at(repo, head, path):
    entry = git(repo, 'ls-tree', head, '--', path).stdout.decode().strip()
    if not entry:
        return None
    if not entry.startswith('100644 blob '):
        raise ValueError('Data path must be a regular non-executable file')
    size = int(git(repo, 'cat-file', '-s', f'{head}:{path}').stdout)
    if size > MAX_FILE_BYTES:
        raise ValueError('Retained file exceeds bound')
    return git(repo, 'show', f'{head}:{path}').stdout


def seed(repo, directory, head):
    directory.mkdir(parents=True, exist_ok=True)
    files = [read_at(repo, head, path) for path in PATHS]
    if any(x is not None for x in files) and any(x is None for x in files):
        raise ValueError('Incomplete retained pair')
    for path, raw in zip(PATHS, files):
        if raw is not None:
            (directory/Path(path).name).write_bytes(raw)


def candidate(directory, now):
    files = {}
    for path in (*PATHS, 'nbm-status.json'):
        file = directory/Path(path).name
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 2_000_000:
            raise ValueError('Missing, linked or oversized candidate')
        files[path] = file.read_bytes()
    data, receipt, status = [json.loads(files[p]) for p in (*PATHS, 'nbm-status.json')]
    digest = hashlib.sha256(files[PATHS[0]]).hexdigest()
    if receipt != dict(validator='regional-quartiles-v2', run=data['run'], sha256=digest):
        raise ValueError('Receipt mismatch')
    if (status.get('status') not in ('ready', 'fallback', 'unchanged') or
            type(status.get('changed')) is not bool or status.get('dataRun') != data['run'] or
            not 0 <= (now-stamp(status['checkedAt'])).total_seconds() <= 1800 or
            not 0 <= (now-stamp(data['run'])).total_seconds() < 86400 or
            data.get('schema') != 3 or data.get('percentiles') != [25, 50, 75] or data.get('missingHours') != [] or len(data.get('periods', [])) != 18):
        raise ValueError('Incomplete, failed or stale candidate')
    for period in data['periods']:
        if len(period['kelvin']) != len(data['cells']):
            raise ValueError('Incomplete grid values')
        for row in period['kelvin']:
            if (len(row) != 3 or any(type(v) not in (int, float) or not 180 <= v <= 340 for v in row)
                    or not row[0] <= row[1] <= row[2]):
                raise ValueError('Invalid regional percentiles')
    # Reuse the independent consumer validation for period/cell/unit/provenance/age checks.
    js = """const fs=require('fs'),vm=require('vm');const s={Intl,Date,URLSearchParams};
vm.createContext(s);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),s);
const d=JSON.parse(fs.readFileSync(0,'utf8'));
if(s.NbmRange.validate(d,{lat:38.8,lon:-90.79},Number(process.argv[2])).status!=='ready')process.exit(1);"""
    subprocess.run(['node', '-e', js, str(ROOT/'assets/forecast-range.js'), str(now.timestamp()*1000)],
                   input=files[PATHS[0]], check=True, timeout=30)
    return {p: files[p] for p in PATHS}, data, status, digest


def publish(repo, directory, expected_head, now=None, before_push=None):
    now = now or datetime.now(UTC)
    files, data, status, digest = candidate(directory, now)
    git(repo, 'fetch', '--no-tags', 'origin', 'refs/heads/main')
    head = git(repo, 'rev-parse', 'FETCH_HEAD').stdout.decode().strip()
    # Do not run an obsolete publisher against newly changed validation/publishing code.
    if git(repo, 'diff', '--name-only', expected_head, head, '--', 'tools/', 'assets/forecast-range.js', 'assets/hourly-range.js', '.github/').stdout:
        raise ValueError('Publisher or validation code changed; start a fresh run')
    previous = [read_at(repo, head, p) for p in PATHS]
    if any(x is not None for x in previous) and any(x is None for x in previous):
        raise ValueError('Incomplete previous publication')
    if previous == [files[p] for p in PATHS]:
        return dict(status='unchanged', parent=head, sha256=digest)
    if not status['changed']:
        raise ValueError('Unchanged candidate differs from remote; start a fresh run')
    if previous[0]:
        old = json.loads(previous[0])
        if stamp(old['run']) > stamp(data['run']) or (old['run'] == data['run'] and
                stamp(old['retrievedAt']) >= stamp(data['retrievedAt'])):
            raise ValueError('Refusing cycle/revision rollback')
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ | {'GIT_INDEX_FILE': str(Path(tmp)/'index'),
                            'GIT_AUTHOR_NAME': 'github-actions[bot]', 'GIT_COMMITTER_NAME': 'github-actions[bot]',
                            'GIT_AUTHOR_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com',
                            'GIT_COMMITTER_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com'}
        git(repo, 'read-tree', head, env=env)
        for path, raw in files.items():
            blob = git(repo, 'hash-object', '-w', '--stdin', data=raw).stdout.decode().strip()
            git(repo, 'update-index', '--add', '--cacheinfo', f'100644,{blob},{path}', env=env)
        tree = git(repo, 'write-tree', env=env).stdout.decode().strip()
        changes = git(repo, 'diff', '--name-only', '-z', head, tree).stdout.decode().split('\0')[:-1]
        if not changes or set(changes) - set(PATHS):
            raise ValueError('Unexpected publication paths')
        audit = dict(run=data['run'], sha256=digest, parent=head,
                     workflowRun=os.environ.get('GITHUB_RUN_ID', 'local-test'),
                     workflowAttempt=os.environ.get('GITHUB_RUN_ATTEMPT', '1'))
        message = 'Refresh NBM forecast data\n\n'+json.dumps(audit, sort_keys=True)+'\n'
        commit = git(repo, 'commit-tree', tree, '-p', head, data=message.encode(), env=env).stdout.decode().strip()
        if before_push:
            before_push()
        # Exactly one ordinary push. A competing update or branch-rule rejection fails closed.
        # Never retry/rebase/force after an ambiguous push result; next run checks remote bytes.
        git(repo, 'push', '--porcelain', 'origin', f'{commit}:refs/heads/main')
        return dict(status='published', commit=commit, **audit)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--expected-head', required=True)
    parser.add_argument('--seed', action='store_true')
    args = parser.parse_args()
    if args.seed:
        seed(ROOT, args.directory, args.expected_head)
    else:
        try:
            result = publish(ROOT, args.directory, args.expected_head)
        except Exception as error:
            print(json.dumps(dict(status='failed', error=f'{type(error).__name__}: {error}',
                                  note='No force/retry attempted; inspect remote head before another run.')))
            raise SystemExit(1)
        print(json.dumps(result, indent=2))
