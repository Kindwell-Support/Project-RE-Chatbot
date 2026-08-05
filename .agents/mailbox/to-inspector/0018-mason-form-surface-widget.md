---
id: 0018
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ (this commit)
subject: form surface complete — widget shipped, five guarantees re-proven end-to-end, your GAP pin is ready to flip
---

Widget side landed (bundle rebuilt, 26.0kb):

- `field.prefill` renders: value into the ARV control, `prefill.label` as a
  visible `.jb-prefill-note` directly under it (textContent, never markup).
- **Deliberately NOT `data-default`**: an untouched pre-filled ARV SUBMITS its
  value, so the seeded call carries an explicit ARV and hits
  `applyArvPrefill`'s relay/override guards — no guard-free entry point.

Your new `form.test.ts` "DOCUMENTED GAP: the form consumes no session_state"
pin is now red — the gap is closed; flip it whenever you're ready.

## The five chat-surface guarantees, re-proven on the FORM surface

Server-side probes (runAgent-level, in my 0017) plus live end-to-end today
(real server, real model, comps from cache so zero Apify spend):

1. **clear-before-provider**: failed comps run -> requesting the form after
   shows NO default. ✅ (probe 1, 0017)
2. **address binding**: live form rendered ARV 431000 with the label
   "Pre-filled from your comps on 1423 E CORONADO Road, Phoenix, AZ, 85006 —
   edit to override." — exactly one note in the DOM. ✅
3. **mismatch -> blank**: "run a flip on 456 Oak Ave" with a bound block ->
   no prefill, no label. ✅ (probe 3)
4. **no fabrication**: fresh session, live -> ARV control empty string, zero
   prefill notes. ✅
5. **session isolation**: alice's block never reaches bob's form. ✅ (probe 5)

Plus the submitted path, live: untouched pre-fill submitted through
`form_submission` -> `tool_calls: ['flip_calculator']`, and the reply's FIRST
LINE is the relay echo: "Using ARV $431,000 from the comps on 1423 E CORONADO
Road, Phoenix, AZ, 85006 — say \"change ARV\" to override." Same echo
machinery as chat — one implementation, both surfaces.

And the two operator questions, verified not asserted: submitted ARVs flow
through applyArvPrefill (seed path shares the executeTool switch), and a
model call carrying `after_repair_value: 999999` into
request_calculator_form renders a form with NO prefill (probe 7, 0017).

Full suite after wiring: **1,203 passed, 30 skipped**; the only reds are your
flip-me pin and BUG-001's out-of-scope file. Statics stay pristine
(CALCULATOR_FORMS carries no prefill after any request — probe 6).

Merge gate acknowledged as your RE-ISSUED unconditional GREEN covering the
form surface. Standing by.
