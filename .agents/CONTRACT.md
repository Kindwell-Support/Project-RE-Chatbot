# CONTRACT — Comps Lookup + ARV (`feat/comps-lookup`)

Owner: MASON. INSPECTOR tests from this file. If code and contract disagree, the
contract wins until a `CONTRACT_CHANGE` is agreed.

- `ALGO_VERSION = 1`
- Status: **token available; full module in scope for tonight.** Pure logic
  stays offline-testable against the stub + fixtures; the Apify provider is
  being built against a recorded spike payload.

## 0. Change log (operator-directed, 2026-08-05 evening)

1. **CUT** in-flight promise dedupe (§7).
2. **CUT** per-session rate cap; the daily cap remains (§3, §9).
3. Radius tier escalation **stays as built** — the operator's cut was
   conditional ("if not already built"); it is built and covered by
   INSPECTOR's filter spec + goldens, so it is not churned.
4. Confidence tiers stay at three, as built (25 goldens green).
5. **RULING (BUG-003)** new hard-filter rule 12 `FUTURE_SOLD_DATE` + defensive
   recency clamp in scoring (§5.3, §5.4).
6. **RULING (BUG-002)** `trimmedMean([])` and `pricePerSqft(price, area <= 0)`
   throw at the function boundary (§5.5).
7. **RULING (CF-001)** `compsUsed` = kept/ranked count, pre-trim (§4).
8. **RULING (§5.1 prose)** normalization *replaces* disallowed chars with a
   space (the implementation was right; the prose was wrong).
9. **RULING (Q3)** cache hits do NOT consume the daily run cap — the cap
   guards Apify spend; a hit costs nothing (§9).
10. **RULING (Q5)** `OTHER` matching nothing, including `OTHER`, is deliberate.
11. `run_comps` is **gated out of `TOOL_DEFINITIONS` when `APIFY_TOKEN` is
    absent** (§9). `set_manual_arv` stays registered regardless.
12. `session_state` written as ONE atomic block, cleared at the START of every
    `run_comps`; pre-fill echoes the bound address and never fires across an
    address mismatch (§8).
