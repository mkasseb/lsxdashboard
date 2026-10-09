#!/usr/bin/env python3
"""Bounded regional refresh. Writes local artifacts only; never deploys or changes credentials."""
import argparse
import fcntl
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import resource
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('nbm_extract', Path(__file__).with_name('nbm-extract.py'))
nbm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nbm)
UTC = timezone.utc
COVERAGE = dict(south=38.2, north=39.2, west=-91.1, east=-89.5, maxDistanceKm=3)
PERIOD_COUNT = 18  # Nine days of native windows: buffers a <=24h-old cycle around seven NWS rows.
SCHEMA = 3
VALIDATOR = 'regional-quartiles-v2'
NS = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}


class Pending(Exception):
    """A published cycle is not complete yet; eligible for bounded retry/fallback."""


class Client:
    def __init__(self):
        self.bytes = 0
        self.requests = 0
        self.started = time.monotonic()

    def get(self, url, headers=None, limit=2_000_000):
        if time.monotonic()-self.started > 600 or self.bytes+limit > 150_000_000 or self.requests >= 100:
            raise RuntimeError('Refresh resource budget exceeded')
        self.requests += 1
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=20) as r:
            body = r.read(limit+1)
            self.bytes += len(body)
            if len(body) > limit:
                raise ValueError('Response exceeds bounded download')
            return body, r.status, {k.lower(): v for k, v in r.headers.items()}


def discover(client, now):
    # Inspect QMD publication, never infer QMD readiness from core's newer cycle.
    candidates = []
    for offset in range(24):
        cycle = now.replace(minute=0, second=0, microsecond=0)-timedelta(hours=offset)
        stamp = cycle.strftime('%Y%m%d%H')
        prefix = f'blend.{stamp[:8]}/{stamp[8:]}/qmd/'
        body, _, _ = client.get(nbm.BASE+'?list-type=2&max-keys=1&prefix='+prefix)
        root = ET.fromstring(body)
        if root.findtext('s:KeyCount', namespaces=NS) != '0':
            candidates.append(stamp)
        if len(candidates) == 2:
            break
    return candidates


def hours_for(run):
    cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
    first = cycle+timedelta(hours=18)
    while first.hour not in (6, 18):
        first += timedelta(hours=1)
    return [int((first-cycle).total_seconds()/3600)+12*i for i in range(PERIOD_COUNT)]


def plan(client, run):
    result = []
    for hour in hours_for(run):
        url = nbm.BASE+f'blend.{run[:8]}/{run[8:]}/qmd/blend.t{run[8:]}z.qmd.f{hour:03}.co.grib2'
        try:
            body, _, _ = client.get(url+'.idx')
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise Pending(f'{run} f{hour:03} index not published') from error
            raise
        try:
            rows = nbm.select_rows(body.decode(), run, hour)
        except nbm.IncompletePercentiles as error:
            raise Pending(str(error)) from error
        if len(rows) != 3:
            raise Pending(f'{run} f{hour:03} percentile group not complete')
        result.append((url, sorted(rows, key=lambda row: row['percentile'])))
    return result


def choose_plan(client, candidates, attempts=3, delay=15, sleep=time.sleep, build=None):
    if not candidates:
        raise Pending('No published QMD cycle within the last 24 hours')
    notes = []
    def load(run):
        planned = plan(client, run)
        return build(client, run, planned) if build else planned
    for i in range(attempts):
        try:
            return candidates[0], load(candidates[0]), notes
        except (Pending, urllib.error.URLError, TimeoutError) as error:
            # Access denials and other non-transient HTTP errors are never hidden by fallback.
            if isinstance(error, urllib.error.HTTPError) and error.code not in (404, 429, 500, 502, 503, 504):
                raise
            notes.append(str(error))
            if i+1 < attempts:
                sleep(delay)
    for run in candidates[1:]:
        try:
            return run, load(run), notes
        except Pending as error:
            notes.append(str(error))
    raise Pending('; '.join(notes))


