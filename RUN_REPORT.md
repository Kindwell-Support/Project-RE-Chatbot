# RUN REPORT — deterministic calculator forms + calculating state

Date: 2026-07-27. Two reported bugs from real use.
Previous run's report archived at `reports/RUN_REPORT_2026-07-22_ask-james-ui-redesign.md`.

**No change to calculator math.** `src/calculators/*` is untouched. No second calculation
path was introduced: the routed form goes through the same `executeTool` switch, the same
tool runners, the same validation, and the same `qa_logs` / `chat_messages` writes as
before.

Files changed:

| File | Why |
| --- | --- |
| `src/agent/calculatorIntent.ts` | **new** — the deterministic rules |
| `src/agent/agent.ts` | pre-model routing; `formTrigger` on the result |
| `src/agent/systemPrompt.ts` | §2 rewritten to agree with the router |
| `src/server/app.ts` | comment only — corrects who decides |
| `widget/widget.js` | the calculating state (Bug 2) |
| `tests/calculatorIntent.test.ts` | **new** — 90 cases, incl. the loop test |
| `tests/calculatingState.widget.test.ts` | **new** — 17 cases |
| `tests/agent.test.ts` | one assertion made position-independent (see §9) |

---

## 1. Bug 1 — how form-triggering worked before

**Before: the model decided, every turn, at temperature 0.3.**

The only mechanism was the `request_calculator_form` tool. `runAgent` looped, the model
either emitted that tool call or it didn't, and `executeTool` set `ctx.formRequest.form`
only if it did. Path in full:

```
model chooses request_calculator_form   <-- the coin flip
  -> executeTool sets ctx.formRequest.form
  -> runAgent returns renderForm
  -> app.ts returns render_form
  -> widget renders the card
```

Nothing downstream of that first step was probabilistic — but the first step was the
whole decision. `temperature: 0.3`, evaluated fresh each turn, over a tool description and
a prompt paragraph that both said "call this when…". So identical input produced a form for
one member and prose for the next. Exactly as reported: not a hallucination, a sampling
outcome.

## 2. Where the decision lives now

**In code, in `src/agent/calculatorIntent.ts`, consulted before the model's first turn.**

`runAgent` now calls `routeCalculatorIntent(userMessage, history)` *before* the completion
loop starts. On a `form` route it executes `request_calculator_form` itself, pushes the
assistant/tool pair into the message array, and sets `formTrigger = 'router'`. `renderForm`
is therefore already set on the result object that every exit path returns, via a single
`finish()` helper.

**Can the model still choose not to show the form on a clear "run a flip"? No.**

Concretely, the three things that would have to be true for it to suppress one:

1. It would have to un-set `formRequest.form` — there is no path that clears it.
2. It would have to reach an exit that doesn't spread `formRequest.form` — all three
   returns go through `finish()`.
3. It would have to prevent the router running at all — the router runs unconditionally
   for any non-form-submission turn, before the first `chat.completions.create` call.

The test that pins this is deliberately hostile: `REFUSING_MODEL` in
`tests/calculatorIntent.test.ts` is a fake model that replies *"Sure — send me the
purchase price, rehab, ARV and holding period"* and never calls the tool. That is the bug
reproduced exactly. The form still renders, 25/25 times, and `formTrigger === 'router'`
every time.

