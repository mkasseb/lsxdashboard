#!/usr/bin/env python3
"""Offline refresh orchestration tests; controlled outages never become forecast fixtures."""
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.error

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('nbm-refresh.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RefreshTests(unittest.TestCase):
    def test_native_schedule(self):
        for hour in range(24):
            run = f'20261007{hour:02}'
            hours = r.hours_for(run)
            self.assertEqual(len(hours), 6)
            self.assertGreaterEqual(hours[0], 18)
            self.assertTrue(all((hour+h) % 24 in (6, 18) for h in hours))
            self.assertEqual([b-a for a, b in zip(hours, hours[1:])], [12]*5)

    def test_delayed_indexes_retry_then_ready(self):
        sleep = Mock()
        with patch.object(r, 'plan', side_effect=[r.Pending('not yet'), r.Pending('partial'), ['complete']]) as plan:
            run, data, notes = r.choose_plan(None, ['new', 'old'], sleep=sleep)
        self.assertEqual((run, data, len(notes)), ('new', ['complete'], 2))
        self.assertEqual(plan.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_index_before_grib_retries_complete_extraction(self):
        build = Mock(side_effect=[r.Pending('GRIB 404'), {'complete': True}])
        with patch.object(r, 'plan', return_value=['index']):
            run, data, notes = r.choose_plan(None, ['new'], sleep=lambda _: None, build=build)
        self.assertEqual(run, 'new')
        self.assertTrue(data['complete'])
        self.assertEqual(build.call_count, 2)
        self.assertIn('GRIB 404', notes)

    def test_fallback_only_after_bounded_retries(self):
        with patch.object(r, 'plan', side_effect=[r.Pending('later'), r.Pending('later'), ['older complete']]) as plan:
            run, _, notes = r.choose_plan(None, ['new', 'old'], attempts=2, sleep=lambda _: None)
        self.assertEqual(run, 'old')
        self.assertEqual([call.args[1] for call in plan.call_args_list], ['new', 'new', 'old'])
        self.assertEqual(len(notes), 2)

    def test_denials_and_invalid_data_fail_closed(self):
        for error in [urllib.error.HTTPError('url', 403, 'Forbidden', {}, None), ValueError('crossed percentiles')]:
            with patch.object(r, 'plan', side_effect=error) as plan:
                with self.assertRaises(type(error)): r.choose_plan(None, ['new', 'old'], sleep=lambda _: None)
                self.assertEqual(plan.call_count, 1)

    def test_partial_index_is_retryable(self):
        text = '1:0:d=2026100712:TMP:2 m above ground:0-18 hour max fcst:10% level\n2:100:other'
        client = Mock()
        client.get.return_value = (text.encode(), 200, {})
        with self.assertRaises(r.Pending): r.plan(client, '2026100712')

    def test_mixed_partial_index_is_invalid_not_pending(self):
        text = ('1:0:d=2026100712:TMP:2 m above ground:0-18 hour max fcst:10% level\n'
                '2:100:d=2026100712:TMP:2 m above ground:0-18 hour min fcst:50% level\n3:200:other')
        client = Mock()
        client.get.return_value = (text.encode(), 200, {})
        with self.assertRaises(ValueError): r.plan(client, '2026100712')

    def test_atomic_failure_preserves_old_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'nbm-range.json'
            p.write_text('old')
            with patch.object(Path, 'replace', side_effect=OSError('simulated interruption')):
                with self.assertRaises(OSError): r.atomic(p, {'new': True})
            self.assertEqual(p.read_text(), 'old')
            self.assertEqual(list(Path(directory).iterdir()), [p])

    def test_retention_and_no_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            for hour in [0, 6, 12, 18]: r.publish_local(p, {'run': f'2026-10-07T{hour:02}:00:00Z'})
            self.assertEqual([x.name for x in sorted((p/'history').glob('*.json'))], ['2026100712.json', '2026100718.json'])
            previous = (p/'nbm-range.json').read_bytes()
            with self.assertRaises(ValueError): r.publish_local(p, {'run': '2026-10-07T06:00:00Z'})
            self.assertEqual((p/'nbm-range.json').read_bytes(), previous)

    def test_failure_report_does_not_renew_retained_cycle(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            r.atomic(p/'nbm-range.json', {'run': '2026-10-06T00:00:00Z', 'retrievedAt': '2026-10-06T08:00:00Z'})
            before = (p/'nbm-range.json').read_bytes()
            with patch.object(r, 'discover', side_effect=ValueError('invalid publication response')):
                report = r.refresh(p)
            self.assertEqual(report['status'], 'failed')
            self.assertTrue(report['retainedPrevious'])
            self.assertEqual((p/'nbm-range.json').read_bytes(), before)
            self.assertEqual(json.loads((p/'nbm-status.json').read_text())['status'], 'failed')

    def test_budget_rejects_before_network(self):
        client = r.Client()
        client.requests = 100
        with self.assertRaises(RuntimeError): client.get('https://example.invalid/')

    def test_workflow_is_manual_and_cannot_publish(self):
        workflow = (Path(__file__).parent.parent/'.github/workflows/nbm-refresh.yml').read_text()
        active = '\n'.join(line for line in workflow.splitlines() if not line.lstrip().startswith('#'))
        self.assertIn('workflow_dispatch:', active)
        self.assertNotIn('schedule:', active)
        self.assertIn('contents: read', active)
        self.assertNotIn('contents: write', active)
        self.assertNotIn('secrets.', active)
        self.assertIn('retention-days: 3', active)


if __name__ == '__main__': unittest.main()
