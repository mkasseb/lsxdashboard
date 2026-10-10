#!/usr/bin/env python3
"""Bounded regional refresh. Writes local artifacts only; never deploys or changes credentials."""
import argparse
import fcntl
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import resource
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
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
LIMITS = dict(requests=100, downloadBytes=150_000_000, elapsedSeconds=600)
MAX_INVENTORY_PAGES = 4


class Pending(Exception):
    """A published cycle is not complete yet; eligible for bounded retry/fallback."""


class BudgetExceeded(RuntimeError):
    """The remaining complete work cannot be admitted within this invocation's limits."""


class Client:
    def __init__(self, attempts=3, delay=15, sleep=time.sleep):
        self.bytes = 0
        self.requests = 0
        self.started = time.monotonic()
        self.attempts, self.delay, self.sleep = attempts, delay, sleep
        self.reserved_requests = self.reserved_bytes = 0
        self.versions = {}
        self.candidates, self.notes, self.events = [], [], []
        self.context = {}
        self.counts = {p: dict(requests=0, downloadBytes=0, completed=0, retries=0)
                       for p in ('discovery', 'inventory', 'index', 'grib')}

    def check(self, requests=0, download_bytes=0, required=False, wait=0):
        held_requests = max(0, self.reserved_requests-int(required))
        held_bytes = max(0, self.reserved_bytes-(download_bytes if required else 0))
        if (self.requests+requests+held_requests > LIMITS['requests'] or
                self.bytes+download_bytes+held_bytes > LIMITS['downloadBytes'] or
                time.monotonic()-self.started+wait >= LIMITS['elapsedSeconds']):
            raise BudgetExceeded(f'Refresh resource budget cannot admit work: requests={self.requests}, '
                                 f'bytes={self.bytes}, reservedRequests={self.reserved_requests}, '
                                 f'reservedBytes={self.reserved_bytes}')

    def reserve(self, requests, download_bytes=0):
        self.reserved_requests, self.reserved_bytes = requests, download_bytes
        self.check()

    def note(self, action, error=None):
        event = dict(self.context, action=action, requests=self.requests, downloadBytes=self.bytes,
                     reservedRequests=self.reserved_requests, reservedBytes=self.reserved_bytes)
        if error is not None:
            event.update(error=f'{type(error).__name__}: {error}')
        self.events.append(event)
        self.notes.append(f"{event.get('candidate', '')} {event.get('phase', '')} {action}: "
                          f"{event.get('url', '')} {event.get('error', '')}".strip())

    def step(self, run, phase, url, load, required=False, completed_bytes=0):
        # Keep completed indexes and decoded ranges in their enclosing loops. Only
        # this failing step repeats; a candidate is never rebuilt from its beginning.
        for attempt in range(1, self.attempts+1):
            self.context = dict(candidate=run, phase=phase, url=url, attempt=attempt)
            try:
                result = load()
            except Exception as error:
                self.note('failed', error)
                transient = isinstance(error, (Pending, urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead))
                if isinstance(error, urllib.error.HTTPError):
                    transient = error.code in (429, 500, 502, 503, 504) or (error.code == 404 and phase in ('index', 'grib'))
                if not transient or attempt == self.attempts:
                    raise
                self.check(requests=1, required=required, wait=self.delay)
                self.note('retry')
                self.counts[phase]['retries'] += 1
                self.sleep(self.delay)
            else:
                if required:
                    self.reserved_requests -= 1
                    self.reserved_bytes -= completed_bytes
                self.counts[phase]['completed'] += 1
                return result

    def get(self, url, headers=None, limit=2_000_000, required=False):
        self.context.update(url=url, byteRange=(headers or {}).get('Range'))
        self.check(requests=1, download_bytes=limit, required=required)
        if self.bytes+limit+1 > LIMITS['downloadBytes']:
            raise BudgetExceeded('No byte-budget headroom for bounded response read')
        self.requests += 1
        count = self.counts[self.context['phase']]
        count['requests'] += 1
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=20) as r:
            try:
                body = r.read(limit+1)
            except http.client.IncompleteRead as error:
                self.bytes += len(error.partial)
                count['downloadBytes'] += len(error.partial)
                raise
            self.bytes += len(body)
            count['downloadBytes'] += len(body)
            if len(body) > limit:
                raise ValueError('Response exceeds bounded download')
            return body, r.status, {k.lower(): v for k, v in r.headers.items()}


