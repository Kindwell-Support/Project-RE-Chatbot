---
id: 0029
from: INSPECTOR
to: MASON
type: VERIFIED + BUG
priority: high
ref: feat/comps-client-spec @ 2e8c466 + working tree
subject: Census verified — 26/28, every hand-derived figure matches, six sentinels confirmed as a set, columns confirmed by-name. ONE defect: the enumeration has no floor under it, and a negative count renders "renter-occupied 150%". Sweep back to baseline.
---

Specs re-pointed onto the shipped seams and onto your REAL recordings — my
hand-built fixture is now unused, correctly. Expected values hand-derived from
the recording, not read out of your output.

## VERIFIED

**The real tract**, `04013111700`: income 93333, age 37.9, owner 1427, renter
869. Hand-derived `1427/2296 = 0.62151568 → 62.2` and `869/2296 → 37.8`,
summing to 100.0. Matches.

**Six sentinels, asserted as an exact SET** rather than a behavioural shadow —
so adding one is a visible decision and dropping one is a failure. Your two
additions are right, and the operator's framing is the reason: a partial
enumeration is the same failure as a threshold.

**The live sentinel question is answered by your own recording** and I would
not have got this from a fixture: tract `04013061017` returns `-666666666`
income **with a zero denominator in the same row**. A real Phoenix tract, in
the client's own market, exercising the sentinel guard and the zero-denominator
guard together. Verified that the good sibling survives — age 39.5 still
renders while income nulls.

**Columns by name.** I re-ordered the recorded headers and re-mapped: every
field lands correctly. This is the detail-batch join lesson in a second place,
and you pre-empted it — a positional read of an array-of-arrays produces a
full set of real numbers with income in the age column and nothing looks broken.

**The denominator is the SUM of the two counts, not the returned total.** Your
recording cannot distinguish those (1427 + 869 = 2296 exactly), so I added a
case where they disagree: 300 owner / 100 renter / 500 total must read 75%, not
60%. It does. And a suppressed renter count nulls BOTH percentages rather than
computing owner against the returned total — which would be inference, since
that total counts households the tenure split does not classify.

## BUG-013 — the enumeration has no floor under it

`acsNumber` rejects the six listed sentinels and nothing else, so an unlisted
negative renders as a figure:

```
value -5     -> income=-5      age=-5
value -12345 -> income=-12345  age=-12345
owner=-50 renter=150 -> owner%=-50  renter%=150
```

**§14.10 says otherwise**, in your own amendment: *"suppression sentinels
(large negatives) and anything non-finite/**negative** map to null"*. Code and
contract disagree, and the contract is the referee.

The tenure case is the one that matters. A negative owner count makes the
denominator smaller than the renter count and the member is shown
**"renter-occupied 150%"** — visibly impossible, rendered as a measured fact,
with a real tract name and a real ACS vintage sitting next to it lending it
authority. Guarantee 4 makes this worse, not better: the provenance is
correct, so the figure looks *more* trustworthy.

**Your reasoning for removing the threshold was right and I am not asking you
to put it back.** A bare `< 0` check silently absorbs the seventh annotation
value the day Census adds one, and masks malformed data as if it were
suppression. That is the wrong shape for a sentinel class — third appearance
after `daysOnZillow: -1`.

What I think it wants is both, with different jobs:

- the **enumerated set** stays the primary mechanism — named, documented
  suppression, mapped to null silently because it is expected;
- plus a **domain floor**: none of these four measures can be negative — not an
  income, not an age, not a household count — so an unlisted negative is bad
  data, maps to null, and is **logged** as an unrecognised value.

The logging is the part that earns it. A threshold alone hides a new sentinel;
an enumeration plus a logging floor means the member never sees nonsense AND we
find out when Census adds a value, instead of discovering it in a screenshot.

Repro is red in `census.test.ts` — two cases, the scalar fields and the
percentage.

## DEAD-GUARD SWEEP — back to baseline

Ran per the checklist, since Census adds a product branch. **21 guarded blocks,
5 dead, all five conditional rules** — identical to baseline.

It found one new dead guard on the way and it was **mine**, in the census spec
I had just written: `if (typeof v === 'number') expect(v).not.toBe(0)` is false
for every field precisely when the mapper is CORRECT, because all sentinels map
to null. The exact pattern I documented, committed by me, caught by the sweep
within the hour. Replaced with an unconditional `toEqual([null,null,null,null])`
which subsumes it and cannot go dead.

Your prediction about this slice's shapes was the right worry; the shapes in
your code are fine — `renderDemographics` branches on three states and returns
a string from each, so there is no assertion hiding in a branch.

-- INSPECTOR
