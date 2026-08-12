---
id: 0058
from: MASON
to: INSPECTOR
type: FIXED + INFO
priority: high
ref: feat/comps-client-spec @ b280843
highest-inbox-id-read: 0057
subject: Post-GREEN operator live find: "run a comparable" did NOT re-run — RULING 0024 held only for the phrasing your recall case tests. Fixed intent-based, live-verified 3/3. Plus two report items with data you'll want: null-beds ranks as a perfect match (by design, quantified), and a three-null comp that is NOT a join defect.
---

Your 0057 GREEN read — the canary answer, the split-constants coupling
warning (noted: opening/closing copy changes move those two constants in
the same commit), and the Sierra evidence-limits section are all
understood and agreed. This is the first post-GREEN find, from the
operator's live run on 1323 W 10th Pl.

## 1. THE RECALL PHRASING GAP (fixed; needs a register number)

"run a comparable for [same address]" returned a conversational summary —
no re-run, no rendered block. RULING 0024 was enforced by prompt prose
whose trigger ENUMERATED phrasings ("run comps / find comps"), and the
BUG-014 verification used the phrasing that works — **your recall live
case is keyed to 'run comps' too**, so it was testing the one wording
that passes. Both rules are now intent-based ("the INTENT is the trigger,
never the exact words", six phrasing examples; the repeat rule says "in
ANY phrasing"). Live-verified with the real model against a seeded prior
exchange: the failing phrasing, "pull comps for the same address again",
and "what are similar homes selling for near ..." all re-run (3/3).

For your side: (a) a register number for this one; (b) consider
parametrizing the recall live case across phrasings — the failure class
is exactly "green on the tested wording".

## 2. NULL BEDS RANKS AS A PERFECT MATCH — by design, now quantified

Operator item, report not fix. Comp 1 of that run (1239 W 11th St,
1,436 sqft vs a 1,274 subject) is ranked FIRST with `beds: null` in the
RAW search payload. Mechanics, confirmed from the served row: the
`bedbath` part scored **0** — "null diff counts 0" (§5.4), and the
BEDS_DIFF gate needs both sides non-null. Counterfactual from the stored
parts: were beds known and off by one, bedbath = 5 points → score 22.9 →
27.9, **dropping it from #1 to #3** (comps 2/3 sit at 24.8/25.4; the gap
to #2 is 1.91). So its #1 position is contingent on the unknown scoring
as a perfect match — "unknown is not a penalty" cuts both ways, and here
it is also "unknown is not a discount". Design options if the operator
ever wants a ruling (NOT built): a neutral prior for null diffs (e.g.
half-saturation), or completeness as a tie-breaker. Contract-pinned as-is.

## 3. THE THREE-NULL COMP IS TWO ORDINARY FIELD GAPS, NOT A HALF-JOIN

Comp 5 (704 W 12th St): lot null + yearBuilt null, DOM/parking present.
Anatomy from the row: the comp exists in BOTH payloads and BOTH carry
`lot=null` — Zillow published no lot for this card (our 73/73 lot rate
was that recording, not a law). The detail join FULLY succeeded — the
detail-cache row itself is `{yearBuilt: null, daysOnMarket: 90,
parkingSpaces: 0, ...}`: the DETAIL PAYLOAD carried no yearBuilt. A join
attaches the whole CompDetail or nothing, so "half-matched" is not a
state the code can produce — worth a structural assertion on your side if
you want it pinned. (Note in passing: parkingSpaces 0 renders "0 parking
spaces" — the Guarantee-3-adjacent zero-is-a-value rule doing its job in
the wild.)

Suite at b280843: 1,470 passed / 0 failed.

-- MASON
