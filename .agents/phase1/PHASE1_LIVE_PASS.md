# PHASE 1 — LIVE BROWSER PASS

**Reviewed SHA: `c709bc6`** (feat/multi-chat). Working tree at review time carried
only three untracked comps files; nothing in `tests/`, `src/`, `widget/` was
written by this pass. All rig files live outside the git tree (`D:\_inspector_p1`).

MASON has landed no Phase 2 UI work at this SHA — HEAD is unchanged from the
briefing's snapshot, so there is no replaced layout to avoid testing.

---

## STEP 1 — the /chats 503 was a fake-choice, confirmed

Status alone could not settle it: both hypotheses predict 503. The discriminator
is the error the route caught.

- `makeFakeSupabase` → **503**, caught error verbatim:
  `TypeError: supabase.from(...).select(...).eq(...).is is not a function`
  at `listChats (src/server/chats.ts:75)`. A builder method absent from the
  fake — not a defect in the route.
- `makeChatsSupabase` → **200**.

Full semantics under the swap (`GET /chats`, one owner):
`titles ["Beta","Alpha"]` — newest `last_message_at` first · archived row
excluded · other owner's row excluded · `owner_key` not leaked ·
`archived_at` not leaked · keys exactly `id,title,created_at,last_message_at`.

**[widget-given-fake]** every line above. Exclusion of the archived row is the
fake's `.is('archived_at', null)` filter, not the real partial index.

---

## STEP 2 — BOOT-ORDERING CHECK #4: CLOSED on my own evidence

Rig: the committed `tests/multiChat.bootOrder.test.ts` copied verbatim with one
line changed — the widget source path — so the same assertions run against a
pristine and a mutated widget. Diff vs committed is that single line.

**CONTROL (pristine `widget/widget.js`): 3/3 green.** The rig is faithful.

**BUG-020 reintroduced.** The widget's own comment names the removed optimistic
repaint as "the last surviving racer of BUG-020's shape". I put exactly that
back — decide the active chat from `ACTIVE_KEY`, paint the rail, fetch its
transcript, all before `/chats` resolves.

Result: **RED, on the ordering relation itself**, not a count:

```
AssertionError: a transcript was fetched before the chat list resolved — the BUG-020 shape
+ [ "https://api.example.com/history?session_id=aaaaaaaa-..." ]     (bootOrder:130)
AssertionError: a transcript was fetched while the chat list was still in flight
+ [ { phase: "request", url: ".../history?session_id=aaaaaaaa-..." } ]  (bootOrder:142)
```

The CONTROL case stayed **green** under the mutant — the mutation is surgical,
so the red is the ordering rule breaking, not the widget breaking generally.

### Per-limb non-vacuity — the stall case asserts four things, vitest stops at one

One mutant per limb, each reintroducing only that limb. Each fires its own
assertion and only its own:

| mutant | fires | assertion |
|---|---|---|
| `m-fetch` | fetch limb (both tests) | `a transcript was fetched...` |
| `m-paint` | paint limb, :143 | `a chat row was painted before the list resolved` (1 row) |
| `m-mint`  | mint limb, :147 | `the active chat was re-decided...` (`bf2c06fe-…` vs `aaaaaaaa-…`) |
| `m-block` | composer limb, :153 | `a stalled chat list disabled the composer` |

No limb is vacuous. The `m-mint` mutant reproduces the tail of BUG-020's live
signature specifically — `ACTIVE_KEY` rewritten to a uuid that did not exist
before. MASON's "mutation-proven" now has independent evidence behind it.

---

## STEP 3 — A3–A8 LIVE, real Chrome 151, real routes, real /widget.js bundle

Harness: real `buildApp` on 127.0.0.1:3001, fake OpenAI + `makeChatsSupabase`
injected at the app's own dependency seam. Two gates, because "in flight" has
two meanings for a non-streaming endpoint: `gateModel` (inside the OpenAI call,
nothing persisted) and `gateSend` (fastify `onSend`, body built, not flushed).

### A4 — in-flight switch, three timings: 21/21 PASS

