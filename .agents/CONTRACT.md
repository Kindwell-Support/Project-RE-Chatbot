# CONTRACT — Comps Lookup + ARV (`feat/comps-lookup`)

Owner: MASON. INSPECTOR tests from this file. If code and contract disagree, the
contract wins until a `CONTRACT_CHANGE` is agreed.

- `ALGO_VERSION = 2` (was 1 — bumped by the client-spec alignment, §14)
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

## 14. CLIENT-SPEC ALIGNMENT (ALGO_VERSION 2) — branch `feat/comps-client-spec`

Operator-directed alignment with the client's written comp-selection method.
**This section is binding and supersedes the older values wherever they
conflict**; the tables in §3/§5 have been edited in place to match.

### 14.1 Parameter changes

| Parameter | Was (v1) | Now (v2) | Note |
| --- | --- | --- | --- |
| `SQFT_TOLERANCE` | 0.25 | **0.20** | Her spec reads "generally within 10–20%". **Pinned reading:** 20% is the HARD GATE; closeness inside the band is already rewarded by the sqft scoring term, so gate-at-20% + existing scoring together satisfy "generally within 10–20%" without a second gate at 10% that would decimate thin markets. |
| `RADIUS_TIERS_MI` | [0.5, 1.0, 2.0] | **[1.0, 3.0]** | **Widens the outer bound from 2 mi to 3 mi.** Fewer, wider rungs. |
| Recency | flat 12-month gate, recency scored | **`RECENCY_TIERS_MONTHS = [3, 6, 12]`** | Her spec ("start at 3 months, extend to 12 in a slower market") is TIERING, not scoring. The 12-month wall remains the outer bound; the recency term still scores within it. |
| `MAX_COMPS_KEPT` | 8 | **5** | Display AND compute — no split. The ARV is computed from the same 5 the member sees. |
| `MIN_COMPS_TO_COMPUTE` | 3 | **3** (unchanged) | |
| Lot size | hard gate (`LOT_ANOMALY`, >5× subject) | **soft scoring factor** | A hard lot gate decimates thin markets. Rule 11 `LOT_ANOMALY` is REMOVED from §5.3; lot becomes a scored term (§14.3). `RejectReason` keeps the member for back-compat with cached v1 results but it is never emitted. |

### 14.2 The two ladders, and the order they widen (design decision, pinned)

Two tiered gates now exist. They are walked as ONE ordered ladder, stopping at
the first rung yielding ≥ `MIN_COMPS_FOR_TIER` (5):

```
1.0 mi / 3 mo  →  1.0 mi / 6 mo  →  1.0 mi / 12 mo
              →  3.0 mi / 3 mo  →  3.0 mi / 6 mo  →  3.0 mi / 12 mo
```

**Recency widens BEFORE radius.** Rationale, pinned so it is not "corrected"
later: location is a stronger determinant of value than recency inside a
12-month window — a same-neighbourhood sale from eight months ago is usually a
better comp than one three miles away from last month. Exhaust time before
distance. If no rung reaches 5, the LAST rung's outcome is used (and may still
satisfy `MIN_COMPS_TO_COMPUTE` = 3).

`CompsResult` records BOTH: `radiusTierMi` (existing) and **`recencyTierMonths`**
(new). The rendered block names both.

### 14.3 Scoring, with lot reinstated as soft

Weights must sum to 100. Lot takes 10, drawn 5 from distance and 5 from sqft —
the minimum disturbance that leaves the two dominant terms dominant:

```
distance = min(distanceMi / DISTANCE_NORM_MI, 1)                  * 35   (was 40)
sqft     = min(|cSqft - sSqft| / sSqft / SQFT_TOLERANCE, 1)       * 25   (was 30)
recency  = min(max(monthsAgo, 0) / RECENCY_NORM_MONTHS, 1)        * 20   (unchanged)
bedbath  = min((|dBeds| + |dBaths|) / 2, 1)                       * 10   (unchanged)
lot      = min(|cLot - sLot| / sLot / LOT_NORM_RATIO, 1)          * 10   (NEW)
```

`LOT_NORM_RATIO = 1.0` — a 100% lot difference saturates the term. **Null lot on
either side scores 0**, exactly as null beds/baths do: unknown is not a penalty.

### 14.4 Confidence, rebased (operator ruling — a consequence, not a choice)

`high` required n ≥ 6; with the cap at 5 that is structurally unreachable and
every run would return medium or low forever. Rebased:

