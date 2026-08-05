---
id: 0008
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ (this commit)
subject: format + service shipped — orchestrator, failure copy, cache/budget seams
---

Landed, typecheck clean:

- `format.ts` — `renderCompsForChat(outcome)`, pure/deterministic, plus the
  exported `FAILURE_COPY` table: ONE §10 wording per code, used by BOTH the
  failure message and the render, so they cannot diverge. Every failure ends
  with the manual-ARV offer and none contains a number. Success render carries
  the §11 audit trail: per-comp lines, the trim (which $/sqft, which end), the
  ARV arithmetic spelled out, radius tier, confidence line (low = explicit
  weak-estimate warning + override invitation), and the not-an-appraisal
  footer.
- `service.ts` — `runComps(rawAddress, deps)`:
  - `deps`: `{ provider, cache?, budget?, logger?, now? }` — every seam
    injectable, nothing constructed inside (CONTRACT §6).
  - `CompsCacheLike` + `CachedComps` interfaces defined here; the Supabase
    implementation is the next slice. `RunBudgetLike` + `createDailyRunBudget`
    (in-memory, resets on deploy — can only under-count, never wrongly block).
  - One provider fetch at the WIDEST tier (2.0 mi); tier narrowing is pure.
    Per-tier fetches would triple the bill exactly when the market is thin.
  - `computeFromRaw()` is shared by the live path and the stale-algo recompute
    path — one implementation, so recompute can never drift from live.
  - Provider exceptions map: Timeout→PROVIDER_TIMEOUT, Http/Network→
    PROVIDER_ERROR (message logged with cacheKey, NEVER the address); anything
    else re-throws as a programmer error.
  - **Caching policy worth pinning**: provider failures are NEVER cached
    (return precedes the write); computed failures (TOO_FEW_COMPS,
    SUBJECT_SQFT_UNKNOWN) ARE cached with their raw payloads — real data,
    real outcome, and a re-ask within TTL must not re-bill.

Smoke-verified offline (stub over the recorded fixtures):

1. recorded real data end-to-end → honest `TOO_FEW_COMPS` with kept=2,
   radius 2.0 in the copy;
2. miss → `ADDRESS_NOT_FOUND`; 3. `ProviderTimeoutError` → `PROVIDER_TIMEOUT`;
4. budget cap of 1 → second address `RATE_LIMITED`;
5. **two identical requests → 1 provider call; algo-bump recompute → still 1**
   (the §7 recompute-from-raw guarantee your spy-count tests target).

Note for your golden-based service tests: `runId` is `crypto.randomUUID()` —
assert shape, not value; everything else is deterministic given `now`.

Next: cache + migration (Supabase `comps_cache` impl of `CompsCacheLike`,
`session_state` table in the same sql file, expires_at index per operator #5).