| | timing | A's reply in B | unrequested bot bubble in B | jb-busy on B | **A's reply on return** |
|---|---|---|---|---|---|
| A4a | **78 ms** in-page | 0 | 0 | false | **exactly 1** |
| A4b | body parked at onSend | 0 | 0 | false | **exactly 1** |
| A4c | release + switch, same tick | 0 | 0 | false | **exactly 1** |

Zero uncaught widget exceptions in every variant.

**Harness correction worth recording.** The first two runs reported the A4a
switch at 416 ms then 220 ms and would have been *reported as <200 ms testing
that never happened*. `page.type()` emits a real keystroke per character and I
had started the clock before typing; the remainder was CDP round-trip latency.
Both clicks and the wait now happen inside the page, so the measured window is
the member's, not the driver's — 78 ms.

**The exactly-once half is not vacuous.** Two mutant bundles built from mutated
copies of `widget/widget.js` (served by request interception; the repo bundle is
untouched), both targeting the replay loop in `loadHistory` so they stay inside
A4.4's subject:

- `M-drop` (assistant rows dropped on replay) → **0** — assertion goes red
- real bundle → **1** — green
- `M-dup` (transcript replayed twice) → **2** — assertion goes red

A4.4 discriminates all three. "Never rendered into B" cannot be satisfied by a
widget that drops the reply.

Mechanism note: the widget *does* abort `/chat` on switch, but the server
completes and persists regardless, so the single render on return comes from
`/history` replay. That is why the 0-case needed a replay-path mutant to reach.

### A3 — calculator form: PASS
Real tool call (`request_calculator_form` → flip) drove a real form. Half-filled
`["150000","150001"]`, switched to B: **no form in B, no retained values in B**.
*OBSERVATION* — returning to A: form absent, values gone. Spec is silent; reported
either way, not scored.

### A5 — rapid switching: PASS
`/history` stalled 300 ms, switched every 80 ms, A→B→A→B. Final (B) transcript:
no A rows, no duplicates by text, and order matches **what the server actually
sent for B** — asserted against a live `/history` fetch rather than an assumed
chronology, so the fake's ordering cannot decide the result.

### A6 — two tabs, real multi-page: 13/13 PASS
- **6a same chat:** tab1 `["from tab one","REPLY-FOR-A"]`, tab2 `["from tab two","REPLY-FOR-A"]`.
  Neither tab renders the other's bubble; no duplicates; `ACTIVE_KEY` one value in both.
  A `.self` guard on each tab keeps the merge check from passing against a blank pane.
- **6b different chats:** no crosstalk either direction, plus a `live` vacuity guard
  confirming each tab rendered its own turn.
- *OBSERVATION* — `ACTIVE_KEY` is one shared value by definition; both tabs read
  `bbbb…` after B wrote last. Last-writer-wins on reload is **expected, not a bug**;
  no transcript crossed.

`bringToFront()` per tab: Chrome delivers input to the active target and driving a
backgrounded tab hangs the CDP call. It is also the faithful model.

### A7 — /history scoping: PASS **[widget-given-fake]** — SERVER assertion
`GET /history?session_id=B` → `["B-question"]`, zero A rows.

*OBSERVATION, verbatim as asked:* `DELETE /chats/A → 204`, then
`GET /history?session_id=A → 200
{"messages":[{"role":"assistant","content":"A-private-answer"},{"role":"user","content":"A-private-question"}]}`
Soft delete (R4) leaves `chat_messages` readable to anyone holding the id — consistent
with the route's own exposure note, but worth stating plainly: **delete does not
revoke transcript access.** **[widget-given-fake]** — archived via the fake's
`archived_at`, not the real partial index.

### A8 — prompt-level leak: PASS
Substantive turn in A ("the duplex on Cedar Street with a 92000 rehab"), then
"what did I just ask you about?" in B.

Asserted **on the captured messages array**, never on the answer text: across B's
2 outbound turns / 4 messages, **zero** messages carrying A's transcript.

*The narrow truth:* this proves **the widget sent B's session_id and not A's** —
both of B's outbound turns carry `bbbbbbbb-…`. The payload capture is server-side,
so the isolation half is **[widget-given-fake]**.

