---
id: 0005
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-lookup @ 9d08b06
subject: a future-dated comp scores NEGATIVE, outranks every genuine sale, and cannot be capped out
---

```
module:    src/features/comps/rank.ts (the recency term, CONTRACT §5.4)
repro:     npx vitest run tests/comps/rank.test.ts -t "recency term must never go below 0"
expected:  parts.recency >= 0   (§5.4 states the score is 0-100)
actual:    -0.0547525
spec-ref:  CONTRACT.md §5.4
```

Both repro tests in `tests/comps/rank.test.ts` are **failing on purpose** —
they're the repro, not noise. They go green when this is fixed.

**The arithmetic.** A comp dated one day after `now`:

```
monthsAgo = -1 / 30.44                     = -0.03285151
recency   = min(-0.03285151 / 12, 1) × 20  = -0.05475252
```

`min(x, 1)` clamps the top of the range. Nothing clamps the bottom.

**Why it's reachable.** Rule 2 rejects `soldDate` null or *more than* 12 months
old. A future date is neither. So a `status: SOLD` comp dated tomorrow passes
all eleven hard filters untouched. Future sold dates are not exotic in Zillow
data — pending-close dates, timezone-shifted dates, and plain bad rows all
produce them.

**Why it's major rather than minor.** The ranking is ascending, so a negative
score sorts ahead of a *flawless* comp at score 0. That means bad data is not
merely tolerated, it is **promoted**:

- guaranteed into the kept set,
- guaranteed to displace a legitimate comp once the set is capped at 8,
- its $/sqft then enters the trimmed mean like any other value.

The second repro test shows it: one future-dated comp against eight genuine
recent sales, and the future one comes back ranked #1.

Secondary effect worth knowing about: `monthsAgo` also feeds the median age
behind the `high` confidence clause, so negative ages pull that median down and
make `high` slightly easier to reach. Small on its own, but it points the wrong
way — worse data producing more confidence.

**Fix — your call.** Two options, and I'd take both:

1. **Reject a future `soldDate`.** Semantically it hasn't sold, so rule 1
   `NOT_SOLD` fits and no new `RejectReason` is needed. Requires a §5.3 wording
   change — something like "status ≠ SOLD (case-insensitive), **or `soldDate`
   is in the future**".
2. **Clamp the recency term at zero**: `min(max(monthsAgo, 0) / 12, 1)`.

1 is the honest behaviour (don't comp against a sale that hasn't happened);
2 is the cheap structural guarantee that §5.4's stated 0–100 range actually
holds no matter what reaches it.

If you take option 1, tell me whether `NOT_SOLD` or a new reason code, and I'll
update the filter spec's first-match ordering assertions to match.

Everything else in slice 2 is clean: 49/49 on the filter spec (every rule in
isolation, first-match ordering, both tier-escalation edges, the candidate
median's radius- and order-independence), 57/57 on the ARV spec, 24/26 on rank
with only these two failing. Details in `.agents/BUGS.md` as BUG-003.
