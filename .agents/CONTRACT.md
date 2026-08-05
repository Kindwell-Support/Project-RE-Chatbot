# CONTRACT — Comps Lookup + ARV (`feat/comps-lookup`)

Owner: MASON. INSPECTOR tests from this file. If code and contract disagree, the
contract wins until a `CONTRACT_CHANGE` is agreed.

- `ALGO_VERSION = 1`
- Status: **provider stubbed** — `APIFY_TOKEN` is not yet available. Everything
  below is testable offline against `StubPropertyDataProvider` + fixtures. The
  Apify implementation slots in behind the same interface with zero changes to
  pure logic.

---

## 1. Where this plugs into the existing repo (read-only facts)

| Concern | Existing mechanism | Comps integration |
| --- | --- | --- |
| Config | `loadConfig()` in `src/config.ts`; required keys enforced in `assertRuntimeConfig` | New optional fields (§3). `apifyToken` absent ⇒ tools still registered, provider calls fail soft as `PROVIDER_ERROR` with stub note; caps still enforced |
| LLM tools | `TOOL_DEFINITIONS` (`src/agent/toolDefs.ts`) + `executeTool` switch (`src/agent/agent.ts`) | Append `run_comps`, `set_manual_arv` defs; add switch cases delegating to `src/features/comps/tools.ts` |
| Conversation memory | Transcript only — `chat_messages` (`src/server/memory.ts`); **no structured state exists today** | New `session_state` table (§8). Read in `/chat`, threaded through `runAgent` ctx, written by comps tools |
| Migrations | `sql/*.sql` run in Supabase SQL editor + check-and-warn in `src/server/migrate.ts` | `sql/add_comps_tables.sql` creates `comps_cache` + `session_state`; `migrate.ts` gains the same zero-cost existence checks |
| Logging | Fastify `request.log` / `Logger` interface (`src/server/logger.ts`) | Same. Log `cacheKey`, never the raw address, at info; never the token |
| Failure style to model | Tool result objects with `error` string; agent instructed not to invent numbers | Comps failures are returned as rendered failure copy (§10), never bare stacks |

Dev server: MASON on port 3000 (already running), INSPECTOR on 3001.

## 2. File layout (all new, additive)

```
src/features/comps/
  types.ts       config.ts      normalize.ts   filter.ts      rank.ts
  arv.ts         format.ts      service.ts     tools.ts
  providers/types.ts  providers/apifyZillow.ts  providers/geocode.ts  providers/stub.ts
  cache/compsCache.ts
  __fixtures__/            # shared with INSPECTOR — hand-written now, real recordings when token lands
sql/add_comps_tables.sql
```

## 3. Config — `src/features/comps/config.ts` (named exports; zero magic numbers elsewhere)

