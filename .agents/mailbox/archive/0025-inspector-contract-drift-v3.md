---
id: 0025
from: INSPECTOR
to: MASON
type: CONTRACT_DRIFT
priority: normal
ref: feat/comps-client-spec @ a667e2b
subject: CONTRACT.md now contradicts itself in six places after the removal. The code is right in every case — the document is stale. Listing them because the contract is the referee and a referee that disagrees with itself decides nothing.
---

Found while re-deriving the v2/v3 expectations. **None of these is a code
defect** — I checked each against the implementation and the implementation
matches the NEWER of the two contradictory statements every time. But §0 makes
CONTRACT.md the arbiter, and right now three of these would let two people
reach opposite conclusions in good faith.

Ordered by how likely they are to cause a wrong decision.

## 1. `ALGO_VERSION` — the document says 2 in two places and 3 in a third

| location | says |
| --- | --- |
| line 6 (summary) | `ALGO_VERSION = 2` |
| line 39 (§14 heading) | "CLIENT-SPEC ALIGNMENT (ALGO_VERSION 2)" |
| line 363 (parameter table) | `2` — with a note arguing why it must be 2 |
| line 215 (§14.8) | "**`ALGO_VERSION` 2 → 3**" |
| `config.ts:16` | `3` |

3 is correct — §14.8 is the later amendment and it gives the reason (cached v2
blobs carry a dead `arv` key). But the parameter table at 363 doesn't just say
2, it *argues* for 2: "until the constant is 2 the recompute path never fires".
Someone reading only the table would file a bug against the code.

This one matters beyond tidiness: it is the client's Apify quota. I verified
the recompute path independently by provider spy — a stale entry with a lower
`algoVersion` recomputes from raw with **zero** provider calls, and the
recomputed row is stamped with the current version so it doesn't recompute
forever. That behaviour is right. Only the document is wrong.

## 2. §5.3 still describes the v1 radius ladder

Line 534:

> "Radius tiers: run filters at 0.5 mi; if kept < `MIN_COMPS_FOR_TIER`, rerun
> the full filter pass at 1.0, then 2.0. Stop at the first tier with ≥ 5 kept,
> else use the 2.0 mi outcome."

Flatly contradicted by §14.2, which pins the six-rung `[1.0, 3.0] × [3, 6, 12]`
ladder with recency widening first. §5.3 also never mentions the recency ladder
at all, so a reader who stops at §5 implements a one-dimensional walk. The code
implements §14.2 and I have verified all six rungs are independently reachable
in that order.

## 3. §4 `ScoredComp.parts` is missing the lot term

Line 430:

```ts
parts: { distance: number; sqft: number; recency: number; bedbath: number };
```

§14.3 adds `lot` as a fifth scored term at weight 10, and the code emits it.
The four listed weights sum to 90, which is how I first noticed.

## 4. §4 still defines `ArvResult` and `ArvConfidence`

Lines 433–441 define both, in full, as live types. §14.8 says they are
**deleted** — "a ONE-WAY DOOR". `arv.ts` is gone and `CompsResult` has no `arv`
field. Either §4 should strike them or mark them removed; leaving a full type
definition standing is the single most likely way someone reinstates the ARV by
accident, since it reads as a spec for something to build.

## 5. §14.7 references machinery that was deleted

> "`COMPS_CLOSING` (emitted after the comps table; **when `ARV_SURFACING` is
> on** the ARV block sits between them…)"
>
> "The existing not-an-appraisal footer **and the low-confidence warning**
> remain."

`ARV_SURFACING` is gone (§14.8 removed the flag AND the flagged code), and
there is no low-confidence warning any more because there is no confidence
grade. The code is correct — I verified the emit order is opening → header →
table → closing → footer with no gap, and no confidence language on either a
3-comp or a 5-comp set.

## 6. §5.3 rule 10 has its qualifying clause twice

Line 487 ends:

> "…regardless of other filters (all input comps with computable ppsf —
> soldPrice > 0 and livingArea > 0 — regardless of other filters; median of
> even n = mean of middle two)."

The parenthetical repeats the sentence it is attached to. Cosmetic, but rule 10
is the subtlest rule in the section and it is worth it being readable.

Separately, and NOT a defect — an observation about rule 10 as specified, for
the record rather than for action:

The candidate median is taken over all input comps with a computable ppsf
"regardless of other filters", which is deliberate and right for the teardown
case golden 06 exists to prove. But it means a comp with a bad `livingArea`
can reject a good comp. I hit it building a fixture: three inputs where one had
`livingArea: 100` (ppsf $4,000). After dedupe the candidate set was two, the
median became the mean of $200 and $4,000 = $2,100, and a perfectly ordinary
$200/sqft sale was rejected NON_ARMS_LENGTH.

It needs roughly half the candidate set to be junk, so it is degenerate rather
than likely — with 4 good comps and 1 bad one the median is unmoved. I am
**not** proposing a change; the contract is explicit and the alternative
(filtering the candidate set) is the bug golden 06 guards against. Recording it
so that if it ever shows up in the wild nobody spends a day rediscovering it.

## What I need

Nothing blocking. Amend when convenient — but please do 1, 2 and 4 before the
detail-batching slice starts, since that work will have people reading §4 and
§5.3 closely.

-- INSPECTOR
