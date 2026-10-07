#!/usr/bin/env python3
"""Local-only QMD extrema extraction. Requires eccodes; never publishes or schedules work."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

BASE = "https://noaa-nbm-grib2-pds.s3.amazonaws.com/"
UTC = timezone.utc
CENTRAL = ZoneInfo("America/Chicago")
ROW = re.compile(r"^\d+:(\d+):d=(\d{10}):(TMP|TMAX|TMIN):2 m above ground:(\d+)-(\d+) hour (max|min) fcst:(10|50|90)% level$")


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def read_url(url, headers=None, limit=2_000_000):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=45) as r:
        data = r.read(limit + 1)
        if len(data) > limit:
            raise ValueError("Response exceeds bounded download")
        return data, r.status, dict(r.headers)


def select_rows(text, run, hour):
    lines = text.splitlines()
    found = []
    for i, line in enumerate(lines):
        m = ROW.fullmatch(line)
        if not m:
            continue
        offset, stamp, variable, start, end, kind, percentile = m.groups()
        if stamp != run or int(end) != hour or int(end) - int(start) != 18:
            raise ValueError("Unexpected run or native extrema interval")
        if variable not in ("TMP", "TMAX" if kind == "max" else "TMIN"):
            raise ValueError("Index variable/statistic mismatch")
        if i + 1 == len(lines):
            raise ValueError("No upper byte boundary")
        found.append(dict(offset=int(offset), stop=int(lines[i+1].split(":")[1])-1,
                          start=int(start), end=int(end), kind=kind, percentile=int(percentile)))
    if found and (len(found) != 3 or sorted(x["percentile"] for x in found) != [10, 50, 90]
                  or len({(x["start"], x["end"], x["kind"]) for x in found}) != 1):
        raise ValueError("Incomplete or mixed percentile group")
    return found


def decode(data, row, run_time, lat, lon):
    import eccodes as e
    g = e.codes_new_from_message(data)
    try:
        get = lambda k: e.codes_get(g, k)
        checks = {"edition": 2, "centre": "kwbc", "productDefinitionTemplateNumber": 10,
                  "discipline": 0, "parameterCategory": 0, "units": "K",
                  "typeOfLevel": "heightAboveGround", "level": 2, "stepUnits": 1,
                  "percentileValue": row["percentile"], "numberOfTimeRange": 1,
                  "typeOfStatisticalProcessing": 2 if row["kind"] == "max" else 3,
                  "startStep": row["start"], "endStep": row["end"], "lengthOfTimeRange": 18,
                  "dataDate": int(run_time.strftime("%Y%m%d")), "dataTime": run_time.hour*100}
        for key, expected in checks.items():
            if get(key) != expected:
                raise ValueError(f"GRIB {key} differs from expected {expected}: {get(key)}")
        if get("parameterNumber") not in (0, 4 if row["kind"] == "max" else 5):
            raise ValueError("Not a temperature extrema parameter")
        end = datetime(*(int(get(k)) for k in ["yearOfEndOfOverallTimeInterval", "monthOfEndOfOverallTimeInterval",
                      "dayOfEndOfOverallTimeInterval", "hourOfEndOfOverallTimeInterval",
                      "minuteOfEndOfOverallTimeInterval", "secondOfEndOfOverallTimeInterval"]), tzinfo=UTC)
        if end != run_time + timedelta(hours=row["end"]):
            raise ValueError("GRIB interval end disagrees with forecast step")
        start = end - timedelta(hours=18)
        cell = dict(e.codes_grib_find_nearest(g, lat, lon, npoints=1)[0])
        k = float(cell.pop("value"))
        if not math.isfinite(k) or not 180 <= k <= 340 or cell["distance"] > 5:
            raise ValueError("Missing/out-of-range temperature or distant cell")
        cell["lon"] = (cell["lon"]+180) % 360 - 180
        cell["gridHash"] = get("md5Section3")
        return {"run": iso(run_time), "kind": "TMAX" if row["kind"] == "max" else "TMIN", "start": iso(start), "end": iso(end),
                "localStart": start.astimezone(CENTRAL).isoformat(), "localEnd": end.astimezone(CENTRAL).isoformat(),
                "cell": cell, "kelvin": k, "fahrenheit": (k-273.15)*9/5+32,
                "percentile": row["percentile"], "template": 10, "statistic": checks["typeOfStatisticalProcessing"]}
    finally:
        e.codes_release(g)


def extract(run, hours, lat, lon):
    run_time = datetime.strptime(run, "%Y%m%d%H").replace(tzinfo=UTC)
    now = datetime.now(UTC)
    if run_time > now or now-run_time > timedelta(hours=24):
        raise ValueError("Select an authentic current QMD run within 24 hours")
    result = {"schema": 1, "source": "NOAA NBM QMD GRIB2", "run": iso(run_time), "retrievedAt": iso(now),
              "timezone": "America/Chicago", "units": "degF", "requestedPoint": {"lat": lat, "lon": lon},
              "periods": [], "missingHours": [], "downloadBytes": 0}
    common_cell = None
    for hour in hours:
        key = f"blend.{run[:8]}/{run[8:]}/qmd/blend.t{run[8:]}z.qmd.f{hour:03}.co.grib2"
        url = BASE + key
        try:
            idx, _, _ = read_url(url+".idx")
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            result["missingHours"].append(hour)
            continue
        rows = select_rows(idx.decode(), run, hour)
        if not rows:
            result["missingHours"].append(hour)
            continue
        members = []
        for row in rows:
            a, b = row["offset"], row["stop"]
            if not 0 < b-a+1 <= 8_000_000:
                raise ValueError("Unexpected GRIB message size")
            data, status, headers = read_url(url, {"Range": f"bytes={a}-{b}"}, b-a+1)
            headers = {k.lower(): v for k, v in headers.items()}
            if status != 206 or not headers.get("content-range", "").startswith(f"bytes {a}-{b}/") or len(data) != b-a+1:
                raise ValueError("Server did not honor exact GRIB byte range")
            if data[:4] != b"GRIB" or data[-4:] != b"7777" or int.from_bytes(data[8:16], "big") != len(data):
                raise ValueError("Invalid single GRIB message boundary")
            member = decode(data, row, run_time, lat, lon)
            member.update(url=url, byteRange=f"{a}-{b}", sha256=hashlib.sha256(data).hexdigest(),
                          publishedAt=headers.get("last-modified"), etag=headers.get("etag"))
            members.append(member)
            result["downloadBytes"] += len(data)
        members.sort(key=lambda m: m["percentile"])
        first = members[0]
        for m in members:
            if not m['etag'] or any(m[k] != first[k] for k in ["cell", "start", "end", "kind", "etag", "publishedAt"]):
                raise ValueError("Percentiles differ in grid cell/interval/statistic")
        if common_cell is not None and first["cell"] != common_cell:
            raise ValueError("Grid cell changed within run")
        common_cell = first["cell"]
        if not members[0]["kelvin"] <= members[1]["kelvin"] <= members[2]["kelvin"]:
            raise ValueError("Crossed percentile values")
        result["periods"].append({k: first[k] for k in ["kind", "start", "end", "localStart", "localEnd"]} |
                                 {"p10": members[0]["fahrenheit"], "p50": members[1]["fahrenheit"],
                                  "p90": members[2]["fahrenheit"], "members": members})
    if not result["periods"]:
        raise ValueError("No validated extrema periods")
    result["cell"] = common_cell
    result["retrievedAt"] = iso(datetime.now(UTC))
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--run", required=True, help="Actual QMD cycle, YYYYMMDDHH; never substitute core cycle")
    p.add_argument("--hours", nargs="+", type=int, default=[18, 30, 42, 54, 66, 78])
    p.add_argument("--lat", type=float, default=38.80)
    p.add_argument("--lon", type=float, default=-90.79)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if len(set(a.hours)) != len(a.hours) or not all(0 < h <= 264 for h in a.hours):
        p.error("Unique forecast hours 1–264 required")
    d = extract(a.run, a.hours, a.lat, a.lon)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    temp = a.output.with_suffix(".tmp")
    temp.write_text(json.dumps(d, indent=2)+"\n")
    temp.replace(a.output)
    print(json.dumps({k: d[k] for k in ["run", "retrievedAt", "cell", "missingHours", "downloadBytes"]}, indent=2))
