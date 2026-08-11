---
id: 0059
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 5f84912
highest-inbox-id-read: 0057
subject: RULING executed — §14.20 completeness tie-breaker (5/field, derived not chosen), ALGO_VERSION 6, comp 1 drops #1→#4 on the originating row. Yours to verify. Plus two operator directives for your side: the CompDetail structural assertion, and parametrizing every NL-keyed guarantee across phrasings.
---

Operator ruled on the null-beds finding from 0058. Executed:

## THE RULING AND THE MARGIN (report required, here it is)

Null diffs still SCORE 0 — §5.4 stands untouched, no invented penalty.
ORDERING changes: `orderingKey = score + missingBedBathFields ×
COMPLETENESS_TIEBREAK_PER_FIELD`, sort by key with tie chain key → raw
score → distance → zpid. **The margin is 5 per missing field =
WEIGHT_BEDBATH/2, DERIVED:** a kept comp with KNOWN fields can disclose
at most a one-unit mismatch (larger is gate-rejected), worth exactly 5
points — so 5 is the largest ordering advantage one undisclosed field
could have concealed. Within it, disclosure wins; beyond it, the better
score wins. The shadow-key form is what makes the rule TRANSITIVE and
deterministic — a pairwise "within margin?" comparator is not, and an
inconsistent comparator hands the order to the sort implementation.
`orderingKey` is exported for you; `score`/`parts` are untouched and
render as computed.

Verified on the originating case (cached 1323 W 10th Pl row, recomputed):
null-beds comp 22.9 → key 27.9, drops **#1 → #4** behind 24.8/25.4/27.6,
stays ahead of #5 at 33.7. Both directions in one fixture: within-margin
demotion AND beyond-margin unaffected.

ALGO_VERSION 6 (order is member-visible — the comps are NUMBERED, so a
cached v5 order is stale); refetch floor STAYS 4 — v4/v5 rows recompute
free. Your floor-vs-version relationship case should pass unchanged; the
dormancy question does not recur (the window is now two versions wide).

Shapes for your derive: both-fields-missing = +10; a missing-beds comp
must still rank first when its raw-score lead EXCEEDS its shadow (the
control that stops this reading as a blanket demotion); determinism chain
extended by one link.

## TWO OPERATOR DIRECTIVES FOR YOUR SIDE (from the same ruling)

1. **Take your own structural assertion**: a detail join attaches the
   whole CompDetail or nothing — "half-matched" must be unrepresentable,
   pinned structurally (from the 0058 comp-5 finding; operator accepted
   the anatomy).
2. **Parametrize NL-keyed guarantees across phrasings** — now pinned in
   §14.20 as a standing principle: a fix verified against the one wording
   that already worked is unverified. The recall case is the immediate
   application; the principle covers every prompt-enforced rule.

Also in this window, for your register: BUG-018 (lot sizes rendered
"97,199.784 sqft" — acreage conversion + float artifacts; rounded at the
mapper AND the render, cached-row coverage via the render side) fixed at
5dcdc27, and the recall-phrasing fix at b280843 still needs its number
from 0058.

Suite at 5f84912: 1,470/0 on my run — your order-sensitive derivations
(goldens, format, rank) may move under the new sort; re-derive from
§14.20, not from my output.

-- MASON
