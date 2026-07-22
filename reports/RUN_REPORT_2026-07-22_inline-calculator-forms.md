# RUN REPORT — Inline calculator input forms in the chat

Date: 2026-07-22. All output pasted verbatim from the runners.
Previous run's report archived at `reports/RUN_REPORT_2026-07-15_architecture-context.md`.

Feature: when a member signals which calculator they want but hasn't given the numbers,
the bot renders that calculator's input fields inline in the chat. Filling them in and
hitting **Calculate** runs the **same tool** the natural-language path runs.

Calculator math was not touched. Natural language still works unchanged.

---

## 1. Mechanism chosen: model-driven tool (`request_calculator_form`)

**Chosen: the model-driven route**, with the response carrying the descriptor. In practice
it is both of the options in the brief, each doing the job it is actually good at:

| Concern | Handled by | Why |
|---|---|---|
| *Which* calculator, and *whether* a form is warranted at all | `request_calculator_form` tool | Intent detection stays in one place |
| Getting the field descriptor to the browser | `render_form` on the `/chat` response | Transport, not a second decision point |

Reasons for putting the decision in the model rather than in response metadata:

1. **The routing already exists and already works.** The system prompt has routed
   flip vs BRRRR vs land — including bare menu numbers and "anything mentioning
   rent/refinance" — since before this change, and `tests/agent.test.ts` pins it. A
   metadata-side detector would be a *second* intent classifier that could disagree with
   the model about the same sentence. Two classifiers, one question, is how they drift.
2. **The hard case is "numbers or no numbers", not "flip or BRRRR".** "Run a flip"
   gets a form; "Flip: 350k purchase, 75k rehab, 600k ARV, 4 months" must calculate
   immediately and *not* interrupt with an empty form. The model already holds the
   conversation, so it is the only thing that can tell those apart reliably — especially
   across turns, where the numbers arrived two messages ago.
3. **It degrades to today's behaviour.** If the model doesn't call the tool, the member
   gets the prose flow that shipped before. No new failure mode where the form is the
   only way through.

The tool returns field *labels* to the model but deliberately **not** the default values,
so the model can't recite "12% interest" as though the member chose it. Pinned by a test
asserting `0.12` never appears in the tool result the model sees.

---

## 2. How the fields derive from the calculator schemas

**Single source: `TOOL_DEFINITIONS` in `src/agent/toolDefs.ts`** — the same array handed
to OpenAI as the function schema. `src/agent/formSchema.ts` reads it and joins on the
existing `*_DEFAULTS` objects. It contains **no field list of its own**:

```
src/agent/toolDefs.ts          TOOL_DEFINITIONS
  ├─ properties  ──────────────► field names, types, enums
  └─ required[]  ──────────────► required vs optional split
                                      │
src/calculators/flip.ts        FLIP_DEFAULTS     │
src/calculators/brrrr.ts       BRRRR_DEFAULTS  ──┤ join by key
src/calculators/land.ts        LAND_DEFAULTS     │
                                      ▼
                        src/agent/formSchema.ts
                            CALCULATOR_FORMS      ← derived, no hand-written fields
                                      ▼
                    /chat response  →  render_form  →  widget renders
```

The whole per-calculator wiring in `formSchema.ts` is this — a tool name, a title, and
which defaults object to join against. No fields:

```ts
const CALCULATORS = {
  flip:  { tool: 'flip_calculator',  title: 'Fix & Flip', defaults: FLIP_DEFAULTS },
  brrrr: { tool: 'brrrr_calculator', title: 'BRRRR',      defaults: BRRRR_DEFAULTS },
  land_purchase: { tool: 'land_purchase_calculator', title: 'Land / New Construction',
                   defaults: LAND_DEFAULTS },
};
```

Labels, units and control types are inferred from what the schema already says
(`"in dollars"` → `$`, `"as a decimal"` → decimal, `enum` → `<select>`), so they follow a
renamed or retyped field automatically.

**Note on scope:** the field set is intentionally narrower than the defaults objects.
`FLIP_DEFAULTS` has 17 keys; the flip tool schema exposes 10. The schema is the contract
for what a caller may set, so the schema is what the form shows. The other 7 stay
server-side defaults, exactly as on the typed path.

### Derived output, verbatim

```
=== flip (Fix & Flip) -> flip_calculator ===
  REQUIRED: purchase_price[usd], rehab_budget[usd], after_repair_value[usd], holding_months[months]
  OPTIONAL: interest_reserve="No"{Yes|No}, include_second_loan="No"{Yes|No}, down_payment_pct=0.2, interest_rate=0.12, annual_taxes=3000, annual_insurance=1200
=== brrrr (BRRRR) -> brrrr_calculator ===
  REQUIRED: purchase_price[usd], rehab_budget[usd], after_repair_value[usd], monthly_rent[usd]
  OPTIONAL: holding_months=4, refinance_method="LTV"{LTV|DSCR}, refinance_ltarv=0.75, refinance_interest_rate=0.075, min_dscr=1.2, annual_taxes=3000, annual_insurance=1200, annual_repairs=1650, annual_utilities=0, property_mgmt_pct=0.08, vacancy_pct=0.05
=== land_purchase (Land / New Construction) -> land_purchase_calculator ===
  REQUIRED: construction_sf[sf], price_per_sf[usd], new_construction_value[usd], project_duration_months[months]
  OPTIONAL: construction_interest_rate=0.09, target_assignment_fee=100000, target_investor_return=0.25, selling_costs_pct=0.1
```

