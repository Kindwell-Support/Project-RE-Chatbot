---
id: 0028
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 689dfc7 (contract only; NO code yet)
subject: CONTRACT §14 — client-spec alignment, ALGO_VERSION 2. Every golden expected value changes. Lead time starts now.
---

New operator work block: align comps with the client's written comp-selection
method. **CONTRACT.md §14 is written and binding. No implementation exists
yet** — deliberately, so you get lead time before the parameters move under
you.

## Read §14 first. The blast radius is total.

**Every golden expected value, every mapped fixture, and all three live
ground-truth runs change.** Filter parameters, comp count, scoring weights and
confidence thresholds all move at once. Operator's instruction, verbatim:
tests are yours and must be **recomputed by hand from the contract — never
adjusted to match my output**.

## The parameter changes (§14.1)

| | v1 | v2 |
| --- | --- | --- |
| sqft gate | ±25% | **±20%** |
| radius tiers | 0.5 / 1.0 / 2.0 | **1.0 / 3.0** (outer bound WIDENS 2→3 mi) |
| recency | flat 12-mo gate | **tiered 3 / 6 / 12 mo** |
| comps kept | 8 | **5** (display AND compute — no split) |
| lot size | hard gate (>5×) | **soft scoring term**, gate REMOVED |
| weights | 40/30/20/10 | **35/25/20/10/10** (lot takes 10) |
| `CONF_HIGH.minComps` | 6 | **5** |
| `ALGO_VERSION` | 1 | **2** |

Two things in there I had to decide rather than transcribe, both pinned with
rationale in §14 so you can argue with the reasoning and not just the value:

1. **§14.2 — two ladders, one order.** Radius and recency are both tiered now.
   They walk as ONE ladder, **recency widening before radius**
   (1mi/3mo → 1mi/6mo → 1mi/12mo → 3mi/3mo → ...), stopping at the first rung
   with ≥ 5. Rationale: location beats recency inside a 12-month window.
   `recencyTierMonths` joins `radiusTierMi` on the result and in the render.
2. **§14.3 — lot weight of 10** drawn 5 from distance and 5 from sqft, so the
   two dominant terms stay dominant. Null lot scores 0, like null beds/baths.

## The consequence worth your attention (§14.4)

`CONF_HIGH.minComps` 6 → 5 is not a preference, it is forced: with the cap at
5, `n >= 6` is unreachable and every run would return medium-or-low forever.

And the trim, stated plainly rather than buried: **at n = 5, trimCount = 1, so
the ARV is the mean of 3 values and the sample sd runs on 3** (2 d.f.). That is
the client's method as written. Worth a golden that pins it explicitly, because
it is the kind of thing someone later "fixes".

## Per-comp fields — I checked the payload before promising anything (§14.5/§14.6)

Operator required evidence first. Across **73 sold comps** in both recorded
search runs:

**Buildable:** beds (`homeInfo.bedrooms`, 70/73), baths (71/73), lot size
(`lotAreaValue`+`lotAreaUnit`, 73/73), property link (`detailUrl`, 73/73).

**NOT buildable, so NOT built:**
- **Days on market** — `daysOnZillow` is **−1 on 73/73** sold comps. A
  sentinel, not data. `timeOnZillow` exists but its meaning for a sold listing
  is unverified. Rendering it would be a guess.
- **Parking, yearBuilt, architectural style, condition, basement/ADU** —
  absent from the search payload entirely. They exist in the DETAIL payload
  (`resoFacts.parkingCapacity`, `architecturalStyle`, `propertyCondition`,
  `yearBuilt`) — which is the SUBJECT's source, not the comps' — so getting
  them per comp costs **5 extra actor runs, 2 → 7 per lookup, ~3.5× Apify
  spend**. Reported to the operator for the client to rule on; no render slots
  built.

**Null rule to test hard:** a null field renders as an explicit em dash `—`,
never omitted, never inferred, never back-filled from a sibling comp or the
subject. No-fabrication now extends to every new column.

## Also in §14

- **§14.7 prescribed copy** — client's opening and closing paragraphs, verbatim
  named constants, emitted structurally by format.ts on every successful render
  (not model-authored, not prompt-dependent). Worth a test that they survive
  verbatim, since "helpful" paraphrase is exactly the failure mode.
- **§14.8 out of scope** — neighbourhood summary entirely; ARV placement stays
  put pending a client ruling, but must become a single structural emit-order
  change rather than threaded through the renderer.
- **ALGO_VERSION 2** means cached v1 raw payloads recompute under the new
  parameters **without re-billing Apify**. That path has only ever run in unit
  tests and there are real cached rows in production now — I'll verify it at
  scale and report; your cache spy-count tests are the other half of that.

Nothing is implemented. Ask for changes to §14 now, while changing it is free.
