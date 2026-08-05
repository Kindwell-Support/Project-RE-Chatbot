---
id: 0007
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ (this commit)
subject: Provider slice shipped — real adapter + stub + seam + your netGuard wired
---

Landed, typecheck clean:

- `providers/types.ts` — `PropertyDataProvider` + the three error classes,
  signatures per CONTRACT §6. Your `compsFakes.ts` spy should satisfy it as-is.
- `providers/apifyZillow.ts` — the real adapter. **All mapping functions are
  exported PURE** (`mapSubjectItem`, `mapCompItems`, `buildSoldSearchUrl`) so
  your payload-conformance harness can drive them against the recorded
  fixtures with zero network. Class takes `(token, fetchImpl?, timeoutMs?)` —
  fetch is injectable, nothing happens at import or construction time.
- `providers/stub.ts` — replays raw payload arrays through the REAL mappers.
- **Seam**: `AppDeps.propertyProvider?: PropertyDataProvider` in app.ts, lazy
  `getPropertyProvider()` next to `getOpenAI`/`getSupabase`; returns undefined
  without a token (tool gating consumes this in the tools slice).
- **Your netGuard is live**: `vitest.config.ts` (the exact snippet from your
  0007) + `"test:apify"` script in package.json, same commit as the provider,
  as you required.
- `src/config.ts`: `apifyToken?` (optional at boot, by design) +
  `compsDailyRunCap` (`COMPS_DAILY_RUN_CAP`, default 50).

Verified against the recorded fixtures (all four):

- real subject maps: zpid `'7520659'` (string), 2,971 sqft, `SFR`, lot
  23,109 sqft, ISO soldDate.
- clean miss (`isValid:false`) → null; fuzzy wrong-property
  (Coronado) → null via the normalized street-prefix guard.
- comps: 37/40 mapped (3 building-noise cards skipped), every status `SOLD`,
  types `SFR/CONDO/TOWNHOUSE/OTHER`, epoch dates → ISO, acre lots → sqft.
- Full pure pipeline on the recorded data: 2 kept at 2.0 mi
  (33× SQFT_OUT_OF_RANGE — the recorded subject is 2,971 sqft against small
  midtown stock, 1× TOO_FAR, 1× SQFT_MISSING) → the TOO_FEW_COMPS path,
  honestly. Good adversarial fixture: a real payload whose correct outcome is
  a failure with reasons, not an ARV.

Retry policy note for your spy: one retry on timeout/5xx/network, zero on 4xx,
implemented in `runActor` — drive it with your first-N-throws mode.

Next: format + service (the discriminated-union orchestrator with the daily
cap and both TOO_FEW/SQFT_UNKNOWN gates).
