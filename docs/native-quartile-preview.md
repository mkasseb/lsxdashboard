# Native quartile preview

This draft replaces daily and hourly P10/P50/P90 with native NOAA P25/P50/P75. NWS temperatures,
NWS Key Messages, alerts, the LSX location boundary and forecast decisions retain their existing
sources and behavior. “Middle 50% model range” spans P25–P75: roughly 25% of modeled outcomes lie
below and 25% above; outcomes outside remain possible. This describes each native window/hour,
not the probability of the entire time series staying inside. P50 remains the median.
The optional P10/P90 threshold commentary is removed.

## Source evidence

Source cycle: **2026-10-09 00Z**, with actual extraction timestamps preserved. Daily JSON retrieval
completed **12:50:55 UTC**; hourly completed **12:57:11 UTC**. The source-age policy withholds both
at **2026-10-10 00Z**. Expiry of this static preview is distinct from production refresh failure.

The [official NOAA percentile specification](https://vlab.noaa.gov/documents/6609493/49238069/NBM_v5.0_Percentiles_and_Exceedances.pdf)
was discoverable with its description of fifth-percentile output, but direct normal-TLS reads
returned HTTP 403. Live NOAA inventories and decoded GRIB metadata provide the implemented evidence.
The [recorded inventory](../tools/fixtures/weather/nbm-quartile-inventory-recorded.json) includes
original lines and hashes from October 9 00Z:

| Sample | Native fields validated |
|---|---|
| daily f018 | P25/P50/P75 minimum, 0–18 hours, PDT 10 |
| daily f030 | P25/P50/P75 maximum, 12–30 hours, PDT 10 |
| daily f222 | P25/P50/P75 maximum, 204–222 hours, PDT 10 |
| hourly f001/f018/f030/f048 | P25/P50/P75 instantaneous 2 m temperature, PDT 6 |

Daily downloads use exact S3 message ranges from the QMD inventories, retaining URL, SHA256, ETag,
upload time, native interval and grid identity. Hourly downloads use the existing NOMADS regional
subset service, retaining subset SHA256 and original-object Last-Modified/Content-Length before
and after decoding. Revision indicators are not cryptographic cross-source identity guarantees.
No values are interpolated, derived from wider percentiles, or synthesized from hourly extrema.
The subset response can contain other NOAA fields/percentiles; only the three native selected
percentiles are decoded into and stored in the serving JSON.

The complete producer validation covers 18 daily windows / 54 messages and 48 hourly samples,
with 2,969 native cells per regional dataset. The supported rectangle remains 38.2–39.2°N,
91.1–89.5°W, a metro subset of LSX. Nearest native cells must be within 3 km; native 18-hour extrema
windows and exact UTC hourly alignment are preserved. Hourly f001–f048 retain rolling coverage.

An [independent raw-GRIB audit](../tools/fixtures/weather/nbm-quartile-decoded-audit.json) re-read the
saved 21 sample messages and checked 231 native nearest-cell comparisons at the default location,
Belleville, corners and edge/midpoints against serving JSON, metadata and source hashes. Daily
rounding tolerance is 0.00000051 K; hourly is 0.00051 K. A separate independent agent review also
compared all 2,969 values and native coordinates for these 21 selected messages (62,349 values),
with no substantive findings. These audits made zero additional NOAA requests. They validate
extraction and alignment, not forecast accuracy or calibration.

## Measured resource use

[Extraction recording](../tools/fixtures/weather/nbm-quartile-extraction-recorded.json); one complete
explicit-cycle extraction per product, normal TLS, seeded with the previous production pairs to
exercise same-cycle schema migration. No publication command or production trigger ran.

| Product | Requests | Response-body bytes | Seconds | Serving JSON bytes |
|---|---:|---:|---:|---:|
| Daily | 72 | 115,829,780 | 29.966 | 1,244,105 |
| Hourly | 146 | 6,718,439 | 375.318 | 3,819,881 |

Daily remains below its 100 request / 150 MB / 600 second / 2 MB output limits. Hourly remains below
180 requests / 30 MB / 600 seconds / 4 MB output, with **180,119 output bytes** left. Only three
values are stored. Explicit `--run` omits ordinary cycle-discovery overhead; these measurements
exclude headers, transport, Git, dependencies and deployment. Different cycles and retries can
consume the remaining budget. No new service, credentials or billing entitlement was introduced.

The [subsequent no-op recording](../tools/fixtures/weather/nbm-quartile-noop-recorded.json) used
36 daily requests / 505,293 bytes and 49 hourly requests / 336,746 bytes, preserving all dataset,
receipt, retrieval timestamp and publication-manifest bytes. There was no repeated full extraction.

## Migration and review checks

Daily regional schema 3 / point schema 4 and hourly schema 2 require explicit [25,50,75] identities
and matching native member/hour percentile metadata. New receipts are `regional-quartiles-v2` and
`hourly-quartiles-v2`. Old schemas, old receipts, mixed percentile groups, malformed/off-point rows,
reordered/missing daily horizons and five-value rows cannot become new labeled guidance. Missing
hourly samples remain visible gaps; publication requires all 48 hours. Structural validation also
runs before retained no-op reuse. Snapshot v22 discards v21, and asset hashes change on migration.
A real HTTP-cache test retains old JSON through the code upgrade and verifies it is withheld.

Temporary bare-Git tests cover atomic pairs, rollback, no-op bytes, independent sibling failures,
remote rejection/races, receipts, malformed publication budgets and six-hour window deferral.
The production publication manifest and scheduled workflows are unchanged. Only existing read-only
PR preview-verification conditions were extended for this branch; permissions remain unchanged.

Browser tests cover daily/hourly native data, gaps, source expiry, location races and saved-state
isolation at 320/390/1440px in Chicago/Tokyo, both themes and 200% text. Separate NWS tests cover
unchanged wording, official fallback, saved-location LSX membership, natural card height, Now-strip
UV wrapping, warnings and source focus. Hosted preview tests use exact commit-byte hashes and
normal TLS. The strict existing Cloudflare HTML-injection verifier remains intact.

This is a draft review artifact. No merge or production activation is authorized by this change.