| Export | Default | Meaning |
| --- | --- | --- |
| `ALGO_VERSION` | `1` | stamped on every result; cache recompute trigger |
| `MAX_COMP_AGE_MONTHS` | `12` | hard filter |
| `SQFT_TOLERANCE` | `0.25` | subject sqft ±25% |
| `MAX_BED_DIFF` | `1` | hard filter |
| `MAX_BATH_DIFF` | `1` | hard filter |
| `RADIUS_TIERS_MI` | `[0.5, 1.0, 2.0]` | stop at first tier with ≥ `MIN_COMPS_FOR_TIER` |
| `MIN_COMPS_FOR_TIER` | `5` | tier advance threshold |
| `MIN_COMPS_TO_COMPUTE` | `3` | below ⇒ `TOO_FEW_COMPS` |
| `MAX_COMPS_KEPT` | `8` | after ranking |
| `NON_ARMS_LENGTH_PPSF_FRACTION` | `0.4` | ppsf < 40% of candidate median ⇒ reject |
| `LOT_ANOMALY_MULTIPLE` | `5` | lot > 5× subject lot ⇒ reject |
| `WEIGHT_DISTANCE` / `WEIGHT_SQFT` / `WEIGHT_RECENCY` / `WEIGHT_BEDBATH` | `40 / 30 / 20 / 10` | score weights |
| `DISTANCE_NORM_MI` | `1.0` | score normalizer |
| `RECENCY_NORM_MONTHS` | `12` | score normalizer |
| `TRIM_FRACTION` | `0.15` | trimmed-mean trim per end (n ≥ 5) |
| `ARV_ROUND_TO` | `1000` | round ARV/low/high to nearest |
| `CONF_HIGH` | `{ minComps: 6, maxCv: 0.15, maxMedianDistanceMi: 0.75, maxMedianAgeMonths: 6 }` | |
| `CONF_MEDIUM` | `{ minComps: 4, maxCv: 0.25 }` | |
| `CACHE_TTL_DAYS` | `14` | |
| `PROVIDER_TIMEOUT_MS` | `90_000` | per Apify run |
| `PROVIDER_MAX_RETRIES` | `1` | transient only (timeout/5xx/network); **0 on 4xx** |
| `COMPS_RUNS_PER_SESSION_PER_HOUR` | `5` | env-overridable |
| `COMPS_DAILY_RUN_CAP` | `50` | env-overridable |
| `DAYS_PER_MONTH` | `30.44` | the only months↔days conversion used anywhere |
| `EARTH_RADIUS_MI` | `3958.8` | haversine |

`AppConfig` (src/config.ts) gains: `apifyToken?: string` (`APIFY_TOKEN`),
`compsRunsPerSessionPerHour` (`COMPS_RUNS_PER_SESSION_PER_HOUR`),
`compsDailyRunCap` (`COMPS_DAILY_RUN_CAP`). None are required at boot; comps
feature checks token presence at call time.

## 4. Types — `src/features/comps/types.ts` (exported signatures; no `any`)

```ts
export interface CompsRequest { address: string; sessionId: string }

export interface SubjectProperty {
  zpid: string; address: string;
  beds: number | null; baths: number | null;
  livingArea: number | null;          // sqft; null/<=0 ⇒ SUBJECT_SQFT_UNKNOWN
  lotSize: number | null; yearBuilt: number | null;
  propertyType: PropertyType; lastSoldPrice: number | null;
  lastSoldDate: string | null;        // ISO date
  lat: number; lng: number;
}

export type PropertyType = 'SFR' | 'CONDO' | 'TOWNHOUSE' | 'MANUFACTURED' | 'OTHER';

export interface RawComp {
  zpid: string; address: string; status: string;
  soldPrice: number | null; soldDate: string | null;
  beds: number | null; baths: number | null;
  livingArea: number | null; lotSize: number | null;
  propertyType: PropertyType; lat: number; lng: number;
}

export type RejectReason =
  | 'NOT_SOLD' | 'STALE_SALE' | 'SQFT_MISSING' | 'SQFT_OUT_OF_RANGE'
  | 'BEDS_DIFF' | 'BATHS_DIFF' | 'TYPE_MISMATCH' | 'TOO_FAR'
  | 'PRICE_MISSING' | 'NON_ARMS_LENGTH' | 'LOT_ANOMALY';

export interface RejectedComp { comp: RawComp; reason: RejectReason }

export interface ScoredComp {
  comp: RawComp; distanceMi: number; monthsAgo: number;
  pricePerSqft: number; score: number;               // 0–100, lower better
  parts: { distance: number; sqft: number; recency: number; bedbath: number };
}

export type ArvConfidence = 'high' | 'medium' | 'low';

export interface ArvResult {
  arv: number; arvLow: number; arvHigh: number;      // rounded to ARV_ROUND_TO
  arvPerSqft: number; sd: number; cv: number;
  confidence: ArvConfidence;
  trimmedOut: { zpid: string; pricePerSqft: number; end: 'low' | 'high' }[];
  compsUsed: number;
}

export interface CompsResult {
  ok: true; algoVersion: number; runId: string;      // runId = crypto.randomUUID()
  subject: SubjectProperty; radiusTierMi: number;
  comps: ScoredComp[]; rejected: RejectedComp[];
  arv: ArvResult; fromCache: boolean; provider: string;
}

export type CompsFailureCode =
  | 'ADDRESS_NOT_FOUND' | 'SUBJECT_SQFT_UNKNOWN' | 'TOO_FEW_COMPS'
  | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'RATE_LIMITED';

export interface CompsFailure {
  ok: false; algoVersion: number; code: CompsFailureCode;
  message: string;                                    // plain English, ends offering manual ARV
  detail?: { kept?: number; needed?: number; radiusTierMi?: number };
}

export type CompsOutcome = CompsResult | CompsFailure;   // discriminated on `ok`
```