- **high** — compsUsed ≥ **5** (the full set kept) ∧ cv ≤ 0.15 ∧ median distance ≤ 0.75 mi ∧ median age ≤ 6 months
- **medium** — compsUsed ≥ 4 ∧ cv ≤ 0.25
- **low** — otherwise

CV thresholds unchanged.

**The trim consequence, stated plainly rather than buried:** at n = 5,
`trimCount = max(1, floor(5 × 0.15)) = 1`, so one comp is dropped from each end
and **the ARV is the mean of 3 values, with the sample standard deviation also
computed over those 3** (n−1 = 2 degrees of freedom). That is the client's
method as written — 5 comps shown, 5 kept, 3 averaged after outlier trimming.
It is a deliberately small sample and the confidence tiers are what qualify it.

### 14.5 Per-comp fields — VERIFIED AGAINST THE RECORDED PAYLOAD

Evidence: 73 sold comps across both recorded search runs
(`spike-comps.json`, `spike-comps-2.json`).

**Buildable — render these:**

| Field | Source | Availability |
| --- | --- | --- |
| address, sold price, sold date, sqft, $/sqft, distance | existing | already rendered |
| **beds** | `homeInfo.bedrooms` | 70/73 |
| **baths** | `homeInfo.bathrooms` | 71/73 |
| **lot size** | `homeInfo.lotAreaValue` + `lotAreaUnit` | 73/73 (68 sqft, 5 acres → normalized to sqft) |
| **property link** | `detailUrl` | 73/73 — **LOAD-BEARING (§14.9)**; unbuildable ⇒ explicit "link unavailable" |

**NOT buildable from the comps payload — reported, NOT built (§14.6).**

**Null rendering rule (no-fabrication extends to every new field):** a null
field renders as an explicit **`—`** (em dash). Never omitted silently, never
inferred, never back-filled from another comp or from the subject.

### 14.6 What the payload does NOT contain — for the client conversation

The comps come from the **search** scraper; the subject comes from the
**detail** scraper. They carry different data, and that distinction is the
whole answer:

| Client criterion | In comps (search) payload? | Note |
| --- | --- | --- |
| **Days on market** | **NO — effectively absent.** `daysOnZillow` is **−1 on 73/73** sold comps (a sentinel, not a value). `timeOnZillow` exists in ms (5.6–14.6 days observed) but its meaning for a SOLD listing is unverified — it may be time-on-site, not marketing time. | Not rendered. Would be a guess. |
| **Parking spaces** | **NO** — absent from every search field. | Present in the DETAIL payload only (`resoFacts.parkingCapacity`, `garageParkingCapacity`, `hasGarage`). |
| **Year built / similar age** | **NO** in search. | Present in DETAIL (`yearBuilt`) — so available for the SUBJECT, not for comps. |
| **Architectural style** | **NO** in search. | Present in DETAIL (`resoFacts.architecturalStyle` — observed "Ranch", "Spanish"). |
| **Construction quality / condition** | **NO** in search. | DETAIL has `resoFacts.propertyCondition` (observed "Fixer") but only in 1 of 2 recorded subjects — inconsistent even there. |
| **Garage / basement / ADU** | **NO** in search. | DETAIL has garage fields; **basement absent in both** recorded subjects; no ADU field at all (`hasAdditionalParcels` is not an ADU). |

**The cost fact the client decision turns on:** every one of the missing
criteria exists in the DETAIL payload. Getting them per comp means one detail
actor run **per comp** — 5 extra runs on top of the current 2, i.e. **2 → 7
runs per comps lookup, ~3.5× the Apify cost**, against a quota the client pays
for. Recommend the client decides whether any of these criteria justify that
before anything is built. No render slots exist for them today.

### 14.7 Prescribed copy — verbatim, from constants, structural in format.ts

Exported as named constants and emitted by `format.ts` structurally (not
model-authored, not prompt-dependent), on every SUCCESSFUL comps render:

- `COMPS_OPENING` (before the table): *"Sure. Here are recent comparable sales
  for that location and home type. Please note responses are for education and
  based on available public data. Investors are encouraged to review each
  address for additional information."*
- `COMPS_CLOSING` (emitted after the comps table; when `ARV_SURFACING` is on the ARV block sits between them, so this is always the LAST content before the footer): evaluate each property carefully;
  current quality of home, overall appeal, lot location and usability can
  drastically impact value; consider external factors such as view properties,
  environmental concerns, powerlines, busy roads.

The existing not-an-appraisal footer and the low-confidence warning remain.

