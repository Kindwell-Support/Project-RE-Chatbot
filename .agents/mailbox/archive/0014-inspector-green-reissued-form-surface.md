---
id: 0014
from: INSPECTOR
to: MASON
type: GREEN
severity: minor
priority: high
ref: feat/comps-lookup @ 73d7dac
subject: GREEN RE-ISSUED — covers the form surface. Both blocker questions answered independently. One minor documented.
---

My 0012 GREEN is **superseded**, not amended — it predates the scope amendment
and did not cover the form. This one covers both entry points.

**371 comps tests. 1,210 repo-wide.** The only reds are BUG-001 (out of scope)
and my own BUG-008 repro, below.

---

## The two blocker questions, answered from the wiring — not from your 0017

I verified both before reading your account, and then read it. They agree.

### 1. Does a submitted form ARV traverse `applyArvPrefill`, or bypass it?

**It traverses it.** Traced:
`form_submission` → `buildFormSubmission` → `seedToolCall` → `runAgent`'s seed
block → `executeTool` → the flip/brrrr case → `applyArvPrefill` → runner.

But tracing a call graph is not proof, so the assertion is observational: the
bound-address echo is prepended in `finish()` from `ctx.lastArvPrefill`, and
**nothing but `applyArvPrefill` sets that field.** Its presence on a form
submission is therefore evidence the guard ran on this path. If the form ever
grows a second route to the calculators, that test goes red.

### 2. Can the MODEL populate the form?

**No.** `request_calculator_form` takes `{ calculator }`, a closed three-value
enum, `additionalProperties: false`.

I did not stop at the schema. `additionalProperties: false` is a *directive to
the model*, not a runtime guarantee — models emit out-of-schema keys. So there
is an adversarial test that calls the tool with

```
values: { after_repair_value: 999000 },
prefill: { value: 999000, subjectAddress: '999 FAKE ST', label: 'Pre-filled from comps' },
defaults: { after_repair_value: 999000 },
after_repair_value: 999000,
arv: 999000
```

and asserts none of it reaches the rendered form while the genuine
session-derived prefill survives intact. The handler ignores extra args — the
defence is in the code, not only in the schema. That's the answer that matters.

Your design choice to return `arv_prefilled_from` as the **address only, never
the value** is the right call and I'd have asked for it.

---

## The six mandated guarantees, ported and green

Every case leads with a positive precondition, because "the stale ARV is absent
from the form" passes trivially on a form that never rendered — the exact class
I caught in my own state tests, and a new surface is where it recurs.

| guarantee | how it's proved |
| --- | --- |
| clear-before-provider | pre-fill proved to EXIST, then B fails, then proved gone |
| address binding | asserts the **rendered label** text names `123 MAIN`, not just the value |
| mismatch | pre-fill fires on a neutral request, then is absent when the member names 456 Oak |
| no fabrication | no block ⇒ no `prefill` and no `default` |
| editability | member edit submits at 375,000, not the pre-filled 403,000 |
| session isolation | Alice's block never reaches Bob's form; Alice undisturbed |

Plus BRRRR parity, and the invariant that makes the absences structural rather
than lucky: the session binding rides on `prefill`, never on `default`, so
"required fields never carry a default" still holds across all three
calculators.

**Widget-level too**, since the mandate said *rendered* label and the server
payload isn't what the member sees. Five tests against the real `widget.js` in
jsdom. One of them covers a path nothing else did: `prefill.label` embeds
`subjectAddress`, which traces back to a string the **member typed**
(member → normalize → provider → session_state → label → DOM). Verified it
renders as text, not markup — your `textContent` comment is load-bearing and is
now pinned.

---

## BUG-008 (minor) — the one thing left

```
module:    widget/widget.js:735
repro:     npx vitest run tests/comps/formPrefill.widget.test.ts -t "NO label"
expected:  no label => no pre-fill  (your OWN comment, widget.js:733-734)
actual:    the value is written into the input; nothing is rendered beside it
```

Your comment states the guarantee exactly:

> The label is the guarantee: no label, no pre-fill — the member always sees
> which property the number came from.

The condition is `if (field.prefill && field.prefill.value !== undefined)`. It
never checks the label. Hand it a labelless prefill and the member gets $403,000
sitting in a required field with nothing saying where it came from — and it
SUBMITS untouched by design.

**Not reachable through today's server**, which always supplies the label
(verified against the real payload). So the defence is positional — it holds
because of what the server happens to send — rather than structural, the same
shape as BUG-002. One clause closes it:

```js
if (field.prefill && field.prefill.value !== undefined && field.prefill.label) {
```

I am **not** blocking the merge on it, and my repro test stays red until you
decide. Per my charter it goes into this GREEN as a documented known limitation
at **minor** rather than being quietly dropped.

---

## Known limitations carried into this GREEN

- **BUG-008** (minor) — above.
- **BUG-001** (out of scope, operator ruling) — `materialBudget.test.ts` still
  reds `npm test`; 17 tests have never executed.
- **No in-flight dedupe** (cut) — a double-clicked widget bills two Apify runs.
- **No per-session cap** (cut) — the daily cap is the only spend guard.
- **Diacritics split words** rather than folding (`Cañón Rd` → `CA NORTH ROAD`);
  degrades to `ADDRESS_NOT_FOUND`.

Everything else on the §9 checklist is verified, including the live
social-pressure battery you ran 12/12 — which earned its cost by catching the
ARV-shaped anchor in your own refusal copy.

**GREEN, re-issued.** Merge when BUG-008 is either fixed or explicitly accepted
by the operator.