def discover(client, now):
    # Inspect QMD publication, never infer QMD readiness from core's newer cycle.
    candidates = []
    client.reserve(PERIOD_COUNT*4)  # Eighteen indexes and 54 native messages.
    for offset in range(24):
        cycle = now.replace(minute=0, second=0, microsecond=0)-timedelta(hours=offset)
        stamp = cycle.strftime('%Y%m%d%H')
        prefix = f'blend.{stamp[:8]}/{stamp[8:]}/qmd/'
        url = nbm.BASE+'?'+urllib.parse.urlencode(dict(**{'list-type': 2, 'max-keys': 1}, prefix=prefix))
        def load():
            body, status, _ = client.get(url, limit=10_000)
            root = ET.fromstring(body)
            count = root.findtext('s:KeyCount', namespaces=NS)
            if (status != 200 or count not in ('0', '1') or
                    root.findtext('s:Prefix', namespaces=NS) != prefix or len(root.findall('s:Contents', NS)) != int(count)):
                raise ValueError('Malformed QMD discovery response')
            return count == '1'
        if client.step(stamp, 'discovery', url, load):
            candidates.append(stamp)
            client.candidates = candidates.copy()
        if len(candidates) == 2:
            break
    return candidates


def hours_for(run):
    cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
    first = cycle+timedelta(hours=18)
    while first.hour not in (6, 18):
        first += timedelta(hours=1)
    return [int((first-cycle).total_seconds()/3600)+12*i for i in range(PERIOD_COUNT)]


def source_urls(run):
    return [nbm.BASE+f'blend.{run[:8]}/{run[8:]}/qmd/blend.t{run[8:]}z.qmd.f{hour:03}.co.grib2'
            for hour in hours_for(run)]


def inventory(client, run):
    """Read exact native-window keys, following bounded S3 continuation tokens."""
    needed = {url[len(nbm.BASE):]+suffix for url in source_urls(run) for suffix in ('', '.idx')}
    prefix = f'blend.{run[:8]}/{run[8:]}/qmd/'
    cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
    versions, tokens = {}, set()
    query = {'list-type': 2, 'max-keys': 1000, 'prefix': prefix,
             'start-after': min(needed).removesuffix('.co.grib2')}
    for _ in range(MAX_INVENTORY_PAGES):
        url = nbm.BASE+'?'+urllib.parse.urlencode(query)
        body, status, _ = client.step(run, 'inventory', url, lambda: client.get(url, limit=1_000_000))
        root = ET.fromstring(body)
        truncated = root.findtext('s:IsTruncated', namespaces=NS)
        contents = root.findall('s:Contents', NS)
        if (status != 200 or root.findtext('s:Prefix', namespaces=NS) != prefix or truncated not in ('true', 'false') or
                root.findtext('s:KeyCount', namespaces=NS) != str(len(contents)) or len(contents) > 1000):
            raise ValueError('Malformed QMD readiness inventory')
        for item in contents:
            key = item.findtext('s:Key', namespaces=NS)
            if not key or not key.startswith(prefix):
                raise ValueError('Unexpected QMD inventory key')
            if key not in needed:
                continue
            etag = item.findtext('s:ETag', namespaces=NS)
            published = datetime.fromisoformat(item.findtext('s:LastModified', namespaces=NS).replace('Z', '+00:00'))
            size = int(item.findtext('s:Size', namespaces=NS))
            if (key in versions or not etag or not re.fullmatch(r'"[^"\r\n]+"', etag) or
                    not cycle <= published <= datetime.now(UTC) or not 0 < size <= 2_000_000_000):
                raise ValueError('Invalid or duplicate QMD source version')
            versions[key] = dict(etag=etag, published=published, size=size)
        if needed.issubset(versions):
            client.versions.update({nbm.BASE+key: value for key, value in versions.items()})
            return
        if truncated == 'false':
            raise Pending(f'{run}: QMD inventory missing {len(needed-versions.keys())} required native-window keys')
        token = root.findtext('s:NextContinuationToken', namespaces=NS)
        if not token or token in tokens:
            raise ValueError('Missing or repeated QMD inventory continuation token')
        tokens.add(token)
        query.pop('start-after', None)
        query['continuation-token'] = token
    raise Pending(f'{run}: required QMD keys not confirmed within {MAX_INVENTORY_PAGES} inventory pages')


def read_source(client, url, limit, byte_range=None):
    version = client.versions[url]
    headers = {'If-Match': version['etag']}
    if byte_range:
        headers['Range'] = 'bytes='+byte_range
    try:
        body, status, found = client.get(url, headers, limit, required=True)
    except urllib.error.HTTPError as error:
        if error.code == 412:
            raise ValueError('QMD source version changed since readiness inventory') from error
        raise
    if found.get('etag') != version['etag'] or parsedate_to_datetime(found.get('last-modified', '')) != version['published']:
        raise ValueError('QMD response disagrees with inventoried source version')
    if byte_range:
        if status != 206 or found.get('content-range') != f"bytes {byte_range}/{version['size']}" or len(body) != limit:
            raise ValueError('Exact GRIB byte range not honored')
    elif status != 200 or len(body) != version['size']:
        raise ValueError('Index response disagrees with inventoried size')
    return body, status, found