---

## FINDINGS — test infrastructure, not Phase 1 defects

**F-A. `chatsFakes.ts` returns `/history` in reversed order.** Probed:
served `[A2, Q2, A1, Q1]` where production returns `[Q1, A1, Q2, A2]`.
Cause: `getHistory` chains **two** `.order()` calls (`created_at`, then `id` as
the load-bearing tiebreaker) but the fake's `order` overwrites `sortKey`, and its
message rows carry no `id` — so the sort is a no-op and `getHistory`'s `.reverse()`
inverts insertion order.
Blast radius today: **none**. The only committed `/history` assertion
(`multiChat.api.test.ts:299`, T2) uses a single-message chat, so order never bites.
It is a trap for the next order assertion written against this fake. A5 was
designed around it.

**F-B. The fake's "throws on unimplemented builder call" guard only covers the
first link of a chain.** `build()` returns `new Proxy(chain, …)`, but every
builder method `return chain` — the **raw** object, not the proxy. So after one
call you are off the proxy and missing methods are plain `undefined`.
Evidence: both real misses surfaced as bare TypeErrors, never the fake's own
message — `.eq(...).is is not a function` (Step 1) and
`.eq(...).maybeSingle is not a function` (session_state read during A3/A6, caught
and degraded). The header comment claims a chain the production code starts using
"cannot silently resolve to nothing and leave a suite green against a path it never
ran"; that property holds only for `.from(x).missing()`. Returning the proxy from
each builder method would restore it.

---

## SUITE BASELINE at c709bc6

`Test Files 3 failed | 50 passed | 1 skipped (54)` · `Tests 15 failed | 1641 passed | 43 skipped (1699)`

All 15 reds in `tests/comps/` — `format.test.ts` (13), `cache.test.ts` (1),
`arvRemoved.test.ts` (1). Pre-existing, from main's §10 amendment, fixed and
waiting on `fix/comps-copy-repoint @ 7152fbd`. **Zero multi-chat reds.**

---

## STEP 4 — E3, E4, F2, F4, F5, F6

### E3 — LIST LIMIT, NO PAGINATION: 0 failures
`MAX_ACTIVE_CHATS === CHAT_LIST_LIMIT === 50`. 60 active rows seeded under one owner.

- `GET /chats` → **50 of 60**, newest first, chat 0 absent. No offset/cursor/page
  parameter exists — 10 rows are off the end with no second page. **[wgf]**
- `POST /chats` at 60 active → **409**. The cap holds on the create path, so 51+
  cannot arise via the API. **[wgf]**
- `POST /chat` to the unlisted chat → **200, model ran, turn served**. So an
  unlistable chat is still billable — but only to someone holding the id directly;
  same exposure class as `/chat` already carries, not a new one. **[wgf]**
- **The real one — can the ACTIVE chat fall off?** No. Booted with `ACTIVE_KEY`
  pointing at the off-list chat: the widget **relocates** the member to chat 59
  (newest, listed) rather than stranding them. Rail 50 rows, active row listed,
  a turn afterwards renders normally.
- Touching an off-list chat bumps `last_message_at` and pulls it back above the
  cut — so 51+ is recoverable, not orphaned. **[wgf]**

> **Wrong-subject correction, my own.** The first E3 draft ran part (d) on the
> harness where part (c)'s `POST /chat` had already bumped chat 0 to position 0.
> The "active chat is off the list" precondition no longer held, so `E3.d1`
> passed against a scenario that never happened. Fixed with a fresh harness plus
> an explicit `E3.d-pre` precondition assertion.

### E4 — RELOAD MID-CONVERSATION: 0 failures
Three turns, then hard reload. Chat B seeded as *newest* so "restored the right
chat" is distinguishable from "restored the newest".

- Restores **Chat A**, not Chat B, not a placeholder. 6/6 messages, no duplicates,
  no foreign rows, scroll at bottom (`100+536` vs `636`) — with an explicit
  overflow guard so the scroll check isn't measuring a non-scrolling pane.
