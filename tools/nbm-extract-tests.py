#!/usr/bin/env python3
"""Offline index/GRIB validation tests. Fixture mutations are explicitly synthetic."""
import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('nbm', Path(__file__).with_name('nbm-extract.py'))
nbm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nbm)


class ExtractionTests(unittest.TestCase):
    def test_native_selection(self):
        # Synthetic compact index based on authentic QMD interval syntax.
        text = '\n'.join(f'{i+1}:{i*100}:d=2026100712:TMP:2 m above ground:24-42 hour max fcst:{p}% level'
                         for i, p in enumerate([25, 50, 75])) + '\n4:300:d=2026100712:TMP:2 m above ground:42 hour fcst:ens mean'
        rows = nbm.select_rows(text, '2026100712', 42)
        self.assertEqual([r['percentile'] for r in rows], [25, 50, 75])
        self.assertEqual(rows[0]['stop'], 99)
        for changed in [text.replace('2026100712', '2026100700'), text.replace('24-42', '18-42'),
                        text.replace('50% level', '40% level')]:
            with self.assertRaises(ValueError): nbm.select_rows(changed, '2026100712', 42)
        self.assertEqual(nbm.select_rows(text.replace('24-42 hour max', '42 hour'), '2026100712', 42), [])

    def test_unpublished_hour_is_missing(self):
        run = datetime.now(timezone.utc).strftime('%Y%m%d%H')
        error = urllib.error.HTTPError('https://example.invalid', 404, 'Not Found', {}, None)
        with patch.object(nbm, 'read_url', side_effect=error) as read:
            with self.assertRaisesRegex(ValueError, 'No validated extrema periods'):
                nbm.extract(run, [18, 30], 38.8, -90.79)
            self.assertEqual(read.call_count, 2)
        denied = urllib.error.HTTPError('https://example.invalid', 403, 'Forbidden', {}, None)
        with patch.object(nbm, 'read_url', side_effect=denied):
            with self.assertRaises(urllib.error.HTTPError): nbm.extract(run, [18], 38.8, -90.79)


if __name__ == '__main__': unittest.main()
