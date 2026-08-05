# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

---

## BUG-003 — a future-dated comp scores NEGATIVE and outranks every genuine sale

- **Status**: OPEN
- **Severity**: major
- **Reported**: msg `0005-inspector-bug-negative-recency-score.md`

```
module:    src/features/comps/rank.ts (the recency term, CONTRACT §5.4)
repro:     npx vitest run tests/comps/rank.test.ts -t "recency term must never go below 0"
expected:  parts.recency >= 0  (§5.4 states score is 0-100)
actual:    -0.0547525
spec-ref:  CONTRACT.md §5.4
```

Arithmetic. A comp dated one day after `now`:

```
monthsAgo = -1 / 30.44                        = -0.03285151
recency   = min(-0.03285151 / 12, 1) × 20     = -0.05475252
```

`min(x, 1)` clamps the top of the range. Nothing clamps the bottom, so a
negative age produces a negative score component and a total score below zero.

**Why it is reachable.** Hard-filter rule 2 rejects `soldDate` null or *more
than* 12 months old. A future date is neither, so a `status: SOLD` comp dated
tomorrow passes every one of the eleven rules.

**Why it matters.** Ranking is ascending, so a negative score sorts ahead of a
flawless comp (score 0). Bad provider data is therefore *guaranteed* into the
kept set and *guaranteed* to displace a legitimate comp once the set is capped
at `MAX_COMPS_KEPT`. Its $/sqft then enters the trimmed mean like any other.
Secondary: `monthsAgo` also feeds the median age behind the `high` confidence
clause, so negative ages pull that median down and make `high` marginally easier
to reach.

Fix options for MASON (his call):
1. Reject a future `soldDate` — semantically it has not sold, so rule 1
   `NOT_SOLD` fits without adding a `RejectReason`. Needs a §5.3 wording change.
2. Clamp the recency term at 0: `min(max(monthsAgo, 0) / 12, 1)`.
Recommend 1, with 2 as defence in depth.

---

## BUG-002 — degenerate inputs return NaN / Infinity at the pure-function edge

- **Status**: OPEN
- **Severity**: minor
- **Reported**: msg `0006-inspector-minor-batch.md`

```
module:    src/features/comps/arv.ts
repro:     npx vitest run tests/comps/arv.test.ts -t "KNOWN GAP"
expected:  throws, per the guards calculateArv already has
actual:    trimmedMean([]) -> { mean: NaN }; pricePerSqft(x, 0) -> Infinity
spec-ref:  CONTRACT.md §4 (exported signatures); TEST_PLAN.md §8 Q2
```

`calculateArv` guards both cases properly and throws with a clear message —
that is the defence that matters and it is verified. The two smaller exported
helpers do not.

Unreachable today: the count gate stops below 3 comps, and rules 3 and 9 drop
comps with a missing sqft or price before any $/sqft is taken. But the defence
is POSITIONAL, not structural — it holds because of who calls these today.
Infinity is the nastier of the two: `Infinity < 0.4 × median` is false, so a
divide-by-zero comp could never be rejected as non-arms-length.

Pinned to current behaviour in `arv.test.ts` so the suite stays green while
this is open.

---

## BUG-001 — `tests/materialBudget.test.ts` has never run; 17 tests silently absent

- **Status**: OPEN
- **Severity**: major
- **Reported**: msg `0004-inspector-bug-materialbudget-suite-never-runs.md`
- **Pre-existing** — present since `ed61772`, unrelated to `feat/comps-lookup`.

```
module:    tools/ingest_material_budget.mjs (line 1)
repro:     npx vitest run tests/materialBudget.test.ts
expected:  suite loads, 17 tests execute
actual:    SyntaxError: Invalid or unexpected token — 0 tests run, `npm test` exits 1
spec-ref:  INSPECTOR_PROMPT.md §9 (sign-off presumes a clean default `npm test`)
```

Root cause: the file begins with `#!/usr/bin/env node` **and** uses CRLF line
endings. Vite's shebang strip does not survive the `\r`, so `#` reaches the
parser. Node's own loader strips it correctly, which is why
`node -e "import('./tools/ingest_material_budget.mjs')"` succeeds and only the
Vitest path fails.

Isolated with a three-way probe (since removed):

| probe | result |
| --- | --- |
| shebang + LF | passes |
| no shebang + CRLF | passes |
| shebang + CRLF | **SyntaxError** |

Only this one file in the repo has a shebang. There is no `.gitattributes`, so
the CRLF will come back on any fresh Windows clone even if the file is
normalised once.

---

## Contract findings (not code bugs)

### CF-001 — `compsUsed` undefined in CONTRACT §4 — RESOLVED IN MAILBOX ONLY

- **Status**: OPEN (documentation)
- **Severity**: minor

The contract does not say whether `compsUsed` is the kept count or the
post-trim count. At n = 5 and n = 6 the two readings give different confidence
tiers — `medium` vs `low`, and `high` reachable vs not. MASON ruled it is the
kept count (mailbox `0003`), and `golden-04-boundary-5.ts` asserts accordingly.

The ruling is not in CONTRACT.md, which is supposed to be the referee. Asked for
a one-line amendment to §4:
`compsUsed: number;  // kept/ranked comps, i.e. n before the trim`
