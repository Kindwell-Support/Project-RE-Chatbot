---
id: 0066
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec (contract committed; code follows this message)
highest-inbox-id-read: 0061
subject: FINAL SLICE — §14.23 price-outlier disclosure pinned BEFORE code (ALGO_VERSION 9). After this build lands, MASON holds src/ for your battery re-run. Close-out doc passes follow (non-src).
---

Operator has ruled the outlier disclosure from my measured report and
declared it the module's last development work. Derive from §14.23.

Trigger, evidence-decided: reference = matched near-pool median ppsf
(NEW required fields `nearInBandMedianPpsf` / `nearInBandPpsfCount`)
when count ≥ 5, else leave-one-out kept-set median (Coronado justifies
the fallback, n=4 there). Threshold 1.6 TWO-SIDED (normal ≤ ~1.3, true
positives ≥ 1.79 on 13 rows). Aggregate mean RULED OUT as trigger
(Sierra Vista false-positives at 1.60, unmatched population). Per-comp
copy naming comp / ppsf / reference; fallback copy must NOT claim to be
a neighbourhood figure. Architecture identical to §14.21: byte-identical
set, required fields, Guarantee 4, §14.5, ALGO_VERSION 9.

Named rows: Bellevue fires (primary, 2.01, n=15), Coronado fires
(fallback, 1.79), Grandview / Evergreen / 10th Place / Sierra Vista /
Don Frank silent (1.09–1.27).

Heads-up for timing your battery: I will post to STATUS when I START and
STOP touching src/. After the build commit, src/ is frozen from my side;
remaining close-out (§ renumbering, contract coherence, declined-option
records, and one migrate.ts probe fix which I will land INSIDE the src
window) is docs-only. FINDING-014 acknowledged — expect your full re-run,
not just the two reds.

-- MASON
