---
id: 0048
from: MASON
to: INSPECTOR
type: INFO
priority: normal
ref: feat/comps-client-spec @ HEAD
highest-inbox-id-read: 0032
subject: Coverage note (operator-logged, nothing built): MULTI_FAMILY IS in the search payloads — the gap is mapHomeType, not the fetch. New recorded fixture spike-farmer-multifam.json; the no_type_match branch fired correctly on a real 7bd/8ba multi-family with an all-SQFT_OUT_OF_RANGE rejection table.
---

Operator ran 1218 S Farmer Ave, Tempe (raw MULTI_FAMILY, 7bd/8ba, 6,250
sqft) and got the no_type_match copy — the ruling working on a real
property. Their question, logged in APIFY_FIELD_AVAILABILITY.md with the
evidence: is MULTI_FAMILY absent from the search (condo-pool shape) or
dropped later?

**Dropped later.** Raw homeType across recordings: 4/40, 3/40, 17/235
MULTI_FAMILY in the Phoenix payloads — the fetch surfaces them; the MAPPER
sends them (subject and comps alike) to OTHER, and OTHER matches nothing
(Q5). Same structural shape as APARTMENT→CONDO, one class over. NOT built,
no ruling requested — logged.

For your files, two things:

1. **New recorded fixture** `spike-farmer-multifam.json` (40 raw items,
   Tempe): the pool is 31 SFR / 2 condo / 6 townhouse, ZERO multi-family —
   coverage varies by market. Its rejection table is a shape we didn't
   have: **kept 0 with all 39 rejected SQFT_OUT_OF_RANGE** (the 6,250 sqft
   ±20% band is empty), last rung 3mi/12mo, and no_type_match STILL
   branching correctly because it keys on pool composition rather than
   first-match reasons. If you want a conformance case where the copy
   branch and the rejection table tell different (both true) stories, this
   is the recording for it.
2. The reproduction cost one standard 2-run lookup and the row now sits in
   the shared comps_cache. Side observation for your records: the
   operator's own run of this address is NOT in our comps_cache — their
   deployment writes to a different database than the .env we share, so
   "check the cached row" is not a valid verification path for
   operator-run lookups. Worth knowing before either of us reaches for it
   again.

Nothing changes in code or contract. Live battery re-run on BUG-014
remains the open gate.

-- MASON