The model retains only the *residual* path: if the rules return `none` and the model calls
`request_calculator_form` anyway (a phrasing the rules don't cover), the form still renders
and is reported as `formTrigger: 'model'`. That path can only add forms, never remove one.

## 3. The intent-detection rules

Pure function, no model call, no clock, no randomness. `detectCalculatorIntent(message)`
evaluates in this order and returns the first match:

**Step 1 — menu picks.** Whole message is a bare number: `/^[\s"'(]*([1-6])[\s"').:,-]*$/`
Tolerates `2`, `2.`, ` 3) `, `"1"`. Mapping matches the prompt's: **1 → BRRRR, 2 → Flip,
3 → Land**. 4-6 (Partnership / Construction / Material Allowance) have no form and fall
through to the model.

**Step 2 — deal numbers present → no form.** `hasDealNumbers()` is true on a `$` before a
digit, a `k`/`m`/`mm`/`million`/`thousand` suffix, any value ≥ 1000, or two or more
separate numbers. Deliberately *not* "contains a digit": `2` and `4 months` are not deal
figures. This is what keeps `Flip: 350k purchase, 75k rehab, 600k ARV, 4 months`
calculating directly.

**Step 3 — a named calculator plus a signal.** Names (case-insensitive, word-bounded,
tolerant of any surrounding words):

| Calculator | Matches |
| --- | --- |
| `brrrr` | `b\s*r{3,}` (BRRR, BRRRR, BRRRRR), `buy rehab rent(al)` |
| `flip` | `flip`, `flips`, `fix and flip`, `fix & flip`, `fix n flip` |
| `land_purchase` | `land`, `new construction`, `new build`, `ground up`, `spec home/house/build` |

A name alone is not enough — a *signal* aimed at it is required, any one of:

- the message is **only** the name plus filler (`flip`, `BRRRR`, `the flip one please`);
- `"<name> calculator"` / `"<name> calc"`;
- the name plus the word `calculator` / `calc` anywhere;
- an **action** within 40 chars before the name, stopped at sentence boundaries:
  `run · rerun · re-run · use · using · do · open · start · launch · pull up · fire up ·
  price out · analyz* · underwrit* · evaluat* · calculat* · model · crunch · i want ·
  i need · i wanna · i'd like · let's · lets · can you · could you · help me · show me ·
  walk me through`

Two different calculators named at once → `ask_which_calculator`, not a guess.

**Step 4 — ambiguous intent.** An action verb (`analyz* · underwrit* · run · rerun ·
evaluat* · review · look at · go over · price out · crunch · model · check`) within 30
chars of a deal noun (`deal(s) · numbers · property · project · purchase · acquisition`),
with no calculator named → `ask_which_calculator`. Also fires on the bare word `calculator`
with no calculator named.

**Question guard.** A message opening with `what · why · how · when · where · who · which ·
whose · does · did · do you · is · are · was · were · explain · tell me · any advice/
thoughts` is treated as conversation, **unless** it also carries `calculator · calc · run ·
rerun · use · using`. So `what do you think about my flip?` gets an answer, and `how do I
run a flip on this one` gets the form.

**Two history-aware suppressions** in `routeCalculatorIntent` — both can only turn a route
*off*, never change which calculator fires, so the guarantee in §2 never depends on
history:

- *carry-forward* (only when history is non-empty): `same · those · these · that deal ·
  this deal · as before · already · earlier · previously · keep the · carry it/them/that
  over/forward · numbers i gave/sent/typed/already` → `none`. This is what stops "same deal
  but 4 months" being fronted with an empty form.
- *"which calculator?" already answered*: if any prior turn mentions a calculator, an
  `ask_which_calculator` route degrades to `none` and the model uses the history it has.

Every route carries a `rule` string naming which clause fired, so a bad route is
diagnosable without a debugger.

## 4. The loop test, verbatim

`ITERATIONS = 25`. Full output of
`npx vitest run tests/calculatorIntent.test.ts --reporter=verbose -t "6.2"`:

```
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "run a flip" routes to the flip form
on all 25 runs 5ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "run a flip" -> flip form on all 25
runs 0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "I want to run a flip" -> flip form
on all 25 runs 0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "2" -> flip form on all 25 runs 0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "BRRRR" -> brrrr form on all 25 runs
0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "I want to do a BRRRR" -> brrrr form
on all 25 runs 1ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > "analyze a land deal" ->
land_purchase form on all 25 runs 2ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > runAgent renders the form all 25
times even when the model never asks for one 6ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > the model declining the tool cannot
suppress the BRRRR or land form either 1ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > the routed form carries the real
derived field set the widget needs 0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > the model is told the form is already
up, and is not handed the defaults 0ms
 ✓ tests/calculatorIntent.test.ts > 6.2 the form fires every time, not usually > the system prompt agrees with the
router (backup, not mechanism) 0ms

 Test Files  1 passed (1)
      Tests  12 passed | 78 skipped (90)
```

The loop assertions are `expect(outcomes).toEqual(new Array(25).fill('flip'))` and
`expect([...new Set(outcomes)]).toEqual([calculator])` — no tolerance, no "mostly".

A separate 1000-iteration run of `detectCalculatorIntent('run a flip')` outside the suite:

```
--- loop proof: "run a flip" x 1000 ---
distinct outcomes over 1000 runs: flip
```

### Mutation check — the test genuinely fails if determinism regresses

Reverting the router to model-only discretion (`const route = { kind: 'none' }`, leaving
everything else including the prompt in place) and re-running the file:

```
 ❯ tests/calculatorIntent.test.ts (90 tests | 9 failed) 157ms
     × runAgent renders the form all 25 times even when the model never asks for one
     × the model declining the tool cannot suppress the BRRRR or land form either
     × the routed form carries the real derived field set the widget needs
     × the model is told the form is already up, and is not handed the defaults
     × turn 1 asks and shows no form; turn 2 names it and the form fires
     × POST run a flip -> render_form flip, with the model refusing
     × POST I want to do a BRRRR -> render_form brrrr, with the model refusing
     × POST analyze a land deal -> render_form land_purchase, with the model refusing
     × POST 2 -> render_form flip, with the model refusing
```

The router was restored immediately after; the file on disk is the working version.

Worth being precise about which tests are mutation-sensitive: the two pure loop tests
(6.2's first two) still pass under that mutation, because `detectCalculatorIntent` itself
still exists — they pin the *rules*. The mutation-sensitive ones are the `runAgent` and
`/chat` loop tests, because their fake model never asks for a form, so the router is the
only possible source of `renderForm`. Those are the tests that pin the *guarantee*.

## 5. The prompt is now the backup

`systemPrompt.ts` §2 was rewritten so the model-driven paths agree with the coded one:
"CALCULATOR INTENT WITHOUT NUMBERS ALWAYS GETS THE FORM… This is not a judgment call: the
router renders that form in code before you see the turn, so it is already on screen." It
also tells the model to call `request_calculator_form` itself if the form somehow is not
up, and adds the ambiguous-case instruction.

For the ambiguous case the *route* is decided in code, and a turn-scoped system directive
(`ROUTING (this turn): …`) is injected so the ask is reliable while the wording stays in
James's voice. The step the brief cares about — naming the calculator in the reply — is
fully deterministic: `flip`, `BRRRR`, `land`, `the flip one`, and `2` all fire the form by
rule on the next turn, tested with the model still refusing.

A test asserts the prompt text still carries the rule, so prompt and code can't drift apart
silently. **The prompt is not what makes forms appear.** Deleting the whole §2 paragraph
would not stop a single case in §4 from passing.

---

## 6. Bug 2 — how the calculating state is wired

Before: `submitCalculatorForm` called `setBusy(true)`, which only disabled the *composer's*
send button — a control nowhere near the member's eye. The Calculate button stayed live and
unchanged. Worse, the one gesture toward a thinking state was
`removeTyping = addTyping(); removeTyping();` — created and destroyed on the same line, so
it painted nothing. Hence a completely dead gap.

**It reuses the app's existing motion language rather than adding a standalone spinner.**
Three layers, all already in the design system:

1. **The room warms.** `root.classList.add('jb-busy')` — the same class the typed-message
   thinking indicator sets, which quickens the three ambient amber orbs and raises their
   saturation (`.jb-root.jb-busy .jb-orb`, unchanged from the UI work).
2. **The button acknowledges instantly.** Set **synchronously inside the click handler**,
   before any network call: `disabled`, `aria-busy="true"`, label → `Calculating…`, plus a
   13px amber-on-near-black `.jb-spin` ring. Inputs and Cancel disable too
   (`data-busy="true"` on the card). There is no frame in which the member has clicked and
   nothing has changed.
3. **A skeleton of the result card** stands where the answer will land — a glass card
   (`.jb-pending .jb-glass`, `role="status"`) carrying the **amber left edge**
   (`border-left:2px solid var(--jb-accent)` + clipped top-left radius) that is the app's
   existing "James is producing this" mark on `.jb-think` and every bot bubble. Inside:
   the existing `.jb-think-dots` amber triplet, the label `Calculating…`, and three bars
   whose widths trace the shape of a result — a 26px lead figure (amber-tinted) then two
   supporting lines. The shimmer is an amber sweep (`rgba(247,178,17,0.34)`, stronger on
   the lead bar), not a grey shimmer. Tokens only: `#F7B211` via `--jb-accent`, near-black
   via `--jb-bg-base`. (The amber edge and the bar contrast were raised after looking at
   the real thing in a browser — see §10.)

When the answer lands the skeleton is removed and the answer goes through the *unchanged*
`addBubble(..., { animate: true })` — same `jb-in` entry animation, same lead-figure
count-up. The result transitions in straight out of the skeleton.

**Click-once.** A `submitting` flag is set synchronously in the handler, so the second event
of a double-click returns before the first `fetch` is even dispatched. `disabled` is the
visible half of the same guarantee. Verified for a 2-click and a 5-click burst: one
submission, one open request.

**Errors always resolve the state.** A single `settle()` helper runs at most once and is
called on every path — success, 400, non-2xx, network rejection, non-JSON body, and
timeout. It clears the timer, removes the skeleton, drops `jb-busy`, re-enables the form,
and writes the message. Copy: `Couldn't reach the calculator — try Calculate again in a few
seconds.` for network/5xx; the server's own field-level text for a 400; `That took too long
to come back. Try Calculate again.` on timeout. `fetch` has no timeout of its own, so a 90s
`AbortController` bound was added specifically so there is no branch that spins forever; a
late response arriving after a timeout is ignored rather than double-rendered.

**`prefers-reduced-motion`.** Checked at build time in JS, not just CSS: the spinner node
and the animated dots are **not created at all**. The state is the static text
`Calculating…` on both the button and the placeholder card. CSS belt-and-braces:
`.jb-bar::after,.jb-spin{animation:none!important;}` plus `display:none` on the sweep. A
companion test asserts the motion path *does* build the spinner, so the reduced-motion test
is a real difference rather than a vacuous pass.

`public/widget.js` rebuilt: 25.6 kb.

---

## 7. MUST NOT BREAK — confirmed

| Item | Status | Evidence |
| --- | --- | --- |
| `Flip: 350k purchase, 75k rehab, 600k ARV, 4 months` → **$101,916** | ✅ | direct run: `A net profit: 101916`; and `6.3` routes it to no form, model calls `flip_calculator`, tool result asserted `≈101916` |
| A second, different flip returns a **different** number | ✅ | 300k/50k/550k/6mo → **$127,626**, `distinct: true`. `invariants.test.ts` (393 cases) green |
| Form submissions use the **same** tool/validation/logging path | ✅ | `calculatorForms.test.ts` 4.2/4.6 unchanged and green: same `runFlipTool`, `toEqual(typed)`, `chat_messages` + `qa_logs` both written. Router is skipped entirely for `seedToolCall` turns, and `6.5` asserts a submission is not re-routed into another form |
| Disclaimers + defaults disclosure | ✅ | `defaults_applied` unchanged (17 keys on flip); prompt §2/§6 disclosure rules intact; the widget's static opening disclaimer untouched (`widget.test.ts`, 27 cases, green) |
| Negative-cash-left CoC caveat | ✅ | `quirks.test.ts` green (12 cases) — IFERROR semantics, `cash_on_cash_return` 0 / `n/a` fallbacks. No calculator file was touched |
| Existing test suite green | ⚠️ | 839 passed, 0 failed, 18 skipped. **One pre-existing suite-load failure remains, unrelated to this work** — see §9 |

Also unchanged: `render_form` transport shape, the widget's form renderer (still purely
descriptor-driven), no browser-storage writes added (`5.3` still asserts the only `setItem`
key is `james-bot-session`). `npm run typecheck` clean.

## 8. Test counts

Whole suite, `npm test`:

| | Count |
| --- | --- |
| Distinct test cases executed | **857** |
| Pass | **839** |
| Fail | **0** |
| Skip | **18** (all `live.test.ts`, gated on `RUN_LIVE_TESTS=1` — unchanged) |
| Suites failing to load | **1** (`materialBudget.test.ts`, pre-existing — §9) |

New this run:

| File | Cases executed | `it`/`it.each` declarations | `expect()` call sites |
| --- | --- | --- | --- |
| `tests/calculatorIntent.test.ts` | 90 | 28 | 50 |
| `tests/calculatingState.widget.test.ts` | 17 | 17 | 63 |
| **Total** | **107** | **45** | **113** |

(Case count exceeds declarations because most Bug-1 tests are `it.each` tables; each row is
an independently reported case, so a single bad phrasing fails on its own line.)

Every test named in the brief was written. Mapping:

| Brief's test | Where |
| --- | --- |
| "run a flip" fires on every run, 10+ iterations | `6.2` — 25 iterations, pure and through `runAgent` |
| "2", "BRRRR", "I want to do a BRRRR" → BRRRR form | `6.1`, `6.2`, `6.5` |
| "analyze a land deal" → land form | `6.1`, `6.2`, `6.5` |
| Full NL deal calculates, no forced form | `6.1` (4 phrasings), `6.3` |
| "analyze a deal" asks, then naming fires the form | `6.4` |
| Code-level, no model call | `6.1`/`6.2` pure-function tests; `6.2`/`6.5` add the model-refusing integration proof |
| Loading state shown immediately | `7.1` — asserted with the request held open |
| Double-click fires one calculation | `7.2` (2-click and 5-click) |
| Simulated error resolves + re-enables | `7.3` (network, 5xx, 400, timeout, late response) |
| `prefers-reduced-motion` static state | `7.4` |
| Mutation-check the loop test | §4 above |

**Not written (deliberate, one item):** no end-to-end browser test drives the real server
plus the real widget together. The seam is covered from both sides — `6.5` asserts the
server emits `render_form` over HTTP, and `calculatorForm.widget.test.ts` feeds the widget
the *real* `CALCULATOR_FORMS` descriptor rather than a fixture — but nothing exercises one
process end to end. That needs a browser harness the repo doesn't have.

## 9. What I couldn't do

**`tests/materialBudget.test.ts` fails to load, before and after this change.** It is a
pre-existing, unrelated failure and I left it alone rather than widen scope into the
ingestion tooling.

Diagnosis: the test imports `tools/ingest_material_budget.mjs`, whose line 1 is the shebang
`#!/usr/bin/env node`. Node strips shebangs in ESM; vitest 4.1.10's transform does not, so
it reports `SyntaxError: Invalid or unexpected token` and the suite loads zero tests.
Confirmed as the cause: `node -e "import('./tools/ingest_material_budget.mjs')"` succeeds
and lists all five exports, while a two-line vitest file importing the same path fails
identically. The file is unmodified from `ed61772` and is valid UTF-8 (checked byte by byte).

Two one-line remedies, your call: drop the shebang (the documented invocation is
`node tools/ingest_material_budget.mjs …`, so nothing depends on it), or move the four pure
helpers into a `.ts` module the script imports. **51 assertions across ~10 cases are
currently not running** as a result — worth fixing, but it belongs to the material-budget
work, not to these two bugs.

**One existing assertion changed** — `tests/agent.test.ts:287`. It read "the first tool
message in the conversation", which happened to be the `flip_calculator` error. Its user
message is `run a flip`, which the router now legitimately answers with a form, so that
conversation carries two tool results. The fix locates the result by `tool_call_id === 'c1'`
instead of by position, and adds a `toBeDefined()` guard. The assertions about the payload
itself (`/holding_months/`, `/do not invent numbers/i`, no `outputs` key) are byte-for-byte
unchanged — the test was made position-independent, not weakened.

**Nothing else was blocked.** §10 records the live run against the real server.

---

## 10. Live verification on localhost

Run with the real `.env` (`npm run dev`, `http://127.0.0.1:3000`), real OpenAI, real
Supabase, and the real widget driven in headless Chromium via Playwright. 99 × HTTP 200,
4 × 502 (all four OpenAI `Request timed out` from hammering the API back-to-back, not
routing).

### Bug 1, against the live model

`"run a flip"` × 10, a fresh `session_id` each time so history cannot help:

```
run 1: render_form=flip   tools=['request_calculator_form']
run 2: render_form=flip   tools=['request_calculator_form']
run 3: render_form=flip   tools=['request_calculator_form']
run 4: render_form=flip   tools=['request_calculator_form']
run 5: render_form=flip   tools=['request_calculator_form']
run 6: render_form=flip   tools=['request_calculator_form']
run 7: render_form=flip   tools=['request_calculator_form']
run 8: render_form=flip   tools=['request_calculator_form']
run 9: render_form=flip   tools=['request_calculator_form']
run 10: render_form=flip  tools=['request_calculator_form']
```

Other intents, one live call each — all correct first time:

| Message | `render_form` |
| --- | --- |
| `2` | `flip` |
| `BRRRR` | `brrrr` |
| `I want to do a BRRRR` | `brrrr` |
| `analyze a land deal` | `land_purchase` |
| `let's do a land purchase` | `land_purchase` |

Ambiguous path, two turns in one session: `I want to analyze a deal` → no form, and *"Which
type of deal are you looking to analyze — a flip, a BRRRR, or a land/new construction
project?"*; then `flip` → `render_form=flip`. Conversation guard: `my flip is stalling, any
advice` → no form, real advice.

MUST NOT BREAK, live: `Flip: 350k purchase, 75k rehab, 600k ARV, 4 months` → no form,
`tool_calls=['flip_calculator']`, **Estimated Net Profit: $101,916**, cash out of pocket
$101,104, CoC 100.8%, defaults disclosed, disclaimer present. A second, different flip
(300k / 50k / 550k / 6mo) → **$127,626**, verified on 6 clean two-turn sessions.

### Bug 2, in a real browser on `/demo`

Filled the flip form, clicked Calculate, and read the DOM on the very next frame — the
request still open:

```
{ buttonDisabled: true, buttonAriaBusy: "true", buttonLabel: "Calculating…",
  spinnerBuilt: true, pendingCardShown: true, pendingLabel: "Calculating…",
  skeletonBars: 3, animatedDots: true, inputsLocked: true,
  cancelDisabled: true, rootBusy: true }
```

Result: skeleton removed, form dismissed, `jb-busy` cleared, and the count-up caught
mid-flight at `$337,031` settling to `$101,916` — the pre-existing guarantee that the final
value is restored verbatim, working on the form path.

Reduced motion (`reducedMotion: 'reduce'`): identical state, but `spinnerBuilt: false` and
`animatedDots: false` — the label alone carries it, and the skeleton holds still.

Simulated failure (`route.abort('connectionfailed')` on the submission only):

```
{ error: "Couldn't reach the calculator — try Calculate again in a few seconds.",
  spinnerStillThere: false, buttonDisabled: false, buttonLabel: "Calculate",
  inputsLocked: false, cancelDisabled: false, formStillUp: true,
  valuesKept: "350000", rootBusy: false }
```

Double-click: three rapid forced clicks → **1** calculation fired, still 1 after the result
landed.

### One design change came out of looking at it

The first screenshot appeared to show the skeleton as nearly invisible. That read was
**wrong** — the shot was taken milliseconds after the click, so it caught `jb-card-in`
mid-fade from `opacity:0`. Measured settled it was `opacity: 0.999963` and fully inside the
scroll viewport (`distanceFromBottom: 0`).

The change it prompted stands on its own merits though: the card originally had no amber
left edge, while `.jb-think` — the app's existing thinking state — does. Adding it (plus
raising the bar fill `0.06 → 0.11`, an amber tint on the lead bar, and the sweep
`0.20 → 0.34`) is what the brief asked for: the same treatment, not a parallel one. Suite
re-run after the CSS change: still 839 passing.

### Two operational notes, neither caused by this work

1. **`[migrate] chat_messages table not found` at boot is a false negative here.** The
   table exists — `GET /history` returns rows and `appendExchange` writes land. The check
   is a one-shot `.select('id').limit(0)` that happened to hit the same transient failure
   as (2).
2. **~10% of Supabase reads failed on this machine:** 5 of ~50 turns logged
   `chat_messages history load failed — continuing with EMPTY history`, every one with
   `TypeError: fetch failed`. The code handles it exactly as designed (warn loudly, carry
   on with empty history), but on those turns the bot loses conversation memory. Looks like
   local network flakiness rather than Supabase itself; worth watching in production, where
   it would show up as James forgetting a deal mid-conversation.

### Cosmetic nit spotted in the transcript echo

The form-submission line reads `holding months 4 months` — `describeSubmission` appends the
`months` unit to a label that already ends in "months". Pre-existing, cosmetic, in
`formSubmission.ts`; left alone as out of scope.

---

## 11. One behavioural trade-off worth knowing about

The rules lean toward firing: a false
positive costs one Cancel click, a false negative is the reported bug. Known
over-triggering: `why did the flip calculator give that?` contains both a calculator name
and the word "calculator", so it renders a form alongside the answer. I judged that
acceptable versus tightening the rules to the point clear intent starts slipping through.
Nine ordinary-conversation phrasings are pinned as *not* triggering in `6.1`, including
`my flip is stalling, any advice`, `what do you think about my flip`, and `why is the
cash-on-cash so low` — the ones that would actually annoy a member mid-conversation.
