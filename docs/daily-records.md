# Seven-day observed station records

Each expanded forecast day shows its calendar-date record high and low. The collapsed row now
shows its [daily normal high and low](daily-normals.md) beneath the optional NBM range. Records are
the maximum of observed daily `maxt` and minimum of observed daily `mint` for
that month/day at the selected climate station. They are Fahrenheit observations, separate from
1991–2020 normals, NWS forecast temperatures and NBM quartiles. NWS remains the primary forecast.

The row date comes from its NWS period's local start date, including Tonight, holiday names and
day-only tails. An overnight NWS low may occur the next morning; its interval is shown in the day
details. Both historical records refer to the row's calendar date. Chicago calendar arithmetic is
independent of the viewer's timezone, DST and December rollover.

## Primary-source verification

On October 11, 2026, bounded ACIS `StnMeta` and dated `StnData` requests verified all seven
October 11–17 dates for Lambert, Columbia Regional and Quincy Regional airport series. The
recorded responses, exact request parameters, retrieval times, station IDs, coordinates and
element-specific archive spans are in
[`tools/fixtures/weather/daily-records-recorded.json`](../tools/fixtures/weather/daily-records-recorded.json).
Each request retrieves one calendar date per historical year, rather than a full daily archive.
The fixture captures two temperature columns; precipitation was not captured in those requests.

The existing default location selects Spirit of St. Louis (`SUS`/`KSUS`) for nearby normals and
Lambert (`STL`/`KSTL`, WBAN 13994, GHCN USW00013994) for deeper records. The nearest legacy
first-order station selection is preserved. Station observations describe that archive, not the
user's exact GPS point. FAA identifiers are ACIS type 3; ICAO identifiers are type 5. Both aliases
refer to the same archive when returned together in ACIS metadata.

Lambert's reported daily-high and daily-low archive spans were 1930-01-01 through 2026-10-10.
For these seven dates, 96 usable observations of each temperature cover 1930–2025. Only completed
dates are included; the current local day's extrema can still change.

| Calendar date | Airport record high (°F), all years | Airport record low (°F), all years |
| --- | --- | --- |
| October 11 | 94 (1963) | 30 (1964) |
| October 12 | 88 (1947, 2024) | 31 (1987) |
| October 13 | 89 (1989) | 33 (1977, 1979) |
| October 14 | 89 (1947, 2017) | 30 (1937) |
| October 15 | 89 (1938, 1963) | 30 (1937) |
| October 16 | 89 (1950) | 32 (1943) |
| October 17 | 91 (2016) | 29 (1943) |

Columbia airport's archive begins 1889-09-01 and Quincy airport's begins 1948-06-01. Archive
spans contain gaps: the checked Columbia dates have 115–116 usable values and Quincy 77–78.
The UI reports separate usable high/low counts and first/last usable years rather than assuming
every year in an archive span contains an observation.

The [ACIS web-services documentation](https://www.rcc-acis.org/ACISWSdoc.html) defines station
metadata, dated observations and annual intervals. `StnData` supplies explicit observation dates;
`MultiStnData` arrays have a different shape and are not used by this loader. A summary extrema
date gives a single occurrence, so all tied years are instead derived from the dated observations.
The [NWS NOWData FAQ](https://www.weather.gov/climateservices/nowdatafaq) describes missing values
and archive qualifications; this is a checked archive, not a claim of final certified climate data.

## Area-series differences and retained conflict

NWS area records can join several station histories. They must remain separate from an airport
series. [ThreadEx's explanation](https://threadex.rcc-acis.org/help/about.html) and
[station-history data](https://threadex.rcc-acis.org/data/threads_dict.json) show these joins:
St. Louis area (`STLthr 9`) begins in 1874, Columbia area (`COUthr 9`) in 1889 and Quincy area
(`UINthr 9`) in 1901. Their underlying location histories differ from the airport archives.

The [NWS St. Louis October calendar](https://www.weather.gov/lsx/stl_oct) agrees with the checked
area-series extrema but differs from Lambert airport on October 12–15. For example, the area
October 12 record is 89°F in 1890; the airport record is 88°F in 1947 and 2024. The
[Columbia calendar](https://www.weather.gov/lsx/cou_oct) gives an area October 11 high of 89°F
in 1962, while the verified airport series gives 87°F.

A source conflict remains unresolved: the [NWS Quincy October calendar](https://www.weather.gov/lsx/uin_oct)
lists October 16 at 90°F (2016) and October 17 at 88°F (1950), while the checked ACIS **area**
series gives October 16 at 88°F (1950) and October 17 at 90°F (2016). The implementation does
not combine these sources or use either area calendar as an airport-record fallback. Users can
follow the NWS climate link for official area products.

## Missing dates, leap days and cache provenance

ACIS annual stepping can replace February 29 with February 28 in non-leap years. Requests start
in a leap year and the reducer filters literal `MM-DD` dates, rejects invalid calendar dates,
excludes current/future observations and does not count duplicate or conflicting observations.
Missing/blank/non-numeric temperatures and temperature traces are omitted; zero remains a value.
High and low coverage are independent. Thirty usable dates are required for an ordinary-date
record; February 29 requires ten actual leap dates. Legacy ranking/briefing sample thresholds
remain unchanged. Archive span alone does not qualify a record.

The existing two record queries now cover the actual seven visible dates, plus today/tomorrow
when required by the climate card: at most nine one-date queries, with two existing ancillary
climate queries and bounded daily normal date ranges. Three context requests run concurrently,
each under the existing 20-second
deadline. Queued work stops after location/date/request supersession. This is optional context;
forecast and model loading never await it. No weather cadence, permission, producer budget or
NOAA extraction/publishing logic changes.

Cache v5 stores derived facts, source metadata, selected station, coordinates, exact calendar
date, completed-date cutoff, counts, tied years and original per-date check times. Extending a
new issued date reuses checked dates and ancillary data without renewing their timestamps.
Failed dates remain explicitly unavailable; one date or temperature never borrows another's
record. Invalid station responses are rejected. Values expire after the existing 12-hour context
age and cannot cross a station/location generation or local midnight.

Snapshot v23 excludes record and NBM markup from saved NWS rows. A saved forecast cannot turn
old supplemental values into newly verified records. Records are loaded on approach to either
the forecast or climate section, or through the existing requested context/refresh controls.

## Validation

`tools/daily-record-tests.js` checks all seven authentic dates for three airport series, independent
high/low gaps, tied years, literal leap dates, completed-date bounds, DST/year rollover, bounded
concurrency, cache reuse/expiry and location/date/request races. `tools/daily-record-browser-tests.js`
checks served assets at 320, 390 and 1440 pixels in Chicago and Tokyo browser timezones, both
themes, visible calendar dates, focus/disclosure retention, partial/wrong-station/timeout isolation,
per-record expiry, visible cache timestamps and snapshot exclusion. Browser outage scenarios are
controlled; they do not prove future upstream availability. The browser placement replay pins
the authentic October 11 06Z NBM publication from main `e9463d9` and its retrieval clock in
`nbm-daily-records-20261011-recorded.json.gz` (uncompressed SHA-256
`cbc9a23f8294d1b01115ff46df69846e35d5e405a8c6c6849f685847f0fc7e20`). Source values and metadata
are unchanged; this uses the existing published file without another extraction. Future model
publications cannot alter this replay. Hosted preview verification uses
normal TLS and compares served assets with the exact PR commit before checking live records.
