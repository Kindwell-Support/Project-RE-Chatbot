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