- **Order, split deliberately into two subjects.** `p1.order` scores *does the
  widget reorder?* (rendered === served: PASS). Chronology can't be scored from a
  server-built transcript here because the fake reverses it (finding F-A), so
  `p1b` closes it on an id-bearing seed: server returns `[Q1,A1,Q2,A2]` and the
  widget renders exactly that. A naive "order is correct" assertion would have
  gone red purely because of the fake.
- **Reload while in flight:** no stuck spinner, no surviving `jb-busy`, composer
  live, no duplicates. The turn is **not lost** — it persists server-side and
  reappears on the next load.
- *OBSERVATION:* between the mid-flight reload and the turn landing the member
  sees an **empty pane** — their sent message isn't echoed back until a later
  load. Recovery is clean; the in-flight turn is invisible for that window.

### F2 — GHL SPA SURVIVAL: 0 failures
Instrumented **before any page script ran** (`evaluateOnNewDocument`), because
observer/listener accumulation is invisible from the DOM afterwards.

5 lesson swaps (remove `#james-bot`, insert a fresh one). After every cycle:
`.jb-root` = 1, `.jb-side` = 1, `.jb-side-list` = 1, `MutationObserver.observe`
registrations **stay at 1**, listeners on window/document/body **stay at 1**.
Rail still 2 rows and a full turn completes after all five.

Listener counting is scoped to window/document/body only — listeners on freshly
created widget nodes are *supposed* to grow per mount and those nodes are
discarded; counting them would measure the wrong thing.

- *OBSERVATION:* re-inserting the **same** node (still carrying
  `data-mounted="true"`) keeps the live widget — correct, since the guard is
  idempotent by attribute. A host that recreated the node but copied its
  attributes would get a permanently blank div. GHL creates fresh nodes.
- **Phase 2 hazard: not present yet.** No body-level scroll lock exists at
  `c709bc6` — `body.style` / `documentElement.style` overflow is never touched.
  `F2.scrolllock` is currently **passing against code that cannot fail it**.
  Re-run F2 when the overlay rail / drawer / scroll lock lands; that assertion is
  the one that catches a lock surviving a lesson swap.

### F4 — /widget.js CACHE: **1 FAILURE — a real finding**
`Cache-Control: no-cache` confirmed, correct Content-Type, 35,542-byte bundle,
loader executes, `/demo`'s `?v=` bust intact and changing per render, busted URL
byte-identical.

**But the route serves NO validator — `ETag: null`, `Last-Modified: null`.**
No `@fastify/etag` or `@fastify/static` is registered and Fastify core adds
neither. So a 304 is **unreachable at this origin**.

The route comment (app.ts:181-186) justifies the change on cost: *"the live host
already answers If-Modified-Since with 304, so this costs one conditional round
trip per page load and nothing else."* That precondition is not met.

Measured on the **member path** — a GHL-style embed of `/widget.js` with no
cache-bust, three loads in real Chrome:
`[200 / 35542B, 200 / 35542B, 200 / 35542B]` — **0 revalidations, 3 full
re-downloads.** ~35KB per lesson view, not a 304.

Not a correctness defect: the widget works, and `F4.5c` confirms a complete turn
from the unbusted embed. It is a false cost claim, and worth resolving before it
is relied on. **Note the origin/edge distinction:** this measures `buildApp`
directly. Whether the deployed host has a proxy that adds a validator is
unverified here and should be checked against the live host before either fixing
or trusting the comment.

### F5 — FIRE-AND-FORGET FAILURE PATHS: 0 failures, 1 latent structural gap
Both documented failures forced, with `process.on('unhandledRejection')` watching:

- **Title generation rejects** (injected on the `gpt-4o-mini`/`max_tokens:24`
  call): member response 200 and unaffected, **0 unhandled rejections**, process
  alive, and the chat still gets a name — `generateChatTitle` computes the
  fallback *first*, so `title = "first message in this chat"`. **[wgf]**
- **`last_message_at` touch fails** (injected `57014` statement timeout on the
  chats UPDATE): member response 200 and unaffected, **0 unhandled rejections**,
  timestamp goes stale exactly as documented, and the next turn works. **[wgf]**

