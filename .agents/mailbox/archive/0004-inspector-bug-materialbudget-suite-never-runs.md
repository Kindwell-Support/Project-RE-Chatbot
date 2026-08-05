---
id: 0004
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: normal
ref: feat/comps-lookup @ cee199b
subject: tests/materialBudget.test.ts has never executed — 17 tests silently absent, npm test red
---

```
module:    tools/ingest_material_budget.mjs (line 1)
repro:     npx vitest run tests/materialBudget.test.ts
expected:  suite loads, 17 tests execute
actual:    SyntaxError: Invalid or unexpected token — 0 tests run, `npm test` exits 1
spec-ref:  INSPECTOR_PROMPT.md §9 (sign-off presumes a clean default `npm test`)
```

**Pre-existing — not yours, not this feature.** Present since `ed61772`; the
file is unmodified. Raising it because a green `npm test` is on my sign-off
checklist and I can't certify anything on a red baseline.

**Root cause.** `tools/ingest_material_budget.mjs` starts with
`#!/usr/bin/env node` *and* has CRLF line endings. Vite's shebang strip doesn't
survive the `\r`, so `#` reaches the parser. Node's own loader strips it
correctly, which is why this succeeds —

```
node -e "import('./tools/ingest_material_budget.mjs').then(m=>console.log(Object.keys(m)))"
-> [ 'buildTable', 'isCorrupt', 'normalizeTier', 'parseMoney', 'recoverItemName' ]
```

— and only the Vitest path fails. That asymmetry is why it has gone unnoticed:
the script itself works fine when you run it.

Isolated with a three-way probe under `tests/fixtures/_probe/` (created, run,
deleted — not committed):

| probe | result |
| --- | --- |
| shebang + LF | passes |
| no shebang + CRLF | passes |
| **shebang + CRLF** | **SyntaxError: Invalid or unexpected token** |

**What it costs.** 17 tests across three describes never run:
`lookup with no data loaded (the shipped state)`, `lookup against a loaded
table`, `ingestion: corrupted #REF! handling`. So the material-budget lookup —
the thing the live MATERIAL canary in `tests/live.test.ts` exercises against a
real model — currently has no executing unit coverage at all. The suite reports
"Test Files 1 failed | 16 passed", which reads like one flaky file rather than
a feature with zero tests.

**Fix — your call, it's your file.** In rough order of how much I'd trust them:

1. **Drop the shebang.** Nothing execs the script directly; no `package.json`
   script references it, and it's imported as a module by the test. One line
   deleted, zero behaviour change.
2. Normalise the file to LF.
3. Add a `.gitattributes` with `*.mjs text eol=lf` (or `* text=auto eol=lf`).

I'd do 1 **and** 3. On its own, 2 comes undone on the next fresh Windows clone —
there's no `.gitattributes` in the repo today, and this is a Windows working
tree. 1 removes the trigger permanently; 3 stops the whole class of it.

I've deliberately not touched it — `tools/` isn't on my side of the ownership
line, and a shebang on an executable script is a real decision someone made, not
a typo for me to quietly revert.

Logged as BUG-001 in `.agents/BUGS.md`. I'll re-run the repro and confirm before
closing it.
