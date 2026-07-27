# RUN REPORT — "Ask James" UI redesign (dark room, warm light)

Date: 2026-07-22. Visual-layer redesign of the chat widget and the `/demo` page.
Previous run's report archived at `reports/RUN_REPORT_2026-07-22_inline-calculator-forms.md`.

**No change to calculator math, tool schemas, agent logic, retrieval, or logging.** The
only files touched are `widget/widget.js` (the whole visual layer), `src/server/app.ts`
(the `/demo` HTML shell + name), and the rebuilt `public/widget.js`. The 65 agent/
calculator/form tests that guard the money path were not touched and stay green.

---

## 1. The token file, verbatim

All color / type / motion derives from one block on `.jb-root` (widget/widget.js). Not
`:root` — scoping to the widget means these can't leak to the GHL host page and the host's
own custom properties can't collide with ours (every token is `--jb-*`).

```css
--jb-bg-base:#0A0A0B;--jb-bg-raised:#141416;--jb-bg-sunken:#060607;
--jb-text-primary:#F5F5F7;--jb-text-secondary:rgba(245,245,247,0.62);--jb-text-tertiary:rgba(245,245,247,0.38);
--jb-accent:#F7B211;--jb-accent-hover:#FFC53D;--jb-accent-pressed:#D99A0A;--jb-on-accent:#0A0A0B;
--jb-glass-fill:rgba(255,255,255,0.055);--jb-glass-border:rgba(255,255,255,0.10);--jb-glass-edge:rgba(255,255,255,0.22);
--jb-danger:#FF6B5A;
/* §11 token swap: user bubbles are amber, James stays neutral glass. To put
   amber on ALL bubbles, point --jb-bot-* at the accent here — one place. */
--jb-user-bg:var(--jb-accent);--jb-user-text:var(--jb-on-accent);
--jb-bot-bg:rgba(255,255,255,0.04);--jb-bot-text:var(--jb-text-primary);--jb-bot-border:var(--jb-glass-border);
--jb-ease:cubic-bezier(0.22,1,0.36,1);--jb-blur:24px;--jb-radius:18px;
```

Every §3 token is present with the exact values specified, including near-black `#0A0A0B`
over `#F5F5F7` (not pure `#000`/`#FFF`). Amber `#F7B211` on `#0A0A0B` is ~10.8:1 (AAA),
used freely for text and the lead metric.

**Type scale** (§5) is applied via these sizes: header/card titles 20px (-0.01em), body 15px
/1.6, labels 13px (+0.01em), the demo eyebrow 11px (+0.06em, uppercase), lead metric ~17px
650-weight amber. `font-variant-numeric: tabular-nums` is set on `.jb-root` so every figure
in the thread aligns and never shifts width as the count-up runs. Fonts are the **system
grotesk stack** — chosen over a web font so a blocked font request can never leave the UI
unstyled and the bundle stays lean (§10). "Confident numerals" come from weight + negative
tracking + tabular figures, not a second downloaded family.

---

## 2. §11 decision — built the recommended interpretation, as a one-line swap

Built the §7 reading: **amber for user bubbles + primary actions, neutral glass for James's
messages.** Amber behind long paragraphs is fatiguing and would flatten the hierarchy that
lets result numbers stand out. James's bubble is marked instead with a quiet amber
left-edge rule (no avatar circle).

To flip to "amber on every bubble," change the three `--jb-bot-*` tokens to the accent — the
comment in the token block marks the exact spot. Nothing else moves.

---

## 3. Liquid glass — the ambient layer is contained, not fixed

The §4 recipe is implemented as one `.jb-glass` utility (blur 24px / saturate 180%, top
specular `::before`, inset top highlight, outer lift shadow) with a
`@supports not (backdrop-filter)` fallback to solid `--bg-raised`. Glass is on **chrome
only** — header, composer, calculator + result cards. Message bubbles are flat translucent
fills, per the performance guardrail.

**One deliberate deviation from §4, for embedding safety:** the ambient orbs are
`position: absolute` inside `.jb-root`, not `position: fixed`. A viewport-fixed layer would
paint amber orbs across the **entire GHL lesson page**, not just the widget. For the same
reason the orbs are sized in px, not vw (a viewport unit balloons inside a small embed).
Three orbs (warm `#F7B211`, deep `#B87400`, cool `#2A3550` counterweight) drift on
independent 47/52/61s ease-in-out loops. The screenshots confirm the header/composer glass
picks up the warm light behind it.

---

## 4. CSS scoping for the embed — prefixed classes (not shadow DOM), and why

**Chosen: scoped `.jb-` prefixed classes**, everything under `.jb-root`, with `--jb-*`
tokens and a `.jb-root *{box-sizing:border-box}` reset so host box-model rules can't distort
us. Reasons shadow DOM was rejected:

