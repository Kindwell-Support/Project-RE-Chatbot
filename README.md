# James Dainard AI Mentor

Production chatbot for ProjectRE Academy. Answers real-estate-investing questions grounded in James Dainard's course material (RAG over the existing Supabase `documents` table) and runs his three deal calculators — reimplemented from the spreadsheets as pure, unit-tested TypeScript, so calculations are instant instead of the old n8n/Google-Sheets round-trip.

## Architecture

```
GHL lesson page (preacademy.app.clientclub.net)
  └─ loader snippet (Header Tracking Code) → widget.js → <div id="james-bot">
       └─ POST /chat ──► Fastify server
                            ├─ GPT-4o (temp 0.3) with typed function tools:
                            │    flip_calculator · brrrr_calculator ·
                            │    land_purchase_calculator ·
                            │    search_knowledge_base · lookup_material_budget
                            ├─ Supabase: match_documents (RAG, topK 5,
                            │    text-embedding-3-small), chat_messages
                            │    (conversation memory), qa_logs (analytics)
                            └─ calculators: src/calculators/*.ts (pure functions,
                                 golden-tested against the sheets' cached values)
```

The spreadsheets in `spec/` are the **specification**, not the runtime. Nothing reads them in production.

## Setup

```bash
npm install
cp .env.example .env       # fill in OpenAI + Supabase credentials
```

Run this once in the Supabase SQL editor to create the conversation-memory table (the existing `documents` and `qa_logs` tables are untouched):

```bash
sql/setup.sql
```

## Local run

```bash
npm test        # 62 tests, including every golden value from the sheets
npm run dev     # tsx watch, http://localhost:3000
```

Smoke test:

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Run a flip: 700k purchase, 150k rehab, 1.15M ARV, 6 months","session_id":"local-test","member_email":"dev@test.com"}'
```

## Build & deploy

```bash
npm run build   # tsc → dist/, esbuild → public/widget.js
npm start
```

Containerized (works as-is on Railway / Fly / Render):

```bash
docker build -t james-mentor .
docker run -p 3000:3000 --env-file .env james-mentor
```

**Deploying: follow [DEPLOY.md](DEPLOY.md) step by step.** It has one-command paths for
Railway (`railway.json`), Fly (`fly.toml`), and Render (`render.yaml`), the full env-var
table (see also `.env.example`), the post-deploy verification curls (health + the CORS
preflight that broke the old build), and the GHL wiring. Two SQL artifacts must exist in
the Supabase project: `sql/setup.sql` (chat_messages — applied) and
`sql/add_match_documents_distinct.sql` (deduped retrieval RPC — applied 2026-07-15).

The server serves its own widget bundle at `GET /widget.js`, so no separate CDN is required. Set `ALLOWED_ORIGINS` (comma-separated) — CORS is allow-listed, never `*`.

## GHL embed — THE live snippet (Phase 3 final)

This section is CANONICAL — DEPLOY.md defers here. Both halves below are the
exact text to paste; the host is the real deployment, not a placeholder.

**1. Lesson body** (each lesson that should show the bot) — content only, GHL
strips `<script>` here:

```html
<div id="james-bot" style="width:100%;height:700px;"></div>
```

**2. Loader** — paste into the membership site's **Header Tracking Code**
(Settings → Advanced → Header Tracking Code; this field does NOT strip
scripts). NOTE: an earlier DEPLOY.md said "Business Profile" — the two
documents disagreed because this snippet never lived in version control.
Confirm the field on paste: the correct one is the SITE-level header code for
the members portal, not an account-level field.

```html
<!-- James Dainard AI Mentor loader (Phase 3) -->
<script>
(function () {
  var API_URL = 'https://re-chatbot-vvtnk.ondigitalocean.app';
  var s = document.createElement('script');
  s.src = API_URL + '/widget.js';
  s.async = true;
  s.onload = function () {
    window.createJamesBot({
      apiUrl: API_URL,
      target: '#james-bot'
    });
  };
  document.head.appendChild(s);
})();
</script>
```

No `memberEmail`: since Phase 3 the widget collects and VERIFIES the member's
email itself (GHL Course Access gate + signed session token), so the old
localStorage email sniff is gone. `createJamesBot` still ACCEPTS a
`memberEmail` option for older pasted snippets — it is ignored for identity.

The widget renders immediately, gates chat access behind member verification,
survives GHL's SPA lesson swaps via a `data-mounted` guard + `MutationObserver`,
and keeps working if a history load fails.

## Project layout

```
src/calculators/   finance.ts (Excel-compatible PV/PMT/IRR/ROUND), flip.ts, brrrr.ts, land.ts
src/agent/         system prompt, typed tool definitions, tool runners, RAG retrieval,
                   material-budget lookup (structured table, NOT vector search)
src/server/        Fastify app: /chat, /health, /widget.js, CORS, memory, qa_logs
widget/            widget source → esbuild → public/widget.js
tests/             golden regression tests (sheet cached values), CORS preflight test
spec/              the three source spreadsheets (read-only specification)
sql/setup.sql      chat_messages table for conversation memory
tools/dump.mjs     dev utility: dumps formulas + cached values from the xlsx files
```

## Calculator guarantees

- Every output in `tests/*.test.ts` reproduces the sheets' own cached values at their default inputs (±1 for rounding).
- Land calculator: `C9` (interest reserve months), `C11` (purchase closing costs), and `C12` (utilities/insurance) are **computed formulas**, exactly as in the sheet — the old build hardcoded them and produced wrong numbers. Explicit overrides exist but are opt-in.
- Every unspecified optional input falls back to the sheet default, and each tool result reports `defaults_applied` so the agent can disclose them.

## Known gaps

See [FINDINGS.md](FINDINGS.md) — most notably the material/construction rate table is scaffolded but **not loaded** (source sheet wasn't supplied); the lookup tool returns an honest "not loaded yet" answer instead of fabricating rates.
