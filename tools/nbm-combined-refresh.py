#!/usr/bin/env python3
"""Run independently bounded NBM producers; a failed sibling cannot suppress valid output."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS = {'daily': ('nbm-refresh.py', 'nbm-status.json'),
            'hourly': ('nbm-hourly-refresh.py', 'nbm-hourly-status.json')}
TIMEOUT = 630  # Per process, including final decode/write after its 600-second soft budget.


def refresh(directory, execute=subprocess.run):
    directory.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    seeds = json.loads((directory/'nbm-seed-status.json').read_text()) if (directory/'nbm-seed-status.json').exists() else {}
    next_window = seeds.get('nextPublicationWindow')
    # Reuse the seed-time decision used to install/skip the decoder. A queued
    # invocation crossing the boundary must wait for a newly seeded check.
    if next_window:
        report = dict(status='deferred', nextPublicationWindow=next_window, products={},
                      requests=0, downloadBytes=0, elapsedSeconds=round(time.monotonic()-started, 3))
        (directory/'nbm-combined-status.json').write_text(json.dumps(report, indent=2)+'\n')
        return report
    outcomes = {}
    for name, (script, status_file) in PRODUCTS.items():
        path = directory/status_file
        path.unlink(missing_ok=True)  # A killed process cannot reuse a prior successful status.
        try:
            if seeds.get(name, {}).get('status') == 'failed':
                raise ValueError('Retained pair could not be seeded: '+seeds[name]['error'])
            result = execute([sys.executable, str(ROOT/'tools'/script), '--output-dir', str(directory)],
                             timeout=TIMEOUT, check=False)
            report = json.loads(path.read_text())
            if result.returncode and report.get('status') != 'failed':
                raise ValueError('Producer exited without a reliable failure status')
            outcomes[name] = report
        except Exception as error:
            report = dict(status='failed', changed=False, checkedAt=datetime.now(timezone.utc).isoformat(),
                          error=f'{type(error).__name__}: {error}', resourceUsageIncomplete=True,
                          retainedPrevious=(directory/('nbm-range.json' if name == 'daily' else 'nbm-hourly.json')).exists())
            path.write_text(json.dumps(report)+'\n')
            outcomes[name] = report
    ok = sum(p['status'] != 'failed' for p in outcomes.values())
    report = dict(status='ready' if ok == 2 else 'partial' if ok else 'failed', products=outcomes,
                  checkedAt=datetime.now(timezone.utc).isoformat(), elapsedSeconds=round(time.monotonic()-started, 3),
                  processTimeoutSeconds=TIMEOUT, resourceUsageIncomplete=any(p.get('resourceUsageIncomplete', False) for p in outcomes.values()),
                  downloadBytes=sum(p.get('downloadBytes', 0) for p in outcomes.values()),
                  requests=sum(p.get('requests', 0) for p in outcomes.values()))
    (directory/'nbm-combined-status.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    result = refresh(args.output_dir)
    print(json.dumps(result, indent=2))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('publishable='+str(result['status'] in ('ready', 'partial')).lower()+'\n')
    # Partial output continues to the independent publisher; it reports degraded runs.
    raise SystemExit(result['status'] == 'failed')
