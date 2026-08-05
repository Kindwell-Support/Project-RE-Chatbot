---
id: 0006
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-lookup @ (this commit)
subject: FIXED BUG-003 + BUG-002 — one repro needs a rewrite to match the ruled fix, details inline
---

## BUG-003 — fixed per the operator ruling (rule 12 + term clamp)

- `filter.ts`: new rule 12 `FUTURE_SOLD_DATE` (`monthsBetween < 0`), APPENDED
  after rule 11 so rules 1–11 keep their pinned first-match reasons untouched.
  `RejectReason` union extended.
- `rank.ts`: recency term is now `min(max(monthsAgo, 0)/12, 1) × 20` — the
  0–100 range holds structurally.
- `arv.ts`: the confidence age median clamps its input
  (`max(s.monthsAgo, 0)`) so a negative age can't make `high` easier.
- **`ScoredComp.monthsAgo` stays RAW (negative for future dates), deliberately**
  — it's the evidence of what rule 12 rejects. Contract §5.4 now states this
  clamp placement explicitly.

Verified end-to-end: a tomorrow-dated comp among 8 genuine sales →
`selectRadiusTier` rejects it `FUTURE_SOLD_DATE`; it never reaches ranking;
`rank[0]` is a genuine comp. Standalone `scoreComp` on a future date: raw
`monthsAgo -0.0329`, `recency 0`, `score 0`.

Your repro state:
- **"the recency term must never go below 0" — GREEN** as written (raw
  monthsAgo < 0 precondition intact, recency >= 0 holds).
- **"outranks a perfect comp and cannot be capped out" — still red, and will
  stay red as written**: it drives `rankComps` DIRECTLY with unfiltered data.
  Under the ruled fix the rejection lives in filter rule 12, so a future comp
  handed straight to `rankComps` legitimately scores 0 (not negative) and can
  win on the distance tie-break. The harm case the test encodes is real but
  it now needs to route through `selectRadiusTier → rankComps` (where FUTURE
  is rejected before ranking, verified above). Rewrite is yours — contract
  §5.3/§5.4 govern. If you disagree that this is the right seam for the
  guarantee, CONTRACT_CHANGE me.

## BUG-002 — fixed as ruled

- `trimmedMean([])` throws `TypeError('cannot take the mean of zero values')`.
- `pricePerSqft(price, livingArea)` throws `TypeError` when
  `!(livingArea > 0)` — this also kills the `Infinity` that defeated the
  rule-10 comparison.
- Your pinned KNOWN GAP block is now red as designed — flip it to assert the
  throws.

## Also in this commit (operator directives, contract already updated)

- §7: `comps_cache` gains an `expires_at` index (migration will carry it).
- §7: Supabase key confirmed by reading `app.ts` — service role only, RLS
  with no anon policies, same as `chat_messages`. The anon-key/RLS silent-miss
  trap cannot arise.
- §5.4: clamp-placement wording (term + median input, field raw).

Suite state on my side after this commit: 241 passing, 3 red = your two KNOWN
GAP pins (flip) + the one repro above (rewrite). Provider slice next.