13. BUG-001 (materialBudget shebang/CRLF) is ruled **out of scope** for this
    feature.

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
  providers/types.ts  providers/apifyZillow.ts  providers/stub.ts   # geocode.ts dropped — detail scraper takes plain addresses (§6.1)
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
| `COMPS_DAILY_RUN_CAP` | `50` | env-overridable. Counts PROVIDER runs only — cache hits are free (change log #9). ~~per-session cap~~ cut (change log #2) |
| `DAYS_PER_MONTH` | `30.44` | the only months↔days conversion used anywhere |
| `EARTH_RADIUS_MI` | `3958.8` | haversine |

`AppConfig` (src/config.ts) gains: `apifyToken?: string` (`APIFY_TOKEN`) and
`compsDailyRunCap` (`COMPS_DAILY_RUN_CAP`). Neither is required at boot.
Token absent ⇒ `run_comps` is not registered in `TOOL_DEFINITIONS` at all
(change log #11); `set_manual_arv` is always registered.

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
  | 'PRICE_MISSING' | 'NON_ARMS_LENGTH' | 'LOT_ANOMALY' | 'FUTURE_SOLD_DATE';

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
  compsUsed: number;  // RULING CF-001: kept/ranked comps — n BEFORE the trim (the charter's `n = ppsf.length`)
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
Uppercase → **replace every character outside `[A-Z0-9 ]` with a space** (never
literal deletion — `'123,Main,St'` must tokenize as three words, not collapse
into one) → collapse whitespace → expand suffix abbreviations **as whole
words**. Exact map (both directions normalize to the long form):

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
0. `SUBJECT_PROPERTY` — comp zpid = subject zpid, both non-empty (BUG-004: a
   recently-sold subject is a perfect comp for itself and anchors the ARV to
   the member's own purchase price; prepended so the reject table names the
   real reason)
1. `NOT_SOLD` — status ≠ SOLD (case-insensitive)
2. `STALE_SALE` — `soldDate` null or > `MAX_COMP_AGE_MONTHS` months before `now` (months = days / `DAYS_PER_MONTH`). **All date arithmetic (`monthsBetween`) runs at UTC CALENDAR-DAY granularity** (BUG-006): `soldDate` is an ISO date, so a sale "today" is 0 months old at every hour of the day, and comp sets are deterministic per calendar day rather than per hour
3. `SQFT_MISSING` — `livingArea` null or ≤ 0
4. `SQFT_OUT_OF_RANGE` — outside subject ± `SQFT_TOLERANCE`
5. `BEDS_DIFF` — both non-null and |Δbeds| > `MAX_BED_DIFF` (null on either side = no rejection)
6. `BATHS_DIFF` — same rule for baths
7. `TYPE_MISMATCH` — `propertyType` ≠ subject's (OTHER never matches anything, including OTHER)
8. `TOO_FAR` — haversine miles > active radius tier
9. `PRICE_MISSING` — `soldPrice` null or ≤ 0
10. `NON_ARMS_LENGTH` — ppsf < `NON_ARMS_LENGTH_PPSF_FRACTION` × median ppsf of the **candidate set** (all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 — regardless of other filters; median of even n = mean of middle two). Deterministic, order-independent.
11. `LOT_ANOMALY` — both lots non-null and comp lot > `LOT_ANOMALY_MULTIPLE` × subject lot
12. `FUTURE_SOLD_DATE` — `soldDate` parses to strictly after `now` (BUG-003: a sale that hasn't happened is not a comp; Zillow emits pending-close and timezone-shifted dates)

Radius tiers: run filters at 0.5 mi; if kept < `MIN_COMPS_FOR_TIER`, rerun the
full filter pass at 1.0, then 2.0. Stop at the first tier with ≥ 5 kept, else
use the 2.0 mi outcome. `radiusTierMi` recorded on the result. Rejected list
reported from the **final** tier only.

### 5.4 Scoring (lower better)
```
distance = min(distanceMi / DISTANCE_NORM_MI, 1)                  * WEIGHT_DISTANCE
sqft     = min(|cSqft - sSqft| / sSqft / SQFT_TOLERANCE, 1)       * WEIGHT_SQFT
recency  = min(max(monthsAgo, 0) / RECENCY_NORM_MONTHS, 1)        * WEIGHT_RECENCY
bedbath  = min((|dBeds| + |dBaths|) / 2, 1)                       * WEIGHT_BEDBATH   // null diff counts 0
score    = sum                                                    // 0–100, structurally >= 0
```
The `max(monthsAgo, 0)` clamp is BUG-003's defensive half: rule 12 already
rejects future-dated comps, but §5.4's stated 0–100 range must hold no matter
what reaches the function. Clamp placement is deliberate: the clamp lives in
the recency TERM and in the confidence-median input inside `calculateArv`;
`ScoredComp.monthsAgo` itself reports the RAW (possibly negative) value — the
negative number is the evidence of a future date, and the field stays honest.
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

Boundary guards (BUG-002, change log #6): `trimmedMean([])` **throws**
(`TypeError`), and `pricePerSqft(price, livingArea)` **throws** when
`livingArea <= 0` — NaN renders as "$NaN" and Infinity defeats the
non-arms-length comparison (`Infinity < 0.4 × median` is false), so both fail
loudly at the function boundary instead of positionally relying on today's
callers.

## 6. Provider interface

```ts
export interface PropertyDataProvider {
  readonly name: string;   // 'apify-zillow' | 'stub'
  lookupSubject(rawAddress: string): Promise<SubjectProperty | null>;  // null ⇒ ADDRESS_NOT_FOUND
  fetchSoldComps(subject: SubjectProperty, radiusMi: number): Promise<RawComp[]>;
}
```
Errors: providers throw `ProviderTimeoutError` / `ProviderHttpError(status)` /
`ProviderNetworkError`; `service.ts` maps them to failure codes (a leaked
`SyntaxError` from a malformed body maps to `PROVIDER_ERROR` too). **The retry
policy lives in `service.ts` at this seam** — one retry on timeout/5xx/network,
none on 4xx — so it is uniform for every provider implementation and
offline-assertable by spy call count; providers themselves make exactly ONE
attempt and only classify failures. `stub.ts` replays fixtures and is what CI
runs — the default `npm test` never touches the network.

**Injection seam (BLOCKED-0008 resolution, binding):**
`AppDeps` (src/server/app.ts) gains `propertyProvider?: PropertyDataProvider`.
buildApp threads it into `runAgent` options and from there into the comps tool
handlers → `service.ts`. `service.ts` NEVER constructs a provider itself; the
default `ApifyZillowProvider` is constructed lazily inside buildApp (mirroring
the existing `getOpenAI`/`getSupabase` lazy getters — nothing network-capable
is created at module scope). A test hands the pipeline a fake provider through
deps with no env vars and no module-registry tricks.

### 6.1 Apify payload mapping — RECORDED FACTS (spike, 2026-08-05; fixtures in `__fixtures__/spike-*.json`)

Two actors, two sequential runs (~8–13s each; both well inside the 90s timeout):

| Step | Actor | Input |
| --- | --- | --- |
| Subject | `maxcopell/zillow-detail-scraper` | `{ addresses: ["<raw address>"], propertyStatus: "RECENTLY_SOLD" }` — takes plain addresses, so **`providers/geocode.ts` is dropped from the layout**; no geocoding step exists |
| Comps | `maxcopell/zillow-scraper` | one `searchUrls` entry: `zillow.com/homes/recently_sold/?searchQueryState=<json>` with `mapBounds` = subject lat/lng ± radius, `filterState.isRecentlySold`, `extractionMethod: "MAP_MARKERS"`, `resultsLimit: 40` |

Field mapping the adapter implements (payload reality vs contract types):

| Contract field | Subject (detail payload) | Comp (search payload, under `hdpData.homeInfo`) |
| --- | --- | --- |
| `zpid: string` | `zpid` is a **number** → `String(zpid)` | number in `homeInfo`, string on the card → `String()` |
| `status` | `homeStatus` — `"RECENTLY_SOLD"` maps to `SOLD` | `homeInfo.homeStatus` — same mapping |
| `soldDate` (ISO **date**) | `dateSold` is an ISO timestamp (`"2026-07-31T00:00:00.000Z"`) → **calendar date only** (`"2026-07-31"`) | `homeInfo.dateSold` is **epoch millis** (local-midnight-in-UTC, e.g. 07:00Z for Phoenix) → **calendar date only**. BUG-006: preserving the instant rejected same-day sales as future-dated for 7 UTC hours a day |
| `soldPrice` | `lastSoldPrice` | `homeInfo.price` |
| `livingArea` | `livingArea` | `homeInfo.livingArea` |
| `lotSize` (sqft) | `lotSize` (already sqft) when present, else `lotAreaValue`+`lotAreaUnits` | `homeInfo.lotAreaValue` + `lotAreaUnit` — **`"acres"` or `"sqft"`** (case-insensitive); acres × 43,560 |
| `propertyType` | `homeType` | `homeInfo.homeType` |
| `lat`/`lng` | `latitude`/`longitude` | `homeInfo.latitude`/`longitude` |
| `beds`/`baths` | `bedrooms`/`bathrooms` | `homeInfo.bedrooms`/`bathrooms` |

`homeType` observed values → enum: `SINGLE_FAMILY→SFR`, `CONDO→CONDO`,
`TOWNHOUSE→TOWNHOUSE`, `MANUFACTURED→MANUFACTURED`, anything else
(`LOT`, `MULTI_FAMILY`, `APARTMENT`, `HOME_TYPE_UNKNOWN`, …) → `OTHER`.

Comps list hygiene: skip items with no `hdpData.homeInfo`, or `zpid` null, or
`isBuilding` — the search emits building/rental cards mixed into sold results
(3/40 in the recorded run).

**Address-miss detection is TWO checks, both required:**
1. Hard miss: the item is `{ isValid: false, invalidReason, ... }` with no
   property data (recorded in `spike-miss.json`) ⇒ `ADDRESS_NOT_FOUND`.
2. **Fuzzy mis-match**: a bad address can return `isValid` with a DIFFERENT
   property — recorded: `"123 E Coronado Rd"` → `"319 E Coronado Rd #1234"`,
   `homeStatus OTHER`, all-null facts. Guard: `normalizeAddress(input street
   part)` must equal `normalizeAddress(returned streetAddress)` (the
   normalizer already unifies `Blvd`/`Boulevard`, `W`/`WEST` — verified on the
   recorded pair); mismatch ⇒ `ADDRESS_NOT_FOUND`. Never run comps against a
   property the member didn't name.

## 7. Caching — table `comps_cache`

```sql
cache_key text primary key, normalized_address text not null,
raw_subject jsonb, raw_comps jsonb, result jsonb,
algo_version int not null, provider text not null,
created_at timestamptz not null default now(), expires_at timestamptz not null
-- plus: create index on comps_cache (expires_at)  — operator #5, for stale-row cleanup
```

**Supabase key (operator #6, confirmed by reading src/server/app.ts):** the
backend's ONLY Supabase client is `createClient(supabaseUrl,
config.supabaseServiceKey)` — the SERVICE ROLE key. `comps_cache` and
`session_state` follow the existing `chat_messages` pattern exactly: RLS
enabled, **no anon policies on purpose**, service role is the sole client. The
anon key appears nowhere in this path, so the RLS-empty-result trap (silent
cache misses re-billing Apify on every request) cannot arise.
- TTL `CACHE_TTL_DAYS` (14). Expired rows are treated as absent.
- Raw payload cached separately from result. Cache hit with stale
  `algo_version` ⇒ **recompute from raw, update result, do not re-hit the provider**.
- ~~In-flight promise dedupe~~ **CUT** (change log #1). Two concurrent
  identical requests may each hit the provider; accepted cost for tonight.
- Cache read/write failures degrade to a live run + warn log; never a user-facing error.
- Cache hits do not consume `COMPS_DAILY_RUN_CAP` (change log #9).

## 8. Conversation state — table `session_state` (new; nothing like it exists today)

Safety-by-construction rules (change log #12):

```sql
session_id text primary key,           -- REUSES the chat_messages session_id verbatim; no new identifier
state jsonb not null default '{}',     -- ONE jsonb column carrying the whole blob; atomicity comes free
updated_at timestamptz not null default now()
```

Pinned Supabase call shapes (BLOCKED-0008; INSPECTOR's double narrows to these):

```
read   .from('session_state').select('state').eq('session_id', id).maybeSingle()
write  .from('session_state').upsert({ session_id, state, updated_at })
```

- The comps block is written as **ONE atomic object**, never field-by-field:
  ```ts
  interface CompsStateBlock {
    subjectAddress: string; subjectSqft: number;
    subjectBeds: number | null; subjectBaths: number | null;
    arv: number; arvLow: number | null; arvHigh: number | null;
    arvConfidence: ArvConfidence | null;
    arvSource: 'comps' | 'manual';
    compsRunId: string | null;
    computedAt: string;                // ISO timestamp
  }
  // state.comps: CompsStateBlock | undefined — the whole block or nothing
  ```
- **The block is CLEARED at the START of every `run_comps` call, before the
  provider is hit.** A failed run leaves NO ARV behind — not the previous one.
- `set_manual_arv` writes the same shape with `arvSource: 'manual'`,
  `arvLow/arvHigh/arvConfidence/compsRunId: null`, and `subjectAddress`
  carried from the existing block when present (else `'manual entry'`).
- Pre-fill: when `flip_calculator` / `brrrr_calculator` is invoked **without**
  `after_repair_value` and `state.comps` exists, the agent layer injects
  `state.comps.arv` before `assertRequired` runs. The reply MUST echo the bound
  address — `using ARV $402,000 from the comps on 123 Main St — say "change
  ARV" to override` — non-negotiable; the echo is what makes a stale value
  visible instead of silently wrong.
- **Address-mismatch guard**: if the user's message states an address that is
  not the same property as `subjectAddress` (compare normalized forms), do NOT
  pre-fill. Ask which deal they mean.
- **Explicit-ARV rule (operator ruling, blocker-level; replaces the plain
  "explicit wins")** — when a stored block exists, an explicit
  `after_repair_value` in a flip/brrrr call resolves by WHO said the number:
  1. `explicit == block.arv` → the model is relaying the current block:
     echo + address-mismatch guard apply (same guarantees as the injected
     pre-fill).
  2. `explicit != block.arv` AND the member stated that number in the
     CURRENT message (forms accepted: `431000`, `431,000`, `$431,000`,
     `431k`, `0.5m`, `431 thousand`; current message only — history is
     precisely where stale figures live) → genuine override: runs, and the
     echo names BOTH the override and the stored estimate it replaces.
     **Sub-case, BUG-007 (operator ruling: label, never block)**: if the
     message ALSO names a different property, the run is coherent new-deal
     input and proceeds — but the echo is two-part and mandatory: (a) the
     property the analysis is actually running on, and (b) the ARV's
     provenance — the member's stated number, with an explicit flag that the
     comps on file are bound to a different address (which `state.comps`
     still is on the next turn). Shape: *"Running this on 456 Oak Ave using
     YOUR stated ARV of $400,000 — note: the comps on file are for 123 Main
     St, not this property."*
  3. `explicit != block.arv` AND the number is NOT in the member's message →
     a model-carried stale figure (address A's ARV surviving into address
     B's deal through conversation history). The calculator does NOT run;
     the model is instructed to ask which number the member wants.
     **Ambiguity is a question, not an assumption.**
  With no stored block, explicit values behave as before (nothing to
  conflict with).
- State read/write failures degrade to no-prefill + warn log, never a blocked
  reply.

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
coaching line, but never authors comp data.

Registration gate (change log #11): `run_comps` appears in `TOOL_DEFINITIONS`
**only when `config.apifyToken` is present** — with no token the model cannot
even attempt a comps run, and the prompt must not advertise it.
`set_manual_arv` is always registered.

Rate cap: the **daily** cap only (per-session cap cut). Checked before provider
work; cache hits bypass it entirely; breach ⇒ `RATE_LIMITED`.

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

Failure copy ownership (FINDING-002): the §10 wording is COMPOSED in
`service.ts` (from format.ts's exported `FAILURE_COPY` table — one source) and
carried on `CompsFailure.message`; `renderCompsForChat` renders failures as a
passthrough of that message, with a code-keyed fallback to the same table
(BUG-005) so a malformed failure object still renders §10 copy rather than
"undefined". `renderCompsForChat` is deterministic for a given outcome object.

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
