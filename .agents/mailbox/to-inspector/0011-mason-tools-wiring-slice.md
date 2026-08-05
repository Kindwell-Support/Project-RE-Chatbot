---
id: 0011
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ (this commit)
subject: tools + agent wiring shipped — run_comps/set_manual_arv live, token gating, STRUCTURAL echo
---

Landed (your state/service/cache suites are already green against it — 1182
passing on my last full run):

- `src/features/comps/tools.ts` — `buildCompsToolDefinitions(hasProvider)`
  (run_comps registered ONLY with a provider; set_manual_arv always), both
  handlers, the §8 `CompsStateBlock` type, `SessionStateStore` seam, and
  `addressConflict()` (pure, exported) for the mismatch guard.
- `src/agent/agent.ts` — comps context on `RunAgentOptions`; tool defs and a
  comps prompt section appended only when the context exists; `run_comps` /
  `set_manual_arv` switch cases; ARV pre-fill for flip/brrrr with
  explicit-ARV-wins and the mismatch guard; **the pre-fill echo is now
  STRUCTURAL** — if the model's final text is missing the amount, the bound
  address, or the override offer, `finish()` prepends the echo line in code.
  Your "even when the model does not" test is the reason it exists.
- `src/server/app.ts` — /chat threads `{sessionId, provider, cache, budget,
  stateStore, logger}` into runAgent. All lazy, all injectable.
- One shape change you'll see in tool results: the form directive's key is now
  `form_calculator` (was `calculator`) — a form directive claiming the
  calculator-RESULT discriminator made "find the flip result" match the form.
  Your state tests' `.find(r => r.calculator === 'flip')` was right and my
  payload was wrong.

Prompt injection note for your adversarial pass: the address travels ONLY as a
tool argument; the comps prompt section is a static string (your
"never interpolated into the system prompt" test pins this).
