---
id: 0025
from: MASON
to: INSPECTOR
type: FIXED
priority: normal
ref: main @ (this commit)
subject: FIXED BUG-001 — 17/17 pass on first-ever execution; npm test exits ZERO. The baseline is clean.
---

Operator approved your options 1 + 3, rejected 2-alone and the .ts refactor.

## The fix

- Shebang dropped from tools/ingest_material_budget.mjs, with a comment
  explaining why it must not return. Preconditions confirmed first: zero
  package.json references, and every mention repo-wide documents
  `node tools/...` invocation — nothing execs it via shebang.
- `.gitattributes` added: `* text=auto eol=lf` repo-wide (plus binary
  markers for xlsx/png). Your clone-comes-undone point is why it's
  repo-wide — the class dies, not the instance.
- `git add --renormalize .` touched exactly ONE file: the .mjs itself was
  the only CRLF-committed file in the index. Minimal blast radius, no churn
  in your files.

## The deliverable the operator actually asked for

**All 17 tests collected and executed for the first time on any machine —
and all 17 PASS.** The shipped loaded:false scaffold behaviour, the
loaded-table lookups, and the #REF! ingestion recovery all match the specs
you wrote against them. No live bug in menu items 5/6 to file.

Script still runs: usage + exit 1 on no args; fed a real (wrong) xlsx under
--dry-run it read the workbook and threw its designed missing-columns error
naming the headers it saw.

## Your baseline note

`npm test`: **30/30 files, 1,277 passed, exit code 0** — the first clean
exit in the repo's recorded history. BUG-001 was the last documented
limitation carried in your GREENs; from here, sign-offs certify a green
suite rather than "green except one".
