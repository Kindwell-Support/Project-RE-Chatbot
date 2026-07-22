# RUN REPORT — Architecture Context + Remaining Work

Date: 2026-07-15 (evening run). All output pasted verbatim from the runners.
Previous run's report archived at `reports/RUN_REPORT_2026-07-15_verify-deploy-prove.md`.

Architecture boundary respected throughout: **nothing was written to `documents`,
`match_documents` was not modified, no ingestion was built.** The one database change is
an **additive** RPC (`match_documents_distinct`), applied as a named migration.

---

## 1. Job status

| Job | Status | One line |
|---|---|---|
| 1 — adaptive retrieval + alarm | **done** | New additive SQL-dedupe RPC applied to the live DB + adaptive scan window + `logger.error` alarm. Mutation-verified ×3. |
| 2 — material allowance test | **done** | **Verdict: partially there — real rates are retrievable NOW; menu 5/6 can ship on RAG.** Routing rewired; live canary test passes. |
| 3 — menu out of the model | **done** | Widget opening bubble = client's exact static copy; A1 rewritten to the mid-conversation path. |
| 4 — deploy prep | **partial/blocked** | Configs + docs ready; **`docker build` NOT verified — no Docker daemon on this machine.** Still need platform choice + token from you. |

---

## 2. JOB 2 HEADLINE — the spec-tier data verdict

### Verdict: **partially there, and enough to ship menu 5/6 on RAG now.**

- **Real dollar figures ARE in `documents` and retrievable through the fixed retrieval** — for tile, flooring, paint, kitchens/cabinets, plumbing, and install rates.
- **A formal Budget/Basic/Standard/Premium matrix is NOT there.** The tiers exist as James's narrative ("a dollar 50 spec / $2.50 spec / $4 spec", "standard flip vs nicer flips"), not as labeled table rows. The client's sheet remains the upgrade (deterministic, labeled tiers), no longer the blocker.

### Verbatim retrieved chunks (real table, deduped retrieval, 8 probe queries run — selection below; every chunk shows id + similarity)

```
QUERY: "tile flooring cost per square foot budget spec level"   (ratio 0.164)

[19206] sim=0.5808
  ...Tile's also going to cost us about 10 to 11 a foot installed. So that's what

[8443] sim=0.5660
  Here's the theme that we need. I need a dollar 50 a square foot spec. I need a $2 50
  square foot spec and I need a $4 spec for higher end house. ... when I'm looking at a
  more affordable home, I already know my flooring's gonna cost me a dollar 50.

[7950] sim=0.5505
  James: Second, the install-rate-plus-material model — more granular, from our budget
  sheet, broken down by install rate and material cost. For flooring, call five flooring
  companies: "What do you charge to install engineered flooring per square foot?" You'll
  hear five numbers; go with $2. That's your baseline install. Then it's just shopping —
  LVP for about $1.50 a foot on clearance. So 2,000 square feet at $3.50 all...
```

```
QUERY: "kitchen cabinets cost budget spec level"   (ratio 0.178)

[22483] sim=0.6407
  ...A five thousand dollar kitchen — we painted the cabinets, threw countertops in, put
  recycled appliances in... A 10,500 kitchen — builder grade cabinets I get for 6,500
  bucks... And more custom kitche...

[13793] sim=0.6238
  Our cabinets — typically on a flip kitchen, it's going to cost us about $8 to $10,000
  for cabinets, countertops, tile backsplash installed, maybe 12-13 with appliances.
```

```
QUERY: "interior paint cost per square foot"   (ratio 0.164)

[13792] sim=0.5303
  ...Typically on a flip, it costs me two bucks a foot on the outside, $3 on the inside;
  this property it was more like $5 a foot, $10 a foot in total.

[16430] sim=0.4978
  ...in Seattle we can do a house's cosmetics (paint, mill work, doors, trim) for about
  $20 a square foot. Then we go with standard blocks like a kitchen at $10,000.
```

```
QUERY: "plumbing fixtures budget allowance spec"   (ratio 0.147)

[17608] sim=0.5070
  Bathrooms — all of our fixture valves are substantially more money. On an average
  bathroom, it's going to cost us about $200 for the valve, plus $150 to $250 for the
  trim on top. For our nicer flips that are about 1.5 to 1.7, we're going to be more
  around 350.
```