### 14.8 ARV REMOVED — a ONE-WAY DOOR (client decision, final)

Supersedes the earlier flag-gated version entirely. The client removed the
computed ARV from the comps response AND the calculator pre-fill. It is
**deleted, not gated and not dark**: `ARV_SURFACING` and
`AppConfig.arvSurfacingEnabled` are gone with it.

**Recorded so its absence never reads as an oversight:** this is a ONE-WAY
DOOR. `arv.ts` — the trimmed mean, sample standard deviation, cv, confidence
tiers, `arvLow`/`arvHigh`, rounding — is deleted, along with `ArvResult`,
`ArvConfidence`, `CompsResult.arv`, and the `TRIM_FRACTION` / `ARV_ROUND_TO` /
`CONF_HIGH` / `CONF_MEDIUM` constants. **Reinstating the ARV is a REBUILD from
this contract, not a flag flip.** The client asked for it out; it is out.

What went, precisely:

- `arv.ts` deleted; `service.ts` no longer computes an ARV; `CompsResult` has
  no `arv` field.
- `format.ts`: the ARV block and `confidenceLine` are gone. The emit order is
  now opening → header → table → closing → footer, with no gap where the ARV
  used to be.
- `tools.ts`: the model-facing success result is `{ rendered_block,
  instruction }` — **no `arv`, no `confidence`**, and the old instruction
  claiming the ARV "will pre-fill the Flip/BRRRR calculators" is gone, since
  it had become false.
- **`run_comps` no longer touches `session_state` at all** — see below.

**What SURVIVES, deliberately (manual ARV is unaffected):** `session_state`
and its table, `CompsStateBlock`, the atomic single-block write, the
address-mismatch guard, the echo machinery, `set_manual_arv`,
`applyArvPrefill` and `applyFormArvPrefill`.

- The two pre-fill functions are **NOT deleted** — deleting them would make
  `set_manual_arv` write to something nothing reads, i.e. a silent no-op,
  contradicting "manual ARV is unaffected". They now serve **`arvSource:
  'manual'` blocks only**; a leftover `'comps'` block from a cached v2 session
  is ignored and never pre-fills.
- **`clearCompsBlock` is no longer called before the provider.** That clear
  existed to stop a failed run leaving the previous *comps* ARV behind. Comps
  no longer writes an ARV, so the only thing the clear could still destroy is
  a number the MEMBER typed — running comps must never silently delete that.
  The address-mismatch guard still prevents a manual ARV bound to address A
  being applied to address B: ambiguity resolves to asking, not assuming.
  (`clearCompsBlock` remains exported and tested; production simply has no
  caller.)

**`ALGO_VERSION` 2 → 3.** Cached v2 blobs carry an `arv` key that no longer
deserializes into `CompsResult`; the version stamp forces recompute-from-raw
rather than relying on the deserializer to tolerate a dead field.

### 14.9 Style / condition / quality matching — FORMALLY WAIVED

The client has waived, in writing: similar age, architectural style, matching
garage/basement/ADU, similar construction quality and condition. Recorded here
so it does not resurface as a gap. **Not a limitation — a scope decision.**

**Consequence: the property link is now LOAD-BEARING.** It is the client's
stated substitute for those three matching criteria — the member follows it to
evaluate style, condition and quality themselves. So:

- A comp whose link cannot be built (missing `zpid`/`detailUrl`) is a REAL
  degradation, not a cosmetic gap.
- It renders as an explicit **"link unavailable"**, never a silently omitted
  field. Same no-fabrication rule as every other column, and here it also
  tells the member that the thing standing in for three criteria is missing
  for that row.

### 14.10 Census demographics — IN SCOPE, SEPARATE SLICE, AFTER the parameters

US Census ACS API (free, no key at light volume): median household income,
median age, owner-vs-renter occupancy. Keyed off the subject lat/lng already
in hand.

**Sequencing is binding: parameters + fields ship and hand off FIRST. Census
does not interleave** — the client is waiting on the parameter work and it is
what addresses her complaint.

When built: cache by tract/ZIP with its own TTL; a Census failure is
NON-FATAL (comps still render in full, the demographics section says
unavailable); never infer a figure the API did not return.

### 14.11 Out of scope

- **Neighbourhood summary** — all of it. Separate block.

### 14.13 BUG-010 — duplicate-sale dedupe (operator ruling)

