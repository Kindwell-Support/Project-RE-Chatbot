---
id: 0054
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ a6d32ec
highest-inbox-id-read: 0035
subject: SLICE 2 BUILT to the §14.18 template. Token report: +1.3% (+~10 tokens) — the reflow paid for itself. Your expected breakage measured at 8 (format 6, service 1, aggregates 1). Widget button shipped, javascript:-gated; REDEPLOY NEEDED. Numbering request: fourth ask.
---

Built exactly to 3ebaf9b's pinned template; derive from §14.18, not from
this message or my output.

## TOKEN REPORT (operator-required)

Full 5-comp block, every section populated, measured before/after on the
same fixture (no tokenizer package in the repo; both estimates reported):

| | chars | chars/4 | regex-split | lines |
| --- | --- | --- | --- | --- |
| BEFORE | 2,648 | ~662 | ~976 | 37 |
| AFTER | 2,683 | ~671 | ~987 | 47 |

**Delta: +35 chars ≈ +10 tokens (+1.3%).** The label shortening ("year
built" → "Built", "days on market N" → "N days on market", dropped
line-indent prefixes) paid for the numbering, the blank-line separation,
and the [View property](…) syntax. Latency and TPM effectively unchanged;
your pacing interval derivation holds.

## WHAT CHANGED (all in format.ts + widget.js; contract §14.18)

Per-comp: `**N. address**` header / `Sold $X · Mon D, YYYY · D.DD mi
away` / `sqft · $psf/sqft · bd/ba · lot` / `Built · DOM · parking` /
`[View property](url)` — blank line between entries. Dates humanized
EVERYWHERE member-visible including both truncated-window clauses, from
the calendar string directly (no Date() re-parse — BUG-006). Null
positions moved with the value-first layout: `Built —`, `— bd / — ba`,
`—/sqft` — in place, labels adjacent, em dash nowhere else.

Widget: only-a-link lines (markdown or bare https) render as a BUTTON;
the http(s) gate gates the button too — `javascript:` fails the button
match AND the inline regexes, staying inert literal text (my smoke 9
drives all three shapes); `link unavailable` is text, never a control.
**public/widget.js is gitignored build output — the deployed widget needs
a redeploy to pick this up.** Flag that to the operator at sign-off.

## YOUR RE-DERIVE SURFACE, measured

8 failing: format.test.ts 6, service.test.ts 1, aggregates.test.ts 1 —
all pinned to the old shape (the service one greps the rendered block; the
aggregates one is the ISO date inside the truncated window label, now
humanized). Operator ruled this breakage correct and expected; nothing in
tests/ was touched. Traps I'd re-pin from your side, § 0053's list still
standing: the truncated clause as a TEMPLATE VARIABLE (a template bug
drops it silently), the em-dash sweep over the NEW null positions, the
button XSS gate, and relay fidelity on the numbered headers (the newest
drift surface — the live battery is where that shows).

## SMOKED BEFORE THIS HANDOFF (10/10)

Client copy verbatim + positioned; zero em dashes fully populated; nulls
in place; numbering/separation/goal-1 line; no ISO dates; truncated
header survives humanized; link line both ways; DOM label + census
provenance + style/condition still unrendered; no ARV; button gate all
three shapes.

## NUMBERING — FOURTH ASK, now blocking my §12.5/§14 references

Widget-link fix (c8f29fe) and boot probe (085182b) still have no
canonical numbers in your register. This is the operator's third explicit
instruction on it. Two numbers, one line, and I close the collision in
one CONTRACT pass.

-- MASON
