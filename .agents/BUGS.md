# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

---

## BUG-008 — the widget pre-filled without a label — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: minor
- **Fix**: `a90b811` — the condition now also requires `field.prefill.label`,
  the exact clause the report proposed. A labelless prefill is DECLINED
  outright: no value in the box, nothing rendered, nothing to submit. Value and
  provenance render together or not at all, so the guarantee is structural
  rather than positional.

Original report follows.

- **Reported**: msg `0014-inspector-form-surface-verified.md`

```
module:    widget/widget.js:735
repro:     npx vitest run tests/comps/formPrefill.widget.test.ts -t "NO label"
expected:  no label => no pre-fill (the module's OWN comment, widget.js:733-734)
actual:    the value is written into the input and nothing is rendered beside it
spec-ref:  CONTRACT §8.1
```

The comment three lines above the condition states the guarantee exactly:

> The label is the guarantee: no label, no pre-fill — the member always sees
> which property the number came from.

The condition is `if (field.prefill && field.prefill.value !== undefined)`. It
never checks the label. Given a prefill with a value and no label, the widget
writes $403,000 into the ARV box and renders an empty note — a number the member
did not type, sitting in a required field, with nothing saying where it came
from. Indistinguishable from their own input, and it SUBMITS untouched by
design.

Not reachable today: the server always supplies the label (verified against the
real payload). So this is the same shape as BUG-002 — the defence is POSITIONAL
(it holds because of what the server happens to send) rather than structural
(the renderer enforcing its own invariant).

Fix is one clause: `if (field.prefill && field.prefill.value !== undefined && field.prefill.label)`.

---

## BUG-007 — the override escape hatch skips the property binding

- **Status**: OPEN
- **Severity**: minor (narrow trigger, real consequence)
- **Reported**: msg `0013-inspector-override-escape-hatch.md`

```
module:    src/agent/agent.ts (explicit-ARV branch, case 2)
repro:     npx vitest run tests/comps/state.test.ts -t "typed for ANOTHER field"
expected:  when a block is bound and the member names a DIFFERENT property, the
           reply says which property it is analysing
actual:    a flip on 456 Oak ran with ARV 400,000 carried from 123 Main's
           $403,000, and the reply names neither property
spec-ref:  CONTRACT §8 (address-mismatch guard)
```

The three-way discriminator is right and covers the case the operator flagged:
a transformed carry with no matching number in the member's message is refused
(verified — my LEAK test passes). The gap is narrower.

`messageStatesNumber` asks "did the member say this number this turn?" but not
"did they say it AS an ARV". A member's message routinely carries several dollar
figures; a purchase price is the commonest. When the model passes that figure as
`after_repair_value`, the call reads as a genuine override, and case 2's
`if (addressConflict(...)) return { args }` deliberately skips the echo.

Result: a full flip on a property the member named as different, priced off a
number carried from the bound property, with no address in the reply at all —
and the state block still bound to the OLD address for the next turn.

Not the wrong-house-ARV leak (that is closed); the residue is that an accepted
override on a conflicting address leaves the analysis unlabelled.

Suggested fix, minimal: on address conflict with an accepted override, still
name the property being analysed — or re-bind/clear the block so the next turn
cannot read a stale binding. Blocking is NOT wanted here; the member gave
coherent input.

Verified NOT affected: `brrrr_calculator` goes through the same guard.

---

## BUG-006 — mapped `soldDate` was a timestamp, not a date — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: major
- **Fix**: adapter emits the calendar date; `soldDate` is `YYYY-MM-DD` again.

Was: `"2026-08-03T07:00:00.000Z"` (Phoenix local midnight in UTC). Rule 12
rejects `soldDate` strictly after `now`, so between 00:00Z and 07:00Z a sale
that closed TODAY was dropped as future-dated — seven hours of every UTC day,
which is evening in the client's own market, eating the freshest comps, with a
plausible-looking reason in the rejection table.

Verified: the comp is kept at 02:00Z, 06:59Z, 07:01Z and 18:00Z; the same
address returns the same comps at every hour; all four mapped fixtures now pass
§4 conformance.

Found by the conformance harness on the first real mapped payload — which is
exactly the reconcile-before-you-trust-anything step paying for itself.

---

## BUG-005 — `renderCompsForChat` returned `undefined` for a message-less failure — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: minor
- **Fix**: falls back to copy keyed off `code`, so the declared `: string`
  signature holds regardless of what the service passes.

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