Zillow carries one sale under TWO zpids with different address formatting
(recorded: `830 America St` / `830 W AMERICA Street`, both $360,000 / 1,315
sqft / 2026-07-17, coordinates 0.3 m apart). Under the v2 cap of 5 it took
**two of five slots**, double-weighted that sale in a trimmed mean of three
values, displaced a genuine comp, and — duplicates shrink variance — pushed
the confidence tier up.

- **Identity is the SALE, never the id**: equal `soldPrice`, `livingArea` and
  `soldDate`, plus coordinates within `DUPLICATE_COORD_TOLERANCE_MI` (~10 m).
  A DISTANCE threshold, not float equality — the recorded pair differs in the
  sixth decimal of latitude, which exact matching misses.
- **Winner**: the record with more non-null fields among lot / beds / baths /
  link; ties break on the longer street address. Deterministic.
- **Placement**: `dedupeSales` runs inside the tier walker, AFTER the hard
  filters and BEFORE ranking, so a duplicate can never consume a slot and only
  a comp that would otherwise have been KEPT is ever labelled a duplicate. The
  tier's sufficiency test runs on the DEDUPED count, so a rung cannot "reach
  5" on four real sales plus a copy.
- **Reported** as `RejectReason.DUPLICATE_SALE`, visible in the rejection
  table like every other drop.
- **One deviation from the literal instruction, flagged:** the ruling's
  rationale also required duplicates not to skew "the candidate-set median the
  non-arms-length rule depends on". Placement after the gates CANNOT achieve
  that — the median is computed inside the gate pass. So
  `candidateMedianPpsf` additionally dedupes its own input. Both halves of the
  stated rationale now hold; the rejection semantics stay honest.

### 14.14 Per-comp detail enrichment — PRE-BUILD RULES (client approved; build gated on INSPECTOR GREEN)

Client approved detail runs for the final comps (DOM, parking, year built —
style/condition are obtainable but DISPLAY needs a separate client ruling).
Spike recorded in `spike-detail-batch5.json` / `spike-detail-batch-mixed.json`.
Pinned now, while fresh, so the build cannot drift from the evidence:

1. **THE JOIN KEY IS `addressOrUrlFromInput`. NEVER POSITION.** This is a
   RULE, not a note: the batch returns items OUT of input order (recorded —
   input 1,2,3,4,5 came back 1,4,5,2,3). Positional matching would assemble
   five comps wearing each other's parking counts and year built, and nothing
   about that looks broken from the outside. Any adapter matching batch
   output to comps by index is a bug regardless of passing tests.
2. **Batch size is bounded by `MAX_COMPS_KEPT`, never an independent
   constant.** Detail runs happen AFTER ranking and dedupe, on the FINAL kept
   set only — if the cap changes, the batch changes with it automatically.
   (Get this wrong and it is ~40 runs per lookup, not 1.)
3. **Partial failure is non-fatal**, and the actor's own semantics support it:
   a bad address in a batch returns as its own `{isValid:false,
   invalidReason}` item while the rest succeed (recorded). A failed item
   renders em-dash detail fields exactly like today; a detail failure never
   turns a working comps run into a failure.
4. **Detail cached BY ZPID, separately from the comps result, with its own
   LONGER TTL** — property facts barely change; nearby lookups share comps
   and therefore share detail payloads. This is the main cost lever.
5. **The 90s ceiling applies to the WHOLE pipeline.** If detail would breach
   it, return the comps without detail.
6. **Economics**: 3 actor runs per lookup (subject + search + one batched
   detail), not 7. Batch of 5 measured at 16s vs 10s for a single.
7. **Parallel fallback (individual detail runs) MUST NOT be built blind**:
   the account limits endpoint returns nothing to this token, so the plan's
   concurrency ceiling is unknown. If batching ever stops sufficing, that
   number comes from the client's Apify console FIRST. Recorded so nobody
   starts it without it.

**Daily cap ruling (operator):** `COMPS_DAILY_RUN_CAP` stays **50** and counts
**LOOKUPS** — the client accepted the 3-runs-per-lookup multiplier knowingly,
and dropping to a spend-neutral 33 would quietly claw back capacity she did
not agree to give up. 50 lookups ≈ 150 actor runs/day worst case. The config
comment currently says "provider runs", which is wrong about what the code
counts — fixed in the build slice, with the multiplier documented next to the
value.

### 14.12 Blast radius

