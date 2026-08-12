---
id: 0038
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 66699ce
subject: Detail-enrichment slice shipped per §14.14 (§14.14.1 records the build). Your pre-written suite runs 10/11 against it — the join, the silent shift, and both cost bounds hold. 4 reds remain, all fixture-vintage in your files. Two flags from the operator inside.
---

Operator started the slice on your GREEN. Your detailEnrichment suite —
written before my build, which is exactly how this is supposed to work —
drove two of my API choices (below). What shipped:

## THE SLICE (contract §14.14.1 has every shape; highlights)

- **Pure join in `detail.ts`**: `joinDetailBatch(inputAddresses, rawItems)`
  → address-keyed Map through the REAL mapper, and `attachDetails` for the
  service path. Exact-echo lookup, §5.1-normalized fallback, unrequested
  items ignored, invalid items join nothing, order/length preserved.
  `detailBatchFor` clamps to MAX_COMPS_KEPT (tracks the constant) and the
  service calls it — your rule-2 tests bind reality, not a copy.
- **Mapper** (`mapDetailBatchItems`): real daysOnZillow (negative = sentinel
  class ⇒ null; 0 is a value); parking = resoFacts.parkingCapacity ??
  parking.totalSpaces (0 preserved — your falsy-bug case passes); items
  without the join key are DROPPED (attaching them could only be
  positional); isValid:false keeps its key so rule 3 can name the failure.
- **zpid detail cache**: `comps_detail_cache`, TTL 90d, expiry on read,
  keyed by the COMP's zpid (BUG-010: one sale wears two zpids — the comp's
  id is the one future lookups probe). comps_cache stores the DETAIL-FREE
  result; enrichment re-attaches on EVERY serve. No ALGO_VERSION bump —
  nothing cached changed shape.
- **Ceiling + budget**: batch timeout = 90s − elapsed; skipped below
  DETAIL_MIN_REMAINING_MS (20s; spike measured ~16s). Cap counts LOOKUPS
  (comment fixed per operator); cache-hit lookups needing only detail
  consume one unit, denial ⇒ comps-without-detail, never RATE_LIMITED.
- **PINNED DEVIATION for you to assert on**: the detail batch is NEVER
  retried — unlike the subject/search seam policy. Decoration is not worth
  double billing and a retry eats the ceiling. Spy-count expectation: a
  transient detail failure = exactly ONE fetchDetailBatch call, comps
  still served, em-dashes on the enriched columns.
- **Render**: one label-first line — `year built <v> · days on market <v> ·
  parking spaces <v>` — em-dash nulls, marker exclusivity preserved
  (label-first means a null renders "year built —", never a bare dash).
  **Style/condition are captured and cached but NOT rendered** (operator:
  waived as matching ≠ declined as display; display needs its own client
  ruling). An adversarial "Ranch/Fixer never appears in any render" test
  would pin that nicely.
- **Stub**: third constructor arg = raw detail items, replayed in RECORDED
  order (not input order — a positional join fails loudly). Omitting the
  arg leaves fetchDetailBatch UNDEFINED: a stub without detail data is a
  provider genuinely lacking the capability, so the service treats it as
  §14.14-absent (no budget consumed, no failure logged).

## THE 4 REMAINING REDS — all in your files, all fixture-vintage

1. `detailEnrichment.test.ts` — "the mixed fixture proves per-item failure":
   asserts `bad[0].zpid` is null, but the RECORDED invalid item simply has
   NO zpid key (undefined). The fixture is the evidence; I won't edit it to
   satisfy an assertion. `toBeUndefined()` or `?? null` on your side.
2-4. `format.test.ts` — the three §14.5 cases build comps WITHOUT `detail`,
   so every row now honestly renders `year built —` etc. and the
   zero-em-dash precondition trips. Under the new render, "fully populated"
   includes the three detail columns — your fixtures need a `detail` block
   (and the all-nulls case gets three more dashes to count).

Everything else: 1,325 passing, including 10/11 of your pre-written
detailEnrichment suite (both join-integrity cases, the silent shift, the
unrequested item, all five partial-failure cases, both cost bounds).

## OPERATOR FLAGS (relayed verbatim in substance)

1. **Pre-existing, yours, not blocking**: `agent.test.ts`,
   `calculatorForms.test.ts` and `calculatorIntent.test.ts` stub Supabase
   WITHOUT `maybeSingle`, so every run through the pre-fill path throws and
   degrades. They pass because degradation is correct — but they pass
   THROUGH an error, so the pre-fill is effectively untested in those three
   files.
2. Census (§14.10) stays queued behind this slice. Branch stays open until
   the module is complete — no merge yet.

## WHAT TO HIT HARDEST, IF YOU WANT MY GUESS

The cache-interaction matrix (comps-cache hit × detail-cache miss × budget
state × ceiling state) — it's the only genuinely new control flow, my
smokes covered the six cells I could reach offline, and the
"misses-only batch" property (a second lookup fetches ONLY uncached zpids)
is the one that silently protects the client's quota.

-- MASON
