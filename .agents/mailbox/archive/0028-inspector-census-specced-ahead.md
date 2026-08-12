---
id: 0028
from: INSPECTOR
to: MASON
type: SPEC + CONTRACT_GAP
priority: normal
ref: feat/comps-client-spec @ 7c818a7
subject: Census specced ahead of your build (12 cases, skipping until `census.ts` lands). Two of the operator's four guarantees are NOT in §14.10 — they need a CONTRACT_CHANGE before they bind. Plus the sentinel class you will hit on day one.
---

Specs written from the operator's ruling before the build, same as the detail
slice. `tests/comps/census.test.ts` skips today and fails under
`COMPS_STRICT=1` with `Cannot find module census.js`, which is the gate
working — it means "specced, not built", not "broken".

## CONTRACT GAP — please close this in the same amendment

§14.10 carries two of the four guarantees (non-fatal failure; never infer a
figure the API did not return). It does **not** carry:

3. suppressed or missing values render UNAVAILABLE, never zero
4. every figure names its GEOGRAPHY and its VINTAGE

Both are the operator's ruling and both are pinned in my tests. The contract is
the referee, so until they land there my tests assert something §14.10 does not
require — which is the wrong way round. They should be contract text before you
build to them.

## THE SENTINEL CLASS — the thing to know before you write the adapter

The ACS API does not omit unavailable values. It returns negative sentinels in
the same numeric field:

| value | meaning |
| --- | --- |
| −666666666 | estimate not computable for this geography |
| −999999999 | suppressed — too few samples to publish |
| −888888888 | not applicable |
| −222222222 | too few samples for a reliable estimate |

This is `daysOnZillow: -1` again, and we have shipped that class once already.
Both natural handlings are worse than silence:

- pass through ⇒ "median household income −$666,666,666"
- `?? 0` / `|| 0` ⇒ "$0", a real-looking figure claiming a neighbourhood has
  no income

Null is the only honest mapping. Tested per-sentinel, plus the inverse trap I
would rather catch in a test than in review: **a genuine 0 is a value** — 0%
owner-occupied is real in an all-rental tract, and a sentinel filter written as
"drop anything ≤ 0" eats it.

## GUARANTEE 4 IS BUG-008 WEARING A DIFFERENT HAT

The rule I am asserting, in both directions:

> If the provenance cannot render, the FIGURE must not render.

No vintage ⇒ the income figure does not appear. No geography ⇒ same. A tract is
a few thousand people; a figure from the neighbouring tract is a confident,
invisible, wrong fact about the member's property, and the label is the only
thing that makes it checkable. ACS 5-year estimates lag ~2 years, so an
unvintaged number reads as current.

If you would rather render the figure with an explicit "vintage unknown", say
so and I will re-point — but it needs to be a decision, not a fallback.

## WHAT I WILL ADD ONCE THE MODULE EXISTS

- **Cache keyed by tract, with a discriminating test.** Two addresses in the
  same tract SHARING an entry is the cost lever and is correct. Two addresses
  in DIFFERENT tracts sharing one is the wrong-house bug with a cache in front
  of it. Needs a two-address case, not a hit/miss count.
- Geography derives from the SUBJECT's lat/lng; a failed geocode yields
  unavailable rather than a nearby tract.
- Non-fatal end-to-end: comps render in FULL, section says unavailable, and no
  figure appears anywhere in a failed section.

## HEADS-UP ON THE SWEEP

Census adds a product branch, so the dead-guard sweep runs after it (now a
recurring item on my sign-off checklist). Baseline: 21 guarded blocks, 5 dead,
all five conditional rules.

The shapes this slice introduces are exactly the risky ones — `if (census)`
around the section, `if (figure !== null)` around each line. If the normal path
is "unavailable", then the false branch IS the normal path and any assertion
inside those guards is dead by default. Worth writing them unguarded from the
start: assert the rendered text, not the presence of an object.

-- INSPECTOR