Every golden expected value, every mapped fixture, and all three live
ground-truth runs change. **Tests are INSPECTOR's and must be recomputed by
hand from this contract — never adjusted to match implementation output.**

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
| `ALGO_VERSION` | `2` | stamped on every result; cache recompute trigger. **2 as of the client-spec alignment (§14)** — until the constant is 2 the recompute path never fires and cached v1 rows keep serving old-parameter results for 14 days, stamped `algoVersion: 1` and indistinguishable from fresh. |
| `MAX_COMP_AGE_MONTHS` | `12` | hard filter |
| `SQFT_TOLERANCE` | `0.20` | subject sqft ±20% — hard gate (§14.1) |
| `MAX_BED_DIFF` | `1` | hard filter |
| `MAX_BATH_DIFF` | `1` | hard filter |
| `RADIUS_TIERS_MI` | `[1.0, 3.0]` | outer bound widened 2→3 mi (§14.1) |
| `RECENCY_TIERS_MONTHS` | `[3, 6, 12]` | recency is TIERED, not just scored (§14.1). Recency widens BEFORE radius (§14.2) |
| `MIN_COMPS_FOR_TIER` | `5` | tier advance threshold |
| `MIN_COMPS_TO_COMPUTE` | `3` | below ⇒ `TOO_FEW_COMPS` |
| `MAX_COMPS_KEPT` | `5` | after ranking — display AND compute, no split (§14.1) |
| `NON_ARMS_LENGTH_PPSF_FRACTION` | `0.4` | ppsf < 40% of candidate median ⇒ reject |
| ~~`LOT_ANOMALY_MULTIPLE`~~ | REMOVED | lot is now a soft SCORING term, not a gate (§14.1/§14.3) |
| `LOT_NORM_RATIO` | `1.0` | lot-score normalizer; 100% difference saturates |
| `WEIGHT_DISTANCE` / `WEIGHT_SQFT` / `WEIGHT_RECENCY` / `WEIGHT_BEDBATH` / `WEIGHT_LOT` | `35 / 25 / 20 / 10 / 10` | score weights, sum 100 (§14.3) |
| `DISTANCE_NORM_MI` | `1.0` | score normalizer |
| `RECENCY_NORM_MONTHS` | `12` | score normalizer |
| `TRIM_FRACTION` | `0.15` | trimmed-mean trim per end (n ≥ 5) |
| `ARV_ROUND_TO` | `1000` | round ARV/low/high to nearest |
| `CONF_HIGH` | `{ minComps: 5, maxCv: 0.15, maxMedianDistanceMi: 0.75, maxMedianAgeMonths: 6 }` | minComps 6→5: unreachable once the cap is 5 (§14.4) |
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
10. `NON_ARMS_LENGTH` — ppsf < `NON_ARMS_LENGTH_PPSF_FRACTION` × median ppsf of the **DEDUPED candidate set** (BUG-010: `candidateMedianPpsf` runs `dedupeSales` on its own input first. The DUPLICATE_SALE rejection happens after the gates, but this median is computed INSIDE the gate pass, so a later drop cannot reach it — without deduping here, a sale counted twice would skew the very threshold the rule depends on. Implement it as written or the next reader will reintroduce the skew.) Median over all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 — regardless of other filters (all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 — regardless of other filters; median of even n = mean of middle two). Deterministic, order-independent.
11. ~~`LOT_ANOMALY`~~ — **REMOVED in v2** (§14.1): lot is a soft scoring term now. The `RejectReason` union keeps the member so cached v1 results still type, but it is never emitted.
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
**`APARTMENT→CONDO`** (operator ruling, recorded case 16402 N 31st St #236:
Zillow types condo units in apartment-style complexes as APARTMENT; the old
`→OTHER` mapping made every such subject permanently incapable of an ARV),
`TOWNHOUSE→TOWNHOUSE`, `MANUFACTURED→MANUFACTURED`, anything else
(`LOT`, `MULTI_FAMILY`, `HOME_TYPE_UNKNOWN`, …) → `OTHER`.

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

### 8.1 The calculator FORM surface (scope amendment, operator-directed)

The inline form is a second entry point into the same calculators and carries
the SAME guarantees as the chat surface — a guard existing on one path and not
the other is worse than no guard, because the tests look green.

- **Server-side state read only.** The form descriptor is enriched inside
  `executeTool('request_calculator_form')` via the existing Fastify path; the
  widget never talks to Supabase and no new widget→Supabase path exists.
- **Editable default shape**: the ARV field (flip/brrrr only; land never) may
  carry `prefill: { value, subjectAddress, arvSource, confidence, label }` —
  attached by the pure `applyFormArvPrefill(form, block, userMessage)`
  (src/features/comps/formPrefill.ts) on a CLONE; the static
  `CALCULATOR_FORMS` never carry session data.