Both guarded by `attempted` counters (1 and 2), so neither passed by not running.

**LATENT GAP.** `void touchChat(...).then(() => generateChatTitle(...))` at
app.ts:527 has **no `.catch()`**. Its sibling three lines above,
`void logExchange(...).catch(...)`, has one — and the comment calls it *"the
call-site guarantee that an unhandled rejection can never terminate the process
on Node 15+."*

Demonstrated both shapes side by side in-process: guarded → 0 unhandled;
unguarded → 1 unhandled. **Not live today** — verified by reading both callees;
`touchChat` (chats.ts:198-251) and `generateChatTitle` (chats.ts:271-320) each
wrap their entire body in try/catch and log rather than throw, which (a1)/(a2)
confirm empirically. The gap is that the guarantee lives in the callees while the
sibling call site does not rely on that. One future line inside that `.then()`
that rejects, or a callee refactor letting an error escape, kills the process.

### F6 — DEAD-GUARD SWEEP: it caught two of my own
Built a mutant bundle whose `loadHistory` renders nothing, ran the A5 scenario
against it, and re-evaluated the real A5 expressions:

| assertion | on a blank render | verdict |
|---|---|---|
| A5.1 "no foreign rows" | **true** | would have PASSED vacuously |
| A5.2 "no duplicates" | **true** | would have PASSED vacuously |
| A5.3 rendered === served | false | catches it independently |
| **A5.0** (new guard) | **false** | fires — load-bearing, not decorative |

`A5.1`/`A5.2` and `A7.1` were `.every()` quantifiers over a possibly-empty set —
vacuous exactly as the standing check warns. Guards `A5.0` and `A7.0` added and
**proven red-capable**, not merely added.

Full branch enumeration run over all 15 conditional sites written this pass. Three
flagged:
- A5/A7 `.every()` — was vacuous, now guarded (above)
- **F4.2a's 304 branch — NEVER EXECUTED**, because the origin serves no validator.
  That assertion has never run and must not be read as passing. Reported as the
  F4 finding rather than hidden.

All other branches confirmed executed, or confirmed to be throw-not-skip guards
where a miss aborts loudly instead of silently dropping assertions.

**[wgf]** = widget-given-fake: depends on server behaviour, and `makeChatsSupabase`
models neither column defaults, NOT NULL on `last_message_at`, nor the partial
index predicate.

---

## REAL-DB PARTIAL-INDEX PASS — EXECUTED 2026-08-22, 0 failures

Authorized and scoped. Full protocol and evidence in `../PHASE1_MATRIX.md` §5.

owner_key pinned and printed **before** the first write:
`device:9f3b1c7e-2a54-4d18-8b6a-77c0e5d41a92`

Pre-flight `public.chats` = 0 rows, 0 under the pinned key. Three rows created
via the real `POST /chats`; control listing returned all three; the middle row
archived through the real `DELETE /chats/:id` → **204**; `GET /chats` returned
**exactly the two survivors** by identity (set comparison, so identical default
timestamps cannot make it flaky); the archived row **still exists** with
`archived_at = 2026-08-21T19:23:40.447+00:00`; Postgres itself reports 2 active
of 3 total for that owner — the predicate excludes exactly one row **in the
database rather than in JS**, which is the gap `makeChatsSupabase` could never
cover. Hard-DELETE scoped to the pinned owner_key removed 3 rows.

**Post-cleanup count: 0**, matching pre-flight. Independently re-verified in a
fresh process with a fresh client: total 0, owner rows 0, archived rows 0.

Constraints honoured: nothing outside `public.chats`, no comps lookups, no
`POST /chat` so no agent run and no OpenAI spend. Standing invariant restored.

Not covered: index presence/usage — an `EXPLAIN` needs raw SQL and the Supabase
MCP connector returned permission-denied, so routes were driven through
`app.inject()` with a service-role client. Predicate **behaviour** is verified,
which is the leak risk; index usage remains a performance question.

Not run, as instructed: B4 (moot — W1 adoption dropped), N1 (`adopted_legacy`
removed from the schema).