def region(client, run, planned):
    import eccodes as e
    import numpy as np
    cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
    cells, indices, grid_hash = None, None, None
    result = dict(schema=SCHEMA, percentiles=list(nbm.PERCENTILES), source='NOAA NBM QMD GRIB2', run=nbm.iso(cycle),
                  timezone='America/Chicago', units='K', coverage=COVERAGE.copy(), periods=[], missingHours=[])
    for url, rows in planned:
        members, values = [], []
        for row in rows:
            a, b = row['offset'], row['stop']
            if not 0 < b-a+1 <= 8_000_000:
                raise ValueError('Unexpected GRIB message size')
            try:
                body, status, headers = client.get(url, {'Range': f'bytes={a}-{b}'}, b-a+1)
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    raise Pending('GRIB object not yet published') from error
                raise
            if status != 206 or not headers.get('content-range', '').startswith(f'bytes {a}-{b}/') or len(body) != b-a+1:
                raise ValueError('Exact GRIB byte range not honored')
            if body[:4] != b'GRIB' or body[-4:] != b'7777' or int.from_bytes(body[8:16], 'big') != len(body):
                raise ValueError('Invalid GRIB message boundary')
            g = e.codes_new_from_message(body)
            try:
                meta = nbm.metadata(g, row, cycle)
                found_hash = e.codes_get(g, 'md5Section3')
                if grid_hash is None:
                    grid_hash = found_hash
                    lats = e.codes_get_array(g, 'latitudes')
                    lons = (e.codes_get_array(g, 'longitudes')+180) % 360-180
                    # Padding ensures boundary requests can still choose the nearest native cell.
                    mask = ((lats >= COVERAGE['south']-.05) & (lats <= COVERAGE['north']+.05) &
                            (lons >= COVERAGE['west']-.05) & (lons <= COVERAGE['east']+.05))
                    indices = np.flatnonzero(mask)
                    if not 100 <= len(indices) <= 5000:
                        raise ValueError('Unexpected regional grid coverage')
                    cells = [[int(i), float(lats[i]), float(lons[i])] for i in indices]
                    del lats, lons, mask
                elif found_hash != grid_hash:
                    raise ValueError('Grid changed across native intervals')
                k = np.asarray(e.codes_get_double_elements(g, 'values', indices.tolist()))
                if not np.all(np.isfinite(k) & (k >= 180) & (k <= 340)):
                    raise ValueError('Missing or invalid regional Kelvin values')
                values.append(k)
                published = headers.get('last-modified', '')
                if not headers.get('etag') or not cycle <= parsedate_to_datetime(published) <= datetime.now(UTC):
                    raise ValueError('Invalid object publication metadata')
                meta.update(url=url, byteRange=f'{a}-{b}', sha256=hashlib.sha256(body).hexdigest(),
                            publishedAt=published, etag=headers['etag'], gridHash=grid_hash, units='K')
                members.append(meta)
            finally:
                e.codes_release(g)
        for member in members:
            if any(member[key] != members[0][key] for key in ('run', 'start', 'end', 'kind', 'etag', 'publishedAt')):
                raise ValueError('Mixed percentile group provenance')
        if not np.all((values[0] <= values[1]) & (values[1] <= values[2])):
            raise ValueError('Crossed regional percentiles')
        result['periods'].append({key: members[0][key] for key in ('kind', 'start', 'end', 'localStart', 'localEnd')} |
                                 dict(members=members, kelvin=np.stack(values, axis=1).round(6).tolist()))
    result.update(cells=cells, gridHash=grid_hash, retrievedAt=nbm.iso(datetime.now(UTC)))
    return result


def consumer_valid(raw, asset):
    """Independently validate retained bytes before permitting a no-op; never renew their age."""
    js = """const fs=require('fs'),vm=require('vm');const s={Intl,Date,URLSearchParams};
vm.createContext(s);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),s);
const d=JSON.parse(fs.readFileSync(0,'utf8')),n=process.argv[2];
if(s[n].validate(d,{lat:38.8,lon:-90.79},Date.parse(d.retrievedAt)).status!=='ready')process.exit(1);"""
    result = subprocess.run(['node', '-e', js, str(Path(__file__).resolve().parent.parent/'assets'/asset),
                             'NbmRange' if asset == 'forecast-range.js' else 'NbmHourly'],
                            input=raw, capture_output=True, timeout=30)
    return result.returncode == 0


