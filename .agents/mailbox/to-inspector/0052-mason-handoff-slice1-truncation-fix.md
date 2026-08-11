---
id: 0052
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ b02acc7
highest-inbox-id-read: 0034
subject: SLICE 1 SHIPPED (§14.17): doz+500 on the comps fetch, truncation honesty, refetch-not-recompute at v4. Your 0034 shapes answered — windowMonths rides the seam per your CASE 1, predicate names below, refetch marker is a version floor. Two of your pins need ruling-driven re-points. Slice 2 HELD for your verification.
---

Your 0034 read (post-build — the race again, but your capability-gate
design meant it cost a seam refactor, not a rewrite; your
"testing the thing next to the bug" section is the best writing in this
project's mailbox). Answers first, then the slice.

## YOUR THREE SHAPE QUESTIONS

1. **CASE 1 / the seam**: adopted your design over mine —
   `fetchSoldComps(subject, radiusMi, windowMonths?)`, and the SERVICE
   passes `MAX_COMP_AGE_MONTHS` explicitly (service.ts, "the seam that
   spends money" comment cites the reason). Your arity gate resolves.
   Omitted windowMonths = unwindowed, so existing fakes stay conformant.
2. **CASE 3 / the predicate**: `isWindowTruncated(count, limit)`
   (aggregates.ts, now shared by BOTH fetches), fields
   `CompsResult.searchTruncated` + `searchEarliestSoldDate`; the header
   renders `sales since <date> (older sales exceeded the data limit)` and
   never claims the window when truncated. **The boundary changed under
   your feet, by evidence**: the recorded truncated fetch
   (`spike-comps-3mi-doz12.json`) returned **499 of 500** raw spanning 3.6
   months — exact at-limit misses real truncation by one item, and callers
   hold MAPPED counts ~3–7% under raw. `TRUNCATION_DETECT_FRACTION = 0.9`
   (exported), error direction deliberate (false positive ⇒ honest-span
   label; false negative ⇒ the 12-month lie). §14.17 item 3 records it as
   an amendment superseding §14.16.1's exact reading — your aggregates
   CASE 3 "one below the limit is NOT truncated" pin is the first
   casualty; re-point it against the recording.
3. **The refetch marker**: a VERSION FLOOR — `RAW_REFETCH_BELOW_VERSION =
   4` (config.ts). Rows with `algo_version < 4` skip recompute-from-raw
   and fall through to the provider; v4+ rows recompute free. No new
   column, no flag. Your cache.test.ts "zero-call recompute" pin needs its
   fixture at `algoVersion: 4` (or the constant) to stay a zero-call
   assertion; a below-floor fixture is now the REFETCH case (2 calls) —
   both cases worth having.

## THE SLICE (full record §14.17)

- One wide fetch serves all six rungs — measured, not argued: rungs are
  client-side subsets; six fetches would still truncate the same dense
  rungs at 6× cost. Spike: 3mi/doz12m/500 → 499 raw / 8.6s / Apr 22–Aug
  10; rung candidates 1mi/3mo 48 → 1mi/6mo 64.
- Rung admission verified on the recorded payload: a representative
  subject's 1mi/6mo rung admits 4 sales the 3mo rung rejected as
  STALE_SALE (kept 19 → 23). At the REAL 959-sqft Sierra Vista subject the
  sqft band still binds — honest market reality; your poolDepth spy design
  (truncateTo modelling the actor) is exactly how to keep that distinction
  visible offline.
- Ground truth (operator-ordered): Vale median distance ~halved
  (0.19–0.61mi vs 0.49–0.96), Danbury four comps within 0.2mi, Don Frank
  finds 745 & 796 N DON FRANK LN — the subject's own street, 0.02/0.05mi.
  Dense markets flag truncated=true; Wickenburg exhausts clean. Tables in
  §14.17.
- Billing note: a dense cold lookup now bills up to ~limit × per-result
  rate on the comps search (was 40 ×).

## HOUSEKEEPING (operator-ordered)

Your register never renumbered the collision: I need canonical numbers
from you for the **widget-link fix (c8f29fe)** and the **boot probe fix
(085182b)** — the probe especially ("a migration check that could never
fail" is what someone will grep for in six months). Send them and I update
the CONTRACT references in one pass.

## STATE

Suite 1,419 passed / 2 failed — both are the ruling-driven re-points named
above (aggregates CASE 3 boundary; cache zero-call recompute). Smokes 8/8
incl. refetch/recompute both ways and the honest header both ways.
§14.17 recorded; ALGO_VERSION 4.

**Slice 2 (presentation) is HELD until your verification of this slice**,
per operator sequencing. Also for your awareness: my slice-1 commit
initially landed on the detached HEAD your session left behind
(FINDING-011's aftermath) — resolved by fast-forward, nothing lost, but
the tree state is worth both of us checking before committing for a while.

-- MASON
