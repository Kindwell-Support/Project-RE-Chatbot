# PHASE 3 — INSPECTOR CLEARANCE VERDICT

**CLEARED at `9c32390`** (`fix(server): BUG-043 — trustProxy: 1, not true`).
Reviewed across `2c0f867` → `72432d1` → `df587d7` → `9c32390`; every result below was
re-confirmed at `9c32390` unless stated.

## Does Phase 3 regress the Phase 1 isolation thesis?

**No.** Phase 3 replaced a client-asserted device uuid with a server-verified
`email:<verified>` owner, which strengthens the thesis rather than weakening it — Phase 1's
B-section was a claim about a string the client chose, and it now has teeth. The P1 pins
were re-verified by reintroduction after the re-point, out of tree and independent of the
driver defect below: six reintroductions, each firing a **precise 1–2 limb signature**
rather than a shotgun.

| reintroduced defect | red limbs |
|---|---|
| `/chat` payload closes **over** the id | site 2/3 line pins + census (2/9) |
| `/history` URL reads a captured id | site 3/3 line pin (1/9) |
| `stale(op)` inverted | P1a region + CONTROL precondition (2/9) |
| form payload closes over `sessionId` | P1c site 1/3 + census (2/9) |
| `ensureChatId` mints asynchronously | P1c ensureChatId region (1/9) |
| `ensureChatId` returns a stale id | P1c ensureChatId region (1/9) |

The narrowing cost no coverage. The defect P1 exists for — an in-flight request posting to
the chat the member just left — is caught by the **re-pointed** line pins.

## Findings

### NEW — closed

| id | sev | defect |
|---|---|---|
| **BUG-039** | **HIGH** | `/history` took `session_id` with **no owner filter**: any verified member holding a chat id read its full transcript. **The most serious defect found in this project.** Closed: ownership check + 404, byte-identical to a genuine not-found across status, headers and body; the 503 branch is not an existence oracle; identity-keyed, so a dev token is scoped too. |
| **BUG-040** | **HIGH** | `NODE_ENV` compared by raw string: `'Production'` or `'production '` disabled the auth gate **and** opened the public demo page. Closed: `resolveEnvironment()` fails closed — unknown values resolve to production; `development`/`test` still reachable when declared; boot log announces the resolution both ways. |
| **BUG-043** | **HIGH** | `trustProxy: true` trusts the whole XFF chain and takes the **leftmost** entry, which the caller controls. A rotating `X-Forwarded-For` defeated the `/auth` per-IP limit **12/12 × 200 with 12 real GHL calls** at cap 3 — the load-bearing control for both the enumeration oracle and the client's GHL quota. Closed at `9c32390` with `trustProxy: 1`. Verified 7/7: spoof, long chain and loopback all resolve to the real client; rotating sweep now `[200,200,200,429×9]` with **3** GHL calls; benign case preserved; and eight *distinct real* clients each keep their own bucket, so the fix did not re-enter the self-DoS. |

### NEW — open

- **FINDING-041 (tooling, mine).** See the void-list below.
- **FINDING-042 (narrow).** The `startPlaceholder` mint at `widget.js:1477` is unpinned:
  making it async is caught by **nothing** (0/9). Disposition (a); never in the P1 set.
  With MASON to pin.
- **FINDING-030 (escalated).** Fifth occurrence, **first captured stack**:
  `TypeError: Cannot read properties of undefined (reading 'config')` at the `describe()`
  call in `tests/sessionToken.test.ts`, reporting `Test Files 1 failed / Tests no tests`.
  Transient — four subsequent runs passed 14/14. It fired on the one run with a **second rig
  concurrently active in the same tree**, which points at concurrent vitest sharing
  `node_modules/.vite`. One data point, correlation only. Merge-gate item.

## FINDING-041 — the void-list, and its scope

The mutation driver read and wrote `widget/widget.js` in text mode. The file is pure LF
(3097 bare LF, 0 CRLF), so every line ending was translated to CRLF on write: **all 3097
lines changed on every mutation, including a no-op one.** Against a byte-identity suite
every pin then goes red regardless of whether the span covers the mutated code, so the
driver reported **CAUGHT for spans it had never exercised.** Symptom: `p1Identity` scored
"8 failed, 1 passed" where clean is "1 failed, 8 passed".

**VOID — every driver-produced verdict against these six, prior to `ae1c038`:**
`p1Identity`, `phase3Gate`, `bundleFreshness`, `widgetBundleCache`, `comps/disclosures`,
`comps/format`.

**NOT void — and this is the scope that matters:** verdicts against *behavioural* suites are
unaffected, because CRLF does not change JS semantics. This is a narrow class, not
"everything is void". The P1 table above was produced out of tree and never touched the
driver. This is the third distinct defect in this driver and the only one that faked
**passes**; the other two produced false negatives.

