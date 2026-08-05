# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

---

## BUG-004 — the subject property appears in its own comp set

- **Status**: OPEN
- **Severity**: major
- **Reported**: msg `0009-inspector-payload-reconciled-two-major-findings.md`

```
module:    src/features/comps/providers/apifyZillow.ts (adapter) + CONTRACT §5.3
repro:     spike-subject-real.json zpid 7520659 IS one of the 37 items in spike-comps.json
expected:  the subject is never a comp for itself
actual:    zpid 7520659, "1111 W ENCANTO Boulevard", 2971 sqft, $1,010,000,
           distance 0.0000 mi — passes all twelve hard filters
spec-ref:  CONTRACT.md §5.3 (no rule excludes the subject)
```

The comps search is a `mapBounds` box centred on the subject, so the subject sits
inside its own search box and returns as a `RECENTLY_SOLD` result like any other.

It is a *perfect* comp by construction — distance 0, sqft delta 0, bed/bath delta
0, sold the same day. Score 0. It sorts first, cannot be capped out, and survives
the trim unless it happens to be an extreme. For any recently-sold subject the
ARV is anchored to the subject's own sale price and then presented as a
market-derived estimate with a confidence tier on it.

Confirmed against real recorded data, not hypothetical: at 0.5 and 1.0 mi it is
the ONLY surviving comp.

---

## FINDING-001 — the recorded fixture pair can never produce an ARV

- **Status**: OPEN (test validity, not product correctness)
- **Severity**: major
- **Reported**: msg `0009`

Running §5.3 over `spike-subject-real.json` + `spike-comps.json` (now = 2026-08-05):

| radius | kept | rejections |
| --- | --- | --- |
| 0.5 mi | 1 | SQFT_OUT_OF_RANGE 33, TOO_FAR 2, SQFT_MISSING 1 |
| 1.0 mi | 1 | same |
| 2.0 mi | 2 | SQFT_OUT_OF_RANGE 33, TOO_FAR 1, SQFT_MISSING 1 |

Always below `MIN_COMPS_TO_COMPUTE` (3), and the single survivor at the tight
tiers is the subject itself (BUG-004). Cause is size, not distance: subject 2,971
sqft against comps with a median of 1,510; only 3 of 36 land in the ±25% band.

Consequence: if `stub.ts` replays these, only the FAILURE path is exercisable.
Requested a second recorded pair for a subject typical of its own comp set.

---

## BUG-003 — a future-dated comp scores NEGATIVE — CLOSED

- **Status**: CLOSED (repro re-run and confirmed 2026-08-05)
- **Severity**: major
- **Fix**: rule 12 `FUTURE_SOLD_DATE` (§5.3) + `max(monthsAgo, 0)` in the recency
  term and the confidence-median input (§5.4).

Verified after the fix:
- `parts.recency` is 0, not -0.0547, for a comp dated tomorrow.
- `monthsAgo` still reports the RAW negative value — the evidence is preserved,
  which is the right call and is now pinned by its own test.
- The comp is REJECTED at the filter with reason `FUTURE_SOLD_DATE`, so the
  negative-score promotion is unreachable by construction rather than merely
  clamped.
- Rule 12 is last, so an earlier failure still wins the first-match report —
  ordering pinned in `filter.test.ts`.
- No neighbour regressions: all 248 comps tests green, including the 25 goldens.

---

## BUG-002 — degenerate inputs returned NaN / Infinity — CLOSED

- **Status**: CLOSED (repro re-run and confirmed 2026-08-05)
- **Severity**: minor
- **Fix**: `trimmedMean([])` and `pricePerSqft(price, area <= 0)` now throw.

Verified: both throw; `trimmedMean([207])` still returns 207 (the guard is a
guard, not a blanket rejection); `pricePerSqft(0, 2000)` still returns 0, because
a zero PRICE is rule 9's business and not a programmer error.

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