Pure-function signatures INSPECTOR can import directly:

```ts
// normalize.ts
export function normalizeAddress(raw: string): string;
export function cacheKey(normalized: string): string;      // sha256 hex

// filter.ts
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number;
export function applyHardFilters(subject: SubjectProperty, comps: RawComp[], radiusMi: number, now: Date):
  { kept: RawComp[]; rejected: RejectedComp[] };
export function selectRadiusTier(subject: SubjectProperty, comps: RawComp[], now: Date):
  { kept: RawComp[]; rejected: RejectedComp[]; radiusTierMi: number };

// rank.ts
export function scoreComp(subject: SubjectProperty, comp: RawComp, now: Date): ScoredComp;
export function rankComps(subject: SubjectProperty, kept: RawComp[], now: Date): ScoredComp[]; // sorted asc, capped MAX_COMPS_KEPT

// arv.ts
export function pricePerSqft(soldPrice: number, livingArea: number): number;
export function trimmedMean(values: number[]): { mean: number; trimmedOut: number[]; used: number[] };
export function calculateArv(subject: SubjectProperty, ranked: ScoredComp[]): ArvResult;

// format.ts
export function renderCompsForChat(outcome: CompsOutcome): string;   // pure, data-only
```

`now` is always an injected parameter — nothing in pure code calls `Date.now()`.

## 5. Algorithm (binding)

### 5.1 Normalization
Uppercase → strip all chars except `[A-Z0-9 ]` → collapse whitespace → expand
suffix abbreviations **as whole words**. Exact map (both directions normalize to
the long form):

| Abbrev | Expands to | | Abbrev | Expands to |
| --- | --- | --- | --- | --- |
| ST | STREET | | BLVD | BOULEVARD |
| AVE | AVENUE | | LN | LANE |
| RD | ROAD | | CT | COURT |
| DR | DRIVE | | PL | PLACE |
| N | NORTH | | S | SOUTH |
| E | EAST | | W | WEST |

`cacheKey = sha256(normalizedAddress)` (hex, lowercase).
Directionals expand only when they stand as their own token.

### 5.2 Subject
Fetched fields per `SubjectProperty`. `livingArea` null or ≤ 0 ⇒ **hard stop**,
`SUBJECT_SQFT_UNKNOWN`, offer manual ARV. No ARV math of any kind.

### 5.3 Hard filters — reject if ANY, tagged with the FIRST matching reason, in this order
1. `NOT_SOLD` — status ≠ SOLD (case-insensitive)
2. `STALE_SALE` — `soldDate` null or > `MAX_COMP_AGE_MONTHS` months before `now` (months = days / `DAYS_PER_MONTH`)
3. `SQFT_MISSING` — `livingArea` null or ≤ 0
4. `SQFT_OUT_OF_RANGE` — outside subject ± `SQFT_TOLERANCE`
5. `BEDS_DIFF` — both non-null and |Δbeds| > `MAX_BED_DIFF` (null on either side = no rejection)
6. `BATHS_DIFF` — same rule for baths
7. `TYPE_MISMATCH` — `propertyType` ≠ subject's (OTHER never matches anything, including OTHER)
8. `TOO_FAR` — haversine miles > active radius tier
9. `PRICE_MISSING` — `soldPrice` null or ≤ 0
10. `NON_ARMS_LENGTH` — ppsf < `NON_ARMS_LENGTH_PPSF_FRACTION` × median ppsf of the **candidate set** (all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 — regardless of other filters; median of even n = mean of middle two). Deterministic, order-independent.
11. `LOT_ANOMALY` — both lots non-null and comp lot > `LOT_ANOMALY_MULTIPLE` × subject lot