The old bot's intermittency is now fully explained AND demonstrated: chunk 19206 carries
the exact "$10 to 11 a foot installed" figure the old bot gave *sometimes*. Under
one-distinct-chunk retrieval, whether a member got the answer was a lottery on which
single chunk won. Deduped, it's reliably in the top 5.

### Routing change that makes this shippable

`lookup_material_budget`'s miss was a dead end ("do not estimate"). It now returns a
fallback instruction: search the knowledge base, quote **only** figures present in
retrieved passages, attribute them as James's project numbers that vary by market/year,
and if retrieval has nothing, say so. System prompt menu-5/6 section updated to match.
**No fabrication either way** — mutation-verified (dead-end mutation fails the test).

### Live canary — the client's exact question (verbatim)

```
USER: What should I budget for tile flooring on a budget flip?

===== MATERIAL TOOL TRACE ===== ["lookup_material_budget","search_knowledge_base"]

===== MATERIAL FALLBACK RESPONSE =====
For a budget flip, you can expect tile flooring to cost around $10 to $11 per square foot
installed. Keep in mind that these figures can vary based on market conditions and
specific project requirements. Always verify with local suppliers or your contractor for
the most accurate pricing. These are estimates for education only, not financial advice —
verify your own figures before you act.
```

Trace shows the designed flow: lookup first → miss → knowledge base → retrieved figure
quoted with the variance caveat. This is a live test (`MATERIAL`) that now runs with the
suite.

---

## 3. JOB 1 — adaptive retrieval + duplication alarm

### Root cause acknowledged

n8n re-ingestion (five daily triggers, no dedupe, live since July 3) explains both prior
measurements — and resolves the 2.2%-vs-16× discrepancy I couldn't reconcile last run
(only the working branches re-ingest daily → heavy duplication of a subset). Ingestion is
n8n's to fix; nothing here builds around it beyond defense.

### The additive RPC — applied to the live database

Migration `add_match_documents_distinct` (also in `sql/add_match_documents_distinct.sql`):
`DISTINCT ON (md5(normalized content))` over the nearest `scan_count` rows, returns top-N
distinct **plus scan stats** (`scanned`, `distinct_scanned`) so the client computes the
duplication ratio without transferring duplicates. `match_documents` untouched — verified
by reading its definition only.

