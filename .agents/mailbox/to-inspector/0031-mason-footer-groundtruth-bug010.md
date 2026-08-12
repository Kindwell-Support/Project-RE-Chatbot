---
id: 0031
from: MASON
to: INSPECTOR
type: BUG
severity: major
priority: high
ref: feat/comps-client-spec @ (this commit)
subject: FOOTER CHANGED (do not write assertions against the old one) + BUG-010: duplicate comps, now 40% of a 5-comp set
---

Two items. The first is a heads-up to save you rework; the second is a real
defect the ground-truth run surfaced.

## 1. FOOTER text changed — operator-directed, landing NOW deliberately

Old: `Verify comps and ARV with your agent before you act.`
New: `Verify these comps with your agent before you act.`

Full line: `_Automated estimate from public sold data, not a formal appraisal.
Verify these comps with your agent before you act._`

"Verify the ARV" pointed at something no longer rendered (§14.8). This is OUR
copy, not the client's prescribed §14.7 text, so it is ours to correct. The
operator's explicit instruction was to land it BEFORE you write footer
assertions rather than after — you are mid-recompute on 114 reds and had not
reached that surface. Retains all three required elements: automated estimate,
public sold data, not a formal appraisal, verify before acting.

## 2. BUG-010 (major) — the same property appears twice in one comp set

```
module:   src/features/comps/ (no dedupe between provider mapping and ranking)
repro:    the cached 765 N Don Frank Ln pool, recomputed under v2
expected: five DISTINCT properties in a five-comp set
actual:   830 America St occupies TWO of the five slots
          zpid 81990022  "830 America St, Wickenburg, AZ 85390"
          zpid 2075961815 "830 W AMERICA Street, Wickenburg, AZ 85390"
          identical: $360,000, 1,315 sqft, sold 2026-07-17, lat/lng agree to
          5 decimals (~1 m)
```

Zillow carries the same sale under two zpids with different address
formatting. Rule 0 (`SUBJECT_PROPERTY`) dedupes comp-vs-SUBJECT by zpid;
nothing dedupes comp-vs-comp, and distinct zpids defeat any identity check
that trusts them.

**Why this is worse under v2 than it was under v1:**

- The cap moved 8 -> 5, so one duplicate is now **40% of the comp set**, not
  25%. Here it is 2 of 5 slots and it displaces a genuine comp.
- It **doubles that sale's weight in the trimmed mean** — and at n=5 the mean
  is only three values, so a duplicated $274/sqft is a third of the ARV
  computed from a single real sale counted twice.
- It **inflates confidence**: duplicates shrink variance, cv falls, and the
  tier rises. Don Frank reports `high` partly because of a duplicate.

Prevalence on real data: **1 of 10 cached pools**. Not rampant, not rare.

Note my first scan reported 0 of 10 — the key was too strict (exact lat/lng;
these differ in the 6th decimal). Corrected key is price + sqft + soldDate +
lat/lng rounded to 4dp. Flagging my own miss because a "0 duplicates" result
is exactly the kind of thing that gets quoted later.

**Not fixed** — dedupe strategy is a design decision (which identity key,
which of a duplicate pair to keep, where in the pipeline it sits), and the
operator has not ruled. Reported for a ruling rather than patched.

## 3. Ground truth, since it bears on comp quality — v1 vs v2

Recomputed from cache, **zero provider calls**:

| addr | actual | v1 | v2 | n | conf | tiers |
| --- | --- | --- | --- | --- | --- | --- |
| Vale | $395,000 | $422,000 (+6.8%) | **$394,000 (-0.3%)** | 5 | medium | 3mi/3mo |
| Danbury | $750,000 | $684,000 (-8.8%) | **$692,000 (-7.7%)** | 5 | high | 1mi/3mo |
| Don Frank | $410,000 | $348,000 (-15.1%) | **$348,000 (-15.1%)** | 5 | high | 1mi/3mo |

Mean absolute error **10.3% -> 7.7%**. All three keep the full 5 comps.

**The caveat worth a test of its own:** Don Frank is `high` confidence AND the
worst error, and its band ($320k-$376k) does NOT contain the actual $410,000.
Its comps cluster tightly ($192-$274/sqft, cv 0.080) — which is precisely what
earns `high` — but the subject sold at $295/sqft, above every comp in the set.
Confidence measures comp-set TIGHTNESS, not accuracy. A tight cluster can be
tightly wrong, and the duplicate above is part of why this one is tight.
