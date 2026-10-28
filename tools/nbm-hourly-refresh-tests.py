import gzip
import importlib.util
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('hourly', Path(__file__).with_name('nbm-hourly-refresh.py'))
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FIX = Path(__file__).parent/'fixtures/weather'

class Tests(unittest.TestCase):
    def test_actual_subset_metadata_and_edges(self):
        raw = gzip.decompress((FIX/'nbm-hourly-subset-recorded.grib2.gz').read_bytes())
        grid,cells,values=m.decode(raw,datetime(2026,10,8,6,tzinfo=timezone.utc),12)
        self.assertEqual(len(cells),2969)
        self.assertTrue(all(a<=b<=c for a,b,c in values))
        with self.assertRaises(ValueError):m.decode(raw,datetime(2026,10,8,6,tzinfo=timezone.utc),13)
        with self.assertRaises(ValueError):m.decode(raw,datetime(2026,10,8,6,tzinfo=timezone.utc),12,'wronggrid')
        with self.assertRaises(ValueError):m.decode(raw[:-2],datetime(2026,10,8,6,tzinfo=timezone.utc),12)
    def test_denied_not_retried(self):
        c=m.Client()
        with patch.object(m.urllib.request,'urlopen',side_effect=urllib.error.HTTPError('u',403,'Forbidden',{},None)),patch.object(m.time,'sleep')as wait:
            with self.assertRaises(urllib.error.HTTPError):c.request('https://nomads.ncep.noaa.gov/')
            self.assertEqual(c.requests,1);wait.assert_not_called()
    def test_transient_bounded_retry(self):
        c=m.Client()
        with patch.object(m.urllib.request,'urlopen',side_effect=TimeoutError()),patch.object(m.time,'sleep'):
            with self.assertRaises(TimeoutError):c.request('https://nomads.ncep.noaa.gov/')
            self.assertEqual(c.requests,2)
            self.assertEqual([e['attempt'] for e in c.errors],[1,2])

    def test_302_report_identifies_metadata_failure_without_retry_or_secrets(self):
        now=datetime.now(timezone.utc)
        run=now.replace(hour=(now.hour//6)*6).strftime('%Y%m%d%H')
        url=m.urls(run,1)[0]
        error=urllib.error.HTTPError(url+'?token=PRIVATE_QUERY#PRIVATE_FRAGMENT',302,'PRIVATE_REASON',{
            'Location':'https://PRIVATE_USER:PRIVATE_PASSWORD@nomads.ncep.noaa.gov/login/PRIVATE_PATH?token=PRIVATE_REDIRECT#PRIVATE_HASH',
            'Set-Cookie':'session=PRIVATE_COOKIE'},None)
        with tempfile.TemporaryDirectory()as t:
            d=Path(t);original=b'{"run":"last-good","retrievedAt":"unchanged"}'
            (d/'nbm-hourly.json').write_bytes(original)
            with patch.object(m,'available',return_value=True),patch.object(m.urllib.request,'urlopen',side_effect=error)as net,patch.object(m.time,'sleep')as wait:
                report=m.refresh(d,run=run)
            self.assertEqual(report['status'],'failed');self.assertEqual(report['requests'],1)
            net.assert_called_once();wait.assert_not_called()
            self.assertEqual((d/'nbm-hourly.json').read_bytes(),original)
            event=report['diagnostics'][0]
            self.assertEqual({k:event[k]for k in ('candidate','phase','forecastHour','method','attempt','httpStatus')},
                             dict(candidate=run,phase='metadata-before',forecastHour=1,method='HEAD',attempt=1,httpStatus=302))
            self.assertEqual(event['url'],url);self.assertEqual(event['responseUrl'],url)
            self.assertEqual(event['redirectUrl'],'https://nomads.ncep.noaa.gov/[redacted]')
            self.assertEqual(report['lastOperation']['url'],url)
            self.assertNotIn('PRIVATE_',json.dumps(report))
            self.assertEqual(json.loads((d/'nbm-hourly-status.json').read_text()),report)

    def test_subset_and_post_decode_metadata_errors_keep_their_phase(self):
        run='2026100900'
        version=dict(publishedAt='2026-10-09T08:00:00Z',contentLength=10000)
        for phase in ('subset','metadata-after'):
            c=m.Client();error=urllib.error.HTTPError(m.urls(run,1)[0],302,'Moved',{'Location':'/cgi-bin/filter_blend.pl?token=PRIVATE'},None)
            body=io.BytesIO(b'test');body.status=200;body.headers={}
            calls=0;original=c.version
            def version_call(url,stamp):
                nonlocal calls
                calls+=1
                return version if calls<=48 else original(url,stamp)
            responses=[error]if phase=='subset'else[body,error]
            with tempfile.TemporaryDirectory()as t,patch.object(c,'version',side_effect=version_call),patch.object(m,'decode',return_value=('grid',[],[])),patch.object(m.urllib.request,'urlopen',side_effect=responses),patch.object(m.time,'sleep')as wait:
                with self.assertRaises(urllib.error.HTTPError):m.extract(c,Path(t),run)
            self.assertEqual(c.errors[-1]['phase'],phase)
            self.assertEqual(c.errors[-1]['method'],'GET'if phase=='subset'else'HEAD')
            self.assertEqual(c.errors[-1]['redirectUrl'],'https://nomads.ncep.noaa.gov/cgi-bin/filter_blend.pl')
            wait.assert_not_called()

    def test_malformed_redirect_cannot_replace_original_http_error(self):
        c=m.Client();error=urllib.error.HTTPError('https://nomads.ncep.noaa.gov/',302,'Moved',{'Location':'https://[invalid'},None)
        with patch.object(m.urllib.request,'urlopen',side_effect=error):
            with self.assertRaises(urllib.error.HTTPError)as caught:c.request(m.FILTER,head=True)
        self.assertIs(caught.exception,error);self.assertEqual(c.errors[-1]['redirectUrl'],'[invalid URL]')

    def test_download_diagnostic_history_is_bounded(self):
        c=m.Client();error=urllib.error.HTTPError(m.FILTER,302,'Moved',{},None)
        with patch.object(m.urllib.request,'urlopen',side_effect=error):
            for hour in range(1,11):
                c.context=dict(candidate='2026100900',phase='subset',forecastHour=hour)
                with self.assertRaises(urllib.error.HTTPError):c.request(m.FILTER)
        self.assertEqual(c.requests,10);self.assertEqual(len(c.errors),8)
        self.assertEqual([e['forecastHour']for e in c.errors],list(range(3,11)))
    def test_resource_caps_before_network(self):
        for kind in ('requests','bytes','time'):
            c=m.Client()
            if kind=='requests':c.requests=m.LIMITS['requests']
            elif kind=='bytes':c.bytes=m.LIMITS['downloadBytes']
            else:c.started-=601
            with patch.object(m.urllib.request,'urlopen')as net:
                with self.assertRaises(RuntimeError):c.request('https://nomads.ncep.noaa.gov/')
                net.assert_not_called()
    def test_failure_retains_bytes_and_timestamp(self):
        with tempfile.TemporaryDirectory()as t:
            d=Path(t);original=b'{"run":"2026-10-08T06:00:00Z","retrievedAt":"2026-10-08T14:00:00Z"}'
            (d/'nbm-hourly.json').write_bytes(original)
            with patch.object(m,'choose',side_effect=TimeoutError('test')):result=m.refresh(d)
            self.assertEqual(result['status'],'failed');self.assertEqual((d/'nbm-hourly.json').read_bytes(),original)
    def test_source_revision_cannot_publish(self):
        with tempfile.TemporaryDirectory()as t:
            c=m.Client();v={'publishedAt':'2026-10-08T13:14:13Z','contentLength':10000}
            with patch.object(c,'version',side_effect=[v]*48+[dict(v,contentLength=10001)]),patch.object(c,'request',return_value=(b'test',{})),patch.object(m,'decode',return_value=('a',[],[])):
                with self.assertRaisesRegex(ValueError,'revised'):m.extract(c,Path(t),'2026100806')
    def test_unchanged_preserves_retrieval(self):
        d=json.loads(gzip.decompress((Path(__file__).parent/'fixtures/weather/nbm-quartile-hourly-recorded.json.gz').read_bytes()))
        c=m.Client()
        with tempfile.TemporaryDirectory()as t,patch.object(m,'retained',return_value=d),patch.object(c,'version',side_effect=[h['publication']for h in d['hours']]),patch.object(c,'request')as request:
            found,changed=m.extract(c,Path(t),'2026100900');self.assertIs(found,d);self.assertFalse(changed);request.assert_not_called()

    def test_receipt_and_schema_migration_cannot_be_noop(self):
        import hashlib
        for validator in ['hourly-v1', m.VALIDATOR]:
            with tempfile.TemporaryDirectory() as t:
                p=Path(t);raw=gzip.decompress((FIX/'nbm-hourly-full-recorded.json.gz').read_bytes());d=json.loads(raw)
                (p/'nbm-hourly.json').write_bytes(raw)
                (p/'nbm-hourly-receipt.json').write_text(json.dumps(dict(validator=validator,run=d['run'],sha256=hashlib.sha256(raw).hexdigest())))
                self.assertIsNone(m.retained(p,d['run']))
        d=json.loads(gzip.decompress((FIX/'nbm-quartile-hourly-recorded.json.gz').read_bytes()))
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)
            def write():
                raw=(json.dumps(d,separators=(',',':'))+'\n').encode();(p/'nbm-hourly.json').write_bytes(raw)
                (p/'nbm-hourly-receipt.json').write_text(json.dumps(dict(validator=m.VALIDATOR,run=d['run'],sha256=hashlib.sha256(raw).hexdigest())))
            write();self.assertEqual(m.retained(p,d['run']),d)
            d['hours'][30]['percentiles']=[10,50,90];write();self.assertIsNone(m.retained(p,d['run']))

    def test_inventory_requires_every_fixed_native_hour(self):
        c=m.Client();prefix='blend.20261008/06/qmd/'
        def listing(hours):
            return ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>'+''.join('<Contents><Key>'+prefix+f'blend.t06z.qmd.f{h:03}.co.grib2'+'</Key></Contents>'for h in hours)+'</ListBucketResult>').encode()
        with patch.object(c,'request',return_value=(listing(range(1,49)),{})):
            self.assertTrue(m.available(c,'2026100806'))
        with patch.object(c,'request',return_value=(listing(range(1,49)).replace(b'<IsTruncated>false',b'<IsTruncated>true'),{})):
            self.assertTrue(m.available(c,'2026100806'))
        with patch.object(c,'request',return_value=(listing(range(1,48)),{})):
            with self.assertRaises(m.Pending):m.available(c,'2026100806')
        with patch.object(c,'request',return_value=(listing([]),{})):
            self.assertFalse(m.available(c,'2026100806'))
    def test_partial_publication_retry_then_independent_older_cycle(self):
        with tempfile.TemporaryDirectory()as t,patch.object(m,'available',side_effect=[m.Pending('late'),m.Pending('late'),True]),patch.object(m,'extract',return_value=({'run':'older'},False))as extract:
            wait=unittest.mock.Mock();d,changed,notes=m.choose(m.Client(),Path(t),['2026100806','2026100800'],sleep=wait)
            self.assertFalse(changed);self.assertEqual(len(notes),2);wait.assert_called_once_with(15)
            self.assertEqual(extract.call_args.args[2],'2026100800')
    def test_access_denial_never_falls_back(self):
        with tempfile.TemporaryDirectory()as t,patch.object(m,'available',side_effect=urllib.error.HTTPError('u',403,'Forbidden',{},None))as available:
            wait=unittest.mock.Mock()
            with self.assertRaises(urllib.error.HTTPError):m.choose(m.Client(),Path(t),['2026100806','2026100800'],sleep=wait)
            self.assertEqual(available.call_count,1);wait.assert_not_called()

if __name__=='__main__':unittest.main()
