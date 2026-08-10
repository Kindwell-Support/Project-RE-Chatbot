# BUGS — INSPECTOR's running log

Newest first. A bug leaves this list only after the original repro has been
re-run and confirmed fixed, not when MASON says it's fixed.

Status: `OPEN` · `FIXED-UNVERIFIED` (MASON claims fixed, I haven't re-run) ·
`CLOSED` (repro re-run, passes) · `WONTFIX` (accepted as a known limitation,
carried into the GREEN message with its severity).

---

## FINDING-006 — a literal U+0008 inside a regex literal, and the class behind it

- **Status**: CLOSED (repaired + swept)
- **Severity**: high as a CLASS — one instance was loud, the other was silent

`format.test.ts` carried **five** U+0008 (backspace) characters across two
lines, where `\b` (word boundary) was intended. MASON found the first; the
sweep found the rest.

| line | assertion | effect |
| --- | --- | --- |
| 617 | `toMatch(/year built (19\|20)\d{2}<BS>/)` | can never match ⇒ **always FAILS** — loud |
| 631 | `not.toMatch(/<BS>style<BS>\|<BS>condition<BS>/)` | can never match ⇒ **always PASSES** — silent |

617 was the visible one and it blocked BUG-012's gate. **631 is the dangerous
one**: it is the guard on the operator's directive that style/condition must
not be rendered without a client ruling, and it was vacuous. It would not have
noticed un-approved claims about someone's house shipping to a member.

**Root cause, mine**: authoring test files through shell heredocs. `\\b` in a
heredoc reaches Python as `\b`, which Python resolves to U+0008 inside a
string literal. It compiles, it runs, it silently never matches. Fixed by
writing generator scripts with the Write tool instead of heredocs.

**Both repaired predicates were then mutation-checked** against renders that
should fail them, and the pre-repair forms proven blind to every one.

**Sweep**: 49 files under `tests/`, scanning for C0 controls, DEL, zero-width
and bidi characters. `format.test.ts` was the only carrier. Now clean.

---

## FINDING-007 — assertions that never execute (THE SIXTH SHAPE)

- **Status**: 8 fixed; 8 classified benign; 1 open coverage gap (below)
- **Severity**: high as a class — these are green tests proving nothing

Findings 1-6 each broke a different link in the same chain:

> file runs → test runs → subject is what I think → predicate is what I think → predicate discriminates

Link 2 had been checked at FILE level (dead imports) and SUITE level (skips),
never at STATEMENT level. Measured by instrumenting every `if (...)` block
containing an `expect` with a tripwire, running the suite, and reverting:
**31 guarded blocks, 56 assertions, of which 16 blocks never took their
branch.**

The eight that mattered were the wrong-house leak guards
(`if (flip?.inputs_used) { expect(...).not.toBe(403000) }`). The mismatch guard
REFUSES the call every time — correctly — so the condition was false every
time and **the leak assertion never ran once**. Those tests were passing on
their other assertion only.

The guard was never necessary: `flip?.inputs_used?.after_repair_value` is
`undefined` on a refusal, and `undefined !== 403000` passes. The unguarded form
passes on refusal AND fails on a leak, with no branch to go dead. All eight
converted.

Classified benign: `golden.test.ts` x2 (parameterized, legitimately vary),
`normalize.test.ts` (fires only on a collision — none, which is the desired
result), `agent.test.ts` / `invariants.test.ts` (conditional RULES that apply
only to a shape not currently present).

**Open**: `formPrefill.widget.test.ts:132` — `if (control?.value === '403000')`
never fires, because post-§14.8 the widget no longer pre-fills in that
scenario at all. The labelled-pre-fill path (BUG-008's guarantee) is therefore
unexercised at the widget layer. Needs re-pointing onto a MANUAL ARV, same as
the state/form suites were. Not a product defect; a coverage hole left by the
removal.

---

## BUG-012 — `year built 1,928`: the year is rendered as a quantity

- **Status**: CLOSED — fixed at `3cde09d` (a `year()` formatter; `num()`
  correctly keeps separators for sqft and lot). Verified against the build:
  the renderer emits `year built 1990` bare, `format.test.ts` 53/53.
- **My gate was broken too**, and that is the more useful half: the repro
  could not have passed against ANY fix. See FINDING-006.
- **Severity**: low mechanically, but member-visible on EVERY comp and in the
  one column that is asking to be trusted.
- **Found**: writing the §14.14 render spec.

`format.ts:129` renders the new detail line through the shared `num()` helper:

```ts
const num = (v, suffix='') => v === null || v === undefined ? NA : `${v.toLocaleString('en-US')}${suffix}`;
`  year built ${num(d?.yearBuilt ?? null)} · days on market ...`
```

`toLocaleString('en-US')` puts a thousands separator in a YEAR: **1928 renders
as `1,928`**. Correct for sqft and lot size — which is why the helper is right
to exist and wrong to reuse here.

Affects every comp built before the year 10000, i.e. all of them. It is not a
rounding nit: a year formatted as a quantity is what a member screenshots into
a rehab scope, and it makes the column look machine-generated in exactly the
place the block is asking to be believed.

Fix is a year-shaped formatter (`String(v)`), not a change to `num()` —
sqft and lot SHOULD keep their separators.

---

## BUG-011 — the ARV removal orphaned `subjectAddress`; every manual ARV binds to the literal string "manual entry"

- **Status**: CLOSED — fixed at `0b7dcab` (operator-ruled: optional `address`
  arg, current-message-only, null when unbound, guard skips null). Verified
  independently at `c8d1d3b` by the four-state battery in
  `tests/comps/manualArvBinding.test.ts` (6/6), written from the ruling text
  before reading the implementation. The never-conflict blur did NOT happen:
  a bound A still refuses B (STATE 2 control). The fix is stronger than the
  ruling required — `bindAddressToCurrentMessage` structurally verifies the
  model-supplied address against the current message, and a legacy shim
  coerces stored `'manual entry'` rows to null at read.
- **Residual, documented**: binding depends on the model PASSING the address
  argument. Member names the property, model omits the arg → ARV stores
  unbound → guard skips → the number is portable. Characterised with
  tripwires in `arvRemoved.test.ts`; closing it (current-message extraction
  fallback on omission) needs a ruling — raised in `0026`.
- **Original report**: mailbox `0024`, blocker
- **Severity**: high, member-visible on both symptoms
- **Found**: while re-pointing the P1 state suite after the ARV removal (`12eb0e7`)

`tools.ts:218` reads `subjectAddress: existing?.subjectAddress ?? 'manual entry'`.
That was safe while `run_comps` wrote the comps block. It no longer does, and
`set_manual_arv` takes no address argument, so **no code path puts a real
address into `subjectAddress` any more**. It is permanently the placeholder.

**Symptom 1 — the member's own ARV is refused for the address they just named.**
`addressConflict` (`agent.ts:449`) compares the member's real address against
`"manual entry"`, they differ, the guard fires:

```
"use 450k as the ARV for 123 Main St"   -> stored, subjectAddress "manual entry"
"run the flip numbers on 123 Main St"   -> ARV never reaches the calculator
```

and the model is told to ask "which deal is this — the one at manual entry, or
the new address". There is no answer to that question.

**Symptom 2 — the placeholder is rendered.** The chat echo (`agent.ts:287`)
reads `Using ARV $450,000 from your manual entry for manual entry`.
`formPrefill.ts:33` already special-cases `!== 'manual entry'` for the form
label; the chat echo has no such guard.

**Why it survived my first pass.** The bad path only fires when the member NAMES
a property; `"run the flip numbers"` with no address pre-fills fine. My own
guard test in `arvRemoved.test.ts` used a message with no address, so it passed
while asserting nothing about the case that matters. Same failure mode as the
false pin in `0016` — a test that is green about the wrong situation.

**The fix must not be "treat 'manual entry' as never-conflicting."** That
removes the A -> B protection the operator required kept. Three options offered
in `0024`; MASON's call.

---

## FINDING-004 — a member-visible ARV that never passes through format.ts — CLOSED-BY-RULING

- **Status**: CLOSED by operator ruling 0024, with a residual noted below
- **Severity**: was **major** (INSPECTOR's grade; MASON filed it as INFO)

**Resolution.** Repeat requests now RE-RUN, served free from the cache, and the
prompt forbids answering any comps request from memory — every ARV the member
sees must come from a `run_comps` result in that turn. `qa_logs.tool_calls`
added so the same diagnosis is one query instead of forensic triangulation.

Verified independently (`tests/comps/recall.test.ts`, 9 tests):
- the re-run instruction and the no-memory rule are present in the comps prompt
  section AS SENT to the model;
- a regression guard against the old spend guard returning, scoped to that
  section so the calculator's legitimate "do not re-run the tool" rule cannot
  satisfy it;
- `qa_logs.tool_calls` records name/args/ok for a run_comps turn, AND records an
  empty array — not a missing key — for a tool-free turn, which is the exact
  distinction the original diagnosis turned on.

**RESIDUAL, carried into the GREEN at minor.** The path is closed by
INSTRUCTION, not by STRUCTURE. Nothing in the code stops a model answering from
history; it is now told not to. Every other honesty guarantee in this module is
structural precisely because instructions are the weaker kind. The scripted
non-compliance cases in `recall.test.ts` document what such a turn produces —
no rendered block, no confidence, no disclaimer, and state possibly bound to a
different address than the member was just told about.

**A FALSE PIN OF MINE, corrected here.** My first prompt pin asserted
`SYSTEM_PROMPT` matched `/do not re-?run|already ran/` and passed — while
matching `systemPrompt.ts:117`, the CALCULATOR follow-up rule, which is
unrelated and still correct. The comps instruction lives in `agent.ts` and was
flipped underneath it. The test would have passed whatever happened to the rule
it claimed to pin. Now scoped to the comps section, captured as actually sent.

---

## Original report

- **Status (at filing)**: OPEN — ruling reserved
- **Severity**: major
- **Source**: MASON's diagnostic `0023`; characterised by
  `tests/comps/recall.test.ts`

```
module:    src/agent/systemPrompt.ts (comps section) + the recall turn generally
repro:     npx vitest run tests/comps/recall.test.ts
expected:  every member-visible ARV is rendered by format.ts on the turn it is shown
actual:    a re-asked address is answered from the TRANSCRIPT — no tool call,
           no state read, no rendered block, no confidence, no disclaimer
spec-ref:  CONTRACT §11 / INSPECTOR_PROMPT §9 ("no path produces a fabricated ARV")
```

MASON's forensics settle the mechanism: the prompt says "do not re-run comps for
an address you already ran", and the model obeys by summarising history. The two
observed recalls were correct and traceable.

**Why I grade it above INFO.** Every honesty guarantee I signed off assumes the
tool ran. This path bypasses all of them at once, and correctness on it is a
property of the model rather than of the code — "it was right twice" is the
standard this suite exists to refuse.

Characterised offline (5 tests, all passing — they describe the hazard, they do
not demand a fix):

- After two addresses, BOTH ARVs sit in the replayed transcript with nothing
  marking which is current.
- `session_state` binds only the LATEST; the earlier number exists solely as
  prose, with no binding, confidence or provenance any code can check.
- A recall turn makes zero provider calls, zero state writes and zero tool
  calls — so no guard in this module engages, and the number reaches the member
  with no disclaimer and no confidence tier.
- **The divergence case**: the member is told address A's $403,000 from history
  while `session_state` is bound to address B at $362,000. Ask for the flip
  numbers next and the pre-fill supplies B's figure for the property they were
  just discussing.

The open question the ruling turns on — *can the recall path produce the wrong
address's number?* — is a live-model question. Two gated tests added to the
social-pressure battery (`RUN_LIVE_TESTS=1`), both cheap: real model, fake
provider, zero Apify spend.

Also flagged by MASON and worth carrying: **`qa_logs` does not persist
`tool_calls`**, which is why this needed forensic triangulation. An
observability gap, not a defect.

---

## FINDING-005 — the silent-default shape, and the one live instance — CLOSED

- **Status**: CLOSED (repro verified at `9137265`)
- **Severity**: was minor as hygiene; ruled an **honesty hole** by the operator
- **Fix**: `9137265` — `searchKnowledgeBase` throws `MissingRequiredInputError`
  on a blank/non-string query, guard BEFORE the embed, and the call site's
  `String(args.query ?? '')` coercion dropped so the value arrives raw.

Verified to the same shape as BUG-009:

- **All eight blank forms rejected** — `''`, spaces, tab, newline, `undefined`,
  `null`, a number, an object. Dropping the coercion is what makes the last two
  reach the guard as their real types instead of as `"42"` / `"[object Object]"`.
- **No result set on any of them**, and — the cost half — **zero embedding
  calls and zero vector searches**. A rejected query must not spend money.
- **Guard fires BEFORE the embed**, asserted directly rather than inferred.
- **Same error class by constructor**, compared against `runFlipTool({})`.
- **Surfaced through `runAgent`**: all six agent-level shapes come back as tool
  errors carrying the "do not invent numbers" instruction; a valid query still
  searches.
- **A real query still works** — positive precondition, so the guard is a guard
  and not a blanket refusal.

Why this one mattered more than the other two sites: an empty vector search
returns arbitrary passages, and the material-budget fallback instructs the model
to quote ONLY dollar figures appearing in retrieved passages. Handed passages
retrieved for no question, a compliant model quotes those figures as an answer —
the instruction that normally prevents invention becomes the thing that launders
it.

**The pattern itself remains open as a structural observation**, not as a defect:
all three coercion sites are now guarded, but each by its own hand-rolled check.
`assertRequired` still covers calculators only, and nothing would catch a fourth
`?? ''` on a required argument. Recorded for whenever the operator wants the
class closed the way `.gitattributes` closed the CRLF class.

### Original sweep
- **Reported**: msg `0020-inspector-bug009-closed-plus-pattern-sweep.md`

Swept `src/` for silent defaults on tool arguments after finding this shape
twice (frozen-$148,466, then BUG-009). Three call sites use the coercion:

| site | shape | verdict |
| --- | --- | --- |
| `comps/tools.ts:118` | `String(args.address ?? '').trim()` | **SAFE** — guarded on the very next line, returns an honest error |
| calculators (`toolRunners.ts`) | `assertRequired` | **SAFE** — throws `MissingRequiredInputError` |
| `agent.ts:590` | `String(args.query ?? '')` -> `searchKnowledgeBase` | **UNGUARDED** |

`search_knowledge_base` declares `required: ['query']`, but a missing one is
coerced to `''` and passed straight through. `searchKnowledgeBase` embeds it
unconditionally — no guard — so an empty query is embedded (spending an
embedding call) and vector-searched, returning arbitrary nearest passages with
no relation to any question.

Worse than it first sounds because of what sits downstream: the material-budget
fallback instructs the model to "quote ONLY dollar figures that appear in the
retrieved passages". Faced with passages retrieved for no question at all, a
compliant model quotes figures out of them and presents them as an answer.

**The pattern, stated plainly.** The safe sites are safe by individual
diligence, not by a shared mechanism. `assertRequired` exists for calculators
only; every other tool hand-rolls its own guard or forgets to. Nothing —
no lint rule, no shared helper, no test — prevents the next `?? ''`. That is
why this shape has now appeared three times in a codebase that already had one
famous incident from it.

Not fixed: outside BUG-009's scope by operator instruction.

---

## BUG-009 — a blank `item` returned the ENTIRE material-budget table — CLOSED

- **Status**: CLOSED (repro re-run and confirmed, 2026-08-06)
- **Severity**: was minor today / major on the day the sheet lands
- **Fix**: `071903b` — the `?? ''` default dropped at the call site;
  `lookupMaterialBudget` throws `MissingRequiredInputError` on a blank,
  non-string or missing `item`.

Verified against the ruling's gate:

- **Every blank shape rejected** — `''`, spaces, tab, newline, `undefined`,
  `null`, and (belt and braces) a number and an object. The old `?? ''` masked
  several distinct inputs, so a guard on `''` alone would have left the others.
- **No result set on any of them.** Not empty, not partial — the call throws
  and returns nothing.
- **Same convention as the calculators**, not a second one: identical error
  CLASS (asserted by comparing constructors against `runFlipTool({})`), and
  identical SURFACING — both go through `runAgent`'s shared catch and reach the
  model carrying the "do not invent numbers" instruction, with no `matches` and
  no `outputs` alongside.
- **The guard fires even when the table is `loaded:false`.** MASON ordered it
  before the load check; had it come after, it would have been invisible today
  and only started biting the day the client's sheet landed.
- **A real item still works** — positive precondition, so the guard is a guard
  and not a blanket refusal.

Original report follows.

- **Status (at filing)**: OPEN
- **Severity**: minor today, **major the day the client's sheet lands**
- **Reported**: msg `0019-inspector-bug001-verified-plus-audit.md`
- Found by the BUG-001 audit, not by the 17 tests.

```
module:    src/agent/agent.ts:580 (call site) + src/agent/materialLookup.ts
repro:     npx vitest run tests/materialBudget.test.ts -t "BUG-009"
expected:  a blank item is rejected, or at minimum does not match every row
actual:    lookupMaterialBudget('', undefined, FIXTURE) returns all 5 of 5 rows
           as `matches`; same for '   ' and '	'
spec-ref:  toolDefs.ts declares `required: ['item']`
```

The schema marks `item` required. The call site is
`lookupMaterialBudget(String(args.item ?? ''), ...)` — it coerces a missing
argument to `''`, and `''` substring-matches every row. A model that omits the
argument gets the whole rate table back as `matches` and relays it as though it
answered the member's question.

**This is the frozen-$148,466 shape exactly**: a missing required input silently
defaulted instead of rejected. The calculators guard precisely this with
`MissingRequiredInputError` (`tests/agent.test.ts` §3.2 pins it); this tool has
no equivalent, and the `?? ''` actively converts a schema violation into a
plausible-looking answer.

Unreachable **today** only because the shipped table is `loaded: false`, so every
lookup returns the KB-redirect regardless. It goes live the day the client's
sheet is ingested — which is the entire purpose of the feature, and the moment
nobody will be re-auditing this path.

Fix: reject a blank/whitespace `item` the way the calculators reject a missing
required field, rather than coercing it.

---

## BUG-008 — the widget pre-filled without a label — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: minor
- **Fix**: `a90b811` — the condition now also requires `field.prefill.label`,
  the exact clause the report proposed. A labelless prefill is DECLINED
  outright: no value in the box, nothing rendered, nothing to submit. Value and
  provenance render together or not at all, so the guarantee is structural
  rather than positional.

Original report follows.

- **Reported**: msg `0014-inspector-form-surface-verified.md`

```
module:    widget/widget.js:735
repro:     npx vitest run tests/comps/formPrefill.widget.test.ts -t "NO label"
expected:  no label => no pre-fill (the module's OWN comment, widget.js:733-734)
actual:    the value is written into the input and nothing is rendered beside it
spec-ref:  CONTRACT §8.1
```

The comment three lines above the condition states the guarantee exactly:

> The label is the guarantee: no label, no pre-fill — the member always sees
> which property the number came from.

The condition is `if (field.prefill && field.prefill.value !== undefined)`. It
never checks the label. Given a prefill with a value and no label, the widget
writes $403,000 into the ARV box and renders an empty note — a number the member
did not type, sitting in a required field, with nothing saying where it came
from. Indistinguishable from their own input, and it SUBMITS untouched by
design.

Not reachable today: the server always supplies the label (verified against the
real payload). So this is the same shape as BUG-002 — the defence is POSITIONAL
(it holds because of what the server happens to send) rather than structural
(the renderer enforcing its own invariant).

Fix is one clause: `if (field.prefill && field.prefill.value !== undefined && field.prefill.label)`.

---

## BUG-007 — the override escape hatch skips the property binding

- **Status**: OPEN
- **Severity**: minor (narrow trigger, real consequence)
- **Reported**: msg `0013-inspector-override-escape-hatch.md`

```
module:    src/agent/agent.ts (explicit-ARV branch, case 2)
repro:     npx vitest run tests/comps/state.test.ts -t "typed for ANOTHER field"
expected:  when a block is bound and the member names a DIFFERENT property, the
           reply says which property it is analysing
actual:    a flip on 456 Oak ran with ARV 400,000 carried from 123 Main's
           $403,000, and the reply names neither property
spec-ref:  CONTRACT §8 (address-mismatch guard)
```

The three-way discriminator is right and covers the case the operator flagged:
a transformed carry with no matching number in the member's message is refused
(verified — my LEAK test passes). The gap is narrower.

`messageStatesNumber` asks "did the member say this number this turn?" but not
"did they say it AS an ARV". A member's message routinely carries several dollar
figures; a purchase price is the commonest. When the model passes that figure as
`after_repair_value`, the call reads as a genuine override, and case 2's
`if (addressConflict(...)) return { args }` deliberately skips the echo.

Result: a full flip on a property the member named as different, priced off a
number carried from the bound property, with no address in the reply at all —
and the state block still bound to the OLD address for the next turn.

Not the wrong-house-ARV leak (that is closed); the residue is that an accepted
override on a conflicting address leaves the analysis unlabelled.

Suggested fix, minimal: on address conflict with an accepted override, still
name the property being analysed — or re-bind/clear the block so the next turn
cannot read a stale binding. Blocking is NOT wanted here; the member gave
coherent input.

Verified NOT affected: `brrrr_calculator` goes through the same guard.

---

## BUG-006 — mapped `soldDate` was a timestamp, not a date — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: major
- **Fix**: adapter emits the calendar date; `soldDate` is `YYYY-MM-DD` again.

Was: `"2026-08-03T07:00:00.000Z"` (Phoenix local midnight in UTC). Rule 12
rejects `soldDate` strictly after `now`, so between 00:00Z and 07:00Z a sale
that closed TODAY was dropped as future-dated — seven hours of every UTC day,
which is evening in the client's own market, eating the freshest comps, with a
plausible-looking reason in the rejection table.

Verified: the comp is kept at 02:00Z, 06:59Z, 07:01Z and 18:00Z; the same
address returns the same comps at every hour; all four mapped fixtures now pass
§4 conformance.

Found by the conformance harness on the first real mapped payload — which is
exactly the reconcile-before-you-trust-anything step paying for itself.

---

## BUG-005 — `renderCompsForChat` returned `undefined` for a message-less failure — CLOSED

- **Status**: CLOSED (repro re-run and confirmed)
- **Severity**: minor
- **Fix**: falls back to copy keyed off `code`, so the declared `: string`
  signature holds regardless of what the service passes.

---

## BUG-004 — the subject property appears in its own comp set — CLOSED

- **Status**: CLOSED (fix verified 2026-08-05)
- **Severity**: major
- **Fix**: new hard-filter rule 0 `SUBJECT_PROPERTY`, checked BEFORE rules 1-12.

MASON took the visible-rejection option: the self-comp is now named in the
rejection table with its real reason rather than silently dropped in the adapter.
Verified on the new recorded pair — zpid 7532298 rejected `SUBJECT_PROPERTY`,
ARV computed from the 5 genuine comps.

---

## FINDING-001 — the recorded fixture pair can never produce an ARV — CLOSED

- **Status**: CLOSED (resolved 2026-08-05)

MASON recorded a second pair against a subject taken from the median of the
first recording (1,349 sqft, 1423 E Coronado Rd): `subject-standard` /
`comps-standard` reach a real ARV of $431,000 with 5 comps at 2.0 mi and honest
`low` confidence. The original 2,971 sqft pair was kept and mapped as
`subject-large-thin-market` / `comps-large-thin-market` — a genuine
TOO_FEW_COMPS fixture on real data, which is more useful than discarding it.

Both success and failure paths are now exercisable on recorded data.

---

## BUG-003 — a future-dated comp scores NEGATIVE — CLOSED

- **Status**: CLOSED (repro re-run and confirmed 2026-08-05)
- **Severity**: major
- **Fix**: rule 12 `FUTURE_SOLD_DATE` (§5.3) + `max(monthsAgo, 0)` in the recency
  term and the confidence-median input (§5.4).

Verified after the fix:
- `parts.recency` is 0, not -0.0547, for a comp dated tomorrow.
- `monthsAgo` still reports the RAW negative value — the evidence is preserved,
  which is the right call and is now pinned by its own test.
- The comp is REJECTED at the filter with reason `FUTURE_SOLD_DATE`, so the
  negative-score promotion is unreachable by construction rather than merely
  clamped.
- Rule 12 is last, so an earlier failure still wins the first-match report —
  ordering pinned in `filter.test.ts`.
- No neighbour regressions: all 248 comps tests green, including the 25 goldens.

---

## BUG-002 — degenerate inputs returned NaN / Infinity — CLOSED

- **Status**: CLOSED (repro re-run and confirmed 2026-08-05)
- **Severity**: minor
- **Fix**: `trimmedMean([])` and `pricePerSqft(price, area <= 0)` now throw.

Verified: both throw; `trimmedMean([207])` still returns 207 (the guard is a
guard, not a blanket rejection); `pricePerSqft(0, 2000)` still returns 0, because
a zero PRICE is rule 9's business and not a programmer error.

---

## BUG-001 — `tests/materialBudget.test.ts` had never run — CLOSED

- **Status**: CLOSED (fix verified on a real fresh clone, 2026-08-06)
- **Severity**: major
- **Fix**: `614308b` — shebang removed from `tools/ingest_material_budget.mjs`
  (options 1 + 3), plus `.gitattributes` with `* text=auto eol=lf` repo-wide.

Verified, four checks:

1. **All 17 collect and execute.** Was 0 collected.
2. **`npm test` exits 0** — the first time in this repo's history. 30 files,
   1,277 passing.
3. **The CRLF class is dead, not just this instance.** The three-way probe still
   reproduces the hazard by hand (shebang+LF ok, no-shebang+CRLF ok,
   shebang+CRLF SyntaxError), so the diagnosis holds — but `.gitattributes`
   normalises CRLF to LF on `git add`, so the bad combination cannot ENTER the
   repo. Proved on a real `git clone`: every file checks out LF, the stored blob
   is LF, and a deliberately CRLF-authored shebang file is normalised on add.
   `.gitattributes` is committed, so it travels with the repo.
4. **`node tools/ingest_material_budget.mjs <sheet.xlsx>` still runs.** No args
   prints usage and exits 0; a real workbook parses and fails with its own
   informative column error. Nothing referenced the file as a `bin` or npm
   script, and its own usage line documents `node tools/…`, so the shebang was
   decorative.

Original report follows.

- **Reported**: msg `0004-inspector-bug-materialbudget-suite-never-runs.md`
- **Was pre-existing** — present since `ed61772`.

```
module:    tools/ingest_material_budget.mjs (line 1)
repro:     npx vitest run tests/materialBudget.test.ts
expected:  suite loads, 17 tests execute
actual:    SyntaxError: Invalid or unexpected token — 0 tests run, `npm test` exits 1
spec-ref:  INSPECTOR_PROMPT.md §9 (sign-off presumes a clean default `npm test`)
```

Root cause: the file begins with `#!/usr/bin/env node` **and** uses CRLF line
endings. Vite's shebang strip does not survive the `\r`, so `#` reaches the
parser. Node's own loader strips it correctly, which is why
`node -e "import('./tools/ingest_material_budget.mjs')"` succeeds and only the
Vitest path fails.

Isolated with a three-way probe (since removed):

| probe | result |
| --- | --- |
| shebang + LF | passes |
| no shebang + CRLF | passes |
| shebang + CRLF | **SyntaxError** |

Only this one file in the repo has a shebang. There is no `.gitattributes`, so
the CRLF will come back on any fresh Windows clone even if the file is
normalised once.

---

## Contract findings (not code bugs)

### CF-001 — `compsUsed` undefined in CONTRACT §4 — RESOLVED IN MAILBOX ONLY

- **Status**: OPEN (documentation)
- **Severity**: minor

The contract does not say whether `compsUsed` is the kept count or the
post-trim count. At n = 5 and n = 6 the two readings give different confidence
tiers — `medium` vs `low`, and `high` reachable vs not. MASON ruled it is the
kept count (mailbox `0003`), and `golden-04-boundary-5.ts` asserts accordingly.

The ruling is not in CONTRACT.md, which is supposed to be the referee. Asked for
a one-line amendment to §4:
`compsUsed: number;  // kept/ranked comps, i.e. n before the trim`
