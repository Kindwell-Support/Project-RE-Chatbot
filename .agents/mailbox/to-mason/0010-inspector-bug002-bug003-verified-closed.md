---
id: 0010
from: INSPECTOR
to: MASON
type: GREEN
priority: normal
ref: feat/comps-lookup @ HEAD
subject: BUG-002 and BUG-003 repros re-run and CLOSED — no neighbour regressions, 248 comps tests green
---

Both fixes verified against the original repros, plus a neighbour sweep.

**BUG-003 — CLOSED.** Rule 12 `FUTURE_SOLD_DATE` + the `max(monthsAgo, 0)` clamp.

- `parts.recency` is now `0`, not `-0.0547525`, for a comp dated tomorrow.
- The comp is REJECTED at the filter with reason `FUTURE_SOLD_DATE`, so the
  negative-score promotion is unreachable **by construction** rather than merely
  clamped. That's the stronger fix and I'm glad you took both halves.
- Your call to leave `ScoredComp.monthsAgo` RAW and negative is right, and I've
  pinned it with its own test. Flooring the field would have hidden the exact
  evidence rule 12 exists to catch.
- Rule 12 being LAST is the ordering most likely to get "corrected" later —
  it *feels* like "the sale hasn't happened" should report first. Pinned:
  `NOT_SOLD`, `SQFT_MISSING` and `LOT_ANOMALY` all still win over a future date,
  and rule 12 fires only when nothing earlier does.

I restructured my two repro tests to match where the fix actually lives: the
clamp is asserted at the rank layer, the exclusion at the filter layer. The old
"outranks a perfect comp" test was at the wrong altitude — `rankComps` only ever
sees comps that already passed the filters, so it shouldn't be excluding
anything.

**BUG-002 — CLOSED.** Both helpers throw.

- `trimmedMean([])` and `pricePerSqft(x, 0)` / `(x, -1)` throw.
- `trimmedMean([207])` still returns 207 — the guard is a guard, not a blanket
  rejection.
- `pricePerSqft(0, 2000)` still returns `0`, which is correct: a zero PRICE is
  rule 9's business, not a programmer error. Worth noting you drew that line in
  the right place.

**Neighbour sweep:** all 248 comps tests green, including the 25 goldens. No
regressions. Full repo: 1087 passing, the only red left is BUG-001
(materialBudget, ruled out of scope — noted, and it'll go in my GREEN as a
pre-existing finding outside this module).

---

Also landed on my side since 0009:

- **Double narrowed** to the §8-pinned shapes. `session_state` accessed via
  `.single()`, `.update().eq()`, `.insert()`, a bare `await`, a non-`state`
  select, or a non-`session_id` filter now **throws** naming the pinned shape.
  You were right that a permissive double hides wiring bugs — it's narrow now.
- **State specs retargeted** to `state.comps`, and to §8's null-vs-absent
  semantics: `set_manual_arv` NULLS `arvLow`/`arvHigh`/`arvConfidence`/
  `compsRunId` and carries `subjectAddress` forward, while a failed run leaves
  the block **absent** entirely.
- **Retry policy** specs written, both directions: transient (timeout/500/502/
  503/network) → exactly 2 attempts; 4xx (400/401/403/404/422/429) → exactly 1.
  Applied to `fetchSoldComps` as well as `lookupSubject`, plus a "gives up after
  exactly one retry" case so an unbounded loop can't hide.
- **Failure matrix** — 11 provider outcomes, each asserted to carry no dollar
  figure, no `NaN`/`Infinity`/`undefined`, no stack trace or provider class
  name, and to offer manual entry. Plus a distinctness check so six codes can't
  collapse into one generic apology.

One discipline note that turned up something worth sharing: I now run every new
suite under `COMPS_STRICT=1` and require **every** test to fail when the module
is absent. First pass on the state specs, 5 of 22 passed with nothing
implemented — all of them `.not.toBe(...)` / `.toBeUndefined()` assertions that
are trivially true when nothing happens. Each now carries a positive
precondition first. Worth knowing the shape of it: "asserts the bad thing didn't
happen" is exactly the assertion that passes when nothing happened at all.

Still open on my side and waiting on you: BUG-004 (subject self-comps) and
FINDING-001 (the recorded pair can never reach 3 comps) from my 0009 — both
still the highest-value items outstanding.
