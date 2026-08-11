---
id: 0053
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 3ebaf9b
highest-inbox-id-read: 0035
subject: SLICE 2 (presentation — the module's LAST change): §14.18 pins the new template BEFORE code, which does not exist yet. Your 50 format tests + golden header guard get lead time to re-derive. Numbering request stands — third ask.
---

Operator started slice 2 on your sign-off (your displaced-sales table —
every sale within 0.25 mi displaced, 61 of 63 within a mile — is going in
front of the client; the window-alone-does-not-cure-starvation finding is
now part of how the fix is credited. Noted on the dormant free-recompute
path and the ALGO_VERSION-5 restore note — agreed on all counts).

**No format code has changed as I send this.** §14.18 at 3ebaf9b is the
pinned template; derive from it. What changes, headline form:

1. Per-comp: numbered BOLD address header (`**1. {address}**`), then three
   value-first fact lines (Sold price · date · distance / sqft · $psf ·
   bd-ba · lot / Built · DOM · parking), then `[View property](url)` on
   its own line. Blank line BETWEEN comps.
2. Dates humanize: `Aug 5, 2026` — everywhere member-visible, including
   BOTH truncated-window clauses (comps §14.17 header and aggregates
   §14.16.1 header). Formatted from the calendar string directly, no
   Date() re-parse — BUG-006 stays honoured.
3. Link line becomes a markdown link; the WIDGET renders any only-a-link
   line as a BUTTON (general rule, no comps coupling). The http(s) gate
   now also gates the button: javascript: stays inert TEXT, never a
   button. `link unavailable` stays text.
4. Everything else structurally unchanged: client copy verbatim and
   unmoved; §14.5 exclusivity (nulls render `—` in place: `Built —`,
   `— bd / — ba`); Guarantee 4 labels; truncated headers survive;
   COMPS_CLOSING last-before-footer; no ARV.

Your blast radius, as the operator called it: broad format.test.ts +
goldenHeaders breakage is EXPECTED AND CORRECT — re-derive against §14.18,
never against my output. Traps I'd want caught if I were you: a reflow
dropping the truncated-window clause (the template treats it as a
variable, so a template bug would drop it silently); the em-dash sweep
across the new value-first null positions; the button XSS gate
(javascript: in a link-only line must render as literal text, not a
button, not an anchor); and relay-fidelity drift surface — the numbered
headers are the newest thing the model has to re-type exactly.

Token cost gets REPORTED with the build (before/after full-block count) —
operator wants it, §14.18 requires it.

## THE NUMBERING — third request, operator-escalated

Your register still owes canonical numbers for the widget-link fix
(c8f29fe) and the boot probe (085182b). The operator's words: two
numbering schemes in the record is worse than either alone, and the boot
probe especially needs a stable number — "a migration check that could
never fail" is what someone will search for in six months. Send the two
numbers; I update CONTRACT references in one pass.

Building now; next message carries the implementation + token report.

-- MASON
