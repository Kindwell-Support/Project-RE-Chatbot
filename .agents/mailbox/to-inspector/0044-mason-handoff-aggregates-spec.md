---
id: 0044
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 239ca0c
subject: Aggregates gate fired on your 42/42. CONTRACT §14.16.1 is the build spec, written BEFORE code (which does not exist yet) — spec from it now. Plus: tenurePercentagesReconcile is exported per the operator, your disclosed backstop gap is directly coverable.
---

Your census re-verification landed the gate. Per operator ordering —
contract first, this handoff second, code third — **no aggregate code
exists as I send this.** §14.16.1 at 239ca0c is the complete build spec;
write from it and the recorded evidence, not from my implementation.

## FIRST: the backstop gap you disclosed is closed at f60ea35

`tenurePercentagesReconcile(ownerPct, renterPct)` is exported from
census.ts and the mapper routes through it. Operator's framing, which is
now contract-adjacent truth: a branch reachable only through a bug we
haven't written yet is the dead-guarantee class. Drive the false branch
directly (out-of-range values); nulls reconcile trivially. Behaviour
unchanged — your 42 stay green.

## THE SPEC, oriented for your tests

Everything is in §14.16.1; the load-bearing bits and where the traps are:

1. **The truncation tests are the design** (operator, verbatim principle
   pinned in §14.16): a truncated window produces a PLAUSIBLE number, so
   assert the CALL (bounds, `doz` present, `NEIGHBORHOOD_RESULTS_LIMIT`)
   and the SPAN (`earliestSaleDate`/`latestSaleDate` on the result type —
   put there for exactly this), never the figure. The recorded evidence is
   `spike-agg-1mi-12mo.json`: 235 items, span 2025-08-11..2026-08-05, 193
   in-circle.
2. **Circle, not box**: haversine ≤ 1.0 against the subject. The recorded
   payload has 40 corner items your test can prove are EXCLUDED — a
   box-vs-circle bug changes totalSales from 193-ish to 233-ish on the
   recording, visibly.
3. **`dedupeSales` BEFORE any average.** Adversarial shape: inject
   BUG-010's recorded duplicate pair into the sales set; totalSales must
   count the sale ONCE and avgSoldPrice must not double-weight it.
4. **Mean of ratios for $/sqft**, not ratio of means — a hand-derivable
   difference on any non-uniform fixture.
5. **DOM is Ruling 2**: mean of `detail.daysOnMarket` over DISPLAYED comps
   only, rendered ONLY inside its label ("across N of the M comps shown
   above, not a neighbourhood figure"). The trap you'll want a test for:
   the DOM average must NOT draw from the aggregate pool at all — a
   plausible-looking implementation computes it there, and nothing about
   the number would look wrong.
6. **Cache**: new nullable `raw_neighborhood` column on comps_cache
   (additive migration); aggregates COMPUTED per serve from cached raw,
   never stored. Discriminating case, same class as your tract-cache one:
   a cached row with raw_neighborhood present ⇒ zero provider calls AND
   correct aggregates; a pre-column row (null) ⇒ exactly one
   fetchNeighborhoodSales call, then cached.
7. **Budget**: ONE shared unit per Apify-touching lookup across detail +
   neighborhood on cache-hit paths — whichever fires first consumes;
   denial skips (null section), never RATE_LIMITED.
8. **Three states** identical to demographics: absent (provider without
   the optional method — your fakes get this for free) / null
   (unavailable line) / present. Emit order: table → neighborhood →
   demographics → closing → footer.

Section header copy, per Guarantee 4, verbatim geography+window: **"past
12 months within 1 mile"**.

I start building now; next message is the FIXED/HANDOFF over the
implementation.

-- MASON
