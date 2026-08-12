---
id: 0032
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ (this commit)
subject: FIXED BUG-010 — duplicate-sale dedupe. Verify this BEFORE I start the ARV removal; the operator sequenced them apart deliberately.
---

Operator ruled the dedupe in, and sequenced it to land and be VERIFIED before
the ARV removal begins — the removal touches everything downstream of
filtering, and one pass would make both diffs unreadable. So this is the whole
change; I am not starting the removal until you have looked.

## What landed (CONTRACT §14.13)

- **`dedupeSales(comps)`** in filter.ts. Identity is the SALE: equal
  `soldPrice` + `livingArea` + `soldDate`, coordinates within
  `DUPLICATE_COORD_TOLERANCE_MI` (~10 m). **Distance, not float equality** —
  the recorded pair differs in the 6th decimal of latitude, which is exactly
  what made my first scan report "0 duplicates". **Not keyed on zpid**:
  distinct zpids are the problem, not the identity.
- **Winner**: more non-null fields among lot / beds / baths / link; ties break
  on the longer street address. Deterministic — worth pinning which of the
  recorded pair survives (`830 W AMERICA Street`, the longer, better-formatted
  one).
- **Placement**: inside the tier walker, after hard filters, before ranking.
  The tier's sufficiency check runs on the DEDUPED count, so a rung cannot
  "reach 5" on four real sales plus a copy — worth a test of its own.
- **`RejectReason.DUPLICATE_SALE`**, reported in the rejection table.

## One deviation from the literal instruction — flagging, not burying

The ruling's rationale had two halves: a duplicate must not consume a slot,
AND must not skew "the candidate-set median the non-arms-length rule depends
on". Placement after the gates achieves the first but **cannot** achieve the
second — that median is computed INSIDE the gate pass, before anything
downstream runs.

So `candidateMedianPpsf` now dedupes its own input as well. Both halves hold,
and the rejection semantics stay honest (only a would-be-kept comp is called a
duplicate). If you or the operator prefer the literal placement with the
median left as-is, it is a two-line revert — but the rationale as written
needs both.

## Verified against all 10 real cached pools (recompute, zero provider calls)

Exactly one duplicate found and dropped, in the pool it was reported from:

```
765 N DON FRANK LANE   $348,000 -> $342,000   n=5   dups_rejected=1
                       -> "830 America St, Wickenburg" rejected DUPLICATE_SALE
```

Every other pool: `dups_rejected=0`, ARV unchanged. No kept set contains a
repeated address anywhere.

**Two consequences worth your attention:**

1. **Don Frank's confidence dropped `high` -> `medium`.** That is the
   duplicate-inflates-confidence effect reversing, and it is the honest tier:
   with the copy removed, the real spread is wider than it looked. The ARV
   moved $348,000 -> $342,000, and ground truth is $410,000 — so accuracy is
   marginally WORSE (-15.1% -> -16.6%) while the confidence signal is now
   correct. Worth saying plainly: dedupe fixed the confidence lie, not the
   accuracy gap. The gap is a market-position problem (the subject sold above
   every comp), not a duplicate problem.
2. A duplicate previously displaced a genuine comp; with it gone, the fifth
   slot is filled by a real sale.

## Next

Awaiting your verification, then the ARV removal — which the operator wants
reported for blast radius first. I have that report ready and will send it
with the removal handoff.
