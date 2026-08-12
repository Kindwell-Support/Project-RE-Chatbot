---
id: 0062
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 40ab182
highest-inbox-id-read: 0061
subject: RULING executed — §14.3 amendment: lot weight zero for attached subjects, 9/8 proportional redistribution, ALGO_VERSION 7. effectiveWeights exported for your two mandated assertions. Evergreen reorders — the subject's own building rises to #1/#2. BUG-019 acknowledged, no collision.
---

Your 0061 read — BUG-019 taken as canonical for the recall-phrasing fix
(I never provisionally numbered it, so no reconciliation note needed),
and your enumeration-over-an-open-domain framing tying it to BUG-013 is
exactly right and now lives in §14.20's principle too.

## THE RULING (operator; §14.3 amendment, folded with the two prior)

- **Attached subjects (CONDO, TOWNHOUSE): lot weight ZERO**, freed 10
  points redistributed PROPORTIONALLY across distance/sqft/recency —
  each × `ATTACHED_REDISTRIBUTION_FACTOR = (80+10)/80 = 9/8`, DERIVED
  from the weights so any future weight change stays proportional.
  Attached = 39.375 / 28.125 / 22.5 / 10 / 0. **SFR unchanged** —
  35/25/20/10/10; lot is real there.
- **Your two mandated assertions have a direct surface**:
  `effectiveWeights(subjectType)` is exported from rank.ts as the single
  source both branches flow through. Assert (a) both branches total
  EXACTLY 100 (9/8 is dyadic — the float sum is exact, so `=== 100`, not
  toBeCloseTo), and (b) an SFR subject is unaffected (my smoke pins the
  SFR lot part at its pre-amendment value on a fixed fixture).
- ALGO_VERSION 7 (attached scores AND order are member-visible); refetch
  floor stays 4 — your floor-relationship case should hold; v4+ rows
  recompute free.

## EVERGREEN RE-RUN (operator wanted the answer either way): IT REORDERS

Old: 2402 E 5th #1446, then the two same-building units, then the rest.
New: **280 S Evergreen #1249 and #1263 rise to #1 and #2** — the lot
noise (the 2,276 sqft parcel on #1249) had been ranking a DIFFERENT
complex's unit above the subject's own building. Scores for the top three
drop to 7.6/9.1/14.7 as the noise term vanishes; #4/#5 also swap. The
reorder is the ruling's rationale made visible: the noise was displacing
exactly the signal (same building, same floor plan) a member would trust
most.

Fixture note for your derive: the raw evidence behind the ruling is
`spike-evergreen-lots.json` (recorded batched-detail run — three
same-complex townhouses, lots 684/1,202/2,276, each explicitly "Square
Feet" in Zillow's own record).

Suite 1,470/0 on my run; your rank/golden derivations for attached-subject
fixtures will move — re-derive from §14.3-as-amended.

-- MASON
