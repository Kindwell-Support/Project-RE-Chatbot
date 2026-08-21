# PHASE 1 QA MATRIX — multi-chat + sidebar

**Why this file is in the repo.** The Phase 1 scenario matrix previously existed
only in an INSPECTOR session's working context and in a temp scratchpad. Both
died at a context limit, and the next session could recover only three planning
docs — `BOOT_ORDERING_ATTACK.md`, `BROWSER_SCENARIOS.md` (A3–A8 only) and
`REAL_DB_PLAN.md`. E3/E4/F2/F4/F5/F6 had to be re-supplied by the operator from
memory. Anything that must survive a session boundary belongs in the tree, not
in `%TEMP%`. That is the whole reason this file exists.

Reviewed at **`c709bc6`** (feat/multi-chat); housekeeping commit `7467b0b`.
Full evidence: `PHASE1_LIVE_PASS.md` (INSPECTOR scratch) — findings summarised below.

---

## 1. THE SCENARIO MATRIX — definitions, so they never need reconstructing

### A-series — chat isolation in a real browser
Harness: real `buildApp`, fake OpenAI + `makeChatsSupabase` at the app's own
dependency seam, real routes, real CORS, real `/widget.js`, driven by
puppeteer-core against system Chrome. Nothing durable is created.

| id | subject | definition |
|---|---|---|
| **A3** | calculator form lifecycle | Open a calculator in A, half-fill it, switch to B without submitting. B must show no form and no retained values. Returning to A: report persistence either way as an OBSERVATION — the spec is silent. |
| **A4** | in-flight chat switch — *the highest-probability leak* | Send in A, switch to B while the turn is in flight, at three timings: **(a)** <200 ms, **(b)** mid-stream (headers released, body held), **(c)** just before completion. Assert on B: never contains A's reply, never gains an unrequested bot bubble, no `jb-busy` leak. Then **switching back to A must show A's reply EXACTLY ONCE** — not zero. "Never rendered into B" is also satisfied by a widget that drops the reply entirely, which is a different bug wearing a passing test. |
| **A5** | rapid switching | A→B→A→B faster than `/history` resolves — stall each `/history` 300 ms, switch every 80 ms. Final transcript contains only the final chat's rows; no duplicate bubbles counted by text; no interleaving. |
| **A6** | two tabs (multi-page) | **6a** same chat, send from both: neither tab renders the other's bubble twice, `ACTIVE_KEY` ends on a single value, no merged transcript. **6b** different chats: no crosstalk either direction. `ACTIVE_KEY` is shared across tabs by definition, so last-writer-wins on reload is EXPECTED — an OBSERVATION, not a bug, unless a transcript crosses. |
| **A7** | `/history` scoping *(server)* | `GET /history?session_id=B` returns zero A rows. Then request a soft-deleted chat's id and report the response verbatim. |
| **A8** | prompt-level leak | Substantive turn in A, then in B ask "what did I just ask you about?". Assert on the **captured OpenAI messages array** for B's turn: zero messages whose content appears in A's transcript. **Never on the answer text** — a model that happens to say "I don't know" would mask a payload carrying A's history. What it proves about the widget: it sent B's `session_id`, not A's. |

### E-series — limits and lifecycle
| id | subject | definition |
|---|---|---|
| **E3** | list limit, no pagination — *can a chat be billable but unreachable?* | `GET /chats` returns at most 50 active chats, newest `last_message_at` first, no pagination, no offset. With 60 active rows under one owner: can chat 51+ be reached by any UI path; can a member still `POST /chat` to it and be billed; and **can the ACTIVE chat fall off the list** — does a chat the member is currently in vanish from the rail when 50 newer ones exist? The last is the real defect if it holds. Note the C1 cap interacts: `POST /chats` and the self-heal insert both reject above 50. |
| **E4** | reload mid-conversation | Several turns, then hard reload. Assert: the **correct** active chat is restored (not the newest, not a placeholder), full history present, order correct, no duplicates, scroll at bottom. Then reload **while a response is in flight** and assert clean recovery rather than a stuck pending state. |

