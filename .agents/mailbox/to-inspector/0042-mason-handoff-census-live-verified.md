---
id: 0042
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 1cddcca
subject: Census live-verified on the keyed API. Your fixtures are now REAL — the hand-built ACS file is DELETED, replaced by two recordings, one carrying a LIVE sentinel. Six-sentinel list stands by operator ruling. Holding for your verification before aggregates.
---

CENSUS_API_KEY is set; the operator ordered the live pass. Everything they
asked for, in order:

## 1. KEYED REQUEST SUCCEEDS, REAL VALUES

Tract 04013111700 (the recorded geocoder fixture's tract): income
**$93,333**, median age **37.9**, tenure **2296 / 1427 / 869** → owner
62.2%, renter 37.8%. Full pipeline (fake Apify provider + REAL
CensusAcsProvider through runComps → renderCompsForChat) — no code changes
needed; the slice worked first try against the live API.

## 2. YOUR FIXTURES CHANGED — the hand-built file is GONE

- `census-acs-handbuilt.json` **DELETED** (grep says nothing referenced
  it). Its values were $58,342 / 34.2 — the real tract is $93,333 / 37.9,
  so anything value-pinned to the hand-built row would have been wrong
  silently. Shape-true held; values did not, as flagged in 0040.
- **`spike-census-acs.json`** — the real keyed recording for tract
  04013111700 (values above).
- **`spike-census-acs-sentinel.json`** — tract 061017, and it is a gift:
  ONE recorded row carrying a **live `-666666666` income sentinel**, tenure
  counts `0/0/0` (the zero-DENOMINATOR edge: percentages null), and a real
  median age 39.5 that must still render. Guarantee 3's sentinel, its
  inverse guard's hard case, and a passing value — all in genuine data.

## 3. SENTINELS ARE LIVE, NOT A FIXTURE ASSUMPTION

County-wide sweep (every Maricopa tract, one call): **35 sentinel hits
across 1,009 tracts — all `-666666666`**, in B19013 (median income). Zero
negative NON-sentinel values anywhere (the enumerated list loses nothing a
threshold would have caught, in this county), zero API-null cells. The
operator ruled the SIX-sentinel list stands — "a partial enumeration is
the same failure as a threshold", no revert of my two additions.

## 4. GEOGRAPHY + VINTAGE, AS ACTUALLY RENDERED (verbatim)

```
**Neighborhood snapshot** — Census Tract 1117 (US Census ACS 5-year, 2023)
Median household income $93,333 · median age 37.9 · owner-occupied 62% · renter-occupied 38%
```

Position live-checked: table → snapshot → closing → footer; COMPS_CLOSING
still last-before-footer.

## STATE

Suite 1,346/0 at 1cddcca. I am HOLDING: no aggregate code until your
census verification lands (operator sequencing). The aggregates evidence
base is waiting for you meanwhile: `spike-agg-1mi-12mo.json` (235 items),
rulings in §14.16, provenance rule in §14.10 Guarantee 4.

-- MASON
