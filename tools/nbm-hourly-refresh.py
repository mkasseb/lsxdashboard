#!/usr/bin/env python3
"""Bounded, independent hourly QMD subset extraction. Local artifacts only."""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import fcntl
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import resource
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('regional', Path(__file__).with_name('nbm-refresh.py'))
regional = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regional)
UTC = timezone.utc
COVERAGE = regional.COVERAGE
HOURS = 48  # Covers a rolling 24h window for a source cycle younger than 24h.
PERCENTILES = regional.nbm.PERCENTILES
SCHEMA = 2
VALIDATOR = 'hourly-quartiles-v2'
LIMITS = dict(requests=180, downloadBytes=30_000_000, elapsedSeconds=600, outputBytes=4_000_000)
BASE = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/'
FILTER = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_blend.pl?'


class Pending(Exception):
    """An advertised QMD cycle has not finished publishing."""



def iso(t):
    return t.isoformat().replace('+00:00', 'Z')


def urls(run, hour):
    d = f'blend.{run[:8]}/{run[8:]}/qmd'
    file = f'blend.t{run[8:]}z.qmd.f{hour:03}.co.grib2'
    query = dict(dir='/'+d, file=file, var_TMP='on', lev_2_m_above_ground='on', subregion='',
                 leftlon='-91.18', rightlon='-89.42', toplat='39.28', bottomlat='38.12')
    return BASE+d+'/'+file, FILTER+urllib.parse.urlencode(query)


