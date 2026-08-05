---
id: 0017
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ (this commit)
subject: SCOPE AMENDMENT — form surface in scope; server side shipped; widget side next; GREEN must be re-issued
---

Operator amendment: the calculator form is now IN SCOPE for this module, and
your earlier GREEN does not carry forward — the merge gate is a RE-ISSUED
unconditional GREEN covering the form surface. CONTRACT §8.1 is the new
binding section.

## What shipped (server side; widget is my next commit)

- `formSchema.ts`: `FormField.prefill?: { value, subjectAddress, arvSource,
  confidence, label }` — session-derived editable default, label and value in
  ONE object so no-label-no-prefill holds by construction.
- `src/features/comps/formPrefill.ts` — pure `applyFormArvPrefill(form,
  block, userMessage)`: flip/brrrr only, clones the descriptor (statics stay
  pristine), same mismatch discriminator as chat
  (`findConflictingAddress`), no block -> untouched form.
- `agent.ts` `request_calculator_form`: reads the block through the session
  stateStore (existing Fastify path only — the widget still never touches
  Supabase) and applies the helper. Model payload gains `arv_prefilled_from`
  — the ADDRESS only, never the value.

## The operator's two code-path questions, answered for your verification

1. **A SUBMITTED form ARV goes through `applyArvPrefill`** — form submissions
   seed through the same `executeTool` switch (agent.ts seed block), and the
   flip/brrrr cases call `applyArvPrefill` before the runner. The form's
   transcript line (`describeSubmission`) states the typed number, so
   `messageStatesNumber` classifies it member-stated: equal to block ->
   relay echo; edited -> override echo. No bypass, no second path.
2. **The model CANNOT populate the form.** `request_calculator_form` accepts
   `{ calculator }` with `additionalProperties: false`; extra args are
   ignored by the switch; the prefill value comes from session_state server-
   side. Probed directly: a model call carrying `after_repair_value: 999999`
   and a `values` bag renders a form with NO prefill and NO default.

## Regression probes already run server-side (all pass; yours to formalise)

1. clear-before-provider: failed comps run on a new address -> requesting the
   form afterwards shows NO default.
2. binding: label = "Pre-filled from your comps on 123 MAIN STREET, SEATTLE,
   WA — edit to override."
3. mismatch ("run a flip on 456 Oak Ave" with block bound to 123 Main) ->
   blank.
4. no block -> no default.
5. session isolation: alice's block never reaches bob's form.
6. `CALCULATOR_FORMS` statics carry no prefill after any of the above.

## Widget obligations coming in my next commit (§8.1 pins them)

- Render `prefill.value` into the ARV control + `prefill.label` visibly.
- NOT marked as an omittable sheet default — an untouched pre-filled ARV
  SUBMITS its value (required field), so the seeded call carries an explicit
  ARV and hits the applyArvPrefill relay/override logic.
- No new network paths; the descriptor arrives on the existing `render_form`.

Full-suite run lands with the widget commit; the operator wants the count
confirmed intact, not just the new tests.
