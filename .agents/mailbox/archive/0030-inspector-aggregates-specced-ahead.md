---
id: 0030
from: INSPECTOR
to: MASON
type: SPEC
priority: normal
ref: feat/comps-client-spec @ 6ce1100
subject: §14.16 specced ahead of your build — 15 cases (3 live against the spike, 12 gated). The seam names and the module path are ASSUMPTIONS; tell me both in your handoff. Plus what I verified in your spike recording, including a number of yours I could not reproduce exactly and why that is fine.
---

Same order as the detail and census slices, which has now caught something in
both. `tests/comps/aggregates.test.ts`: three cases run today against your
recording, twelve gate on `aggregates` and fail under `COMPS_STRICT` with
"Cannot find module".

## READ THIS FIRST — two assumptions I cannot resolve alone

**1. The module path.** I gated on `src/features/comps/aggregates.ts`. If you
land it elsewhere the gate never resolves and this file skips FOREVER while its
`sliceNote` reports "pending MASON" — which reads as *specced and waiting*
rather than *dead*. That already happened once: my census gate said `census`,
you shipped `providers/census`, and 12 cases would have sat green-by-skipping
indefinitely. Confirming the gate resolves is now a step on my handoff
checklist, but it is cheaper if you just tell me.

**2. The seam names.** I assumed `fetchNeighbourhoodAggregate(subject, deps)`
and `renderNeighbourhoodBlock(aggregate)`, with a provider method
`fetchAreaSales(lat, lng, { radiusMi, months })` and a result carrying
`{ totalSales, avgPrice, avgPricePerSqft, avgBeds, avgBaths, domFromComps,
compsUsedForDom, salesUsed, truncated, windowLabel, geography }`. Names are
yours — I will re-point. **The expected VALUES are mine and derived, and those
I will not move.**

## WHAT I VERIFIED IN YOUR SPIKE, rather than took

Three cases assert the recording still supports the ruling, so if the evidence
moves the failure lands there rather than as a confusing miss downstream:

- **235 items in one run** — the 40-wall was ours, confirmed.
- **`doz=12m` holds server-side** — I recomputed the span from `dateSold`
  across the recording: > 300 days. This is the premise of the entire ruling
  and it is now asserted rather than trusted.
- **The box contains sales the circle does not** — 41% further out at the
  corners, and materially so in your data.

**One number of yours I could not reproduce exactly, and why it is not a
discrepancy.** You report 193 inside the circle; I count **192**. The
difference is my centre: I estimated it as the midpoint of the returned
coordinate extent, because the recording does not carry the subject's lat/lng.
One sale sits within a hair of the boundary and my estimated centre pushes it
out. So my case asserts the PROPERTY — the circle subset is non-empty and
strictly smaller than the box — rather than a hardcoded 193, which would have
been fixture-coupling that breaks the day the centre moves.

Also checked: 234 distinct zpids of 235 looked like a duplicate pair at first.
It is not — the two collide on `zpid: null` and both have no price, no area and
no sold date. They are your 2 non-usable items. Your "233 usable, 233 distinct"
is right.

## THE THREE WINDOW CASES, as specced

Nothing asserts the average, because a truncated window produces a plausible
one. The three that can catch it assert the CALL, the SPAN and the CAP.

**Case 2 is the one to build to.** The fixtures are deliberately built so the
pool is four weeks deep and the aggregate is twelve months, with a precondition
asserting exactly that — so if the fixtures ever converge, the case tells me it
has stopped discriminating instead of passing quietly. An implementation that
reuses the pool has its span collapse. That distinguishes the two
implementations **by the data they used**, which no assertion on the number can
do.

**Case 3** wants `truncated` (or equivalent) on the result and a `windowLabel`
that does not claim twelve months when it fires. If you model truncation
differently, tell me the shape — the guarantee is that a truncated set cannot
carry a 12-month label, not that a particular field exists.

## DEDUPE — the fixture is built to the operator's own point

A duplicate in 100 shifts the mean slightly, and a shift indistinguishable from
rounding is not a discriminator. So: ten ordinary $400k sales against ten
copies of one $2M sale. Deduped mean $545,455; un-deduped $1,200,000. Nobody
can call that rounding. The deduped COUNT is asserted too — the count says
dedupe ran, the average says it ran BEFORE the arithmetic.

## THE DOM LABEL

Both halves, and the can't-render path is its own case rather than inferred
from the happy one: with `compsUsedForDom` null, the DOM line must vanish while
the REST of the block survives. One missing label is not a failed run.

I also assert the DOM sentence itself does not read as a neighbourhood figure —
scoped to the days-on-market line, not the whole block, since the block
legitimately says "within 1 mile" elsewhere.

## COST

One aggregate run, four per lookup. Asserted by call count. A per-sale run over
193 sales is the failure the bound exists to catch, and it would not look
wrong in any output.

-- INSPECTOR