def retained_unchanged(client, directory, run, planned):
    """Reuse only a complete prior validated output with intact receipt and unchanged objects."""
    target, receipt_path = directory/'nbm-range.json', directory/'nbm-receipt.json'
    try:
        if target.stat().st_size > 2_000_000:
            return None
        raw = target.read_bytes()
        data, receipt = json.loads(raw), json.loads(receipt_path.read_text())
        stamp = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
        if (receipt != dict(validator=VALIDATOR, run=nbm.iso(stamp), sha256=hashlib.sha256(raw).hexdigest()) or
                data.get('run') != nbm.iso(stamp) or data.get('schema') != SCHEMA or data.get('percentiles') != list(nbm.PERCENTILES) or data.get('coverage') != COVERAGE or
                data.get('missingHours') != [] or len(data.get('periods', [])) != len(planned)):
            return None
        if not consumer_valid(raw, 'forecast-range.js'):
            return None
    except (OSError, ValueError, TypeError):
        return None
    for period, (url, rows) in zip(data['periods'], planned):
        members = period.get('members', [])
        if len(members) != 3 or any(m.get('url') != url or m.get('byteRange') != f"{row['offset']}-{row['stop']}" or
                                   m.get('percentile') != row['percentile'] for m, row in zip(members, rows)):
            return None
        try:
            body, status, headers = client.get(url, {'Range': 'bytes=0-0'}, 1)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise Pending('Previously indexed GRIB object unavailable') from error
            raise
        if status != 206 or len(body) != 1 or not headers.get('content-range', '').startswith('bytes 0-0/'):
            raise ValueError('Source version probe did not honor byte range')
        if not headers.get('etag') or any(m.get('etag') != headers['etag'] for m in members):
            return None
    return data


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode()
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.'+path.name, delete=False) as f:
            temp = Path(f.name)
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        temp.replace(path)
    finally:
        if temp and temp.exists():
            temp.unlink()
    return len(raw)


def publish_local(directory, data):
    # Complete validated dataset first; no half-cycle updates and no remote writes.
    target = directory/'nbm-range.json'
    if target.exists():
        previous = json.loads(target.read_text())
        if previous.get('run', '') > data['run']:
            raise ValueError('Refusing to replace a newer cycle with an older one')
    stamp = datetime.fromisoformat(data['run'].replace('Z', '+00:00')).strftime('%Y%m%d%H')
    atomic(directory/'history'/f'{stamp}.json', data)
    try:
        size = atomic(target, data)
        atomic(directory/'nbm-receipt.json', dict(validator=VALIDATOR, run=data['run'],
                                                sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    finally:
        for obsolete in sorted((directory/'history').glob('[0-9]'*10+'.json'), reverse=True)[2:]:
            obsolete.unlink()
    return size


def refresh_locked(directory, run=None, attempts=3, delay=15):
    client = Client()
    try:
        now = datetime.now(UTC)
        if run and not timedelta(0) <= now-datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC) < timedelta(hours=24):
            raise ValueError('Explicit run must be within the last 24 hours')
        candidates = [run] if run else None
        for attempt in range(attempts):
            if candidates is not None:
                break
            try:
                candidates = discover(client, now)
            except (urllib.error.URLError, TimeoutError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (429, 500, 502, 503, 504):
                    raise
                if attempt+1 == attempts:
                    raise
                time.sleep(delay)
        def build(client, candidate, planned):
            retained = retained_unchanged(client, directory, candidate, planned)
            return (retained, False) if retained is not None else (region(client, candidate, planned), True)
        selected, (data, changed), notes = choose_plan(client, candidates, attempts, delay, build=build)
        if datetime.now(UTC)-datetime.fromisoformat(data['run'].replace('Z', '+00:00')) >= timedelta(hours=24):
            raise ValueError('Cycle became stale during extraction')
        size = publish_local(directory, data) if changed else (directory/'nbm-range.json').stat().st_size
        report = dict(status=('ready' if changed else 'unchanged') if selected == candidates[0] else 'fallback',
                      changed=changed, dataRun=data['run'],
                      candidateRuns=candidates, publicationNotes=notes, cells=len(data['cells']), periods=len(data['periods']),
                      outputBytes=size, coverage=COVERAGE)
    except Exception as error:
        report = dict(status='failed', error=f'{type(error).__name__}: {error}', retainedPrevious=(directory/'nbm-range.json').exists())
    report.update(checkedAt=nbm.iso(datetime.now(UTC)), downloadBytes=client.bytes, requests=client.requests,
                  elapsedSeconds=round(time.monotonic()-client.started, 3), peakRssMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 2))
    atomic(directory/'nbm-status.json', report)
    return report


def refresh(directory, run=None, attempts=3, delay=15):
    directory.mkdir(parents=True, exist_ok=True)
    # Workflow concurrency and this local lock prevent older concurrent writers winning a race.
    with (directory/'.refresh.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return refresh_locked(directory, run, attempts, delay)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--run', help='Optional authentic YYYYMMDDHH cycle; default discovers published QMD')
    parser.add_argument('--attempts', type=int, default=3, choices=range(1, 4))
    parser.add_argument('--retry-seconds', type=int, default=15, choices=range(0, 31))
    args = parser.parse_args()
    report = refresh(args.output_dir, args.run, args.attempts, args.retry_seconds)
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if report['status'] == 'failed' else 0)
