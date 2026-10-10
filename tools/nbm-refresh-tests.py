#!/usr/bin/env python3
"""Offline refresh orchestration tests; controlled outages never become forecast fixtures."""
from collections import Counter
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime, parsedate_to_datetime
import importlib.util
import json
import gzip
import io
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch, Mock
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).with_name('nbm-refresh.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class OfflineNoaa:
    """Synthetic transport only. All producer network calls are intercepted."""
    def __init__(self, runs=('2026100900',)):
        self.objects, self.versions, self.calls, self.faults, self.pages = {}, {}, Counter(), {}, {}
        for run in runs:
            cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=timezone.utc)
            for hour, url in zip(r.hours_for(run), r.source_urls(run)):
                kind = 'max' if (cycle.hour+hour) % 24 == 6 else 'min'
                body = b''.join(b'GRIB'+b'\x00'*3+bytes([p])+(24).to_bytes(8, 'big')+b'\x00'*4+b'7777'
                                for p in r.nbm.PERCENTILES)
                index = '\n'.join(f'{i+1}:{i*24}:d={run}:TMP:2 m above ground:{hour-18}-{hour} hour {kind} fcst:{p}% level'
                                  for i, p in enumerate(r.nbm.PERCENTILES))+'\n4:72:other'
                for source, content in ((url, body), (url+'.idx', index.encode())):
                    self.objects[source] = content
                    self.versions[source] = dict(etag='"'+source.split('/')[-1]+'"', size=len(content), published=cycle+timedelta(minutes=10))

    def xml(self, prefix, sources, truncated=False, token=None):
        ns = '{'+r.NS['s']+'}'
        root = ET.Element(ns+'ListBucketResult')
        for key, value in (('Prefix', prefix), ('KeyCount', str(len(sources))), ('IsTruncated', str(truncated).lower())):
            ET.SubElement(root, ns+key).text = value
        for url in sources:
            entry = ET.SubElement(root, ns+'Contents')
            version = self.versions[url]
            for key, value in (('Key', url[len(r.nbm.BASE):]), ('ETag', version['etag']),
                               ('Size', str(version['size'])), ('LastModified', r.nbm.iso(version['published']))):
                ET.SubElement(entry, ns+key).text = value
        if token is not None:
            ET.SubElement(root, ns+'NextContinuationToken').text = token
        return ET.tostring(root)

    def open(self, request, **kwargs):
        url, headers = request.full_url, dict((k.lower(), v) for k, v in request.header_items())
        byte_range = headers.get('range')
        key = (url, byte_range)
        self.calls[key] += 1
        faults = self.faults.get(key, [])
        if faults:
            fault = faults.pop(0)
            if fault is not None:
                raise fault
        if '?' in url:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            prefix = query['prefix'][0]
            sources = sorted(s for s in self.objects if s.startswith(r.nbm.BASE+prefix))
            token = query.get('continuation-token', [''])[0]
            if query['max-keys'] == ['1']:
                body = self.xml(prefix, sources[:1])
            else:
                body = self.pages.get((prefix, token), self.xml(prefix, sources))
            status, found = 200, {}
        else:
            version = self.versions[url]
            if headers.get('if-match') != version['etag']:
                raise urllib.error.HTTPError(url, 412, 'version changed', {}, None)
            body, status = self.objects[url], 200
            found = {'etag': version['etag'], 'last-modified': format_datetime(version['published'], usegmt=True)}
            if byte_range:
                a, b = map(int, byte_range.removeprefix('bytes=').split('-'))
                body, status = body[a:b+1], 206
                found['content-range'] = f"bytes {a}-{b}/{version['size']}"
        response = io.BytesIO(body)
        response.status, response.headers = status, found
        return response

    def fault(self, url, code=404, byte_range=None, times=1):
        self.faults[(url, byte_range)] = [urllib.error.HTTPError(url, code, 'controlled outage', {}, None)]*times