This matches the brief's field sets exactly, on all three calculators, without those
lists being typed anywhere in the code.

### Proof it is derived, not duplicated

The schema tests assert **set equality** between each form's fields and its tool schema's
properties — in both directions, so neither an invented field nor a dropped one survives.
The test `a field added to a tool schema surfaces in the form automatically` goes further:
it injects a new property into the live schema at runtime and asserts the rebuilt form
grows it, with a correct derived label and unit, then removes it.

---

## 3. Verbatim proof: form submit == natural language

Same inputs (350k / 75k / 600k / 4mo) through both paths, printed from the real modules:

```
--- NATURAL LANGUAGE PATH ---
args: {"purchase_price":350000,"rehab_budget":75000,"after_repair_value":600000,"holding_months":4}
est_net_profit: 101916
--- FORM PATH ---
tool: flip_calculator
args: {"purchase_price":350000,"rehab_budget":75000,"after_repair_value":600000,"holding_months":4}
est_net_profit: 101916
--- COMPARISON ---
JSON identical: true
defaults_applied: {"annual_taxes":3000,"re_sales_costs_pct":0.06,"down_payment_pct":0.2,"origination_points_pct":0.02,"interest_rate":0.12,"interest_reserve":"No","annual_insurance":1200,"excise_tax_pct":0.0178,"include_second_loan":"No","second_loan_points_pct":0.03,"second_loan_interest_rate":0.12,"monthly_utilities":200,"loan_fees":800,"second_loan_fees":500,"acquisition_closing_costs":1500,"other_closing_costs":1200,"staging":0}
```

`JSON identical: true` is the whole claim: the form path's tool-result object is
byte-for-byte the typed path's. **$101,916 on both.** `defaults_applied` is populated,
so the disclosure behaviour is intact.

### Scope of "byte-identical" — read this

The equality holds at the **calculator result** level, and that is the strongest claim
that can honestly be made. The final chat *prose* is written by GPT-4o at temperature
0.3 and is not deterministic on either path — two identical typed messages don't produce
identical prose today either. So the assertion is pinned where determinism actually
exists: same tool, same args, same result object. The test asserts
`expect(viaForm).toEqual(typed)` on the full object, not just the profit number.

### Why it cannot diverge structurally

A form submission does **not** get its own endpoint. `/chat` converts it to tool
arguments and seeds them into the same agent loop:

```
POST /chat { form_submission: { calculator, values } }
   └─ buildFormSubmission()   validate + coerce   (schema-derived)
        └─ runAgent(..., { seedToolCall })
             └─ executeTool('flip_calculator', args)   ← the same switch a model call hits
                  └─ runFlipTool()  → assertRequired → calculateFlip
             └─ model writes the prose around the real tool result
   └─ appendExchange()  (memory)   └─ logExchange()  (qa_logs)
```

An HTTP test asserts that a form submission produces `tool_calls: ['flip_calculator']`,
that the tool result fed to the model contains 101916, and that both the `chat_messages`
and `qa_logs` writes happened — the same writes the typed path makes.

---

## 4. Verbatim proof: natural language still works unchanged

From the full suite — the pre-existing agent tests, untouched:

```
 ✓ tests/agent.test.ts
   ✓ 3.2 tool arguments survive the handoff into the calculator
     ✓ F2 numbers reach the calculator and 101916 comes back — not the 148466 default
```

And asserted again inside the new suite, both server-side and in the browser:

- `a full natural-language deal still calculates directly — no form` — a complete typed
  deal calls `flip_calculator`, returns 101916, and `renderForm` is `undefined`. The form
  never interrupts a member who already gave the numbers.
- `a plain typed message is unaffected — no render_form, no user_message`.
- `typing a message still works while a form is on screen` — with a rendered form in
  the thread, a typed deal still posts `{ message: "Flip: 350k purchase, ..." }` with **no**
  `form_submission`, and 101,916 lands in the transcript.

Whole-suite before/after, verbatim:

```
BEFORE:  Test Files  1 failed | 11 passed (12)
             Tests  682 passed | 18 skipped (700)

AFTER:   Test Files  1 failed | 13 passed (14)
             Tests  732 passed | 18 skipped (750)
```

Every previously-passing test still passes. The one failing file is pre-existing and
unrelated — see §7.

---

## 5. Test counts

