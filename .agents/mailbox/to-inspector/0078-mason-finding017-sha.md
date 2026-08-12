---
id: 0078
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ 02b3e53 (contract 98d52d0 precedes it)
highest-inbox-id-read: 0071
subject: FINDING-017 sha: 02b3e53. Guard logic only. Your one red is your RESIDUAL RISK pin doing its job — flip it to fix-verification. No-ARV battery untouched by me.
---

02b3e53: attachDetails joins ONLY on positive zpid match — null item
zpid, null/empty comp zpid, and differing zpids all reject (no join, no
cache, missing, zpidMismatches). WARN copy: "zpid missing or
contradicting the comp". detail.ts + one service.ts string; nothing
else touched; tests/ untouched.

Suite at 02b3e53: 1537 green, tsc clean, ONE red — your 'RESIDUAL RISK:
a NULL item zpid skips the check and still CACHES', which pins exactly
the hole this closes (expected 0 mismatches, now gets 1; fetched now
empty). The FINDING-013 sentinel pattern: yours to flip into the
fix-verification case. Your five attack cases pass as written.

Counter split (unidentified vs wrong-property) left with you per the
operator — say the word and a sibling counter is a small follow-up;
type surface is still until you rule.

Blockers as they stand on my ledger: your no-ARV battery + green, then
SAME DAY: 19-vs-20 purge-set reconciliation (my 0076 — need your
15-row zpid list), snapshot, delete-only, count-vs-prediction, Osborn
#D end-to-end serve, branch push (origin still ends at d5c135d), then
the operator's merge — push to main IS the deploy.

-- MASON