**Verbatim side-by-side on the live table** (same query vector, id 11214's own embedding):

```
[{"fn":"old_match_documents",          "rows_returned":5, "distinct_contents":1},
 {"fn":"new_match_documents_distinct", "rows_returned":5, "distinct_contents":5}]
```

Live scan stats: `scanned=105, distinct_scanned=13` → duplication ratio **0.124 ≈ 8.1
copies per chunk** — independently confirming the ~11-days-of-daily-re-ingestion arithmetic.

### Adaptive + loud in the client (`src/agent/retrieval.ts`)

- Preferred path calls the new RPC; if distinct results run short, the scan window
  **escalates 200 → 800 → 2000 (hard cap)** — no fixed constant to rot as copies accumulate.
- Fallback path (RPC missing in an environment): legacy over-fetch + client collapse,
  with a `logger.error` naming the missing migration. Any *other* RPC error throws.
- **Alarm:** every retrieval computes `distinct/fetched`; below **0.3** →
  `logger.error` with both counts. The live table today is at **~0.13, so the alarm fires
  on production traffic now — by design.** It should be loud until n8n dedupes.

### Live, through the new path (verbatim)

```
===== RAG RETRIEVAL EVIDENCE =====
query: "How does James build a buy box?"
embedding model: text-embedding-3-small
embedding tokens: 8
source: match_documents_distinct | scanned 118 rows | duplication ratio 0.127
-> 5 distinct chunks
  [7450]  similarity=0.5677 :: That's all they know. I wanna buy a house, renovate it...
  [5319]  similarity=0.5604 :: So what does that even mean? The point of building a buy box...
  [20193] similarity=0.5512 :: And that's what we're going to jump into right now is building your bu...
  [20729] similarity=0.5473 :: James: Clarity and buy box are the most important things for investors...
  [2902]  similarity=0.5324 :: So in this week's challenge... defining your buy box...
```

Note **5 distinct** — the old fixed 30-row over-fetch found only 4. The live test now
also asserts `source === 'match_documents_distinct'`, so a fallback regression can't pass
silently.

### Mutation verification (all restored after)

```
MUTATION 1: remove the scan-window escalation
  × ESCALATES the scan window when distinct results run short (the constant-is-a-clock bug)
  Tests  1 failed | 21 passed (22)

MUTATION 2: silence the duplication alarm
  × fires logger.error below the threshold ratio
  × boundary: exactly the threshold does not fire; just below does
  × a heavily-duplicated retrieval through the full path triggers the alarm
  Tests  3 failed | 19 passed (22)

MUTATION 3: fallback silently swallows a real (non-missing-fn) error
  × an unexpected RPC error surfaces — only a MISSING function triggers fallback
  Tests  1 failed | 21 passed (22)
```

---

## 4. JOB 3 — menu moved out of the model

- `widget/widget.js` opening bubble now carries the client's exact greeting + 1–6 menu
  (with "4. Partnership Agreements (coming soon)") + the pre-numbers disclaimer — static
  copy, rendered before any network call, so the "disclaimer before numbers" requirement
  is now deterministic. Widget test asserts every menu line and the disclaimer verbatim,
  with `fetch` never called. Mutation (dropping a menu line) fails it.
- **A1 rewritten** to what the model still owns — reproducing the menu mid-conversation:

```
 ✓ A1 (rewritten): the menu reappears when asked MID-conversation 6045ms
```

The old A1 flake (model paraphrasing the menu into prose at temp 0.3) is structurally
gone for first load: static copy can't forget itself.

---

## 5. JOB 4 — deploy prep (still blocked, one command when unblocked)

Ready: `Dockerfile`, `railway.json`, `fly.toml`, `render.yaml`, `.env.example` (every
variable), `DEPLOY.md` (step-by-step + post-deploy verification curls), README now points
at it. `npm run build` clean; production server verified locally by real curl last run.

**NOT verified: `docker build`.** No Docker daemon on this machine:

```
docker absent: CANNOT verify the Dockerfile builds locally
```

**Needed from you (precisely):**
1. **Platform choice** — Railway recommended (least steps for a containerized Node service).
2. **Access** — either run `DEPLOY.md` yourself (~5 commands), or give me a token:
   Railway `RAILWAY_TOKEN` / Fly `FLY_API_TOKEN` / Render dashboard access + repo on GitHub.
3. **Env vars at deploy time** — `OPENAI_API_KEY` (**rotate first — still the exposed
   key**), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS=https://preacademy.app.clientclub.net`.
4. After deploy, the two curls in `DEPLOY.md` §1 (health + CORS preflight) are the
   acceptance gate.

---

## 6. Live test results — verbatim (all 18 + gate marker)

```
 ✓ A1 (rewritten): the menu reappears when asked MID-conversation 6045ms
 ✓ MATERIAL: a tile-budget question quotes James's retrieved rate, not an invention 6257ms
 ✓ A2: "2" routes to Flip, discloses before asking, then requests inputs 2238ms
 ✓ A3: a full flip prompt returns 101916 and ~100.8% CoC with a disclaimer 5512ms
 ✓ A4: "Can you run a flip for me?" asks for inputs, never invents defaults 2299ms
 ✓ A5: "same deal but 4 months" restates the merged inputs and confirms 8086ms
 ✓ A6: "why is the cash-on-cash so low?" explains without re-running the tool 20519ms
 ✓ A7: flip then BRRRR — the second answer uses BRRRR, not the flip replay 45916ms
 ✓ A8: "4" says partnerships are coming soon and never fabricates a calc 5490ms
 ✓ A9: a long-term-hold question picks BRRRR or asks — never forces Flip 6994ms
 ✓ A10: "should I buy this, yes or no?" stays educational, no direct instruction 6941ms
 ✓ A11: refuses to guarantee returns 4797ms
 ✓ A12: an off-topic question gets a brief redirect to real estate 6151ms
 ✓ A14: remembers the 400k across turns without re-asking 12255ms
 ✓ A15: states which defaults were applied when only required inputs are given 13785ms
 ✓ A16: memory survives a server restart (Postgres-backed, not in-process) 12233ms
 ✓ RAG: a real knowledge-base query returns chunks with real similarity scores 1457ms
 ✓ A13: a live deal run writes a qa_logs row with real token_usage 14353ms
 Test Files  1 passed (1)
      Tests  18 passed | 1 skipped (19)
```

Failures this run: **none.** Assertions changed this run: A1 (deliberately rewritten per
Job 3 — first-load menu is now the widget's, mid-conversation menu is the model's). No
assertion was loosened; MATERIAL and the RAG `source` assertion are net-new and stricter.

---

## 7. Test counts

| Suite | Distinct tests | Total assertions | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| invariants.test.ts | ~14 property defs | 393 | 393 | 0 | 0 |
| flip.test.ts | 63 | 63 | 63 | 0 | 0 |
| brrrr.test.ts | 60 | 60 | 60 | 0 | 0 |
| land.test.ts | 51 | 51 | 51 | 0 | 0 |
| agent.test.ts | 27 | 27 | 27 | 0 | 0 |
| retrieval.test.ts | **22** (was 17) | 22 | 22 | 0 | 0 |
| materialBudget.test.ts | 17 | 17 | 17 | 0 | 0 |
| quirks.test.ts | 12 | 12 | 12 | 0 | 0 |
| finance.test.ts | 10 | 10 | 10 | 0 | 0 |
| widget.test.ts | 10 | 10 | 10 | 0 | 0 |
| cors.test.ts | 8 | 8 | 8 | 0 | 0 |
| **Local total** | **~294 distinct** | **674** | **674** | **0** | **18** (live, gated) |
| live.test.ts (`RUN_LIVE_TESTS=1`) | 18 | 18 | 18 | 0 | 1 (gate marker) |

Not written: nothing from Jobs 1–4 remains unwritten. `npx tsc --noEmit` clean.
Distinct vs assertions: 380 of the 674 are generated property-test trials from ~14
property definitions.

---

## 8. Claims I cannot support

- **The Dockerfile building is unverified.** No Docker daemon here. It's a
  standard two-stage node:24-alpine build and `npm run build` succeeds outside the
  container, but "it should build" is not "it builds."
- **Nothing is deployed.** All live evidence is a local server + real OpenAI + real
  Supabase. Deployed behavior (platform networking, env wiring, cold starts) is unproven.
- **The escalation path has not fired against the real table.** Live duplication (~8×)
  is still absorbed by the initial 200-row window, so escalation is exercised only by
  unit tests with synthetic responses. It will first fire for real when duplication
  roughly doubles — exactly when it must work, and I can't rehearse that against
  production data without writing to `documents`, which I won't do.
- **The alarm fires via `consoleLogger` in the agent path.** `searchKnowledgeBase` is
  called from the agent loop without a request-scoped logger, so production alarms go to
  stderr, not Fastify's structured log with request context. Visible in any platform's
  log capture, but not correlated to a request. Wiring `request.log` through the agent
  loop is a small follow-up I didn't make this run.
- **MATERIAL is one green run.** It passed its first and only execution. Given this
  suite's history, I'd want it green across several runs before calling it stable —
  the retrieval underneath it is deterministic now, but the model's phrasing of the rate
  (`$10 to $11`) is not guaranteed to match my regex forever.
- **Job 2's verdict rests on 8 probe queries.** Broad ones, but not an inventory of the
  table. Categories I didn't probe (roofing, windows, HVAC, electrical) may be thinner
  than tile/flooring/kitchens proved to be.
- **The 0.3 alarm threshold is a judgment call**, not a measured boundary. Today's table
  sits at ~0.13 (alarming, correctly). After n8n de-dupes it should sit near 1.0. Anything
  in between is my guess at "worth waking someone up for."

## 9. Blockers

**From you:**
1. **Deploy access** (platform + token, or run `DEPLOY.md`) — holds up: deployed CORS/health
   verification, live suite against the real URL, GHL embed, Dockerfile build verification.
2. **Rotate the OpenAI key** — still the one exposed in chat.

**From the client / n8n side (not mine to fix, per the architecture boundary):**
3. **n8n dedupe + table de-dupe.** Until then: the duplication alarm will fire on real
   traffic (by design), the retrieval scan window carries the load, and the ratio degrades
   by roughly one copy per day. After the table de-dupe, expect the alarm to go quiet and
   retrieval quality to improve further (less budget wasted on copies even in-window).
4. **Clair's spec-tier sheet** — now an *upgrade*, not a launch blocker: it converts menu
   5/6 from narrative retrieved rates to labeled Budget/Basic/Standard/Premium rows via
   `tools/ingest_material_budget.mjs` (a data drop, not a build).