1. **It would break the test suite wholesale.** ~50 assertions across `tests/widget.test.ts`
   and `tests/calculatorForm.widget.test.ts` query the light DOM (`#james-bot input`,
   `.jb-calc`, `.jb-list`, …). Shadow DOM hides all of that behind a shadow root, failing
   them — and the rules forbid weakening tests.
2. **The a11y live region and label associations** are simplest and most robust in the light
   DOM.
3. Prefix + token namespacing already gives practical isolation both directions.

Trade-off flagged honestly: prefixed scoping is not the hard guarantee shadow DOM gives. If
GHL ever ships CSS that targets bare tags aggressively (e.g. `div{}`), our reset covers box
model but not everything. If that happens, shadow DOM is the escalation — but it's a larger
change that requires rewriting the test queries, so it should be a deliberate, approved step.

---

## 5. Thinking state — honest neutral rotation (tool-event plumbing does not exist)

**Could NOT tie it to real tool events, and did not fake it.** The `/chat` endpoint returns
the whole answer in one response after 15–20s — there is no token stream or progress
channel, so the widget genuinely cannot know mid-wait whether retrieval or a calculator is
running. Per §8, it therefore uses **honest neutral copy that rotates on a slow (2.8s)
interval** — "Thinking it through" → "Still with you" → "Working on it" → "Putting this
together" — rather than inventing "Reading James's material…" on a timer.

What it does do (§8): the whole room responds. While thinking, `.jb-busy` on the root warms
the orbs and speeds their drift (52s→22s), settling when the answer lands — visible in the
thinking screenshot as the intensified amber glow behind the header. No percentage, no
progress bar.

To get real staged status ("Reading James's material…" during retrieval) the server would
need to stream tool events (SSE / chunked). That's an agent/transport change, out of this
visual-only scope — flagged as the upgrade path.

---

## 6. Every location the product name changed

Renamed to **"Ask James"** on the member-facing surfaces:

| File | What | From → To |
|---|---|---|
| `widget/widget.js` | in-app header text | "James Dainard AI Mentor" → **"Ask James"** |
| `widget/widget.js` | top-of-file doc comment | updated to "Ask James" |
| `src/server/app.ts` | `/demo` `<title>` | → **"Ask James — Demo"** |
| `src/server/app.ts` | `/demo` `<h1>` | → **"Ask James"** |
| `src/server/app.ts` | `/demo` meta tags | added description, robots, color-scheme, theme-color, og:* |

**Deliberately NOT renamed, with reasons:**
- `src/server/app.ts` `/` service string (`"James Dainard AI Mentor API"`) — the route's own
  comment states it is "the API, not a member-facing page," so §1's "everywhere it surfaces"
  doesn't reach it. `tests/cors.test.ts` also pins this string; renaming it would regress a
  test for no member-facing gain. Left legacy, commented.
- The mount id `#james-bot`, the global `createJamesBot`, the `james-bot-session` key, the
  `james-bot-styles` style id — internal identifiers wired into the GHL loader snippet,
  `DEPLOY.md`, and the test suite. Not user-visible; renaming would break the embed contract.
- Infra/package names (`package.json`, `fly.toml`, `render.yaml`, `.do/app.yaml`) — deploy
  identifiers, not UI. Untouched.
- The greeting keeps James's "I'm James" first-person voice, as instructed.

---

## 7. §12 — must-not-break, confirmed

All confirmed via the existing suite (untouched) — these paths are pure backend and the
redesign never touched them:

- **NL flip `350k/75k/600k/4mo` → `$101,916`** — `tests/agent.test.ts`: "F2 numbers reach the
  calculator and 101916 comes back — not the 148466 default". Also reproduced live in the
  result screenshot (the count-up lands on **$101,916**).
- **A second different flip returns different numbers** — `tests/agent.test.ts`: "a second,
  different deal in the same run gets its own numbers" (the frozen-value regression).
- **BRRRR immediately after a flip calls the BRRRR tool with fresh numbers** — covered by the
  agent tool-routing tests.
- **Inline forms submit through the same tool path** — `tests/calculatorForms.test.ts` 4.2/4.6
  (form result === typed result, byte-identical; same `qa_logs`/memory writes).
- **Disclaimer before inputs + with every result; defaults disclosure** — `ESTIMATE_NOTE` +
  `defaults_applied` unchanged; forms/agent tests assert both.
- **Existing suite green — no regressions.**

Verbatim, whole suite before/after the redesign:

```
BEFORE:  Tests  732 passed | 18 skipped (750)   (1 pre-existing file fails to load — §9)
AFTER:   Tests  732 passed | 18 skipped (750)   (same 1 pre-existing file)
```