@contextmanager
def synthetic_decoder():
    import eccodes as e
    import numpy as np
    def metadata(g, row, cycle):
        start, end = cycle+timedelta(hours=row['start']), cycle+timedelta(hours=row['end'])
        return dict(run=r.nbm.iso(cycle), kind='TMAX' if row['kind'] == 'max' else 'TMIN',
                    start=r.nbm.iso(start), end=r.nbm.iso(end), localStart=start.isoformat(), localEnd=end.isoformat(), percentile=row['percentile'])
    with ExitStack() as stack:
        for name, replacement in (('codes_new_from_message', lambda raw: raw[7]),
                                  ('codes_get', lambda g, k: 'grid'),
                                  ('codes_get_array', lambda g, k: np.full(100, 38.8 if k == 'latitudes' else -90.79)),
                                  ('codes_get_double_elements', lambda g, k, indices: np.full(len(indices), 270+g/10)),
                                  ('codes_release', lambda g: None)):
            stack.enter_context(patch.object(e, name, replacement))
        stack.enter_context(patch.object(r.nbm, 'metadata', metadata))
        yield


class RefreshTests(unittest.TestCase):
    def retained_setup(self, directory):
        data = json.loads(gzip.decompress((Path(__file__).parent/'fixtures/weather/nbm-quartile-daily-short-recorded.json.gz').read_bytes()))
        r.publish_local(directory, data)
        planned = [(p['members'][0]['url'], [dict(offset=int(m['byteRange'].split('-')[0]),
                   stop=int(m['byteRange'].split('-')[1]), percentile=m['percentile']) for m in p['members']]) for p in data['periods']]
        client = r.Client(delay=0)
        client.get = Mock()
        client.versions = {p['members'][0]['url']: dict(etag=p['members'][0]['etag'],
                           published=parsedate_to_datetime(p['members'][0]['publishedAt'])) for p in data['periods']}
        return data, planned, client

    def test_unchanged_gate_preserves_validated_bytes_and_age(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            data, planned, client = self.retained_setup(p)
            before = (p/'nbm-range.json').read_bytes()
            self.assertEqual(r.retained_unchanged(client, p, '2026100900', planned), data)
            client.get.assert_not_called()
            self.assertEqual((p/'nbm-range.json').read_bytes(), before)

    def test_full_horizon_unchanged_gate_preserves_source_age(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            data = json.loads(gzip.decompress((Path(__file__).parent/'fixtures/weather/nbm-quartile-daily-recorded.json.gz').read_bytes()))
            r.publish_local(target, data)
            planned = [(p['members'][0]['url'], [dict(offset=int(m['byteRange'].split('-')[0]), stop=int(m['byteRange'].split('-')[1]), percentile=m['percentile']) for m in p['members']]) for p in data['periods']]
            client = r.Client()
            client.get = Mock()
            client.versions = {p['members'][0]['url']: dict(etag=p['members'][0]['etag'],
                               published=parsedate_to_datetime(p['members'][0]['publishedAt'])) for p in data['periods']}
            before = (target/'nbm-range.json').read_bytes()
            self.assertEqual(r.retained_unchanged(client, target, '2026100900', planned), data)
            client.get.assert_not_called()
            self.assertEqual((target/'nbm-range.json').read_bytes(), before)

    def test_missing_final_horizon_index_cannot_publish_shorter_plan(self):
        transport = OfflineNoaa()
        transport.fault(r.source_urls('2026100900')[-1]+'.idx', times=3)
        client = r.Client(delay=0)
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            with self.assertRaises(r.Pending): r.choose_plan(client, ['2026100900'], delay=0)
        self.assertEqual(client.counts['index']['requests'], 20)
        self.assertEqual(client.counts['index']['completed'], 17)
        self.assertEqual(client.counts['grib']['requests'], 0)

    def test_short_cached_horizon_cannot_skip_full_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            _, planned, client = self.retained_setup(target)
            self.assertIsNone(r.retained_unchanged(client, target, '2026100900', planned*3))
            client.get.assert_not_called()

    def test_source_revision_requires_reextraction(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            _, planned, client = self.retained_setup(p)
            client.versions[planned[0][0]]['etag'] = 'new version'
            self.assertIsNone(r.retained_unchanged(client, p, '2026100900', planned))

    def test_late_retained_revision_leaves_capacity_for_full_reextraction(self):
        transport = OfflineNoaa()
        data = json.loads(gzip.decompress((Path(__file__).parent/'fixtures/weather/nbm-quartile-daily-recorded.json.gz').read_bytes()))
        for period, url in zip(data['periods'], r.source_urls('2026100900')):
            for i, member in enumerate(period['members']):
                member.update(byteRange=f'{24*i}-{24*i+23}', etag=transport.versions[url]['etag'],
                              publishedAt=format_datetime(transport.versions[url]['published'], usegmt=True))
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            r.publish_local(p, data)
            before = (p/'nbm-range.json').read_bytes()
            last = r.source_urls('2026100900')[-1]
            transport.versions[last]['etag'] = '"late revision"'
            client = r.Client()
            def build(client, run, planned):
                self.assertIsNone(r.retained_unchanged(client, p, run, planned))
                return r.region(client, run, planned)
            with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
                _, result, _ = r.choose_plan(client, ['2026100900'], delay=0, build=build)
            self.assertEqual(len(result['periods']), 18)
            self.assertEqual(client.requests, 73)
            self.assertEqual(client.counts['grib']['requests'], 54)
            self.assertFalse(any(byte_range == 'bytes=0-0' for _, byte_range in transport.calls))
            self.assertEqual((p/'nbm-range.json').read_bytes(), before)

    def test_unchanged_refresh_never_extracts_or_republishes(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            data, planned, client = self.retained_setup(p)
            client.started, client.bytes, client.requests = time.monotonic(), 0, 0
            before = (p/'nbm-range.json').read_bytes()
            with patch.object(r, 'datetime') as clock, patch.object(r, 'Client', return_value=client), \
                 patch.object(r, 'inventory'), patch.object(r, 'plan', return_value=planned), patch.object(r, 'region') as extract, \
                 patch.object(r, 'publish_local') as publish:
                clock.now.return_value = datetime.fromisoformat(data['retrievedAt'].replace('Z', '+00:00'))
                clock.strptime.side_effect = datetime.strptime
                clock.fromisoformat.side_effect = datetime.fromisoformat
                report = r.refresh(p, run='2026100900')
            self.assertEqual(report['status'], 'unchanged')
            self.assertIs(report['changed'], False)
            extract.assert_not_called()
            publish.assert_not_called()
            self.assertEqual((p/'nbm-range.json').read_bytes(), before)

    def test_missing_or_invalid_receipt_cannot_skip_validation(self):
        for kind in ['missing', 'changed-data', 'new-cycle']:
            with tempfile.TemporaryDirectory() as directory:
                p = Path(directory)
                _, planned, client = self.retained_setup(p)
                if kind == 'missing': (p/'nbm-receipt.json').unlink()
                if kind == 'changed-data': (p/'nbm-range.json').write_text('{}')
                run = '2026100718' if kind == 'new-cycle' else '2026100900'
                self.assertIsNone(r.retained_unchanged(client, p, run, planned))
                client.get.assert_not_called()

    def test_legacy_and_mixed_receipts_force_native_extraction(self):
        import hashlib
        for filename in ['nbm-regional-recorded.json.gz', 'nbm-regional-full-recorded.json.gz']:
            for validator in ['regional-v1', r.VALIDATOR]:
                with tempfile.TemporaryDirectory() as directory:
                    p = Path(directory)
                    raw = gzip.decompress((Path(__file__).parent/'fixtures/weather'/filename).read_bytes())
                    data = json.loads(raw)
                    (p/'nbm-range.json').write_bytes(raw)
                    r.atomic(p/'nbm-receipt.json', dict(validator=validator,run=data['run'],sha256=hashlib.sha256(raw).hexdigest()))
                    client = Mock()
                    run = datetime.fromisoformat(data['run'].replace('Z','+00:00')).strftime('%Y%m%d%H')
                    self.assertIsNone(r.retained_unchanged(client,p,run,[None]*len(data['periods'])))
                    client.get.assert_not_called()
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);data,planned,client=self.retained_setup(p)
            data['periods'][0]['kelvin'][0]=[300,290,310];r.publish_local(p,data)
            self.assertIsNone(r.retained_unchanged(client,p,'2026100900',planned));client.get.assert_not_called()

    def test_native_schedule(self):
        for hour in range(24):
            run = f'20261007{hour:02}'
            hours = r.hours_for(run)
            self.assertEqual(len(hours), 18)
            self.assertGreaterEqual(hours[0], 18)
            self.assertTrue(all((hour+h) % 24 in (6, 18) for h in hours))
            self.assertEqual([b-a for a, b in zip(hours, hours[1:])], [12]*17)

    def test_delayed_indexes_retry_then_ready(self):
        transport = OfflineNoaa()
        transport.fault(r.source_urls('2026100900')[-1]+'.idx', times=2)
        client = r.Client()
        sleep = Mock()
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            run, planned, notes = r.choose_plan(client, ['2026100900'], sleep=sleep)
        self.assertEqual((run, len(planned)), ('2026100900', 18))
        self.assertEqual(client.counts['index']['requests'], 20)
        self.assertEqual(client.counts['index']['completed'], 18)
        self.assertEqual(sleep.call_count, 2)
        self.assertTrue(any('index retry' in note for note in notes))

    def test_late_grib_retry_preserves_completed_downloads(self):
        transport = OfflineNoaa()
        url = r.source_urls('2026100900')[-1]
        transport.fault(url, byte_range='bytes=48-71')
        client = r.Client()
        with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
            run, data, notes = r.choose_plan(client, ['2026100900'], delay=0, build=r.region)
        self.assertEqual(run, '2026100900')
        self.assertEqual(len(data['periods']), 18)
        self.assertEqual(client.counts['index']['requests'], 18)
        self.assertEqual(client.counts['grib']['requests'], 55)
        self.assertEqual(client.counts['grib']['completed'], 54)
        self.assertEqual(sum(transport.calls.values()), 74)
        self.assertEqual(transport.calls[(url, 'bytes=48-71')], 2)
        self.assertTrue(all(n == 1 for key, n in transport.calls.items() if key != (url, 'bytes=48-71')))
        self.assertTrue(any('grib retry' in note for note in notes))

    def test_fallback_only_after_bounded_retries(self):
        transport = OfflineNoaa(('2026100906', '2026100900'))
        transport.fault(r.source_urls('2026100906')[0]+'.idx', code=503, times=2)
        client = r.Client()
        with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
            run, data, notes = r.choose_plan(client, ['2026100906', '2026100900'], attempts=2, delay=0, build=r.region)
        self.assertEqual(run, '2026100900')
        self.assertEqual(client.counts['index']['requests'], 20)
        self.assertEqual(len(data['periods']), 18)
        self.assertTrue(any('fallback' in note for note in notes))

    def test_denials_and_invalid_data_fail_closed(self):
        for error in [urllib.error.HTTPError('url', 403, 'Forbidden', {}, None), ValueError('crossed percentiles')]:
            with patch.object(r, 'inventory'), patch.object(r, 'plan', side_effect=error) as plan:
                with self.assertRaises(type(error)): r.choose_plan(r.Client(), ['new', 'old'], delay=0)
                self.assertEqual(plan.call_count, 1)

    def test_partial_index_is_retryable(self):
        text = '1:0:d=2026100712:TMP:2 m above ground:0-18 hour max fcst:25% level\n2:100:other'
        client = r.Client(attempts=1)
        client.reserve(72)
        client.versions = {r.source_urls('2026100712')[0]+'.idx': dict(size=len(text))}
        with patch.object(r, 'read_source', return_value=(text.encode(), 200, {})):
            with self.assertRaises(r.Pending): r.plan(client, '2026100712')

    def test_mixed_partial_index_is_invalid_not_pending(self):
        text = ('1:0:d=2026100712:TMP:2 m above ground:0-18 hour max fcst:25% level\n'
                '2:100:d=2026100712:TMP:2 m above ground:0-18 hour min fcst:50% level\n3:200:other')
        client = r.Client()
        client.reserve(72)
        client.versions = {r.source_urls('2026100712')[0]+'.idx': dict(size=len(text))}
        with patch.object(r, 'read_source', return_value=(text.encode(), 200, {})):
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

    def test_incomplete_newest_uses_complete_fallback_without_index_work(self):
        newest, older = '2026100906', '2026100900'
        transport = OfflineNoaa((newest, older))
        del transport.objects[r.source_urls(newest)[-1]]
        client = r.Client()
        with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
            run, data, notes = r.choose_plan(client, [newest, older], delay=0, build=r.region)
        self.assertEqual(run, older)
        self.assertEqual(len(data['periods']), 18)
        self.assertEqual(client.requests, 74)
        self.assertTrue(any('missing 1 required' in note for note in notes))
        self.assertTrue(any('fallback' in note for note in notes))
        self.assertFalse(any(url in r.source_urls(newest) or url.removesuffix('.idx') in r.source_urls(newest)
                             for url, _ in transport.calls))

    def test_full_discovery_overhead_still_leaves_complete_extraction(self):
        now = datetime(2026, 10, 10, 15, tzinfo=timezone.utc)
        transport = OfflineNoaa(('2026100917', '2026100916'))
        client = r.Client()
        with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
            candidates = r.discover(client, now)
            run, data, _ = r.choose_plan(client, candidates, delay=0, build=r.region)
        self.assertEqual(candidates, ['2026100917', '2026100916'])
        self.assertEqual(run, candidates[0])
        self.assertEqual(len(data['periods']), 18)
        self.assertEqual(client.counts['discovery']['requests'], 24)
        self.assertEqual(client.requests, 97)
        self.assertEqual(client.reserved_requests, 0)
        self.assertEqual(client.reserved_bytes, 0)

    def test_inventory_follows_encoded_continuation_and_stops_after_required_keys(self):
        transport = OfflineNoaa()
        prefix = 'blend.20261009/00/qmd/'
        sources = sorted(transport.objects)
        token = 'next+/=&'
        transport.pages[(prefix, '')] = transport.xml(prefix, sources[:18], True, token)
        # Unrelated later keys may be truncated; all required keys are confirmed.
        transport.pages[(prefix, token)] = transport.xml(prefix, sources[18:], True)
        client = r.Client()
        client.reserve(72)
        with patch.object(r.urllib.request, 'urlopen', transport.open): r.inventory(client, '2026100900')
        self.assertEqual(len(client.versions), 36)
        self.assertEqual(client.requests, 2)
        self.assertTrue(any('continuation-token=next%2B%2F%3D%26' in url for url, _ in transport.calls))

    def test_truncated_inventory_is_bounded_and_never_accepts_partial_keys(self):
        transport = OfflineNoaa()
        prefix = 'blend.20261009/00/qmd/'
        sources = sorted(transport.objects)
        for i in range(4):
            token = '' if not i else str(i)
            transport.pages[(prefix, token)] = transport.xml(prefix, sources[i:i+1], True, str(i+1))
        client = r.Client()
        client.reserve(72)
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            with self.assertRaisesRegex(r.Pending, 'within 4 inventory pages'): r.inventory(client, '2026100900')
        self.assertEqual(client.requests, 4)
        self.assertEqual(client.versions, {})

    def test_malformed_inventory_and_repeated_tokens_fail_closed(self):
        transport = OfflineNoaa()
        prefix = 'blend.20261009/00/qmd/'
        sources = sorted(transport.objects)
        for token in (None, 'same'):
            transport.pages[(prefix, '')] = transport.xml(prefix, sources[:1], True, token)
            transport.pages[(prefix, 'same')] = transport.xml(prefix, [], True, 'same')
            client = r.Client()
            client.reserve(72)
            with patch.object(r.urllib.request, 'urlopen', transport.open):
                with self.assertRaisesRegex(ValueError, 'continuation token'): r.inventory(client, '2026100900')
            self.assertEqual(client.versions, {})
        for old, new in ((b'<ns0:IsTruncated>false', b'<ns0:IsTruncated>unknown'),
                         (b'<ns0:KeyCount>36', b'<ns0:KeyCount>1001'),
                         (b'<ns0:ETag>"', b'<ns0:ETag>*')):
            transport.pages[(prefix, '')] = transport.xml(prefix, sources).replace(old, new)
            with patch.object(r.urllib.request, 'urlopen', transport.open):
                with self.assertRaises(ValueError): r.choose_plan(r.Client(), ['2026100900'], delay=0)

    def test_inventory_retries_only_failed_page(self):
        transport = OfflineNoaa()
        prefix = 'blend.20261009/00/qmd/'
        sources = sorted(transport.objects)
        transport.pages[(prefix, '')] = transport.xml(prefix, sources[:18], True, 'next')
        transport.pages[(prefix, 'next')] = transport.xml(prefix, sources[18:])
        query = {'list-type': 2, 'max-keys': 1000, 'prefix': prefix, 'continuation-token': 'next'}
        url = r.nbm.BASE+'?'+urllib.parse.urlencode(query)
        transport.fault(url, 503)
        client = r.Client(delay=0)
        client.reserve(72)
        with patch.object(r.urllib.request, 'urlopen', transport.open): r.inventory(client, '2026100900')
        self.assertEqual(sorted(transport.calls.values()), [1, 2])
        self.assertEqual(client.counts['inventory']['retries'], 1)

    def test_candidate_and_retry_admission_do_not_consume_reserved_capacity(self):
        transport = OfflineNoaa()
        client = r.Client()
        client.requests = 29
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            with self.assertRaises(r.Pending): r.choose_plan(client, ['2026100900'], delay=0)
        self.assertEqual(transport.calls, {})
        self.assertEqual(client.requests, 29)
        client = r.Client()
        client.requests = 27
        url = r.source_urls('2026100900')[0]+'.idx'
        transport.fault(url, 503, times=3)
        sleep = Mock()
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            with self.assertRaises(r.Pending): r.choose_plan(client, ['2026100900'], sleep=sleep)
        self.assertEqual(client.requests, 29)
        self.assertEqual(transport.calls[(url, None)], 1)
        sleep.assert_not_called()
        self.assertTrue(any('BudgetExceeded' in note for note in client.notes))

    def test_exact_bytes_reserved_after_indexes_before_any_grib_download(self):
        transport = OfflineNoaa()
        client = r.Client()
        client.versions = transport.versions.copy()
        index_bytes = sum(len(body) for url, body in transport.objects.items() if url.endswith('.idx'))
        client.bytes = r.LIMITS['downloadBytes']-index_bytes-54*24+1
        with patch.object(r, 'inventory'), patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
            with self.assertRaises(r.Pending): r.choose_plan(client, ['2026100900'], delay=0, build=r.region)
        self.assertEqual(client.counts['index']['completed'], 18)
        self.assertEqual(client.counts['grib']['requests'], 0)
        self.assertTrue(any('reservedBytes=1296' in note for note in client.notes))

    def test_changed_source_version_during_download_fails_without_reuse_or_fallback(self):
        for changed in ('etag', 'published', 'size'):
            transport = OfflineNoaa(('2026100906', '2026100900'))
            client = r.Client()
            def build(client, run, planned):
                url = planned[-1][0]
                if changed == 'etag': transport.versions[url]['etag'] = '"revised"'
                if changed == 'published': transport.versions[url]['published'] += timedelta(seconds=1)
                if changed == 'size': transport.versions[url]['size'] += 1
                return r.region(client, run, planned)
            with patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder():
                with self.assertRaises(ValueError): r.choose_plan(client, ['2026100906', '2026100900'], delay=0, build=build)
            self.assertEqual(client.counts['inventory']['requests'], 1)
            self.assertEqual(client.counts['grib']['completed'], 51)
            self.assertEqual(client.counts['grib']['requests'], 52)

    def test_partial_response_bytes_count_toward_retry_reservation(self):
        import http.client
        transport = OfflineNoaa()
        url = r.source_urls('2026100900')[0]+'.idx'
        normal_open = transport.open
        failed = False
        def open(request, **kwargs):
            nonlocal failed
            response = normal_open(request, **kwargs)
            if request.full_url == url and not failed:
                failed = True
                response.read = Mock(side_effect=http.client.IncompleteRead(b'partial'))
            return response
        client = r.Client()
        with patch.object(r.urllib.request, 'urlopen', open):
            r.choose_plan(client, ['2026100900'], delay=0)
        expected = sum(len(body) for source, body in transport.objects.items() if source.endswith('.idx'))+len(b'partial')
        self.assertEqual(client.counts['index']['downloadBytes'], expected)
        self.assertEqual(client.counts['index']['requests'], 19)

    def test_retry_sleep_and_oversized_body_cannot_exceed_time_or_byte_limits(self):
        transport = OfflineNoaa()
        client = r.Client()
        client.started -= 599
        client.reserve(72)
        sleep = Mock()
        client.sleep = sleep
        client.delay = 15
        with self.assertRaises(r.BudgetExceeded):
            client.step('2026100900', 'inventory', 'url', Mock(side_effect=TimeoutError('late response')))
        sleep.assert_not_called()
        client = r.Client()
        client.bytes = r.LIMITS['downloadBytes']-1
        with patch.object(r.urllib.request, 'urlopen', transport.open):
            with self.assertRaises(r.BudgetExceeded): client.get('url', limit=1)
        self.assertEqual(client.requests, 0)
        self.assertLessEqual(client.bytes, r.LIMITS['downloadBytes'])

    def test_failure_report_keeps_trigger_candidate_range_counts_and_fallback_admission(self):
        transport = OfflineNoaa(('2026100906', '2026100900'))
        client = r.Client()
        client.requests = 27  # 27 prior discovery requests leave exactly 73 calls.
        client.counts['discovery']['requests'] = 27
        url = r.source_urls('2026100906')[-1]
        transport.fault(url, byte_range='bytes=48-71', times=3)
        with tempfile.TemporaryDirectory() as directory, patch.object(r, 'Client', return_value=client), \
             patch.object(r, 'discover', return_value=['2026100906', '2026100900']), \
             patch.object(r.urllib.request, 'urlopen', transport.open), synthetic_decoder(), patch.object(r, 'datetime') as clock:
            clock.now.return_value = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
            clock.strptime.side_effect, clock.fromisoformat.side_effect = datetime.strptime, datetime.fromisoformat
            p = Path(directory)
            r.atomic(p/'nbm-range.json', {'run': '2026-10-08T18:00:00Z', 'retrievedAt': '2026-10-08T20:00:00Z'})
            before = (p/'nbm-range.json').read_bytes()
            report = r.refresh(p, delay=0)
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['candidateRuns'], ['2026100906', '2026100900'])
            self.assertEqual(report['requests'], 100)
            self.assertEqual(report['phaseCounts']['grib']['completed'], 53)
            self.assertEqual(report['requests'], sum(p['requests'] for p in report['phaseCounts'].values()))
            self.assertEqual(report['downloadBytes'], sum(p['downloadBytes'] for p in report['phaseCounts'].values()))
            self.assertTrue(any(e.get('url') == url and e.get('byteRange') == 'bytes=48-71' and e.get('candidate') == '2026100906'
                                for e in report['diagnostics']))
            self.assertTrue(any(e.get('candidate') == '2026100900' and e.get('phase') == 'admission' and 'BudgetExceeded' in e.get('error', '')
                                for e in report['diagnostics']))
            self.assertEqual((p/'nbm-range.json').read_bytes(), before)
            self.assertFalse((p/'nbm-receipt.json').exists())
            self.assertEqual(json.loads((p/'nbm-status.json').read_text()), report)

    def test_workflow_has_bounded_schedule_and_main_only_writer(self):
        workflow = (Path(__file__).parent.parent/'.github/workflows/nbm-refresh.yml').read_text()
        active = '\n'.join(line for line in workflow.splitlines() if not line.lstrip().startswith('#'))
        self.assertIn('workflow_dispatch:', active)
        self.assertIn('schedule:', active)
        self.assertIn("cron: '17 * * * *'", active)
        self.assertIn('contents: read', active)
        self.assertIn("if: ${{ github.ref == 'refs/heads/main' && vars.NBM_REFRESH_ENABLED != 'false' && needs.extract.outputs.publishable == 'true' }}", active)
        self.assertEqual(active.count('contents: write'), 1)
        self.assertNotIn('secrets.', active)
        self.assertIn('retention-days: 3', active)


if __name__ == '__main__': unittest.main()