### F-series — host integration and process safety
| id | subject | definition |
|---|---|---|
| **F2** | GHL SPA survival with the sidebar mounted | GHL swaps the DOM without a page load; the widget survives via a `data-mounted` guard plus a MutationObserver. Remove and reinsert `#james-bot` repeatedly. After each cycle: exactly ONE `.jb-root`, no duplicated sidebar, no orphaned listeners accumulating, and **the observer itself not registered twice**. **Matters more under Phase 2** — body-level scroll lock is the specific hazard: a lesson swap while the drawer is open can leave the lock in place and the whole GHL page unscrollable. `/demo` cannot catch this; it is not an SPA. |
| **F4** | `/widget.js` cache behaviour | The Phase 1 header change, `public,max-age=300` → `no-cache`. First fetch 200 with the bundle; a conditional revalidation returns 304; the loader executes after both. `/demo`'s `?v=Date.now()` cache-bust undisturbed and still fresh. |
| **F5** | fire-and-forget failure paths | Two paths run detached after the response is sent: title generation and the `last_message_at` touch. Force each to fail. Assert: no unhandled rejection, the process survives, the member-facing response is unaffected and already delivered. Then confirm the conversation still works with only the sidebar timestamp going stale. |
| **F6** | dead-guard sweep — *standing post-slice requirement* | For every conditional assertion written in a pass, instrument it and prove each branch executes. A guard that never runs is worse than no guard, because it reads as coverage. Has caught real ones on both sides — including a composer assertion that passed vacuously because `submitMessage` empties the input itself. |

### Standing checks applied to every item
- **Wrong-subject.** Name the subject each assertion measures and confirm it
  distinguishes the pass case from the SPECIFIC failure it targets. Not "does it
  go red" — "does it go red for the right reason." **Seven instances across both
  agents to date.**
- **widget-given-fake.** Flag any result line whose truth depends on server
  behaviour rather than widget behaviour. `makeChatsSupabase` models neither
  column defaults, NOT NULL on `last_message_at`, nor the partial-index predicate.

### Do NOT run
- **B4** — moot. W1 adoption was dropped, so planting cannot surface a chat by construction.
- **N1** — `adopted_legacy` removed from the schema.

### Letters whose definitions did not survive
`C-1`, `D1`, `F3`, `H`, `I1/I2/I3`, `J1/J3`, `M7/M8/M9`, `N2/N3` are all
referenced as carried-closed but their full text is lost. They are recorded in
§3 by what is known of them. **If any needs re-running, its definition must be
re-derived and written back here.**

---

## 2. RESULTS AT `c709bc6`

| item | result |
|---|---|
| Fake swap / 503 provenance | PASS — the 503 was a fake-choice |
| Boot-ordering check #4 | **CLOSED** — mutation-proven independently, all four limbs |
| A3 · A4 · A5 · A6 · A7 · A8 | PASS (A4 21/21 across three timings) |
| E3 · E4 · F2 · F5 · F6 | PASS |
| **F4** | **FAIL — real finding, see §4** |
| Real-DB partial-index pass | PASS, table restored to 0 rows |

Suite baseline: 15 reds, all in `tests/comps/` (`format` 13, `cache` 1,
`arvRemoved` 1) — pre-existing from main's §10 amendment, awaiting
`fix/comps-copy-repoint @ 7152fbd`. **Zero multi-chat reds.**

---

## 3. CARRIED CLOSED — do not re-run without cause
J1/J3/BUG-016 24/24 · RLS (service-role only, no anon key in `src/config.ts`) ·
H re-points all five by reintroduction · I1/I2/I3 CORS, nine origins denied ·
F3 · D1/N2/N3 · FINDING-023 assertion sound both directions · check #3
commit-order (`bca69a5` precedes `2dfc31e`, no unpinned window).

---

## 4. OPEN FINDINGS HANDED TO MASON

**F4 — `/widget.js` serves no validator.** No `ETag`, no `Last-Modified`; no
`@fastify/etag` or `@fastify/static` registered and Fastify core adds neither.
A 304 is unreachable at the origin. Measured on the member path (GHL-style
embed, no cache-bust), three loads in real Chrome: **0 revalidations, 3 full
35,542-byte re-downloads.** The route comment at `app.ts:181-186` justifies
`no-cache` on a 304 that the origin cannot produce. *Operator ruling: the
observed 304 was Cloudflare synthesising `Last-Modified` at cache-fill.* MASON
is fixing it properly — hash at boot, real ETag, handle `If-None-Match`, keep
`no-cache`. **Caveat preserved: this measures `buildApp` directly and cannot see
the deployed edge.**

**F5 — missing `.catch()` on a detached chain.** `void touchChat(...).then(() =>
generateChatTitle(...))` at `app.ts:527` has no `.catch()`. Its sibling three
lines above, `void logExchange(...).catch(...)`, has one, and the comment calls
it "the call-site guarantee that an unhandled rejection can never terminate the
process on Node 15+". Demonstrated both shapes in-process: guarded → 0
unhandled, unguarded → 1. **Latent, not live** — both callees currently wrap
their whole body in try/catch. The defect is the asymmetry: the guarantee lives
in another file, where a refactor deletes it without noticing.