Widget-specific: `tests/widget.test.ts` + `tests/calculatorForm.widget.test.ts` = **40
passed**, after a full rewrite of the widget's markup and CSS. TSC clean. Bundle rebuilt:
8.0kb → **22.3kb** (all inline CSS + ambient layer + count-up; still no animation library).

---

## 8. Screenshots

Rendered from the **real built bundle** (`public/widget.js`) via headless Chrome with a
stubbed `fetch` (no server, no API spend), at 2× DPR. Files in the session scratchpad
`shots/`:

| File | State |
|---|---|
| `01-empty.png` | Empty state — glass header catching the warm orb, greeting bubble with amber left-rule, glass composer with amber focus ring, circular amber send |
| `02-result.png` | Thread with a result — amber user bubble, glass result card, lead metric **$101,916** in amber (count-up landed), supporting metrics in aligned tabular figures, disclaimer in muted micro type |
| `03-form.png` | Inline calculator form — glass card, `($)`/`(months)` unit hints, amber required asterisks, dark-inset fields, "Show advanced options (4)", solid amber Calculate + ghost Cancel |
| `04-thinking.png` | Thinking state — amber user bubble, thinking pill with amber dots + honest rotating copy, header amber glow intensified (room warming) |
| `05-mobile360.png` | Widget at a true 360px width — everything wraps, nothing clips, composer fits |

Note on the mobile shot: headless Chrome enforces a ~491px minimum viewport, so a literal
360px window is impossible via flags (measured: `innerWidth=491`). The widget container was
constrained to exactly 360px inside a wider window instead; its `@media (max-width:520px)`
rules still fire (491 < 520). A plain-paragraph probe confirmed the earlier right-edge
clipping was the capture canvas, **not** a widget overflow bug.

---

## 9. Anything I could not do — three brief items blocked by locked tests

Three parts of §7 directly conflict with assertions in `tests/widget.test.ts` that a prior
deliberate decision locked in. The rules forbid weakening tests and require the suite green,
so I built the test-compatible behavior and am surfacing the conflict for you to decide —
each needs a test change you should explicitly approve, not one I make silently.

1. **Composer multiline auto-grow (§7).** Kept a single-line `<input type="text">`. The suite
   queries `#james-bot input[type="text"]` in ~20 places and asserts `.value`/`.disabled`;
   a `<textarea>` returns null there and fails all of them. Enter-sends / Shift+Enter is moot
   without multiline. **To do it:** migrate those queries to the textarea and re-assert.

2. **Empty-state suggested-prompt chips (§7).** The opening screen stays a single greeting
   bubble. `tests/widget.test.ts` "the opening screen is plain" asserts **zero** `.jb-chip`,
   exactly one `.jb-bubble`, and exactly one `<button>` — a prior decision that removed the
   chip row and numbered menu as a "phone tree." Chips would break all three. **To do it:**
   update that test (and "renders the send button and the opening message locally") to expect
   the chips.

3. **Numbered menu in the empty state (§7).** Same test forbids it (`not.toMatch(/^\s*1\.\s/m)`,
   `not.toContain('2. Flip')`). Left out for the same reason.

Two smaller notes:

- **§10 "no browser storage" vs the pre-existing session id.** The widget has a pre-existing
  `localStorage['james-bot-session']` write that predates this brief and gives conversation
  continuity across a full reload. I added **no new** storage, but did not rip out the
  existing one: SCOPE is "visual layer only," and removing it is a behavioral change (a member
  reloading `/demo` would lose their thread). It survives GHL SPA lesson swaps regardless (the
  JS context persists). One-line change to in-memory if you want strict §10 — say the word;
  the trade is losing continuity across a hard reload.
- **Count-up under reduced motion.** The amber lead-figure color is now static (applied even
  when motion is off, per §5); only the counting animation is disabled under
  `prefers-reduced-motion` (per §6). Orb drift, entry transforms, and the arm-pulse are all
  disabled there too; opacity fades are kept.

---

## 10. Files changed

| File | Change |
|---|---|
| `widget/widget.js` | Full visual rewrite: tokens, contained ambient orbs, glass utility, restyled header/composer/bubbles/forms, redesigned thinking state, count-up on the lead figure, "Ask James" header. Behavior/DOM contract preserved for every test. |
| `src/server/app.ts` | `/demo` restyled to the dark aesthetic; title/h1/meta → "Ask James". `/` service string left legacy (commented). |
| `public/widget.js` | Rebuilt (22.3kb). |
| `RUN_REPORT.md` | This report; prior report archived to `reports/`. |

No calculator, agent, tool-schema, retrieval, or logging file was modified. No test was
weakened or deleted.