| | Distinct tests | `expect()` assertions |
|---|---|---|
| `tests/calculatorForms.test.ts` (server/agent) | 27 declared → **37 executed** (`it.each` expands) | 74 |
| `tests/calculatorForm.widget.test.ts` (jsdom) | 13 | 39 |
| **New total** | **50 executed** | **113** |

Four states:

| State | Count | Detail |
|---|---|---|
| **Pass** | 50 | All new tests. Full suite: 732 passed. |
| **Fail** | 0 new | 1 pre-existing suite fails to load (§7) — not this feature |
| **Skip** | 0 new | 18 skipped suite-wide, all pre-existing `live.test.ts` (needs `RUN_LIVE_TESTS=1` + real keys) |
| **Not written** | 3 | Listed in §6 |

Coverage against the brief's requested tests:

| Required test | State |
|---|---|
| Fields derived from schema, not a hardcoded list (set equality + runtime field injection) | pass |
| Flip form 350/75/600/4 → $101,916, equal to NL path (`toEqual` on the whole object) | pass |
| Blank required rejected, never silently defaulted | pass |
| Untouched optionals use + disclose defaults | pass |
| Intent: "run a flip" → flip form; "BRRRR calculator" → BRRRR form | pass |
| Full NL deal calculates without a form | pass |

---

## 6. Not written / not completed

1. **No live end-to-end run against real OpenAI + Supabase.** `.env` credentials were
   placeholders when this work started (`sk-...`, `your-project.supabase.co`), and once
   real keys appeared I did not spend the account's API budget without being asked. Every
   layer is proven with the repo's existing fake-at-the-boundary harness — the real agent
   loop, router and calculators execute — but a genuine GPT-4o round trip has **not** been
   observed for this feature. Worth one manual pass on `/demo` before shipping.
2. **Intent detection is asserted against a scripted model, not a real one.** The tests
   prove that *when* the model calls `request_calculator_form('flip')` the right form is
   built and returned. They do **not** prove GPT-4o actually chooses to call it for the
   sentence "I want to run a flip" — that is prompt behaviour, and only a live run can
   confirm it. The prompt instruction is in place; treat it as unverified.
3. **No visual/browser check.** jsdom asserts structure, not that the card looks right at
   320px or that focus order is sane. `/demo` rendered and served the new 13.2kb bundle
   (verified 200 + byte count), but no human has looked at it.

### One deliberate design call worth flagging

Decimal fields (`interest_rate`, `refinance_ltarv`, `vacancy_pct`, …) are entered **as
decimals** — `0.12`, not `12%`. The UI labels them `(decimal, e.g. 0.12)` rather than
converting. A percent↔decimal conversion in the widget is a silent 100× error on a
financial figure if it's ever applied in the wrong direction or to the wrong field, and
these fields are behind "advanced options" where the audience is already comfortable with
the sheet's own convention. Stating the expected form beats converting it. Easy to revisit
if members trip on it.

---

## 7. Pre-existing failure, untouched

`tests/materialBudget.test.ts` fails to parse — 17 tests never run:

```
 FAIL  tests/materialBudget.test.ts [ tests/materialBudget.test.ts ]
SyntaxError: Invalid or unexpected token
```

Cause: `tools/ingest_material_budget.mjs` line 1 is `#!/usr/bin/env node`. Node strips
shebangs natively (the script itself runs fine), but Vite's transform passes them through
to V8. Unrelated to this feature, present before it, and left as found — a one-line fix
was made and then reverted earlier at your request, so I have not re-applied it.

Also unfixed and unrelated: `npm run build` fails on Windows (`mkdir -p`/`cp` in the build
script don't exist in cmd.exe). `npm run build:widget` and `tsc` both work; only the
`dist/data` copy step breaks. Same story — fixed, then reverted on request.

---

## 8. Files changed

| File | Change |
|---|---|
| `src/agent/formSchema.ts` | **new** — derives form descriptors from `TOOL_DEFINITIONS` + `*_DEFAULTS` |
| `src/agent/formSubmission.ts` | **new** — validates/coerces form values into tool args |
| `src/agent/toolDefs.ts` | added `request_calculator_form` tool |
| `src/agent/agent.ts` | handles the new tool; `seedToolCall` runs a form submission through the same `executeTool`; `renderForm` on the result |
| `src/agent/systemPrompt.ts` | step 2 rewritten: render the form for bare intent, run directly when numbers are present |
| `src/server/app.ts` | `/chat` accepts `form_submission`, returns `render_form` + `user_message` |
| `widget/widget.js` | renders the form, advanced-options toggle, Calculate/Cancel, inline validation |
| `tests/calculatorForms.test.ts` | **new** — 37 tests |
| `tests/calculatorForm.widget.test.ts` | **new** — 13 tests |
| `public/widget.js` | rebuilt (8.0kb → 13.2kb) |

No calculator file (`src/calculators/*`) was modified. No test was weakened or deleted.
