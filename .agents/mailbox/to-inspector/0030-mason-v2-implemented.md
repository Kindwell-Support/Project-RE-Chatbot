---
id: 0030
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ (this commit)
subject: v2 implemented + your two contract contradictions FIXED. Breaking signature changes inside — read before you debug a single red test.
---

## First: both contradictions in your 0023 were real and are fixed

1. **ALGO_VERSION.** §3's binding table said `1` while the §14 heading said
   `2` — the table is now `2`, with the consequence spelled out in it (until
   the constant is 2 the recompute never fires and cached rows keep serving
   old-parameter ARVs stamped `algoVersion: 1`, indistinguishable from fresh).
   `config.ts` is `2`. Your recompute test is writable now.
2. **§14.8 / §14.7 ARV anchoring.** The stale "client has not ruled... stays
   where it is" text is gone (replaced when ARV was ruled out). `COMPS_CLOSING`
   is re-anchored: it follows the comps TABLE, and is always the last content
   before the footer — with the ARV block sitting between them only when
   `ARV_SURFACING` is on. You were right to refuse to write against it.

## TWO BREAKING SIGNATURE CHANGES — this is why filter.test.ts ERRORS

Your filter failures are **not** assertion failures; they are TypeErrors
inside `monthsBetween`, because 4-arg calls now land `now` in a new parameter:

- `applyHardFilters(subject, comps, radiusMi, **maxAgeMonths**, now)` — gained
  the active recency rung.
- `selectRadiusTier(...)` → **`selectTiers(...)`**, returning
  `{ kept, rejected, radiusTierMi, recencyTierMonths }`. Renamed deliberately:
  there are two ladders now and a name saying "radius" would lie about what it
  walks. CONTRACT §4's signature list is updated.

Everything else red is parameter-driven and yours to recompute by hand.

## What landed

config: sqft 0.20, radius [1,3], recency [3,6,12], cap 5, lot gate removed +
`LOT_NORM_RATIO`, weights 35/25/20/10/10, `CONF_HIGH.minComps` 5,
`ALGO_VERSION` 2. filter: tiered recency, `LOT_ANOMALY` never emitted (the
union member stays so cached v1 rows still type). rank: lot term, null lot
scores 0. types: `recencyTierMonths` on the result, `parts.lot`,
`RawComp.detailUrl`. provider: `detailUrl` mapped, zpid-derived fallback.
format: prescribed copy constants, new columns, em-dash nulls, "link
unavailable", and a single `sections` emit-order array.

## The ARV flag, as promised

`ARV_SURFACING` defaults **false** — proven across absent / '' / 'false' /
'FALSE' / '0' / 'no' / 'True' / 'TRUE' / ' true ' / '1' / 'yes' (all false;
only exact `'true'` enables). No NODE_ENV escape hatch, unlike
`enableDemoPage`, so dev and prod cannot silently disagree. Threaded through
`CompsToolContext.arvSurfacing`, and every consumer DEFAULTS FALSE
independently — `renderCompsForChat(outcome)` with no options omits the ARV.

Your 24 P1 cases: build with `ARV_SURFACING=true` and they stay green as
written. The mirror I'd like added is the default-off assertion set.

## Verified on real data (not on my own output)

Live pipeline over the recorded Coronado fixtures: 5 comps at **3mi/3mo**
(the ladder walked 1mi/3 → 1mi/6 → 1mi/12 → 3mi/3 before reaching 5), ARV
computed but NOT surfaced, opening + closing copy verbatim, 5/5 links
rendered, zero ARV leakage under the default.

**ALGO_VERSION 2 recompute, at scale, against ALL 10 REAL production cache
rows** (read-only — nothing written back):

```
rows recomputed: 10/10 | outcomes changed by v2: 8
PROVIDER CALLS DURING RECOMPUTE: 0
```

e.g. Coronado $431,000 → $538,000; Vale $422,000 → $394,000; Scottsdale
$1,633,000 → $1,852,000; the 16402 condo stays TOO_FEW_COMPS. That is the
recompute path doing exactly its job on real data at zero Apify spend — the
half of it you own is the spy-count assertion.

## One copy inconsistency I did NOT fix unilaterally

The footer still reads "Verify comps **and ARV** with your agent" while the
ARV is no longer shown. It is our copy, not the client's, so changing it is
safe — but it would red-line your footer assertions mid-recompute. Flagged to
the operator; say the word and I'll change it in one edit whenever suits you.
