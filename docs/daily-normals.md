# Seven-day daily normals

The collapsed forecast rows show the normal high and low for their calendar date directly below
NBM guidance. Expanding a day shows its supplied normal values, station, baseline and check time,
then the observed record high and low with **every tied year**. The NWS forecast remains primary;
NBM quartiles, source windows and freshness rules are unchanged.

## Verified source and station

The existing weekly ACIS normal feed is reused. The
[ACIS documentation](https://www.rcc-acis.org/ACISWSdoc.html) defines `maxt`/`mint` as Fahrenheit and
`normal: "91"` as NOAA NCEI's **1991–2020** normal product (`"1"` is its documented alias). Requests
pin `91` and `prec: 1`, retaining supplied tenths in cached facts and expanded details; compact rows
round to whole degrees. Normals are official adjusted climatological values, not historical record
extrema or a dashboard average of a small observation sample. Record coverage thresholds do not
apply to normal values.

Bounded live requests on October 15, 2026 verified all seven high/low pairs at Spirit of St. Louis
(SUS/KSUS, USW00003966), Columbia Regional (COU/KCOU, USW00003945) and Quincy Regional
(UIN/KUIN, USW00093989). Each station was checked for October 15–21, February 27–March 4, 2028,
and December 29, 2026–January 4, 2027. Exact parameters, returned dates, station aliases,
coordinates, retrieval times and response hashes are preserved in
[`daily-normals-recorded.json`](../tools/fixtures/weather/daily-normals-recorded.json). An additional
October 11–18 SUS response at one decimal supports replay beside the existing recorded forecast.

A bounded corroboration with NOAA's
[SUS station normal product](https://www.ncei.noaa.gov/data/normals-daily/1991-2020/access/USW00003966.csv)
matched all seven October 15–21 ACIS decimal high/low pairs. For October 15, SUS is **70.0/45.5°F**;
Lambert's whole-degree normal is **70/50°F**. Their sources must stay distinct. The existing nearest
climate station selects SUS for the default location's normals, while the legacy airport selection
uses Lambert for deeper records. Station climate is labelled by station and does not describe the
user's exact GPS point. A failed normal response does not borrow another station's normal.

Normal requests ask for `meta: ["name", "sids", "ll"]` and validate the returned station aliases.
Adding observation-only `valid_daterange` to a normal request reproducibly returned ACIS's HTTP200
`No data available` error for SUS/STL during verification. Record requests retain their archive
metadata. No new feed origin, credentials, permissions or production producer work is needed.

## Calendar and availability

The normal date is the row's NWS local start date, including Tonight and holiday labels. A forecast
low is an overnight interval and can occur the next morning; normal and historical record values
both match the labelled row date. Today/tomorrow are also covered when the climate comparison card
needs them. At most nine distinct dates are requested, grouped only into contiguous bounded
ranges, so a newly issued tail obtains its own normal instead of inheriting another date's value.
Calendar arithmetic uses validated ISO date keys, independent of browser timezone and DST.

The [NOAA daily normal documentation](https://www.ncei.noaa.gov/data/normals-daily/1991-2020/doc/Normals_DLY_Documentation_1991-2020.pdf)
explains that February 29 temperature normals are estimated from February 28 and March 1. The
loader accepts only the **explicit February 29 entry** returned for the requested leap date. It
does not compute that estimate itself or substitute a neighbouring date when the entry is missing.
Observed records continue to use only literal observed February 29 dates, with all tied years.

Missing high and low values are independent. Blank, trace, malformed and non-finite temperatures,
wrong dates/stations, conflicting duplicates and service errors stay unavailable. The optional
context loader uses its existing three-request concurrency and 20-second request deadlines;
NWS/NBM loading never awaits it. An unavailable normal date waits for the existing refresh policy
rather than creating a repaint retry loop.

Context cache v6 rejects older normal facts without provenance. Each fact carries its date, station,
1991–2020 baseline, location, local as-of date and successful check time. Cache extension fetches
only missing record and normal dates and preserves original check times. Values are withheld after
12 hours, after local midnight or a location change, or for future check timestamps. Old responses
cannot update newer location/date/request state. Normals and records are removed from saved NWS
HTML along with model context; a later snapshot timestamp cannot renew optional climate facts.

## Validation

`daily-record-tests.js` and `daily-record-browser-tests.js` cover recorded normals and records,
separate stations, all tied years, missing sides, wrong stations, date/DST/year rollover and leap
semantics, stale/future cache facts, new-tail coverage, timeout isolation, snapshots and response
races. Browser screenshots cover 320px, 390px and desktop in both themes and Chicago/Tokyo
viewer timezones. The hosted verifier compares exact deployment bytes and live values against
actual matching-station ACIS responses using normal TLS. Desktop planning gap and native
interaction checks remain part of verification.
