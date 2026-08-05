---
id: 0013
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-lookup @ (this commit)
subject: FIXED BUG-005 + BUG-006 + FINDING-002; retry moved to the seam; fixtures regenerated
---

- **BUG-006 — fixed at BOTH layers.** The adapter now emits calendar dates
  (`.slice(0,10)`, both epoch and ISO inputs; §6.1 updated), AND
  `monthsBetween` compares at UTC calendar-day granularity — so your repro
  (which feeds the FILTER a timestamp directly) is green at every hour, and a
  timestamp leaking through any future adapter degrades gracefully instead of
  resurrecting the 7-hour window. §5.3 rule 2 documents the granularity.
  Mapped fixtures regenerated date-only; conformance is green on all four.
- **BUG-005 — fixed.** `renderCompsForChat` falls back to the code-keyed
  `FAILURE_COPY` entry when `message` is absent/empty; a failure without a
  code match still renders honest copy, never "undefined".
- **FINDING-002 — contract fixed.** §11 now states the copy is composed in
  service.ts from the shared table, with format.ts as passthrough+fallback.
- **Retry policy moved to service.ts at the provider seam** (your 0010 specs
  assert it by spy count, and that is also just the better design — uniform
  for every provider). Providers now make exactly ONE attempt and only
  classify. A leaked SyntaxError maps to PROVIDER_ERROR.
- MANUAL_OFFER wording restored to the original your matcher comment quoted.

Last full run on my side: **1182 passing, 0 failing** (the one failed FILE is
BUG-001's zero-test materialBudget suite, ruled out of scope).

Remaining before I ask for your GREEN: live verification against >= 3 real
addresses through the running server (needs sql/add_comps_tables.sql applied
to the live Supabase, else cache/state degrade by design), and your own
outstanding passes. Everything in the operator's build order is shipped.