class Client:
    def __init__(self):
        self.requests = self.bytes = 0
        self.started = time.monotonic()

    def request(self, url, head=False, limit=500_000):
        for attempt in range(2):
            if (self.requests >= LIMITS['requests'] or self.bytes+limit > LIMITS['downloadBytes'] or
                    time.monotonic()-self.started > LIMITS['elapsedSeconds']):
                raise RuntimeError('Hourly resource budget exhausted')
            self.requests += 1
            try:
                with urllib.request.urlopen(urllib.request.Request(url, method='HEAD' if head else 'GET'), timeout=30) as r:
                    raw = b'' if head else r.read(limit+1)
                    self.bytes += len(raw)
                    if r.status != 200 or len(raw) > limit:
                        raise ValueError('Invalid or oversized NOAA response')
                    return raw, {k.lower(): v for k, v in r.headers.items()}
            except (urllib.error.URLError, TimeoutError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (429, 500, 502, 503, 504):
                    raise
                if attempt:
                    raise
                time.sleep(2)

    def version(self, url, cycle):
        _, h = self.request(url, head=True, limit=0)
        published = parsedate_to_datetime(h['last-modified'])
        size = int(h['content-length'])
        if not cycle <= published <= datetime.now(UTC) or not 1000 < size < 2_000_000_000:
            raise ValueError('Invalid NOMADS publication metadata')
        # NOMADS supplies Last-Modified and size, not S3's ETag. This is a revision
        # indicator, not a cryptographic assertion of identity with an S3 object.
        return dict(publishedAt=iso(published), contentLength=size)


def decode(raw, cycle, hour, expected_grid=None):
    import eccodes as e
    import numpy as np
    if not raw.startswith(b'GRIB') or not raw.endswith(b'7777'):
        raise ValueError('Not a complete GRIB subset')
    members, cells, grid = {}, None, None
    offset = 0
    while offset < len(raw):
        length = int.from_bytes(raw[offset+8:offset+16], 'big')
        if length < 20 or offset+length > len(raw) or raw[offset:offset+4] != b'GRIB' or raw[offset+length-4:offset+length] != b'7777':
            raise ValueError('Invalid GRIB framing')
        g = e.codes_new_from_message(raw[offset:offset+length])
        offset += length
        try:
            get = lambda k: e.codes_get(g, k)
            if get('productDefinitionTemplateNumber') != 6:
                continue  # Probability thresholds / ensemble summaries are not percentiles.
            q = get('percentileValue')
            if q not in PERCENTILES:
                continue
            expected = dict(edition=2, centre='kwbc', stepUnits=1, discipline=0, parameterCategory=0, parameterNumber=0, typeOfLevel='heightAboveGround',
                            level=2, units='K', stepType='instant', startStep=hour, endStep=hour,
                            dataDate=int(cycle.strftime('%Y%m%d')), dataTime=cycle.hour*100,
                            validityDate=int((cycle+timedelta(hours=hour)).strftime('%Y%m%d')),
                            validityTime=(cycle+timedelta(hours=hour)).hour*100)
            if q in members or any(get(k) != v for k, v in expected.items()):
                raise ValueError('Mixed, duplicate or incorrect hourly percentile metadata')
            found = get('md5Section3')
            if (grid and grid != found) or (expected_grid and expected_grid != found):
                raise ValueError('Hourly grid changed')
            grid = found
            if cells is None:
                lats = e.codes_get_array(g, 'latitudes')
                lons = (e.codes_get_array(g, 'longitudes')+180) % 360-180
                indices = np.flatnonzero((lats >= 38.15) & (lats <= 39.25) & (lons >= -91.15) & (lons <= -89.45))
                if not 2500 <= len(indices) <= 4000:
                    raise ValueError('Incomplete regional grid')
                cells = [[int(i), float(lats[i]), float(lons[i])] for i in indices]
                # Corners and edge points must retain a nearby native cell; no extrapolation.
                for lat in (38.2, 38.7, 39.2):
                    for lon in (-91.1, -90.3, -89.5):
                        nearest = e.codes_grib_find_nearest(g, lat, lon)[0]
                        if nearest['distance'] > 3 or nearest['index'] not in indices:
                            raise ValueError('Missing coverage edge cell')
            values = np.asarray(e.codes_get_double_elements(g, 'values', indices.tolist()))
            if not np.all(np.isfinite(values) & (values >= 180) & (values <= 340)):
                raise ValueError('Invalid or missing Kelvin values')
            members[q] = values
        finally:
            e.codes_release(g)
    if set(members) != set(PERCENTILES):
        raise ValueError('Incomplete hourly percentile group')
    if not np.all((members[25] <= members[50]) & (members[50] <= members[75])):
        raise ValueError('Crossed hourly percentiles')
    return grid, cells, np.stack([members[q] for q in PERCENTILES], axis=1).round(3).tolist()


def retained(directory, run):
    try:
        raw = (directory/'nbm-hourly.json').read_bytes()
        d = json.loads(raw)
        receipt = json.loads((directory/'nbm-hourly-receipt.json').read_text())
        if (len(raw) <= LIMITS['outputBytes'] and d.get('schema') == SCHEMA and d.get('percentiles') == list(PERCENTILES) and d['run'] == run and len(d['hours']) == HOURS and
                receipt == dict(validator=VALIDATOR, run=run, sha256=hashlib.sha256(raw).hexdigest()) and
                regional.consumer_valid(raw, 'hourly-range.js')):
            return d
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def extract(client, directory, run):
    cycle = datetime.strptime(run, '%Y%m%d%H').replace(tzinfo=UTC)
    old = retained(directory, iso(cycle))
    versions = [client.version(urls(run, h)[0], cycle) for h in range(1, HOURS+1)]
    if old and all(p['publication'] == v for p, v in zip(old['hours'], versions)):
        return old, False
    data = dict(schema=SCHEMA, percentiles=list(PERCENTILES), source='NOAA NBM QMD NOMADS subset', run=iso(cycle), units='K',
                timezone='America/Chicago', coverage=COVERAGE, hours=[], cells=[], gridHash=None)
    for h, version in enumerate(versions, 1):
        original, subset = urls(run, h)
        raw, _ = client.request(subset)
        grid, cells, kelvin = decode(raw, cycle, h, data['gridHash'])
        if data['cells'] and cells != data['cells']:
            raise ValueError('Native cell coordinates changed across hours')
        if client.version(original, cycle) != version:
            raise ValueError('NOMADS object revised during extraction')
        data['gridHash'], data['cells'] = grid, cells
        data['hours'].append(dict(validTime=iso(cycle+timedelta(hours=h)), forecastHour=h,
                                 template=6, stepType='instant', level=2, percentiles=list(PERCENTILES),
                                 sourceUrl=original, subsetUrl=subset, publication=version,
                                 sha256=hashlib.sha256(raw).hexdigest(), kelvin=kelvin))
        print(f'hour {h}/{HOURS}: {len(raw)} bytes', flush=True)
        time.sleep(1)  # NOAA asks clients to pause between subset requests.
    data['retrievedAt'] = iso(datetime.now(UTC))
    return data, True


def available(client, run):
    prefix = f'blend.{run[:8]}/{run[8:]}/qmd/'
    raw, _ = client.request(regional.nbm.BASE+'?list-type=2&max-keys=1000&prefix='+prefix)
    root = ET.fromstring(raw)
    ns = '{http://s3.amazonaws.com/doc/2006-03-01/}'
    if root.findtext(ns+'IsTruncated') not in ('true', 'false'):
        raise ValueError('Malformed QMD inventory')
    keys = [e.text for e in root.findall(ns+'Contents/'+ns+'Key')]
    if not keys:
        return False
    needed = {prefix+f'blend.t{run[8:]}z.qmd.f{h:03}.co.grib2' for h in range(1, HOURS+1)}
    # The listing spans other regions and can be truncated after our 48 files.
    # We require every exact CONUS key, not completeness of unrelated regions.
    if not needed.issubset(keys):
        raise Pending(f'{run}: hourly QMD inventory is incomplete')
    return True


def choose(client, directory, cycles, attempts=2, delay=15, sleep=time.sleep):
    notes = []
    for run in cycles:
        for attempt in range(attempts):
            try:
                if not available(client, run):
                    notes.append(run+': QMD not listed yet')
                    break
                data, changed = extract(client, directory, run)
                return data, changed, notes
            except (Pending, urllib.error.URLError, TimeoutError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (404, 429, 500, 502, 503, 504):
                    raise  # Never conceal an access denial with retries or older cycles.
                notes.append(f'{run}: {type(error).__name__}: {error}')
                if attempt+1 < attempts:
                    sleep(delay)
    raise Pending('No complete hourly source cycle; '+ '; '.join(notes))


def refresh(directory, run=None):
    directory.mkdir(parents=True, exist_ok=True)
    client = Client()
    with (directory/'.hourly.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            now = datetime.now(UTC)
            cycles = [run] if run else [(now.replace(hour=(now.hour//6)*6, minute=0, second=0, microsecond=0)-timedelta(hours=6*i)).strftime('%Y%m%d%H') for i in range(4)]
            for candidate in cycles:
                cycle = datetime.strptime(candidate, '%Y%m%d%H').replace(tzinfo=UTC)
                if not timedelta(0) <= now-cycle < timedelta(hours=24):
                    raise ValueError('Source cycle must be younger than 24h')
            data, changed, notes = choose(client, directory, cycles)
            if datetime.now(UTC)-datetime.fromisoformat(data['run'].replace('Z', '+00:00')) >= timedelta(hours=24):
                raise ValueError('Source became stale during extraction')
            raw = (json.dumps(data, separators=(',', ':'), allow_nan=False)+'\n').encode()
            if len(raw) > LIMITS['outputBytes']:
                raise ValueError(f'Hourly output {len(raw)} bytes exceeds bound')
            target = directory/'nbm-hourly.json'
            if target.exists() and json.loads(target.read_text())['run'] > data['run']:
                raise ValueError('Refusing source rollback')
            if changed:
                regional.atomic(target, data)
                regional.atomic(directory/'nbm-hourly-receipt.json', dict(validator=VALIDATOR, run=data['run'], sha256=hashlib.sha256(raw).hexdigest()))
            report = dict(status='ready' if changed else 'unchanged', changed=changed, dataRun=data['run'],
                          hours=len(data['hours']), cells=len(data['cells']), outputBytes=len(raw), publicationNotes=notes)
        except Exception as error:
            report = dict(status='failed', error=f'{type(error).__name__}: {error}', retainedPrevious=(directory/'nbm-hourly.json').exists())
        report.update(checkedAt=iso(datetime.now(UTC)), downloadBytes=client.bytes, requests=client.requests,
                      elapsedSeconds=round(time.monotonic()-client.started, 3), peakRssMiB=round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 2), limits=LIMITS)
        regional.atomic(directory/'nbm-hourly-status.json', report)
        return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output-dir', type=Path, required=True)
    p.add_argument('--run')
    a = p.parse_args()
    report = refresh(a.output_dir, a.run)
    print(json.dumps(report, indent=2))
    raise SystemExit(report['status'] == 'failed')
