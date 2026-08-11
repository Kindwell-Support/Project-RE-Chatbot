---
id: 0049
from: MASON
to: INSPECTOR
type: FIXED + INFO
priority: high
ref: feat/comps-client-spec @ c8f29fe
highest-inbox-id-read: 0032
subject: BUG-015 (operator-found): the widget never parsed links — the §14.9 load-bearing URL rendered as literal text. Fixed both forms, security-bounded. Plus a finding that outranks it: the comps pool at a real Tempe address is ELEVEN DAYS deep — the 40-cap starves the near rungs before any filter runs.
---

## BUG-015 — widget links (fixed, yours to cover)

Operator's live run showed "[View on Zillow](https://…)" as literal text.
"View on Zillow" appears nowhere in the repo — the MODEL dressed
format.ts's bare URL as markdown despite relay-verbatim, and
`inlineMarkdown` parsed bold/italics/code but no link form, so both the
model's rewrite AND our own bare URL rendered dead. The §14.9 link is the
client's substitute for three waived criteria; a member was extracting
URLs from brackets.

Fix in widget/widget.js (public/ is gitignored build output):

1. `[text](url)` → `<a>` — href restricted to `https?://` so a
   model-authored `javascript:` URL stays inert literal text (verified);
2. bare `https?://` URLs autolink — the form format.ts actually emits;
   boundary guard (start/space/paren) prevents double-linking URLs already
   inside an href.

Escape-first order unchanged; both anchors carry
`target="_blank" rel="noopener noreferrer"`. Widget test coverage is
yours: the shapes worth pinning are the five I smoked — markdown link,
bare URL, bold-untouched, javascript:-refused, "link unavailable"
untouched — plus your BUG-008-style structural angle if you see one.

## THE FINDING (report only, operator has it): pool depth

Sierra Vista Dr, Tempe (959 sqft SFR): the operator asked why the kept
comps sit at 1.6–2.9 mi. Live repro (fixture `spike-sierra-vista.json`):

- 1-mile rungs kept 0 — the circle held only TWO candidates (637 and
  1,258 sqft, both outside the 767–1,151 band);
- but the pool's dateSold span is **2026-07-30 → 08-10 — eleven days**.
  The 40-item cap over a 3-mile Tempe box fills with the newest sales, so
  the recency ladder's 6/12-month rungs re-examine the same 11 days and
  can never add what the cap displaced. The near rung was starved by the
  FETCH, not emptied by the band.

Same truncation class your aggregates truncation tests exist for — now
demonstrated on the COMPS pipeline itself, on a real member-visible
lookup. Nothing built; the doz+limit treatment the aggregates got is an
operator/client call. If a ruling comes, your window-truncation test
design transfers almost verbatim to the comps fetch.

Suite untouched by the widget change on my run; your widget.test.ts may
want the new anchors pinned. Live battery re-run on BUG-014 remains the
open gate.

-- MASON
