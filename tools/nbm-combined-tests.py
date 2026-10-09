#!/usr/bin/env python3
"""Offline transactional publication, cadence and producer-isolation tests."""
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'tools'/filename)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

m = load('combined', 'nbm-combined-publish.py')
r = load('runner', 'nbm-combined-refresh.py')
git = m.daily.git


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo, self.remote, self.directory = root/'repo', root/'remote', root/'candidate'
        for p in (self.repo, self.remote, self.directory): p.mkdir()
        git(self.remote, 'init', '--bare', '--initial-branch=main'); git(self.repo, 'init', '--initial-branch=main')
        git(self.repo, 'config', 'user.email', 'test@example.invalid'); git(self.repo, 'config', 'user.name', 'Test')
        (self.repo/'app.txt').write_text('original'); git(self.repo, 'add', '.'); git(self.repo, 'commit', '-m', 'base')
        git(self.repo, 'remote', 'add', 'origin', str(self.remote)); git(self.repo, 'push', 'origin', 'main')
        self.base = self.head()
        self.now = datetime(2026, 10, 9, 14, 20, tzinfo=timezone.utc)
        self.data = {name: json.loads(gzip.decompress((ROOT/'tools/fixtures/weather'/file).read_bytes())) for name,file in [('daily','nbm-quartile-daily-recorded.json.gz'),('hourly','nbm-quartile-hourly-recorded.json.gz')]}
        self.write()

    def head(self): return git(self.remote, 'rev-parse', 'main').stdout.decode().strip()
    def write(self, changed=True):
        for name,p in m.PRODUCTS.items():
            data = self.data[name]; raw = (json.dumps(data,separators=(',',':'))+'\n').encode()
            (self.directory/Path(p.PATHS[0]).name).write_bytes(raw)
            receipt = dict(validator='regional-quartiles-v2' if name=='daily' else 'hourly-quartiles-v2',run=data['run'],sha256=hashlib.sha256(raw).hexdigest())
            (self.directory/Path(p.PATHS[1]).name).write_text(json.dumps(receipt))
            status = 'nbm-status.json' if name=='daily' else 'nbm-hourly-status.json'
            (self.directory/status).write_text(json.dumps(dict(status='ready' if changed else 'unchanged',changed=changed,dataRun=data['run'],checkedAt=self.now.isoformat())))
    def fail(self,name):
        (self.directory/('nbm-status.json' if name=='daily' else 'nbm-hourly-status.json')).write_text('{"status":"failed","changed":false}')
    def publish(self, **kw): return m.publish(self.repo,self.directory,self.base,now=self.now,**kw)
    def app_update(self,path='app.txt',content='changed'):
        (self.repo/path).parent.mkdir(parents=True,exist_ok=True);(self.repo/path).write_text(content)
        git(self.repo,'add',path);git(self.repo,'commit','-m','app change');git(self.repo,'push','origin','main')
    def revise(self):
        for d in self.data.values(): d['retrievedAt']=self.now.isoformat()
        self.write()

    def test_single_atomic_commit_preserves_dirty_index_and_independent_runs(self):
        self.app_update();parent=self.head()
        (self.repo/'dirty').write_text('keep');git(self.repo,'add','dirty')
        result=self.publish();self.assertEqual(result['parent'],parent);self.assertFalse(result['degraded'])
        self.assertEqual(set(git(self.remote,'diff','--name-only',parent,'main').stdout.decode().splitlines()),set(m.PATHS))
        self.assertEqual(git(self.remote,'rev-list','--count',parent+'..main').stdout.strip(),b'1')
        self.assertIn(b'dirty',git(self.repo,'diff','--cached','--name-only').stdout)
        self.assertEqual(result['products']['daily']['run'],self.data['daily']['run']);self.assertEqual(result['products']['hourly']['run'],self.data['hourly']['run'])
    def test_daily_failure_does_not_block_hourly(self):
        self.fail('daily');result=self.publish();self.assertTrue(result['degraded'])
        self.assertIsNone(m.daily.read_at(self.remote,'main',m.daily.PATHS[0]))
        self.assertIsNotNone(m.hourly.publisher.read_at(self.remote,'main',m.hourly.publisher.PATHS[0]))
    def test_hourly_failure_does_not_block_daily(self):
        self.fail('hourly');result=self.publish();self.assertTrue(result['degraded'])
        self.assertIsNone(m.hourly.publisher.read_at(self.remote,'main',m.hourly.publisher.PATHS[0]))
        self.assertIsNotNone(m.daily.read_at(self.remote,'main',m.daily.PATHS[0]))
    def test_both_failed_do_not_commit(self):
        self.fail('daily');self.fail('hourly');self.assertEqual(self.publish()['status'],'failed');self.assertEqual(self.head(),self.base)
    def test_noop_preserves_all_bytes_and_budget_as_clock_advances(self):
        self.publish();head=self.head();self.now+=timedelta(hours=1);self.write(False)
        self.assertEqual(self.publish()['status'],'unchanged');self.assertEqual(self.head(),head)
        out=Path(self.tmp.name)/'seed';result=m.seed(self.repo,out,head,now=self.now)
        self.assertEqual(result['nextPublicationWindow'],'2026-10-09T18:00:00+00:00')
        for p in m.PRODUCTS.values():
            self.assertEqual((out/Path(p.PATHS[0]).name).read_bytes(),(self.directory/Path(p.PATHS[0]).name).read_bytes())
        self.assertEqual([h['forecastHour'] for h in self.data['hourly']['hours']],list(range(1,49)))
    def test_revision_deferred_in_same_window_and_revalidated_next_window(self):
        self.publish();head=self.head();self.now+=timedelta(minutes=10);self.revise()
        self.assertEqual(self.publish()['status'],'deferred');self.assertEqual(self.head(),head)
        self.now=self.now.replace(hour=18,minute=0);self.write()
        self.assertEqual(self.publish()['status'],'published');self.assertNotEqual(self.head(),head)
    def test_sibling_recovery_waits_for_next_budget_window(self):
        self.fail('hourly');self.publish();head=self.head();self.now+=timedelta(minutes=5);self.write()
        self.assertEqual(self.publish()['status'],'deferred');self.assertEqual(self.head(),head)
        self.now=self.now.replace(hour=18,minute=0);self.write();result=self.publish()
        self.assertEqual(result['products']['daily']['status'],'unchanged');self.assertEqual(result['products']['hourly']['status'],'changed')
    def test_bad_receipt_cannot_contribute_bytes(self):
        (self.directory/'nbm-hourly-receipt.json').write_text('{}');result=self.publish()
        self.assertEqual(result['products']['hourly']['status'],'failed');self.assertEqual(result['status'],'published')
    def test_old_status_and_stale_product_cannot_contribute(self):
        self.now+=timedelta(hours=4);result=self.publish();self.assertEqual(result['status'],'failed')
        self.now=self.now.replace(day=10,hour=1);self.write();result=self.publish()
        self.assertEqual(result['products']['daily']['status'],'failed');self.assertEqual(result['products']['hourly']['status'],'failed')
    def test_rollback_is_product_local(self):
        self.publish();self.now=self.now.replace(hour=18,minute=0)
        self.data['daily']['retrievedAt']='2026-10-08T13:00:00Z';self.data['hourly']['retrievedAt']=self.now.isoformat();self.write()
        result=self.publish();self.assertEqual(result['products']['daily']['status'],'failed');self.assertEqual(result['products']['hourly']['status'],'changed')
    def test_race_rejects_entire_transaction(self):
        with self.assertRaises(subprocess.CalledProcessError):self.publish(before_push=self.app_update)
        for p in m.PATHS:self.assertIsNone(m.hourly.publisher.read_at(self.remote,'main',p))
    def test_remote_rejection_leaves_every_pair_and_budget_unchanged(self):
        self.publish();head=self.head();self.now=self.now.replace(hour=18);self.revise()
        hook=self.remote/'hooks/pre-receive';hook.write_text('#!/bin/sh\nexit 1\n');hook.chmod(0o755)
        with self.assertRaises(subprocess.CalledProcessError):self.publish()
        self.assertEqual(self.head(),head)
    def test_obsolete_code_stops_both_products(self):
        self.app_update('tools/changed.py')
        with self.assertRaisesRegex(ValueError,'code changed'):self.publish()
    def test_invalid_future_and_removed_budget_fail_closed(self):
        self.publish();git(self.repo,'fetch','origin','main');git(self.repo,'reset','--hard','FETCH_HEAD')
        for content in ('{}',json.dumps(dict(schema=1,preparedAt='2099-01-01T00:00:00Z',windowStart='2099-01-01T00:00:00Z'))):
            self.app_update(m.MANIFEST,content)
            with self.assertRaises(ValueError):m.budget(self.repo,self.head(),self.now)
        git(self.repo,'rm',m.MANIFEST);git(self.repo,'commit','-m','accidental deletion');git(self.repo,'push','origin','main')
        with self.assertRaisesRegex(ValueError,'missing'):m.budget(self.repo,self.head(),self.now)
    def test_existing_good_pair_survives_sibling_only_publication(self):
        self.publish();old=m.daily.read_at(self.remote,'main',m.daily.PATHS[0]);receipt=m.daily.read_at(self.remote,'main',m.daily.PATHS[1])
        self.now=self.now.replace(hour=18);self.revise();self.fail('daily');result=self.publish()
        self.assertEqual(result['status'],'published');self.assertTrue(result['degraded'])
        self.assertEqual(m.daily.read_at(self.remote,'main',m.daily.PATHS[0]),old)
        self.assertEqual(m.daily.read_at(self.remote,'main',m.daily.PATHS[1]),receipt)
    def test_shallow_bootstrap_rejected(self):
        with patch.object(m.daily,'read_at',return_value=None),patch.object(m.daily,'git')as g:
            g.return_value.stdout=b'true'
            with self.assertRaisesRegex(ValueError,'Complete history'):m.budget(self.repo,self.base,self.now)

    def test_adapter_state_is_isolated(self):
        self.assertEqual(m.daily.MAX_FILE_BYTES,2_000_000);self.assertEqual(m.hourly.publisher.MAX_FILE_BYTES,4_000_000)
        self.assertNotEqual(m.daily.PATHS,m.hourly.publisher.PATHS)


