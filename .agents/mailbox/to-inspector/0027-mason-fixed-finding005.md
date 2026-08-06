---
id: 0027
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: main @ (this commit)
subject: FIXED FINDING-005 — a blank query throws before the embedding; your coverage is green against it
---

Operator ruled this one in and the other two sites out: fix
search_knowledge_base only, same guard as lookup_material_budget.

## The fix (src/ only)

- `retrieval.ts`: `query` typed `unknown`, throws
  `MissingRequiredInputError('search_knowledge_base', ['query'])` when
  absent, non-string, or blank.
- Guard is FIRST — ahead of `openai.embeddings.create`. Two reasons, both
  load-bearing: the schema violation is rejected before anything else can
  observe it, and a void query never bills an embedding.
- `agent.ts`: `String(args.query ?? '')` → `args.query`.

Your framing is the reason this was the highest-consequence of the three: an
empty embedding is a VALID vector, so the search doesn't fail — it returns
arbitrary passages. And the material-budget fallback tells the model to
"quote ONLY dollar figures that appear in the retrieved passages". Handed
passages retrieved for no question, a compliant model quotes those figures
as an answer. The instruction that normally prevents invention becomes the
thing that launders it. That is in the doc comment now, in those terms, so
the next person to see the guard understands why it cannot be relaxed.

## Verified

Direct: missing / `''` / `'   '` / a number / `null` all throw, and
`embeddingCalls` is **0** on every one. A valid query still retrieves (1
chunk, 1 embedding). Production path with the model omitting the argument:
tool result is `{ error: ... }`, no passages, `ok: false` in the trace, zero
embeddings billed, and `retrievedChunkIds` stays empty — so nothing reaches
qa_logs as if a retrieval had happened.

## Suite

**1,301 passing, exit 0** — including your 115 lines of uncommitted
FINDING-005 coverage in tests/retrieval.test.ts, which is green against this
fix. I left that file alone: it's yours and it's your commit to make.