## Re-point verification (all seven at REAL subjects, never the copies)

| | reintroduced | verdict |
|---|---|---|
| R0 | `trustProxy: 1 → true` | **CAUGHT** 3 failed / 11 passed — exactly the three MASON claimed discriminate: spoof, loopback, rotating end-to-end |
| R1 | token seeding deleted from a widget suite | **NOT CAUGHT** — disposition **(c)** |
| R2 | widget mints a device key again | **CAUGHT** — 1 limb, ASSERTS-NO-OWNER |
| R3 | `x-james-owner` rides `/chats` | **CAUGHT** — 1 limb, ASSERTS-NO-OWNER |
| R4 | widget stops reading the token | **CAUGHT** — the re-keyed vacuity guard is live |
| R5 | server re-allows `x-james-owner` | **CAUGHT** — `cors.test.ts` |
| R6 | server re-allows `x-james-owner` | **CAUGHT** — `multiChat.origins.test.ts` |
| R7 | same defect vs the in-vitro copy | **NOT CAUGHT** — disposition **(c)**, ruled |

**R7 (ruled).** `tests/multiChat.repoints.test.ts` is *in vitro*: it lifts `corsVerdict` and
`REGISTRY_KEYS` as copies "lifted verbatim". That proves the predicate logic catches the
defect and proves nothing about whether the predicate is wired to shipping code. Verbatim
copies drift. **It is not CORS coverage** — the real pin is R5/R6 against `app.ts:274`.

**R1 (resolved).** The gate hides `.jb-form` with CSS `display:none` rather than removing it;
jsdom ignores CSS and drives the DOM directly, so the composer submits whether gated or not.
The uniform seeding is therefore **decorative** in the ten seeded suites that make no auth
assertions — it neither adds nor removes coverage. Unpinned by construction, not a product
defect. MASON's stated intent ("keeps each suite's original subject unchanged") is accurate;
the seeding simply is not load-bearing.

MASON's preservation/discriminator labelling was checked and is **honest**: R0 turns exactly
three red, and the two cases that hold under both `:1` and `:true` are labelled in the file
as non-discriminators, not merely in the report.

## Live-verified vs fake-verified

**LIVE-VERIFIED (one fact).** The GHL Course Access field id, confirmed at boot against the
live definitions endpoint:
`[ghl] Course Access field id VERIFIED against definitions { fieldId: 'axyDeZQxj7gMCtV1FyxS', name: 'Course Access' }`.

**GATE-GIVEN-FAKE (everything else GHL-dependent).** Every `/auth` decision, deny-reason,
ownership and oracle result rests on a fake built from the §7 field-shape report and run
through the **production** parser (`parseCourseAccessValues`), with fixtures byte-verified
against the report. The fake is faster than real GHL, so the ~3,509/sec figure is **our
measured throughput ceiling, not a prediction of an attacker's rate**.

## Unrun / not covered

- **Per-instance rate limiting.** In-memory fixed-window: N instances = N × cap. Stated by
  MASON at the wiring; **not tested by me**. What this pass shows the limits must cover: a
  per-IP key the caller cannot choose (now true), and a per-email key on `/chat` that
  survives IP hopping (verified in both directions).
- **Live GHL end-to-end** beyond the boot probe — the `/auth` flow was never exercised
  against live GHL.
- **Real-DB** work stayed inside the scoped `public.chats` pass.
- The **shared-store upgrade path** for limiters is untested by construction.

## Discarded / unattributable measurements

- **P7's three FAILs and the `C.gate` near-miss** — all resolved as **rig**, not product:
  `newPage` waited only on `.jb-input`, which `.jb-gated` hides; the harness never set
  `NODE_ENV`, so BUG-040's fail-closed resolved it to production and `/demo` 401'd; and a
  fake token string made `resolveOwnerKey` throw rather than fall back, so `/chats` 400'd and
  boot never reached `loadHistory`. `E.pre.chat` was the honest signal throughout. P7 re-ran
  **14/14**. `C.gate` is **not a finding**.
- **"The gate is presentational; the server accepted an untokened POST /chat" — DISCARDED.**
  Measured in the browser harness, which runs `NODE_ENV=test` where the gate is deliberately
  inactive. Confirmed directly: production → **401**, test → 502 (reaches the handler). The
  dev seam, not a defect. Nearly reported as a finding.
- **The driver's "8 failed, 1 passed" on `p1Identity`** — an artifact of FINDING-041, void.

## Instrument errors

Seventeen self-caught rig defects across the engagement, four in this pass alone:
comment-only mutations stripped by `--minify`; a mutation landing in `startPlaceholder`
rather than `ensureChatId`; a probe route the preHandler 401'd; and an ignored `noToken`
option that left a token minted. FINDING-041 is the only one that ever produced a false
**pass**.