class RunnerAndCadenceTests(unittest.TestCase):
    def test_clock_movement_revisions_and_staggered_arrivals_never_exceed_budget(self):
        for days in (30,31):
            published=0;manifest=None;start=datetime(2026,10,1,tzinfo=timezone.utc)
            # A changed source/revision every hour is the worst case. Failures and noops
            # can only reduce these commits; horizon/time movement alone never changes a payload.
            for hour in range(days*24):
                now=start+timedelta(hours=hour)
                with patch.object(m.daily,'read_at',return_value=manifest),patch.object(m.daily,'git')as g:
                    g.return_value.stdout=b'false' if manifest is None else b''
                    if manifest is None:
                        g.side_effect=[type('R',(),{'stdout':b'false'})(),type('R',(),{'stdout':b''})()]
                    blocked=m.budget(None,None,now)
                if not blocked:
                    published+=1;manifest=json.dumps(dict(schema=1,preparedAt=now.isoformat(),windowStart=m.publication_window(now).isoformat())).encode()
            self.assertEqual(published,days*4)
    def test_bucket_boundary_is_not_a_six_hour_minimum_spacing(self):
        now=datetime(2026,10,8,17,59,tzinfo=timezone.utc)
        raw=json.dumps(dict(schema=1,preparedAt=now.isoformat(),windowStart=m.publication_window(now).isoformat())).encode()
        with patch.object(m.daily,'read_at',return_value=raw):
            self.assertIsNotNone(m.budget(None,None,now));self.assertIsNone(m.budget(None,None,now+timedelta(minutes=1)))
    def test_failure_and_timeout_are_isolated_with_explicit_unknown_resource_use(self):
        for failed in ('daily','hourly'):
            with tempfile.TemporaryDirectory()as t:
                d=Path(t);calls=[]
                def execute(args,**kwargs):
                    name='hourly' if 'hourly' in args[1] else 'daily';calls.append(name)
                    self.assertEqual(kwargs['timeout'],630)
                    if name==failed:raise subprocess.TimeoutExpired(args,630)
                    (d/r.PRODUCTS[name][1]).write_text(json.dumps(dict(status='unchanged',changed=False,requests=3,downloadBytes=42)))
                    return type('Result',(),{'returncode':0})()
                out=r.refresh(d,execute);self.assertEqual(out['status'],'partial');self.assertEqual(calls,['daily','hourly'])
                self.assertTrue(out['products'][failed]['resourceUsageIncomplete']);self.assertTrue(out['resourceUsageIncomplete']);self.assertEqual(out['requests'],3)
    def test_failed_producer_preserves_resource_counters(self):
        with tempfile.TemporaryDirectory()as t:
            d=Path(t)
            def execute(args,**kw):
                name='hourly' if 'hourly' in args[1] else 'daily'
                (d/r.PRODUCTS[name][1]).write_text(json.dumps(dict(status='failed',requests=100,downloadBytes=999)))
                return type('Result',(),{'returncode':1})()
            out=r.refresh(d,execute);self.assertEqual(out['status'],'failed');self.assertEqual(out['requests'],200)
    def test_closed_budget_window_makes_no_noaa_requests_or_timestamp_changes(self):
        with tempfile.TemporaryDirectory()as t:
            d=Path(t);raw=b'last good';(d/'nbm-hourly.json').write_bytes(raw)
            (d/'nbm-seed-status.json').write_text(json.dumps(dict(nextPublicationWindow=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat())))
            with patch.object(subprocess,'run')as execute:
                out=r.refresh(d,execute);execute.assert_not_called()
            self.assertEqual(out['status'],'deferred');self.assertEqual(out['requests'],0);self.assertEqual((d/'nbm-hourly.json').read_bytes(),raw)
    def test_seed_decision_remains_deferred_when_clock_crosses_boundary(self):
        with tempfile.TemporaryDirectory()as t:
            d=Path(t);(d/'nbm-seed-status.json').write_text('{"nextPublicationWindow":"2020-01-01T06:00:00+00:00"}')
            with patch.object(subprocess,'run')as execute:
                out=r.refresh(d,execute);execute.assert_not_called()
            self.assertEqual(out['status'],'deferred')
    def test_seed_failure_skips_only_affected_product(self):
        with tempfile.TemporaryDirectory()as t:
            d=Path(t);(d/'nbm-seed-status.json').write_text('{"daily":{"status":"failed","error":"bad pair"}}')
            calls=[]
            def execute(args,**kw):
                calls.append(args[1]);(d/'nbm-hourly-status.json').write_text('{"status":"unchanged"}')
                return type('Result',(),{'returncode':0})()
            out=r.refresh(d,execute);self.assertEqual(len(calls),1);self.assertIn('hourly',calls[0]);self.assertEqual(out['status'],'partial')
    def test_release_workflow_default_and_explicit_opt_out(self):
        w=(ROOT/'.github/workflows/nbm-refresh.yml').read_text()
        import re
        expressions={name:re.search(r'  '+name+r':\n(?:[^\n]*\n)*?    if: \$\{\{ (.*?) \}\}',w).group(1) for name in ('extract','publish','verify')}
        for ref in ('refs/heads/main','refs/heads/codex/nbm-hourly-range'):
            for event in ('schedule','workflow_dispatch'):
                for flag in ('','true','false'):
                    for usable in ('true','false'):
                        values={'github.ref':ref,'github.event_name':event,'vars.NBM_REFRESH_ENABLED':flag,'needs.extract.outputs.publishable':usable,'needs.publish.outputs.verifiable':usable}
                        actual={}
                        for job,expression in expressions.items():
                            for key,value in values.items():expression=expression.replace(key,repr(value))
                            actual[job]=eval(expression.replace('&&',' and ').replace('||',' or '),{'__builtins__':{}})
                        enabled=ref=='refs/heads/main' and flag!='false'
                        self.assertEqual(actual,{'extract':event=='workflow_dispatch' or enabled,'publish':enabled and usable=='true','verify':enabled and event=='workflow_dispatch' and usable=='true'})
        self.assertIn('timeout-minutes: 25',w);self.assertIn('steps.refresh.outputs.publishable',w)
        self.assertIn('nbm-combined-publish.py --directory',w);self.assertEqual(w.count('contents: write'),1)
        hourly=(ROOT/'.github/workflows/nbm-hourly-refresh.yml').read_text();self.assertNotIn('  schedule:',hourly)

if __name__=='__main__':unittest.main()
