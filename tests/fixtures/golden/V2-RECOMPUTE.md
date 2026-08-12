# Golden dataset — v2 recompute (CONTRACT §14, ALGO_VERSION 2)

Hand-derived from the amended contract, then cross-checked against a
**from-scratch** transcription of §14 (rebuilt, not patched — the v1
transcription was wrong in nine places and editing it would have carried v1
assumptions in invisibly).

Worked example verified by hand end-to-end: **golden 01**, below. Its six
ranking scores, the cap decision, the trim, the band and the confidence tier
were computed on paper first and matched the transcription to 7 decimal places.

## What changed in the pipeline

```
sqft band        ±25%  ->  ±20%            [1600, 2400] on a 2,000 sqft subject
radius tiers     0.5/1.0/2.0  ->  1.0/3.0
recency          flat 12mo gate  ->  TIERED [3, 6, 12], still scored within
ladder           radius-only  ->  6 rungs, recency exhausted BEFORE radius:
                 1.0/3 -> 1.0/6 -> 1.0/12 -> 3.0/3 -> 3.0/6 -> 3.0/12
cap              8  ->  5   (display AND compute)
lot              hard gate (rule 11)  ->  soft scoring term, weight 10
weights          40/30/20/10  ->  35/25/20/10/10
confidence high  n>=6  ->  n>=5
```

## Recomputed outcomes

| case | tier (mi/mo) | kept | capped out | trim | used $/sqft | ARV | band | sd | cv | conf |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 clean | **1.0 / 3** | 6→5 | G1-C7 | 1 | 195, 200, 205 | **400,000** | 390–410k | 5 | 0.025 | **high** |
| 02 outlier | 1.0 / 12 | 6→5 | **G2-C2** | 1 | 195, 200, 205 | **400,000** | 390–410k | 5 | 0.025 | medium |
| 03 thin | 3.0 / 12 | 3 | — | 0 | 190, 200, 240 | **420,000** | 367–473k | 26.4575131 | 0.1259882 | low |
| 04 boundary | 1.0 / 6 | 5 | — | 1 | 190, 200, 210 | **400,000** | 380–420k | 10 | 0.05 | **high** |
| 05 too few | 3.0 / 12 | 2 | — | — | — | none | — | — | — | — |
| 05b empty | 3.0 / 12 | 0 | — | — | — | none | — | — | — | — |
| 06 arms-length | 3.0 / 12 | 3 | — | 0 | 190, 200, 210 | **400,000** | 380–420k | 10 | 0.05 | low |

Rejections: 01 drops C4/C8 `STALE_SALE` at the 3-month rung; 05 drops C3
`NOT_SOLD`, C4 `STALE_SALE`; 06 drops D/E `SQFT_OUT_OF_RANGE`, F
`NON_ARMS_LENGTH`. No `LOT_ANOMALY` anywhere — rule 11 is gone.

## Golden 01 worked by hand (the template)

Subject 2,000 sqft, 3/2, SFR, lot 6,000, `now` 2025-07-15.

**Ladder rung 1 — 1.0 mi / 3 months.** Ages are 0.9855, 1.9711, 2.9566, 3.9422
months (30/60/90/120 days ÷ 30.44). C4 and C8 at 3.9422 exceed the 3-month rung
⇒ `STALE_SALE`. Six survive, and 6 ≥ `MIN_COMPS_FOR_TIER` (5), so the ladder
**stops at the first rung** — this is the must-NOT-escalate case.

**Band check.** ±20% of 2,000 = [1600, 2400]. C5 is exactly 1,600 — the lower
edge — and is KEPT, because rule 4 rejects only what falls *outside*. Under v1
that comp sat comfortably interior at ±25%; it is now the boundary itself.

**Scores** (35 distance / 25 sqft / 20 recency / 10 bedbath / 10 lot):

