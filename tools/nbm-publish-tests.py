#!/usr/bin/env python3
"""Offline real Git remote tests. Recorded weather stays test-only."""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('nbm-publish.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.remote, self.repo, self.candidate = root/'remote.git', root/'repo', root/'candidate'
        self.remote.mkdir(); self.repo.mkdir(); self.candidate.mkdir()
        p.git(self.remote, 'init', '--bare', '--initial-branch=main')
        p.git(self.repo, 'init', '--initial-branch=main')
        p.git(self.repo, 'config', 'user.email', 'test@example.invalid')
        p.git(self.repo, 'config', 'user.name', 'Test')
        (self.repo/'app.txt').write_text('original')
        p.git(self.repo, 'add', '.')
        p.git(self.repo, 'commit', '-m', 'baseline')
        p.git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        p.git(self.repo, 'push', 'origin', 'main')
        self.base = self.head()
        self.data = json.loads(gzip.decompress((Path(__file__).parent/'fixtures/weather/nbm-regional-recorded.json.gz').read_bytes()))
        self.now = p.stamp(self.data['retrievedAt'])+timedelta(minutes=1)
        self.write_candidate()

    def head(self):
        return p.git(self.remote, 'rev-parse', 'main').stdout.decode().strip()

    def write_candidate(self, changed=True):
        raw = (json.dumps(self.data)+'\n').encode()
        (self.candidate/'nbm-range.json').write_bytes(raw)
        (self.candidate/'nbm-receipt.json').write_text(json.dumps(dict(validator='regional-v1', run=self.data['run'], sha256=hashlib.sha256(raw).hexdigest())))
        (self.candidate/'nbm-status.json').write_text(json.dumps(dict(status='ready' if changed else 'unchanged', changed=changed, dataRun=self.data['run'], checkedAt=self.now.isoformat())))

    def publish(self, **kwargs):
        return p.publish(self.repo, self.candidate, self.base, now=self.now, **kwargs)

    def app_update(self, path='app.txt'):
        (self.repo/path).parent.mkdir(parents=True, exist_ok=True)
        (self.repo/path).write_text('concurrent update')
        p.git(self.repo, 'add', path)
        p.git(self.repo, 'commit', '-m', 'app update')
        p.git(self.repo, 'push', 'origin', 'main')

    def test_only_allowlisted_paths_and_remote_parent_with_dirty_index(self):
        self.app_update()
        parent = self.head()
        (self.repo/'unrelated.txt').write_text('must not publish')
        p.git(self.repo, 'add', 'unrelated.txt')
        result = self.publish()
        self.assertEqual(result['parent'], parent)
        self.assertEqual(set(p.git(self.remote, 'diff', '--name-only', parent, 'main').stdout.decode().splitlines()), set(p.PATHS))
        self.assertEqual(p.git(self.remote, 'show', 'main:app.txt').stdout, b'concurrent update')
        self.assertIn(b'unrelated.txt', p.git(self.repo, 'diff', '--cached', '--name-only').stdout)

    def test_unchanged_no_commit_and_seed_roundtrip(self):
        self.publish(); head = self.head()
        self.write_candidate(False)
        self.assertEqual(self.publish()['status'], 'unchanged')
        self.assertEqual(head, self.head())
        out = Path(self.tmp.name)/'seed'
        p.seed(self.repo, out, head)
        self.assertEqual((out/'nbm-range.json').read_bytes(), (self.candidate/'nbm-range.json').read_bytes())

    def test_racing_push_rejected_without_overwriting_app(self):
        with self.assertRaises(Exception): self.publish(before_push=self.app_update)
        self.assertEqual(p.git(self.remote, 'show', 'main:app.txt').stdout, b'concurrent update')
        self.assertIsNone(p.read_at(self.remote, 'main', p.PATHS[0]))

    def test_remote_rejection_preserves_last_good(self):
        self.publish(); head = self.head()
        self.data['retrievedAt'] = (self.now-timedelta(seconds=1)).isoformat()
        self.write_candidate()
        hook = self.remote/'hooks/pre-receive'
        hook.write_text('#!/bin/sh\nexit 1\n'); hook.chmod(0o755)
        with self.assertRaises(Exception): self.publish()
        self.assertEqual(head, self.head())

    def test_invalid_off_point_values_receipt_and_stale_fail_before_push(self):
        for mutation in ('values', 'receipt', 'stale'):
            with self.subTest(mutation=mutation):
                self.write_candidate()
                if mutation == 'values':
                    original = self.data['periods'][0]['kelvin'][0]
                    self.data['periods'][0]['kelvin'][0] = [300, 200, 290]
                    self.write_candidate()
                    self.data['periods'][0]['kelvin'][0] = original
                elif mutation == 'receipt': (self.candidate/'nbm-receipt.json').write_text('{}')
                else: self.now += timedelta(days=2)
                with self.assertRaises(Exception): self.publish()
                self.assertEqual(self.base, self.head())

    def test_obsolete_publisher_fails_closed(self):
        self.app_update('tools/changed.py')
        with self.assertRaisesRegex(ValueError, 'code changed'): self.publish()

    def test_same_cycle_revision_cannot_roll_back(self):
        self.publish(); head = self.head()
        self.data['periods'][0]['kelvin'][0][0] -= .01
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, 'rollback'): self.publish()
        self.assertEqual(head, self.head())


if __name__ == '__main__': unittest.main()
