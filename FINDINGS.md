# FINDINGS

Build report: discrepancies, assumptions, and open items.
See `RUN_REPORT.md` for the verify/deploy/prove run (live test results, A7 evidence, counts).

## Architecture (settled 2026-07-15)

Two systems share one database. **n8n owns ingestion** (Drive → clean → chunk → embed →
write `documents`); **this repo owns the chatbot** (read `documents`, calculators, /chat,
widget). Never build ingestion here, never write to `documents`, never modify
`match_documents` — additive RPCs only (`sql/add_match_documents_distinct.sql`).

## Live findings (2026-07-15)

1. **`documents` table is duplicated ~8× — retrieval was returning 5 copies of ONE chunk
   on every query.** Root cause (confirmed by the client): the n8n ingestion workflow has
   five daily schedule triggers and no dedupe, live since July 3 — it adds one copy of
   everything per day, so any fixed over-fetch constant rots. Fixed properly with the
   additive `match_documents_distinct` RPC (SQL-side DISTINCT ON content hash, O(1) in the
   duplication ratio), an adaptive scan window (200→800→2000), and a `logger.error`
   duplication alarm below ratio 0.3 (the live table sits at ~0.13, so it fires on real
   traffic by design until n8n de-dupes). Details in RUN_REPORT.md.
1b. **Material/spec-tier data is PARTIALLY in `documents` already** — real narrative rates
   (tile $10–11/sf installed, flooring $1.50/$2.50/$4 specs, paint $2–3/sf, flip kitchens
   $8–10k) are retrievable now; a labeled Budget/Basic/Standard/Premium matrix is not.
   Menu 5/6 ship on RAG with lookup→KB fallback; the client's sheet is an upgrade, not a
   launch blocker.