```
C1  2.4182935 +  0      + 1.6425755 + 0   + 0.3333333 =  4.3942023
C2  2.4182935 +  6.25   + 3.2851512 + 7.5 + 1.6666667 = 21.1201114
C3  4.8365870 + 12.5    + 4.9277267 + 0   + 0.3333333 = 22.5976470
C6  7.2548805 + 15.625  + 3.2851512 + 5   + 1.3333333 = 32.4983650
C5  7.2548805 + 25      + 1.6425755 + 5   + 1.3333333 = 40.2307893
C7  9.6731740 + 15.625  + 4.9277267 + 10  + 3.3333333 = 43.5592340
```

**Cap at 5** drops C7, the worst. Kept $/sqft sorted: [190, 195, 200, 205, 215].

**Trim.** n = 5 ⇒ `max(1, floor(5 × 0.15)) = max(1, 0) = 1`. Drop 190 and 215.
Used = [195, 200, 205], **three values**.

**ARV.** mean 600/3 = 200 × 2,000 = **$400,000**.
**sd** over the same three: deviations −5, 0, +5 ⇒ Σd² = 50, ÷ (3−1) = 25,
sd = **5**. Band 5 × 2,000 = 10,000 ⇒ **390,000 / 410,000**. cv = 5/200 = 0.025.

**Confidence.** compsUsed 5 ≥ 5 ✓, cv 0.025 ≤ 0.15 ✓, median distance 0.1381882
≤ 0.75 ✓, median age 1.9710907 ≤ 6 ✓ ⇒ **high**.

## Reachability — both ends, as required

| tier | reachable | witness |
| --- | --- | --- |
| high | **yes** | 01 and 04 (n=5, cv ≤ 0.15, medians inside) |
| medium | yes | 02 — n=5 and cv 0.025, but median age 8.21 mo > 6 blocks high |
| low | yes | 03 and 06 (n=3 < 4) |

`high` was dead code under v1's n ≥ 6 with a cap of 5. It fires now. The mirror
check also passes: `medium` is still reachable, via the distance/age clauses
rather than the count.

## FINDINGS FROM THE RECOMPUTE — read before rewriting fixtures

**1. Golden 02 has lost its purpose.** Its whole reason to exist was "the trim
must neutralise a 3× outlier". Under v2 the $600/sqft comp (G2-C2) is **capped
out at rank 6, before the trim ever sees it**. The case still produces a correct
number, but it no longer tests what its name and header claim, and a fixture
that passes for the wrong reason is exactly what this dataset exists to prevent.

Needs redesign, not just recomputation: the outlier must score well enough on
distance/sqft/recency/bedbath/lot to survive into the kept 5, so that the TRIM
is demonstrably what removes it. That means an outlier that is close, right-
sized, recent and similar — differing *only* in price, which is also the more
realistic new-build scenario.

**2. Three cases have converged on $400,000.** 01, 02, 04 and 06 all now yield
the same ARV, and 01/04 are additionally identical on band, sd, cv and
confidence. Under v1 they were 403,000 / 405,000 / 400,000 / 400,000. Distinct
expected values are what make a failure message diagnostic — four cases sharing
one number means a bug that shifts the ARV shows up as four identical failures
with no signal about which stage broke. The fixtures should be re-spread.

**3. Golden 04's distinguishing property is gone.** It existed to pin the n=5
trim boundary and the "must not escalate" tier decision. With the cap AT 5, n=5
is now the ordinary case rather than a boundary, and 01 already covers the
non-escalating rung. It needs a new job or it is redundant.

## Still missing — no case covers these yet

- the 20% band edges as such: exactly 2,400 (kept), 2,401 (rejected), 1,599
  (rejected). Only the lower edge is incidentally covered, by 01's C5.
- **the old ±25% boundaries now being INTERIOR** — a comp at 2,500 sqft was the
  v1 edge and must now be rejected; one at 1,700 was interior and stays interior.
  Worth explicit assertions, since these are the values a reader of the v1
  fixtures would still have in their head.
- the lot term in isolation — nothing yet varies lot alone to check the weight,
  the `LOT_NORM_RATIO` saturation, or that a null lot scores 0 rather than
  penalising.
- rungs 4 and 5 of the ladder (3.0 mi / 3 mo and 3.0 mi / 6 mo) are unexercised;
  every case that widens to 3 mi goes straight to 12 months.