def plan(client, run):
    result = []
    for hour, url in zip(hours_for(run), source_urls(run)):
        def load():
            body, _, _ = read_source(client, url+'.idx', min(2_000_000, client.versions[url+'.idx']['size']))
            try:
                rows = nbm.select_rows(body.decode(), run, hour)
            except nbm.IncompletePercentiles as error:
                raise Pending(str(error)) from error
            if len(rows) != 3:
                raise Pending(f'{run} f{hour:03} percentile group not complete')
            if any(not 0 < row['stop']-row['offset']+1 <= 8_000_000 or
                   not 0 <= row['offset'] <= row['stop'] < client.versions[url]['size'] for row in rows):
                raise ValueError('Unexpected GRIB message range')
            return rows
        rows = client.step(run, 'index', url+'.idx', load, required=True)
        result.append((url, sorted(rows, key=lambda row: row['percentile'])))
    client.reserve(PERIOD_COUNT*3, sum(row['stop']-row['offset']+1 for _, rows in result for row in rows))
    return result


def choose_plan(client, candidates, attempts=3, delay=15, sleep=time.sleep, build=None):
    if not candidates:
        raise Pending('No published QMD cycle within the last 24 hours')
    client.attempts, client.delay, client.sleep = attempts, delay, sleep
    client.candidates = candidates.copy()
    for run in candidates:
        client.context = dict(candidate=run, phase='admission', url=None)
        try:
            client.reserve(PERIOD_COUNT*4)
            inventory(client, run)
            planned = plan(client, run)
            data = build(client, run, planned) if build else planned
            return run, data, client.notes
        except (Pending, BudgetExceeded, urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as error:
            # A changed version, invalid data or access denial fails closed.
            if isinstance(error, urllib.error.HTTPError) and error.code not in (404, 429, 500, 502, 503, 504):
                raise
            client.note('candidate-unavailable', error)
            client.reserved_requests = client.reserved_bytes = 0
            if run != candidates[-1]:
                client.note('fallback')
    raise Pending('No complete daily source cycle; '+'; '.join(client.notes))


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
            body, status, headers = client.step(run, 'grib', url,
                lambda: read_source(client, url, b-a+1, f'{a}-{b}'), required=True, completed_bytes=b-a+1)
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
    """Reuse validated bytes only when indexes and inventoried source versions still match."""
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
        version = client.versions.get(url)
        if not version or any(m.get('etag') != version['etag'] or
                              parsedate_to_datetime(m['publishedAt']) != version['published'] for m in members):
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
    client = Client(attempts, delay)
    try:
        now = datetime.now(UTC)
        if run and not timedelta(0) <= now-datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC) < timedelta(hours=24):
            raise ValueError('Explicit run must be within the last 24 hours')
        candidates = [run] if run else discover(client, now)
        client.candidates = candidates.copy()
        def build(client, candidate, planned):
            retained = retained_unchanged(client, directory, candidate, planned)
            if retained is not None:
                client.reserve(0)
            return (retained, False) if retained is not None else (region(client, candidate, planned), True)
        selected, (data, changed), notes = choose_plan(client, candidates, attempts, delay, build=build)
        if datetime.now(UTC)-datetime.fromisoformat(data['run'].replace('Z', '+00:00')) >= timedelta(hours=24):
            raise ValueError('Cycle became stale during extraction')
        client.check()
        size = publish_local(directory, data) if changed else (directory/'nbm-range.json').stat().st_size
        report = dict(status=('ready' if changed else 'unchanged') if selected == candidates[0] else 'fallback',
                      changed=changed, dataRun=data['run'],
                      cells=len(data['cells']), periods=len(data['periods']),
                      outputBytes=size, coverage=COVERAGE)
    except Exception as error:
        client.note('aborted', error)
        report = dict(status='failed', error=f'{type(error).__name__}: {error}', retainedPrevious=(directory/'nbm-range.json').exists())
    report.update(candidateRuns=client.candidates, publicationNotes=client.notes, diagnostics=client.events,
                  lastOperation=client.context, phaseCounts=client.counts,
                  checkedAt=nbm.iso(datetime.now(UTC)), downloadBytes=client.bytes, requests=client.requests,
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
