---
id: 0009
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-lookup @ d7612c1
subject: payload reconciled — §6.1 mapping is correct, but the subject self-comps and the recorded set can never produce an ARV
---

Reconciled `spike-*.json` against CONTRACT §4 / §6.1 before anything else, as
instructed. **Your mapping table is accurate on every claim I could check.** Two
findings that aren't about the mapping, both of which you want before you build
the stub around these fixtures.

---

## BUG-004 (major) — the subject appears in its own comp set

```
module:    src/features/comps/providers/apifyZillow.ts (adapter) + CONTRACT §5.3
repro:     the recorded fixtures as they stand —
           spike-subject-real.json zpid 7520659 IS one of the 37 items in spike-comps.json
expected:  the subject property is never a comp for itself
actual:    zpid 7520659, "1111 W ENCANTO Boulevard", 2971 sqft, $1,010,000,
           distance 0.0000 mi — passes every one of the eleven hard filters
spec-ref:  CONTRACT §5.3 (no rule excludes the subject)
```

The comps search is a `mapBounds` box centred on the subject, so the subject is
inside its own search box. It comes back as a `RECENTLY_SOLD` result like any
other, and nothing in §5.3 removes it.

Why it matters more than it first looks: it is a *perfect* comp by construction —
distance 0, sqft delta 0, bed/bath delta 0, sold the same day. Score 0. It sorts
**first**, it can never be capped out, and it survives the trim unless it happens
to be an extreme. So for any recently-sold subject the ARV is anchored to the
subject's own sale price and then presented as a market-derived estimate with a
confidence tier on it.

That is precisely the buy-a-flip case: someone just bought it, wants to know
what it's worth after repair, and gets back a number substantially made of what
they just paid.

Fix: exclude by `zpid` (adapter or a new §5.3 rule — your call which layer).
I'd add it as a hard-filter rule with its own reason code so the rejection is
visible in the rendered table rather than silently dropped in the adapter; a
member seeing "your property, excluded" understands the estimate better than one
who sees 36 comps and can't tell why.

---

## FINDING (major, test validity) — the recorded set can never produce an ARV

I ran the full §5.3 pipeline over the recorded pair with my own independent
implementation (`now` = 2026-08-05):

| radius | kept | rejections |
| --- | --- | --- |
| 0.5 mi | **1** | SQFT_OUT_OF_RANGE 33, TOO_FAR 2, SQFT_MISSING 1 |
| 1.0 mi | **1** | SQFT_OUT_OF_RANGE 33, TOO_FAR 2, SQFT_MISSING 1 |
| 2.0 mi | **2** | SQFT_OUT_OF_RANGE 33, TOO_FAR 1, SQFT_MISSING 1 |

`MIN_COMPS_TO_COMPUTE` is 3, so **this fixture always ends at
`TOO_FEW_COMPS`** — and the single comp surviving at 0.5/1.0 mi is the subject
itself (BUG-004 above). Strip that out and the honest count is 0, 0, 1.

The cause isn't distance, it's size. The subject is 2,971 sqft; the recorded
comps run 500–6,010 sqft with a **median of 1,510**. The ±25% band is
[2,228, 3,714] and only **3 of 36** land inside it — of which one is the subject
and one is 2.03 mi away (outside even the widest tier).

```
comp sqft:  n=36  min 500  p25 1064  median 1510  p75 1880  max 6010
in band:    3 of 36        SFR and in band: 3 of 25
```

So: if `stub.ts` replays these, every success-path test — `format.ts` rendering,
the cache result shape, session_state writes, the Flip/BRRRR pre-fill — has no
fixture to run on. Only the failure path is exercisable.

What I need, in preference order:

1. **A second recorded pair for a subject typical of its own comp set** — a
   ~1,500 sqft Phoenix house would have 20+ in-band comps in this very data.
   One more spike run, and the whole success path becomes testable on real data.
2. Failing that, I'll hand-extend a fixture from the recorded shapes. Cheap and
   precise, but it stops being a recording.

Either way this is worth knowing as a **product** signal too, not just a test
one: a real 2,971 sqft subject in this market genuinely has almost no comps
within ±25%, and the feature will legitimately return `TOO_FEW_COMPS` a lot.
Worth confirming with the operator that the honest refusal is the wanted
behaviour there, because it will fire more often than the band suggests.

---

## §6.1 mapping — verified against the bytes

Everything below checked against all 40 items / both subjects:

| claim | verdict |
| --- | --- |
| `zpid` is a number in `homeInfo` | ✅ 37/37 number; card-level `zpid` is a **string** — both need `String()` |
| `homeStatus` is `RECENTLY_SOLD` | ✅ 37/37 |
| comp `dateSold` is epoch ms | ✅ 37/37 number, range 2026-06-24 → 2026-07-31 |
| subject `dateSold` is ISO | ✅ `"2026-07-31T00:00:00.000Z"` |
| lot units differ per actor | ✅ comp `lotAreaUnit` = `"acres"`/`"sqft"`; subject `lotAreaUnits` = **`"Acres"`** — singular/plural AND capitalised differently. Your case-insensitive note is load-bearing, not defensive |
| acres × 43,560 | ✅ 0.5305096418732782 acres × 43,560 = 23,109 = the subject's own `lotSize` |
| `homeType` beyond the enum | ✅ SINGLE_FAMILY 25, CONDO 4, TOWNHOUSE 2, **MULTI_FAMILY 4, LOT 1, APARTMENT 1** → 6 map to OTHER |
| 3/40 building/rental noise | ✅ exactly 3 — and the same 3 have no `hdpData.homeInfo`, `isBuilding: true`, and `zpid: null`. All three signals agree, so any one of them is a sufficient skip |
| flat lat/lng | ✅ 0 missing across 37 |
| nullability | ✅ livingArea 1/37, bedrooms 2/37, bathrooms 1/37 null — all legal per §4 |

Two small ones on top:

- **`hasBadGeocode` is a third miss signal you aren't using.** The fuzzy-miss
  subject has `hasBadGeocode: true`; the real one has `false`. That's the
  provider telling you directly, and it's cheaper and more robust than the
  street-string comparison. Recommend it as a first-line check *alongside* the
  §6.1 guard, not instead of it.
- **`bathrooms` is ABSENT, not null, on the fuzzy-miss subject** (`undefined`).
  §4 says `number | null`. Pass-through leaves `undefined`, which type-checks,
  survives `?.`, and then vanishes on JSON round-trip through the cache. Adapter
  needs `?? null` on every nullable field, not just the ones observed null.

---

`tests/comps/payload.conformance.test.ts` auto-discovers
`subject-*.json` / `comps-*.json` in `__fixtures__/` and validates every field
against §4 — presence, type, nullability, enum domain, plus a `lat/lng = 0,0`
Null Island check. It deliberately does **not** match `spike-*.json`, since those
are raw and unmapped. Name the mapped fixtures with those prefixes and they get
reconciled automatically on every run.

Acknowledged from your 0004/0005 and already actioned or queued:
radius tiers kept (no golden churn), seam granted, call shapes pinned — I'm
narrowing the double to `.maybeSingle()` / `.upsert()` and `state.comps` now.
BUG-003's new rule 12 `FUTURE_SOLD_DATE` means my first-match ordering
assertions move; I'll update them in the same pass so your fix lands green.
