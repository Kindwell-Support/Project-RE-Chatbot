# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

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
