# Changes — 2026-07-27

Two reported bugs. Full detail and evidence in [RUN_REPORT.md](RUN_REPORT.md).

---

## Bug 1 — calculator forms appeared inconsistently

**What was wrong.** The same message got a form for one member and a prose "send me your
numbers" for the next. The cause wasn't the model making things up — the *decision* to show
a form was the model's, made fresh every turn at temperature 0.3 by choosing whether to call
the `request_calculator_form` tool. That's a coin flip. Prompting harder only moves the odds.

**What changed.** The decision moved out of the model and into code.

| File | Change | Why |
| --- | --- | --- |
| `src/agent/calculatorIntent.ts` | **New.** Pure function: message text → `form` / `ask_which_calculator` / `none`. | Same input must give the same route, every time. No model, no clock, no randomness. |
| `src/agent/agent.ts` | Calls the router *before* the model's first turn; on a `form` route it runs `request_calculator_form` itself and sets `renderForm`. Added `formTrigger: 'router' \| 'model'`. | The form is already on the result object before the model speaks, so the model has no way to decline. `formTrigger` records who decided. |
| `src/agent/systemPrompt.ts` | §2 rewritten: calculator intent without numbers *always* gets the form; the form is already on screen; ask which calculator if none was named. | The prompt now agrees with the code instead of being the mechanism. Deleting it would not stop a single form from rendering. |
| `src/server/app.ts` | Comment only. | The old comment said the model chooses. It no longer does. |

**The rules, in order:** bare menu number (1→BRRRR, 2→Flip, 3→Land) → deal numbers present
means calculate directly, never front a form → a named calculator plus an action aimed at it
(`run a flip`, `use the flip calculator`, `I want to do a BRRRR`) → action verb near a deal
noun with no calculator named means ask which one. A question guard keeps ordinary
conversation (`my flip is stalling, any advice`) out of it.

**Deliberately unchanged:** the routed form goes through the same `executeTool` switch, the
same tool runners, the same validation and the same logging. No second calculation path.

---

## Bug 2 — dead ~2s gap after clicking Calculate

**What was wrong.** `submitCalculatorForm` only disabled the *composer's* send button —
nowhere near where the member was looking. The Calculate button stayed unchanged. And the one
gesture toward a loading state, `removeTyping = addTyping(); removeTyping();`, created and
destroyed the indicator on the same line, so it painted nothing.

**What changed** — all in `widget/widget.js`:

- **Synchronously on click**, before any network call: button disabled, `aria-busy`, label →
  `Calculating…`, amber spinner; inputs and Cancel locked. There is now no frame where the
  member has clicked and nothing has changed.
- **A skeleton of the result card** appears where the answer will land — glass card, amber
  left edge, the existing `.jb-think-dots`, and three bars tracing a result's shape.
- **`jb-busy` on the root**, the same class the typed-message thinking state uses, so the
  ambient orbs warm and quicken. Reusing the existing treatment rather than bolting on a
  generic spinner was the requirement.
- **Click-once:** a `submitting` flag set synchronously, so a double-click's second event
  returns before the first `fetch` is dispatched. `disabled` is the visible half of it.
- **One `settle()` helper** resolves the state on *every* path — success, 400, 5xx, network
  rejection, non-JSON body, timeout. A 90s `AbortController` was added because `fetch` has no
  timeout of its own and a stuck spinner is worse than the original gap.
- **`prefers-reduced-motion`:** the spinner and dots aren't created at all; the static text
  `Calculating…` carries it.

`public/widget.js` rebuilt (25.7 kb).

---

## Tests

| File | Cases | Covers |
| --- | --- | --- |
| `tests/calculatorIntent.test.ts` | 90 | The rules, plus 25-iteration loops proving the form fires *every* time — including through `runAgent` with a fake model that refuses to ask for one. |
| `tests/calculatingState.widget.test.ts` | 17 | Loading state asserted while the request is held open; double-click; network / 5xx / 400 / timeout all resolving; reduced motion. |

`tests/agent.test.ts` — one assertion made position-independent: it took "the first tool
message", and `run a flip` now legitimately adds a form tool result ahead of it. It now
locates the result by `tool_call_id`. The payload assertions are unchanged.

**Mutation-checked:** reverting the router to model-only discretion fails 9 tests.

**Suite:** 839 passing, 18 skipped (live tests, gated). One pre-existing unrelated failure
remains — `tests/materialBudget.test.ts` won't load because vitest 4 doesn't strip the shebang
on `tools/ingest_material_budget.mjs`. Diagnosis and two one-line remedies in RUN_REPORT §9.

## Verified unchanged

- `Flip: 350k / 75k / 600k / 4 months` → **$101,916**; a different flip → **$127,626**
  (checked live and in tests).
- Form and typed paths still produce identical results.
- Disclaimers, defaults disclosure, and the CoC fallbacks intact. No calculator math touched.