2. **Read-your-own-writes race in memory.** `chat_messages` was fire-and-forget, so a fast
   follow-up could load history before the prior turn landed (live A16 replied "I don't
   have your purchase price on record"). Now awaited before the reply returns. `qa_logs`
   stays detached — memory is correctness, logging is observability. Both directions
   pinned by tests in `agent.test.ts` §3.5.
3. **Seven agent-behavior defects, all fixed in the system prompt** — stalling on optional
   fields instead of running with defaults (the worst: it silently declined to call the
   calculator), not disclosing applied defaults, re-asking for figures already in history,
   omitting the numbered menu, no disclaimer on buy/sell questions. See RUN_REPORT.md §3.
4. **`EMBEDDING_MODEL` was env-overridable with no guard.** `ada-002` is also 1536-dim, so
   it would have returned silently wrong results forever. `assertRuntimeConfig` now
   refuses to boot on anything but `text-embedding-3-small`.
5. **The live suite is flaky** (14/17 vs 17/17 on identical code). Transient OpenAI errors
   surface as a 502 to the member; `maxRetries: 4` + 60s timeout added, unproven.
6. **Agent errors were undiagnosable under `NODE_ENV=test`** — `request.log` is silenced
   there, so live-test 502s swallowed their cause. Now always surfaced server-side.

## Detached-promise audit (Job 1)

Audited every detached promise in `src/`. There are exactly two, both in `src/server/app.ts`:

| Call site | Rejection handler before? | Live-reachable crash? | Now |
|---|---|---|---|
| `void appendExchange(...)` — app.ts:103 | No `.catch()` | **No** | `.catch()` added |
| `void logExchange(...)` — app.ts:104 | No `.catch()` | **No** | `.catch()` added |

**The hypothesised crash bug was not live.** Both helpers wrap their entire bodies in `try/catch` and swallow every error internally (`logging.ts:20-32`, `memory.ts:39-47`), so neither promise could ever reject, and neither could trigger Node's unhandled-rejection process termination. The reported symptom — a Supabase outage taking down the server on every request — could not have occurred against this code. **No live production bug was found or fixed here.**

The `.catch()` handlers were still added, for two reasons:

1. **The guarantee lived in the wrong module.** Safety depended on an invariant inside `logExchange`/`appendExchange`. Anyone removing that `try/catch` — a reasonable-looking refactor, since throwing from a logger is normal — would silently re-arm the crash with no signal at the call site. The `.catch()` pins the guarantee where the risk actually is.
2. It routes failures through Fastify's structured logger (`request.log.warn`) instead of bare `console.error`, so outages are visible in production log aggregation with request context attached.

Test `I4` in `tests/cors.test.ts` now asserts zero unhandled rejections with Supabase rejecting, so this cannot regress. Verified by mutation: removing *both* the call-site `.catch()` and `logExchange`'s internal `try/catch` makes I4 fail on exactly that assertion.

`console.error` remains inside `logging.ts`/`memory.ts` as a last-resort fallback for callers that don't pass a logger. Not worth plumbing a logger through for a path that is now double-guarded.

## Real bug found and fixed: silent NaN on missing required inputs

Not the reported bug, but the same class, and it was live.

`runFlipTool({})` returned `est_net_profit: NaN`. Required fields (`purchase_price` etc.) have no entry in `FLIP_DEFAULTS`, so they did *not* silently become `700000` — the old build's exact failure did not reproduce. Instead the arithmetic produced `NaN`, and **`JSON.stringify` serialises `NaN` to `null`**, so the model received:

```json
{"total_direct_costs":null,"est_net_profit":null,...}
```

A blank with no error signal, which the model was free to narrate around. Same category as the frozen-number bug — garbage crossing the agent/tool boundary without a failure — differing only in whether the garbage was stale or empty.

**Fix:** `assertRequired()` in `src/agent/toolRunners.ts` throws `MissingRequiredInputError` when a required field is absent, non-numeric, `NaN`, or `Infinity`. `agent.ts` already converts thrown tool errors into an explicit instruction to the model not to invent numbers, so the model now asks the user instead. Covered by the anti-regression tests in `tests/agent.test.ts` §3.2.

## Test coverage: distinct tests vs. total assertions

The headline number overstates coverage, so both are reported:

| File | Passing | Notes |
|---|---|---|
| `invariants.test.ts` | 393 | **~14 distinct properties**, randomized into 393 trials |
| `flip.test.ts` | 63 | F1 golden + F2–F9 fixtures |
| `brrrr.test.ts` | 60 | B1 golden + intermediates + B2–B7 |
| `land.test.ts` | 51 | L1 golden + L2–L6 |
| `agent.test.ts` | 25 | agent/tool handoff (new) |
| `quirks.test.ts` | 12 | 6 preserved quirks |
| `finance.test.ts` | 10 | PV/PMT/IRR/excelRound |
| `cors.test.ts` | 8 | I1–I4, I7 |
| `live.test.ts` | 1 (+16 skipped) | gated behind `RUN_LIVE_TESTS=1` |
| **Total** | **623 passing, 16 skipped** | |

**Distinct hand-written tests: ~244** (230 fixture/unit + ~14 property definitions). The remaining 379 are generated trials. Property testing is kept — it catches input-dependent edge cases fixtures miss — but 623 should not be read as 623 independent checks.

Coverage by layer, which matters more than the count:

- **Calculator math** — thorough (golden values from the workbooks, all scenarios, 10 invariants, 6 quirks).
- **Agent/tool handoff** — now covered: schema typing, argument passthrough, required-field rejection, `token_usage`, defaults disclosure, memory plumbing. This is the layer every shipped bug lived in and it had **zero** tests before this pass.
- **Model judgment** — covered only by the gated live suite. Structurally untestable with mocks, since mocking the model means choosing its output.

### Mutation-verified

Each new test was verified to fail when its bug is reintroduced — a test that passes but wouldn't catch the bug is the failure mode that let the last build ship broken:

| Reintroduced bug | Caught by |
|---|---|
| Free-form `query` param on `flip_calculator` | §3.1 catch-all regression |
| Silent default substitution for required fields | §3.2 anti-regression (3 tests) |
| `token_usage` logged as `{}` | §3.3 A13 (2 tests) |
| Unhandled rejection from detached `logExchange` | I4 |

## Test I4 — rewritten (Job 2)

I4 previously asserted the source *contained* the strings `void appendExchange` / `void logExchange` — a shape test that would pass against code whose behavior was broken. It now injects a Supabase client whose every `insert` rejects, asserts a real `200` with a non-empty `output`, and asserts zero unhandled rejections after the detached promises settle. A second test asserts the writes were genuinely attempted, so it can't pass vacuously.

The original justification ("needs live credentials") was wrong: `buildApp(config, deps)` already accepts injected clients, so no keys, no network, and no `vi.mock` are required. Fakes live in `tests/helpers/fakes.ts` and exercise the real agent loop, tool router, and calculators.

## Sheet vs. build-document discrepancies

**None material.** All three workbooks were parsed formula-by-formula (`tools/dump.mjs`) and cross-checked against the build document's cell maps. Every formula, default, and cached golden value matches. Three cosmetic notes, none of which change any number:

1. **Flip `D25`** is `SUM(D22:D24)` in the sheet vs. `D22 + D23 + D24` in the document — identical result. Same pattern for `D49` (`SUM(D37:D48)`, where the C-column cells fall outside the summed range), BRRRR `D29`/`D48`/`D64`, and Land `C27`/`C32`/`C50`/`E43`.
2. **Flip `D68`** is `D64 + D66 + D67` in the sheet, where `D67 = D55` (staging) — the document writes it directly as `D64 + D66 + D55`. Equivalent.
3. **File names** differ from the document (`Flip Calculator.xlsx` vs `Flip_Calculator.xlsx`, `BRRR Calculator corrected[1].xlsx` vs `BRRR_Calculator_corrected_1_.xlsx`). Copies were normalized into `spec/`. Checksums confirmed the project-root copies and the `spec/` copies are identical files.

All golden regression values reproduce exactly. The Land non-default case (L2) produces 544665 / 875000, not the old n8n build's buggy 595665 / 873229.

## Deviation from the test spec

**`defaults_applied` vs. `applied_defaults`.** The spec's §3.4 example names the field `applied_defaults`; the implementation uses `defaults_applied`, which predates the spec and is what the tool already returns to the model. Semantically identical. Kept the existing name rather than churn the tool contract; tests assert against `defaults_applied`. Rename on request.

## Blockers / not completed

1. **Material Allowance & Construction lookup data not loaded.** The client's ChatBot/spec-tier sheet (with the corrupted `#REF!` item names) was not supplied. `src/data/material_budget.json` is a typed scaffold with `loaded: false`; the `lookup_material_budget` tool returns an honest "not loaded yet" response and the agent will not fabricate rates. **To finish:** obtain the sheet, clean the `#REF!` names, populate `items` as `{category, item, spec_tier, unit, low, high}`, set `loaded: true`.
2. **Not deployed.** The container builds and runs, but deployment (Railway/Fly/Render) and the production `API_URL` in the GHL loader snippet need a hosting decision.
3. **Live agent-behavior tests written but never executed.** A1–A16 exist in `tests/live.test.ts`, gated behind `RUN_LIVE_TESTS=1` (`npm run test:live`). They are ready to run the moment the server is deployed, but have **not been run even once**, so their assertions are unvalidated against real model output — expect some to need tuning on first run (particularly A2/A15, which assert disclosure phrasing, and A5/A6, which assert conversational judgment). A7 is the priority: it pins the memory-replay regression.
4. **A4 and A15 exist in both suites.** The mocked suite covers their *plumbing* (required-field rejection; `defaults_applied` payload); only the live suite covers whether the model actually asks for missing inputs and discloses defaults in prose. The mocked versions are not a substitute.

## Assumptions

1. **Conversation memory table**: created a new `chat_messages` table (`sql/setup.sql`) in the same Supabase project, service-role access only. The build document said "Postgres keyed by session_id" without naming a table.
2. **`qa_logs.user_id`**: member email when the widget can read it from GHL localStorage, otherwise the session id — per the document's "member email, else session id".
3. **BRRRR 5-year projection assumptions** (appreciation 3%, rent growth 2%, expense growth 2%, selling costs 6%) are exposed as optional tool-callable inputs defaulting to the sheet's values, since they're editable yellow cells in the sheet.
4. **Excel `ROUND`** rounds half away from zero; `Math.round` differs for negatives. Implemented `excelRound` accordingly (affects BRRRR's rounded operating figures and Land's rounded fee cells).
5. **BRRRR loan-balance projection** uses the *unrounded* `PMT` inside the `PV` chain (per the sheet's row-16 formula), while monthly debt service `C66` is the *rounded* PMT — both behaviors preserved exactly.
6. **IRR**: Newton–Raphson with bisection fallback, matching Excel's `IRR` to ~1e-9 on the golden case. Returns the string `"n/a"` when no sign change exists, matching the sheet's `IFERROR`. Same for BRRRR's `cash_on_cash_return`, `return_on_equity`, and `dscr_at_refinance` on a zero denominator.
7. **Widget session identity**: a per-browser `localStorage` UUID (`james-bot-session`), so history persists across page loads within the same browser. Member email is passed separately for logging.
8. **Second-loan flip inputs** (`second_loan_points_pct`, `second_loan_interest_rate`, fee cells) are supported by the calculator but not exposed in the OpenAI tool schema, which follows the build document's parameter list. Easy to add if members ask for them.
9. **`match_documents` RPC signature** is `(filter, match_count, query_embedding)`, confirmed against the live database during end-to-end testing. `src/agent/retrieval.ts` passes `filter: {}`.

## Frame-level leak testing — filed, NOT fixed (2026-08-28)

Raised by INSPECTOR against `tests/gatePassNewChat.test.ts` after the gate-pass
slice. Recorded here because each one narrows a claim that is currently stated
more broadly than the instrument supports.

**FINDING-056 — the frame watch is blind to microtask transients.**
`frameWatch()` samples on MACROTASK boundaries (`setTimeout(…, 0)`), so a
refill→clear transient that lives entirely inside a single microtask drain is
never observed. The instrument was built precisely for this class of leak and
cannot see the tightest version of it. The `drop the draft clear` mutant is
caught, but partly because its edit also breaks pinned source text rather than
because a frame was seen carrying the draft. Needs microtask-level sampling — a
`MutationObserver`, as used in the one-off probe — before any future
frame-level claim rests on this helper.

**FINDING-058 — two normalisation cases collapse into two others.**
`<input type="email">` sanitises surrounding whitespace on assignment, so the
`surrounding whitespace` and `both` cases submit the same strings as the plain
and `UPPERCASE` cases. Their labels claim coverage they do not provide.
Consequently `.trim()` inside `normaliseEmail` is pinned by EXACTLY ONE test —
the unnormalised-token-payload fixture (`tokRaw('  A@X.com  ')`) — which is
therefore load-bearing and sole. Retitle the collapsed cases honestly and say so
at the payload fixture.

**FINDING-059 — `Frame.active` is collected and never asserted.**
`snapshot()` reads `localStorage[ACTIVE_KEY]` into every frame and no assertion
reads it back. Either assert the active pointer at frame level (it is a genuine
cross-member surface: it can point at another owner's chat) or stop collecting
it. Collected-but-unread data reads as coverage that does not exist.

**Standing note for future frame-level work.** A claim that no frame carried
cross-member content is only as good as the sampling rate. State the sampling
mechanism alongside the claim, not just the result.

## (d) Lesson-page width chain — CLOSED, no CSS change (2026-08-28)

**Question:** does the GHL grid column cap the widget's width on lesson pages?
**Answer: no.** `.content-fix-width` measures `max-width: 1800px` on a real
lesson page (operator, DevTools). Our own `--jb-max-w` is
`calc(var(--jb-font-base) * 58)` = **1044px at base 18**, so the container is
756px wider than anything we would use. It never constrains us, and the space
beside the widget on a wide screen is our own centring, by design.

**Custom CSS v2 already does its part.** With
`html.ajm-lesson .content-fix-width > .col-span-8 { grid-column: span 12 / span 12 }`
and the siblings hidden, the column takes the container's full content width —
measured, not assumed. What remained in the sweep was only the container's own
cap, which at 1800px is inert for us.

**Measured sweep** (Chrome, `.membership-preview-remote.ajm-lesson` wrapper,
Custom CSS v2 rules applied, mount inside `.col-span-8`):

| `.content-fix-width` | mount @1920 | mount @2560 | widget root |
| --- | --- | --- | --- |
| no cap | 1920 | 2560 | 1044 |
| max-width 1280 | 1280 | 1280 | 1044 |
| max-width 1280 + pad 24 | 1280 | 1280 | 1044 |
| padding 48 only | 1824 | 2464 | 1044 |
| max-width 1024 + pad 32 | 1024 | 1024 | **1024** |

The widget renders at its own 1044px measure in every shape EXCEPT one whose
cap is narrower than 1044. That is the only case where a container override
would buy anything.

**The gap decomposes into two things needing different rules**, if a future
template ever does cap below 1044:
- **max-width** — produces the bulk, and lands as AUTO MARGIN, so it scales
  with the viewport (a 1280 cap gives 640px at 1920 and 1280px at 2560).
- **padding** — a FIXED amount on top, constant at any viewport (48px → 96px).

**The override, kept here and NOT pasted into Custom CSS.** Verified to close
every shape above to a zero gap at 1920 and 2560 with no horizontal scrollbar.
Positive-marker scope only — no `:not()`, because a negated scope matches by
default once GHL rewrites `html` to its app wrapper:

```css
html.ajm-lesson .content-fix-width {
  max-width: none !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
}
```

**Caveat if it is ever applied:** removing the cap widens EVERYTHING in
`.col-span-8`, not only our mount — any remaining lesson copy or video goes
full-bleed with it. The v2 rules hide the title, comments and Mark As Complete,
but not necessarily everything else in that column.

**Not reachable from this repo, for the next person who tries:**
`.content-fix-width` appears 0 times in `clientportal-core-*.css`, 0 times in
`index-*.css`, 0 times in the portal HTML and 0 times in the 3.3MB
`app-*.js` bundle. It ships in a member-only route chunk, and the lesson DOM is
behind member auth — so its computed style can only come from a real member
session. That is why the sweep above is parameterised rather than measured
directly.

## FINDING-062 — spaceBelow has two stable fixed points (filed, NOT fixed)

Raised by INSPECTOR against the viewport-fill slice. **Deliberately not fixed:**
picking the semantics for out-of-flow siblings is a design decision and the
operator ruled it should be made on its own, not under merge pressure.

**The incoherence.** `applyFrame()` derives the widget's height from the
viewport, but `spaceBelow()` measures sibling rects — and those rects move when
the widget resizes. With an OUT-OF-FLOW sibling the loop settles at a fixed
point determined by the mount's STARTING inline height rather than by the
viewport. INSPECTOR's reproducing numbers:

| GHL snippet `height:` | settles at |
| --- | --- |
| `700px` | 784px |
| `900px` | 984px |

Both land at start + 84. A function whose output depends on its own initial
condition is not deriving anything — it is remembering.

**Why it does not bite today.** It requires an out-of-flow sibling below the
mount, and (d) established that `.content-fix-width` is IN FLOW on the current
lesson page (`max-width: 1800px`, ordinary grid container). The current chain
has no absolutely-positioned sibling under the widget, so the loop converges on
the viewport-derived value as intended.

**THE TRAP, stated plainly:** changing the GHL snippet's `height:700px` to some
other value would SILENTLY MOVE THE OUTCOME if an out-of-flow sibling is ever
introduced. The snippet is hand-edited and not in this repo, so that edit could
happen without anything here changing. Whoever revisits this should decide what
an out-of-flow sibling MEANS — does it compete for vertical space or not — and
make `spaceBelow` say so explicitly, rather than inheriting an answer from
whatever height the snippet happens to carry.

## Instrument construction rule (adopted 2026-08-28)

After five instances in one week of the same defect — the frame watch sampling
past the transient, the 520px row that never reached the floor, the gated rail
probe, railPos/railOnScreen feeding nothing, and the hamburger gate that only
printed — this is now a construction rule rather than something a sweep catches:

1. **Every value read must either FEED THE VERDICT or be printed under an
   explicit INFORMATIONAL label.** There is no third category. A value that is
   measured, printed, and unconnected to the outcome reads as coverage and is
   not.
2. **For each gate, name the mutation that makes it fail.** If you cannot name
   one, the gate is not real yet. Put the mutation in the comment beside it.
3. **A gate is not finished until the gate itself can fail.** FINDING-060 sat
   inside the block written to fix FINDING-059 — the fix for "a value that does
   not gate" was itself a value that did not gate.

---

## FINDING-064 — the rail entered the flow before there was room for it

The drawer→flow breakpoint was 560px. Crossing it removed 11.5 base units from
the text column in one step, and the measure fell to **40 characters** — below
anything readable — and stayed there until ~700px.

The breakpoint is now set by what the column can afford, not by a round number.
With `chars ≈ [0.86W − 15.03b] / 0.5b`, requiring ≥50 gives `W ≥ 46.5b`, which
against the curve (b = 16.5 in that region) is `W ≥ 769`. **800** is the first
sensible stop above it. `jb-w-mid` moved 700 → 900 alongside so the tiers still
nest — leaving mid at 700 would have put a 750px widget in narrow-but-not-mid,
a combination no rule anticipates.

Measured across the transition: **73 characters at 800, 65 at 801.** The
predicted 57 was pessimistic; the mid rail is 11.5 units, not 13.5.

## FINDING-065 — range claims sampled at two points

Gates asserting a property across a range were sampling their endpoints and
missing every discontinuity between them. The measure gate sampled 375 and 768
and straddled the dip in FINDING-064 — the defect was inside the gate's stated
range the whole time and the table read `ok`. The viewport sweep straddled all
three tier boundaries and the `FRAME_MIN_H` clamp endpoint.

Both instruments now sample every tier boundary and clamp endpoint at ±1px, and
no coarser than 40px through the sub-1024 range, and each **states its sampling
density in its own output**.

**A gate scoped by a constant that the mutation also moves is not scoped at
all.** The first version of the measure floor read `w >= 801`. Reverting the
breakpoint to 560 put the rail in the flow at 561 — outside a scope pinned to
801 — so the gate could not catch its own named mutation, and printed `ok` over
a 19-character dip. The floor is now scoped by the **measured** rail position.
Verified: with the breakpoint reverted, four rows report `UNDER 50`.

## FINDING-066 — touch targets below the accessibility minimum

An audit of all 20 interactive controls at base 16 found **13** below 44×44,
not the two originally named. Two techniques, chosen per control:

- `min-height:44px` where a 44px box is simply an ordinary button (nine
  controls, plus `.jb-btn-link` which needed `inline-flex` to centre against).
- an `::after` hit overlay for `.jb-side-toggle`, whose visual box must stay
  small in the header. The overlay extends the hit area only: no layout shift.

`.jb-chat-act` is **deliberately** at 26×26 and needs a ruling. Its two
instances sit 2px apart, so 44px overlays centred 24px apart would overlap by
20px — and one of the two is DELETE. A hit area that can swallow a click aimed
at its destructive neighbour is worse than a small one. 26×26 clears WCAG
2.5.8's 24×24 minimum; going further needs the buttons separated first.

Two instrument defects surfaced during this audit and are worth carrying: the
probe under-reported by 2px because `elementFromPoint` is exclusive at the
exact boundary, and it measured `.jb-calc`'s children **mid-animation** —
`jb-card-in` starts at a sub-1 scale, so a 44px box read as 43.1px. Entry
animations are now finished deterministically before anything is measured.
