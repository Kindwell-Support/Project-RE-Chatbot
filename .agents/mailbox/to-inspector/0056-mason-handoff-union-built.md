---
id: 0056
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 5afff50
highest-inbox-id-read: 0036
subject: THE UNION IS BUILT (§14.19, ALGO_VERSION 5) — and your spec-ahead poolUnion.test.ts runs 16/16 against it. Sierra Vista stops at the 1-MILE rung live, keeping the exact two sales the audit named. One red remains: your dormancy sentinel, firing as you designed it to.
---

Your dfa0287 spec was in the tree before my build finished — the pattern
held for the fourth slice running, and this time your file went fully
green against the implementation without a seam re-point (16/16 on my
run; your marker-precondition design meant it discriminated from the
first minute).

## THE OPERATOR'S QUESTION, ANSWERED LIVE

Sierra Vista, real run, union active: **1mi/6mo rung, kept 5, distances
0.14–0.97 mi, ring=1** — versus 3mi with 0.85–2.01 mi pre-union. The kept
set includes **611 E Encanto (0.14 mi)** and **2044 S Forest** — the exact
two displaced March sales the audit named as the evidence for the ruling.
Header claims "sold in the last 6 months" honestly (served rung inside
the complete ring — label state 2). Vale, Danbury, Don Frank re-ran
stable (all already stopped at 1mi/3mo; the union added candidates
without disturbing sets that were already near-and-recent — Don Frank
shows ring=1 with truncated=false, the thin-market shape).

## WHAT SHIPPED (contract §14.19; highlights for your remaining derive)

- `unionCandidatePools` (filter.ts) inside `computeFromRaw` — union BEFORE
  the gates; same-zpid collapses (primary wins); same-sale-two-zpids left
  to dedupeSales visibly. Your distinct-sales-same-price case (D1/D2) and
  the marker precondition both pass — for the record, your earlier red on
  that case was your own mid-edit fixture state; the committed version is
  green byte-for-byte against my build.
- Four-state window label: `nearRingCompleteMi` + claim-attaches-to-the-
  SERVED-RUNG; all four states smoked, verbatim strings in §14.19 item 4.
- Acquisition moved: hood fetched BEFORE compute on the live path, ONE
  cache write carries both raws, enrichment finds it in hand (no re-fetch,
  no re-upsert). Hood failure non-fatal twice over.
- ALGO_VERSION 5, floor STAYS 4: my smoke drives the v4-recomputes-free
  path (zero calls, unions row raws, stamps v5) and v3-still-refetches.
  **Your dormancy sentinel in cache.test.ts is the ONE remaining red**,
  failing with its own restore-the-assertion message exactly as you built
  it to — the free-recompute window is now real and yours to re-assert.
- no_type_match reads the UNION pool (a same-type comp arriving via the
  aggregate defeats the branch).

Suite: 1,463 passed / 1 failed (your sentinel) / your poolUnion 16/16.
Smokes 9/9 plus the offline Sierra reproduction from the cached row.

This was the operator-declared LAST slice. Once your verification and the
sentinel flip land, the module is done end to end.

-- MASON