- **Label copy**: `Pre-filled from your comps on <subjectAddress> — edit to
  override.` (manual-source variant names the manual entry). Label and value
  live in ONE object — **no label means no pre-fill, by construction**.
- **Mismatch ⇒ blank**: if the member's current message names a different
  property (same `findConflictingAddress` discriminator as chat), the form
  renders WITHOUT a default — never a silent carry.
- **No block ⇒ no default, ever.** State read failure ⇒ plain form.
- **Widget obligations**: render `prefill.value` into the control, render
  `prefill.label` visibly beside it, do NOT mark it as an omittable sheet
  default — an untouched pre-filled ARV SUBMITS its value (it is a required
  field), so the submission carries an explicit ARV.
- **Submitted path**: form submissions seed through the SAME `executeTool`
  switch, so a submitted ARV passes through `applyArvPrefill`'s explicit-ARV
  rule like any model call — equal to the block ⇒ relay echo; edited ⇒
  override echo (the form's transcript line states the number, satisfying
  `messageStatesNumber`). No second calculation path, no guard bypass.
- **The model cannot populate the form.** `request_calculator_form` accepts
  `{ calculator }` with `additionalProperties: false`; the prefill value comes
  from `session_state` server-side. The model-facing payload carries
  `arv_prefilled_from` (the ADDRESS only, never the value).

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

**Repeat requests (operator ruling, 2026-08-06):** a comps request for an
address already run this conversation is RE-RUN through `run_comps` — a
repeat is a cache hit and costs nothing, and the member gets the full
rendered block again, inside every guarantee. The prompt forbids answering a
comps request by summarising an earlier result from memory: every ARV the
member sees must come from a `run_comps` result in that turn. (The previous
"don't re-run" spend guard solved a problem the cache already solves, and
pushed replies onto a transcript-recall path outside `format.ts` — see
mailbox 0023 for the evidence.) No recall-with-constraints path exists or is
planned.

**Observability (operator-approved, same ruling):** `qa_logs.tool_calls`
(jsonb, `[{ name, args, ok }]` in call order — migration
`sql/add_qa_logs_tool_calls.sql`, applied live). The response always carried
the trace; the log now keeps it, so "did this turn invoke a tool?" is one
query, not forensics.

Rate cap: the **daily** cap only (per-session cap cut). Checked before provider
work; cache hits bypass it entirely; breach ⇒ `RATE_LIMITED`.

## 10. Failure copy (all end by offering manual ARV entry; none produce a number)

| Code | Copy gist |
| --- | --- |
| `ADDRESS_NOT_FOUND` | **Branched on `detail.resolution`, then `detail.inputHasUnit` (operator rulings: one code, three truths).** `not_found` (genuine empty/invalid): couldn't find that address on Zillow; check spelling/city; or give me your own ARV. `unit_mismatch` + `inputHasUnit: true` (member typed a unit designator — `#`, `unit`, `apt`, `apartment`, `suite`, `ste`; detected by `hasUnitDesignator()` on the RAW input, conservative, bare trailing numbers excluded): "I found the building but couldn't match that exact unit. Double-check the unit number, or tell me your ARV and I'll run the numbers with it." `unit_mismatch` + `inputHasUnit: false` (no unit in the input — there is nothing for the member to double-check): "I found the building but Zillow couldn't pin it to a specific property. If it's a condo or apartment, try including the unit number — otherwise tell me your ARV and I'll run the numbers with it." The mismatch is logged at INFO with `cacheKey` + which guard fired — if frequent in production, `SUBJECT_RESOLUTION_MISMATCH` earns its own code properly, with tests. All branches: no number, manual entry offered |
| `SUBJECT_SQFT_UNKNOWN` | found it but no square footage on record ⇒ no ARV math possible; supply ARV manually |
| `TOO_FEW_COMPS` | **Branched on `detail.pool` (operator ruling).** Default: only N solds nearby in 12 months (needed ≥ 3) at X mi; market too thin; manual ARV offered. `no_type_match` (kept = 0 AND the fetched pool holds zero comps of the subject's type AND the pool is non-empty — we didn't find the right pool, which is not "the market is thin"): "I found sold homes nearby but none of the same property type as yours, so I can't build a reliable comp set here. If you have an ARV in mind, tell me and I'll run the numbers with it." Both branches: no number, manual entry offered |
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
