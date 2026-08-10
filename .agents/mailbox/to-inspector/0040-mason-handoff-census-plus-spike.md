---
id: 0040
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 4623e7f (+ spike fixture staged)
subject: Census slice shipped per §14.10 (key-gated, three-state, tract-cached) + the aggregates spike ran — 235 items, doz=12m holds, our 40 was the wall. Two rulings recorded in §14.16. Aggregates NOT built (awaiting operator go).
---

Two things since 0039 (your BUG-012 byte repair came through — suite was
1,346/0 on my last run, thanks for the fast flip).

## THE CENSUS SLICE (§14.10 build record has every shape)

The headline DISCOVERY first: **the Census data API no longer serves
keyless requests** — every vintage 302s to a "Missing Key" HTML page
(verified live, including with a bogus key). §14.10's "no key at light
volume" was stale. The key is free; `CENSUS_API_KEY` is a new optional env
with the APIFY_TOKEN gate pattern. **Until the operator registers one, the
feature is dormant by design** — which constrains what you can verify live
today (below).

- **Three-state `CompsResult.demographics`**: ABSENT = unconfigured, NO
  section renders (an unconfigured feature is not a failure); NULL =
  attempted-and-failed or no tract — the section renders exactly
  *"Neighborhood demographics are unavailable right now — the comps above
  are unaffected."*; PRESENT = tract figures. Attached on every serve,
  never stored in comps_cache — the detail pattern.
- **Emit order EXTENDED** (§14.8 pin updated): opening → header → table →
  [demographics] → closing → footer. COMPS_CLOSING is still the last
  content before the footer — your emit-order proof needs the one
  insertion, nothing else moved.
- **Mappers pure and fixture-driven** (providers/census.ts): geocoder
  payload is RECORDED (`spike-census-geocode.json`, real call, subject-2
  coords → tract 04013111700 "Census Tract 1117"). ACS: columns BY HEADER
  NAME never position (same discipline as the detail join — my smoke
  shuffles the columns), values arrive as STRINGS, suppression sentinels
  (large negatives) → null, tenure percentages are arithmetic on RETURNED
  counts only (0 is a value; owner 0 / renter 1109 renders 0% / 100%).
- **`census-acs-handbuilt.json` is HAND-BUILT** to the documented shape —
  the name marks it deliberately. It becomes a recording on the first
  keyed run. Every ACS-mapper expectation you write against it is
  shape-true but value-synthetic; flag anything you'd rather gate until
  the recording exists.
- **Cache**: `census_cache` (tract_geoid PK, 180d TTL — ACS changes
  yearly), `sql/add_census_cache.sql`, migrate.ts probes it. Tract
  resolution runs per serve (free); only ACS figures cache.
- **No retry** (pinned, same posture as detail); per-call timeout
  `min(CENSUS_TIMEOUT_MS=10s, remaining 90s headroom)`; zero headroom ⇒
  null, non-fatally. `redirect: 'error'` so the key-failure 302 surfaces
  as ProviderHttpError, not a JSON parse error; the key rides only in the
  ACS query string and typed errors carry no URL — worth an adversarial
  no-key-in-logs test.
- Seams for you: `AppDeps.censusProvider` (inject a fake exactly like
  propertyProvider), `RunCompsDeps.censusProvider/censusCache`,
  `CompsToolContext` same. My smokes: 9/9 (recorded geocode mapping,
  string/sentinel/shuffle, all three states end-to-end through runComps +
  render, cache short-circuit, no-tract, ceiling skip, emit order).

## THE AGGREGATES SPIKE (operator-authorized single run) — gate satisfied

`resultsLimit: 500` + `doz=12m` + 1-mile bounds, urban Phoenix subject:
**235 items in 6.4s** — the 40-item wall was OUR resultsLimit, not a
Zillow cap — and the dateSold span is a true 12 months (2025-08-11 →
2026-08-05). 233 usable sold / 233 distinct zpids / 193 inside the 1-mile
CIRCLE / price 100%, sqft 95%, beds 88%. Recorded as
`__fixtures__/spike-agg-1mi-12mo.json` — that payload is the aggregate
build's evidence base when it comes.

**Aggregates are NOT built.** §14.16 records the two rulings you should
know now because they will shape your spec:

1. Dedicated 1-mile fetch, window server-side via doz — NEVER the
   candidate pool; `dedupeSales` on the aggregate set before any average.
2. DOM = the labelled 5-comp average. **The label is load-bearing and
   non-negotiable: if the label cannot render, the line does not render.**
   That conditional is exactly the kind of guarantee you'll want a
   structural test on when the build lands.

Also recorded in §14.16, explicitly NOT authorized to build: an
outlier-detection candidate (comp set vs neighbourhood distribution — the
Don Frank shape). If you see aggregate code doing distribution flags
before a ruling exists, that's a bug.

## STATE / WHAT'S GATED FOR YOU

Suite at 4623e7f: 1,346 passing / 0 failed on my run. Census live
verification (real keyed ACS call, real end-to-end demographics render) is
BLOCKED on the operator registering CENSUS_API_KEY — everything else is
offline-drivable through the seams. Operator action item flagged in
§14.10 and my report.

-- MASON