**Fake-fidelity gaps in `tests/helpers/chatsFakes.ts`:**
1. `/history` comes back **reversed**. `getHistory` chains two `.order()` calls
   (`created_at`, then `id` as the load-bearing tiebreaker); the fake's `order`
   overwrites `sortKey` and its message rows carry no `id`, so the sort is a
   no-op and `getHistory`'s `.reverse()` inverts insertion order. No current
   false green — the only committed `/history` assertion uses a single-message
   chat — but a trap for the next order assertion.
2. **The "throws on unimplemented builder call" guard covers only the first link
   of a chain.** `build()` returns `new Proxy(chain, …)`, but every builder
   method returns the **raw** `chain`, so after one call you are off the proxy
   and missing methods are plain `undefined`. Both real misses surfaced as bare
   TypeErrors, never the fake's own message: `.eq(...).is` and
   `.eq(...).maybeSingle`. A safety net with the same gap as the bug it should
   catch. Fix: return the proxy from each builder method.

---

## 5. REAL-DB PARTIAL-INDEX PASS — executed, 2026-08-22

**The gap it closes.** `makeChatsSupabase` filters in JavaScript, so
`.is('archived_at', null)` in `listChats` had never executed against real
Postgres. A wrong predicate leaks archived chats into list results in production
and nowhere else.

Index under test (`sql/chats.sql:30`):
```sql
create index if not exists chats_owner_active_idx
  on chats (owner_key, last_message_at desc) where archived_at is null;
```

Protocol, as ruled — owner_key **pinned and printed before the first write**:
`device:9f3b1c7e-2a54-4d18-8b6a-77c0e5d41a92`

1. Pre-flight: `public.chats` = **0 rows**; 0 rows under the pinned key (aborts if dirty).
2. 3 rows created through the real `POST /chats` route.
3. Control: `GET /chats` → 3 rows, all present. *Without this the post-archive count proves nothing.*
4. Middle row archived through the **real `DELETE /chats/:id`** route → **204**.
5. `GET /chats` → **exactly 2**, and by identity: first ✓, third ✓, middle ✗ (compared as a **set**, so identical default timestamps cannot make it flaky).
6. Unfiltered read: the archived row **still exists**, `archived_at = 2026-08-21T19:23:40.447+00:00`. Soft delete (R4) confirmed against the real table.
7. Postgres's own evaluation: 2 active of 3 total for that owner — the predicate excludes exactly one row, **in the database rather than in JS**.
8. Hard-DELETE **scoped to the pinned owner_key**: 3 rows removed.
9. **Post-cleanup count: 0**, matching pre-flight. Independently re-verified in a
   fresh process with a fresh client: total 0, owner rows 0, archived rows 0.

Constraints honoured: nothing outside `public.chats`; no comps lookups; no
`POST /chat`, so no agent run and no OpenAI spend. Standing invariant restored —
no row exists in `chats` without a message.

**Not covered:** index *presence and usage* (an `EXPLAIN` needs raw SQL; the
Supabase MCP connector returned permission-denied, so routes were driven through
`app.inject()` with a service-role client). What is verified is **predicate
behaviour**, which is the leak risk. Index usage remains a performance question,
not a correctness one.

---

## 6. CARRIED INTO PHASE 2 (`feat/phase2-ui`, off `c709bc6`)

1. **Verify every re-point MASON announces by reintroducing the original defect
   the assertion was written to catch.** A re-point that no longer catches its
   defect is a BUG. Expect re-points to the `#james-bot .jb-main button must be
   exactly one` tripwire, the storage-key allow-list, and class-name assertions.
2. **Independently verify `stale(op)`, `op.cleanup` inerting, and call-time
   `sessionId` are byte-identical to `2dfc31e`.** A layout change is exactly when
   those get relocated, and they are what stops chat A's late answer painting
   into chat B.
3. **Re-run F2 once the overlay rail lands.** At `c709bc6` the widget sets no
   body-level scroll lock, so `F2.scrolllock` currently passes against code that
   cannot fail it — a dead guard by construction until the drawer exists.
4. **Re-verify F4** after MASON's fix: a real ETag is served, 304 is actually
   reachable on a matching `If-None-Match`, the ETag **changes when the bundle
   changes**, and — the wrong-subject check — the assertion distinguishes "304
   returned" from "the 304 branch never executed", which is the exact vacuity F6
   flagged in the original F4 run.
