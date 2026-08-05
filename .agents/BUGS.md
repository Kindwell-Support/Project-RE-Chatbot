# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

---

## BUG-006 — mapped `soldDate` is a timestamp, so today's comps are rejected as future-dated

- **Status**: OPEN
- **Severity**: major
- **Reported**: msg `0011-inspector-bug006-timestamp-vs-date.md`

```
module:    src/features/comps/providers/apifyZillow.ts (soldDate mapping)
repro:     npx vitest run tests/comps/filter.test.ts -t "regardless of what hour"
expected:  a comp sold today is kept at every hour of the UTC day
actual:    FUTURE_SOLD_DATE for any `now` between 00:00Z and 07:00Z
spec-ref:  CONTRACT §4 (`soldDate: string | null;  // ISO date`)
```

The epoch-ms -> ISO mapping preserved the time component:
`"2026-08-03T07:00:00.000Z"` is Phoenix local midnight in UTC (Arizona = UTC-7,
no DST). §4 says ISO *date*; `monthsBetween`, the 12-month wall, rule 12 and the
whole golden set assume date-only.

Measured with a comp identical to the subject in every filterable way, so only
rule 12 can fire:

```
now = 2026-08-05T02:00:00.000Z  ->  FUTURE_SOLD_DATE
now = 2026-08-05T06:59:00.000Z  ->  FUTURE_SOLD_DATE
now = 2026-08-05T07:01:00.000Z  ->  KEPT
```

Seven hours of every UTC day — 5pm-midnight Phoenix, prime usage hours in the
client's own market. It eats the FRESHEST comps, it is nondeterministic across
runs, and results cache for 14 days so the first computed set is frozen in. The
symptom is invisible: `FUTURE_SOLD_DATE` reads plausible in the rejection table.

Fix: `new Date(epochMs).toISOString().slice(0, 10)`. Pinned by a third test that
already passes with the date-only form.

Found by the conformance harness on the first real mapped fixtures.

---

## BUG-005 — `renderCompsForChat` returns `undefined` for a failure with no message

- **Status**: OPEN
- **Severity**: minor
- **Reported**: msg `0011`

```
module:    src/features/comps/format.ts
repro:     npx vitest run tests/comps/format.test.ts -t "BUG-005"
expected:  returns a string, per §4's declared signature
actual:    `undefined` when `message` is absent; `''` when empty
spec-ref:  CONTRACT §4 / §11
```

Reaches the chat layer as the literal word "undefined" or throws on `.length`.
TypeScript can't catch it — `CompsFailure.message` is declared required, so the
guarantee is only as strong as every service call site remembering to set it.

---

## FINDING-002 — §11 attributes the §10 failure copy to the wrong module

- **Status**: OPEN (documentation)
- **Severity**: minor

§11 says "Failures render their §10 copy" under the `format.ts` heading, but the
renderer never reads `code` or `detail` — it relays `outcome.message`, which
`service.ts` composes. The architecture is fine; the contract points at the wrong
module, which is where a future reader will look for the manual-entry guarantee.

§10 property assertions accordingly live in `service.test.ts`; `format.test.ts`
tests only the passthrough contract.

---

## BUG-004 — the subject property appears in its own comp set — CLOSED

- **Status**: CLOSED (fix verified 2026-08-05)
- **Severity**: major
- **Fix**: new hard-filter rule 0 `SUBJECT_PROPERTY`, checked BEFORE rules 1-12.

MASON took the visible-rejection option: the self-comp is now named in the
rejection table with its real reason rather than silently dropped in the adapter.
Verified on the new recorded pair — zpid 7532298 rejected `SUBJECT_PROPERTY`,
ARV computed from the 5 genuine comps.

---

## FINDING-001 — the recorded fixture pair can never produce an ARV — CLOSED

- **Status**: CLOSED (resolved 2026-08-05)

MASON recorded a second pair against a subject taken from the median of the
first recording (1,349 sqft, 1423 E Coronado Rd): `subject-standard` /
`comps-standard` reach a real ARV of $431,000 with 5 comps at 2.0 mi and honest
`low` confidence. The original 2,971 sqft pair was kept and mapped as
`subject-large-thin-market` / `comps-large-thin-market` — a genuine
TOO_FEW_COMPS fixture on real data, which is more useful than discarding it.

Both success and failure paths are now exercisable on recorded data.

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