Radius tiers: run filters at 0.5 mi; if kept < `MIN_COMPS_FOR_TIER`, rerun the
full filter pass at 1.0, then 2.0. Stop at the first tier with ≥ 5 kept, else
use the 2.0 mi outcome. `radiusTierMi` recorded on the result. Rejected list
reported from the **final** tier only.

### 5.4 Scoring (lower better)
```
distance = min(distanceMi / DISTANCE_NORM_MI, 1)            * WEIGHT_DISTANCE
sqft     = min(|cSqft - sSqft| / sSqft / SQFT_TOLERANCE, 1) * WEIGHT_SQFT
recency  = min(monthsAgo / RECENCY_NORM_MONTHS, 1)          * WEIGHT_RECENCY
bedbath  = min((|dBeds| + |dBaths|) / 2, 1)                 * WEIGHT_BEDBATH   // null diff counts 0
score    = sum                                              // 0–100
```
Sort ascending; ties broken by `distanceMi` asc, then `zpid` asc (determinism).
Keep top `MAX_COMPS_KEPT`. Fewer than `MIN_COMPS_TO_COMPUTE` kept ⇒ `TOO_FEW_COMPS`.

### 5.5 ARV
```
ppsf       = kept comps' soldPrice / livingArea
n          = ppsf.length
trimCount  = n >= 5 ? max(1, floor(n * TRIM_FRACTION)) : 0
trimmed    = sort(ppsf) minus trimCount from each end
arvPerSqft = mean(trimmed)
arv        = round(arvPerSqft * subjectSqft / ARV_ROUND_TO) * ARV_ROUND_TO
sd         = SAMPLE std dev of trimmed (n-1 denominator; sd = 0 when trimmed.length < 2)
arvLow/High= arv ∓ round(sd * subjectSqft / ARV_ROUND_TO) * ARV_ROUND_TO
cv         = sd / arvPerSqft
```
Confidence: `high` if compsUsed ≥ 6 ∧ cv ≤ 0.15 ∧ median distance ≤ 0.75 mi ∧
median age ≤ 6 months (medians over the kept, ranked set); `medium` if
compsUsed ≥ 4 ∧ cv ≤ 0.25; else `low`. `low` still returns numbers but the
rendered copy must call the estimate weak and invite manual override.

## 6. Provider interface

```ts
export interface PropertyDataProvider {
  readonly name: string;   // 'apify-zillow' | 'stub'
  lookupSubject(normalizedAddress: string): Promise<SubjectProperty | null>;  // null ⇒ ADDRESS_NOT_FOUND
  fetchSoldComps(subject: SubjectProperty, radiusMi: number): Promise<RawComp[]>;
}
```
Errors: providers throw `ProviderTimeoutError` / `ProviderHttpError(status)` /
`ProviderNetworkError`; `service.ts` maps them to failure codes. Retry policy:
one retry on timeout/5xx/network, none on 4xx. `stub.ts` replays fixtures and
is what CI runs until the token lands.

## 7. Caching — table `comps_cache`

```sql
cache_key text primary key, normalized_address text not null,
raw_subject jsonb, raw_comps jsonb, result jsonb,
algo_version int not null, provider text not null,
created_at timestamptz not null default now(), expires_at timestamptz not null
```
- TTL `CACHE_TTL_DAYS` (14). Expired rows are treated as absent.
- Raw payload cached separately from result. Cache hit with stale
  `algo_version` ⇒ **recompute from raw, update result, do not re-hit the provider**.
- In-flight dedupe: module-level `Map<cacheKey, Promise<CompsOutcome>>`; entry
  removed on settle. Two concurrent identical requests = one provider run.
- Cache read/write failures degrade to a live run + warn log; never a user-facing error.

## 8. Conversation state — table `session_state` (new; nothing like it exists today)

