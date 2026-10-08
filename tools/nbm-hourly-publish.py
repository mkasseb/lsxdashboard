#!/usr/bin/env python3
"""Hourly adapter for the existing guarded, data-only NBM publisher."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('nbm-publish.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
publisher.PATHS = ('data/nbm-hourly.json', 'data/nbm-hourly-receipt.json')
publisher.MAX_FILE_BYTES = 4_000_000


def candidate(directory, now):
    files = {}
    for name in (*publisher.PATHS, 'nbm-hourly-status.json'):
        file = directory/Path(name).name
        if file.is_symlink() or not file.is_file() or file.stat().st_size > publisher.MAX_FILE_BYTES:
            raise ValueError('Missing, linked or oversized hourly candidate')
        files[name] = file.read_bytes()
    data, receipt, status = [json.loads(files[p]) for p in (*publisher.PATHS, 'nbm-hourly-status.json')]
    digest = hashlib.sha256(files[publisher.PATHS[0]]).hexdigest()
    if receipt != dict(validator='hourly-v1', run=data['run'], sha256=digest):
        raise ValueError('Hourly receipt mismatch')
    if (status.get('status') not in ('ready', 'unchanged') or type(status.get('changed')) is not bool or
            status.get('dataRun') != data['run'] or not 0 <= (now-publisher.stamp(status['checkedAt'])).total_seconds() <= 1800 or
            len(data.get('hours', [])) != 48):
        raise ValueError('Incomplete or failed hourly candidate')
    js = """const fs=require('fs'),vm=require('vm');const s={Intl,Date,URLSearchParams};
vm.createContext(s);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),s);
const d=JSON.parse(fs.readFileSync(0,'utf8'));
if(s.NbmHourly.validate(d,{lat:38.8,lon:-90.79},Number(process.argv[2])).status!=='ready')process.exit(1);"""
    subprocess.run(['node', '-e', js, str(publisher.ROOT/'assets/hourly-range.js'), str(now.timestamp()*1000)],
                   input=files[publisher.PATHS[0]], check=True, timeout=30)
    return {p: files[p] for p in publisher.PATHS}, data, status, digest


publisher.candidate = candidate
if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    p.add_argument('--expected-head', required=True)
    p.add_argument('--seed', action='store_true')
    a = p.parse_args()
    if a.seed:
        publisher.seed(publisher.ROOT, a.directory, a.expected_head)
    else:
        try:
            print(json.dumps(publisher.publish(publisher.ROOT, a.directory, a.expected_head), indent=2))
        except Exception as error:
            print(json.dumps(dict(status='failed', error=f'{type(error).__name__}: {error}')))
            raise SystemExit(1)