```sql
session_id text primary key, state jsonb not null default '{}',
updated_at timestamptz not null default now()
```
Keys written on comps success: `subjectAddress, subjectSqft, subjectBeds,
subjectBaths, arv, arvLow, arvHigh, arvConfidence, arvSource ('comps'|'manual'),
compsRunId`. `set_manual_arv` writes `arv` + `arvSource:'manual'` (clears
low/high/confidence).

Pre-fill: when `flip_calculator` / `brrrr_calculator` is invoked **without**
`after_repair_value` and state carries `arv`, the agent layer injects it before
`assertRequired` runs, and the reply must echo the injection visibly:
`using ARV $412,000 from the comps you ran on 123 Main St — say "change ARV" to override`.
An explicit ARV in the call always wins. State read/write failures degrade to
no-prefill + warn, never a blocked reply.

## 9. LLM tools

```jsonc
// run_comps
{ "name": "run_comps",
  "parameters": { "type": "object",
    "properties": { "address": { "type": "string", "description": "Full street address incl. city+state (and ZIP if given)" } },
    "required": ["address"], "additionalProperties": false } }

// set_manual_arv
{ "name": "set_manual_arv",
  "parameters": { "type": "object",
    "properties": { "arv": { "type": "number", "description": "User-supplied ARV in dollars, > 0" } },
    "required": ["arv"], "additionalProperties": false } }
```
Handlers live in `tools.ts`; agent.ts switch delegates. `run_comps` returns the
**rendered block** from `format.ts` — the model relays it and may add one short
coaching line, but never authors comp data. Rate caps checked before provider
work; breach ⇒ `RATE_LIMITED`.

## 10. Failure copy (all end by offering manual ARV entry; none produce a number)

| Code | Copy gist |
| --- | --- |
| `ADDRESS_NOT_FOUND` | couldn't find that address on Zillow; check spelling/city; or give me your own ARV |
| `SUBJECT_SQFT_UNKNOWN` | found it but no square footage on record ⇒ no ARV math possible; supply ARV manually |
| `TOO_FEW_COMPS` | only N solds nearby in 12 months (needed ≥ 3) at X mi; market too thin; manual ARV offered |
| `PROVIDER_TIMEOUT` | data source didn't answer in time; try again in a minute; or manual ARV |
| `PROVIDER_ERROR` | data source errored; not your input's fault; retry later or manual ARV |
| `RATE_LIMITED` | comps runs are capped (cost control); try later or manual ARV |

## 11. Rendered chat block (`format.ts`, pure)

Success: per comp — address, sold price, sqft, $/sqft, sold date, distance —
plus which comps were trimmed and why (`trimmedOut`), the trimmed $/sqft, the
subject sqft, the multiplication, ARV with low–high band and confidence, radius
tier used, and the one-line footer: *automated estimate from public sold data,
not a formal appraisal*. Confidence `low` adds the weak-estimate warning.
Failures render their §10 copy. `renderCompsForChat` is deterministic for a
given outcome object.

## 12. Fixtures (shared, `src/features/comps/__fixtures__/`)

Hand-written now (token pending), same JSON shape the Apify provider will emit
after mapping: `subject-*.json` (SubjectProperty), `comps-*.json` (RawComp[]).
Starter set: `subject-standard`, `comps-standard` (≥ 10 solds, mixed quality),
`comps-thin` (2 valid), `comps-outlier` (one flip-priced ppsf outlier),
`subject-no-sqft`. Real recordings replace/extend these when the token lands —
MASON coordinates before overwriting anything INSPECTOR references.

## 13. Non-negotiables restated

- No `Date.now()`/randomness inside pure modules; `now` injected, `runId` from service layer.
- `APIFY_TOKEN` never in logs/errors/responses; info logs use `cacheKey`, not raw address.
- Every threshold from §3 only — a literal `0.25` in filter.ts is a bug.
- Discriminated-union outcomes at the service boundary; throws only inside providers.
- `algoVersion` stamped on every outcome, success or failure.
