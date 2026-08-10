# CONTRACT — Comps Lookup + ARV (`feat/comps-lookup`)

Owner: MASON. INSPECTOR tests from this file. If code and contract disagree, the
contract wins until a `CONTRACT_CHANGE` is agreed.

- `ALGO_VERSION = 3` (1 → 2 client-spec alignment §14; 2 → 3 ARV removal §14.8)
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

## 14. CLIENT-SPEC ALIGNMENT (ALGO_VERSION 2, then 3 after §14.8) — branch `feat/comps-client-spec`

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

**Additional per-comp fields via the DETAIL BATCH (§14.14.1, BUILT):** year
built, days on market (real `daysOnZillow`), parking spaces — rendered
label-first on their own line, em-dash nulls. Style/condition captured but
NOT rendered (display needs its own ruling).

**NOT buildable from the comps SEARCH payload alone — see §14.6; the ones the
client approved now arrive through the detail batch (§14.14).**

**Null rendering rule (no-fabrication extends to every new field):** a null
field renders as an explicit **`—`** (em dash). Never omitted silently, never
inferred, never back-filled from another comp or from the subject.
**Marker exclusivity (pinned via INSPECTOR's format suite):** within the
success block the em dash appears ONLY as the null marker — the renderer
must not use it as punctuation, or "explicit" stops being true. A
fully-populated render contains zero em dashes.

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

**The cost fact the client decision turned on:** every one of the missing
criteria exists in the DETAIL payload. The naive shape was one detail run per
comp (2 → 7 runs, ~3.5×); the spike proved BATCHING (§14.14), and the client
approved **3 runs per lookup** (subject + search + ONE batched detail). DOM /
parking / year built are now BUILT per comp (§14.14.1). Style and condition
are OBTAINABLE and captured; their DISPLAY awaits a separate client ruling
(§14.9 waived them as matching criteria only — not the same as declining to
see them).

### 14.7 Prescribed copy — verbatim, from constants, structural in format.ts

Exported as named constants and emitted by `format.ts` structurally (not
model-authored, not prompt-dependent), on every SUCCESSFUL comps render:

- `COMPS_OPENING` (before the table): *"Sure. Here are recent comparable sales
  for that location and home type. Please note responses are for education and
  based on available public data. Investors are encouraged to review each
  address for additional information."*
- `COMPS_CLOSING` (emitted after the comps table, always the LAST content
  before the footer — the emit order is opening → header → table → closing →
  footer with no gap, §14.8): evaluate each property carefully;
  current quality of home, overall appeal, lot location and usability can
  drastically impact value; consider external factors such as view properties,
  environmental concerns, powerlines, busy roads.

The existing not-an-appraisal footer remains. (The low-confidence warning is
GONE with the confidence grade itself, §14.8; an earlier draft of this
section referenced an `ARV_SURFACING` flag that §14.8 also deleted.)

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

**BUILT (2026-08-11). Shapes and discoveries:**

- **The "no key at light volume" assumption above is STALE**: the Census
  data API now 302s every keyless request to a "Missing Key" page (verified
  live across vintages, incl. with a bogus key). The key is FREE
  (api.census.gov/data/key_signup.html) — **OPERATOR ACTION: register one
  and set `CENSUS_API_KEY`**. Until then the feature is dormant by design:
  no key ⇒ no provider ⇒ `CompsResult.demographics` stays ABSENT ⇒ **no
  section renders at all** — an unconfigured feature is not a failure (same
  gate pattern as `run_comps`/APIFY_TOKEN). The free GEOCODER still works
  keyless; its payload is recorded (`spike-census-geocode.json`).
- **Three-state field**: `CompsResult.demographics?: Demographics | null` —
  ABSENT = never attempted (no section); NULL = attempted, failed or no
  tract (section renders the plain "unavailable" line, comps unaffected);
  PRESENT = tract figures. Attached on EVERY serve, never stored in
  comps_cache — same decoration pattern as detail.
- **Two calls per cold tract** (providers/census.ts): geocoder lat/lng →
  tract (GEOID/name), then ACS 5-year (`CENSUS_ACS_YEAR = 2023`) for
  B19013_001E (median household income), B01002_001E (median age), B25003
  tenure counts. Columns located BY HEADER NAME never position; ACS values
  arrive as STRINGS; suppression sentinels (large negatives) and anything
  non-finite/negative map to null. Tenure percentages are ARITHMETIC ON
  RETURNED COUNTS (owner/(owner+renter), 1dp) — allowed arithmetic, never
  inference; 0 counts are values.
- **Cache**: `census_cache` (tract_geoid PK, demographics jsonb;
  `sql/add_census_cache.sql`, migrate.ts probes it),
  `CENSUS_CACHE_TTL_DAYS = 180` — ACS changes once a year; the cache buys
  latency and key-quota headroom, not dollars. Tract resolution runs per
  serve (free); only the ACS figures cache.
- **Ceiling**: each Census call is clamped to
  `min(CENSUS_TIMEOUT_MS = 10s, remaining pipeline headroom)`; zero
  headroom ⇒ skip to null non-fatally. **NO retry** (same pinned posture as
  the detail batch — the "unavailable" line is the retry). The provider
  fetches with `redirect: 'error'` so the API's 302-to-HTML failure mode
  for key problems surfaces as an HTTP-class failure, not a parse error;
  the key rides only in the query string and typed errors carry no URL.
- **Render** (§14.8 emit order EXTENDED): opening → header → table →
  **[demographics]** → closing → footer — `COMPS_CLOSING` remains the last
  content before the footer exactly as pinned. Section copy: tract name +
  "US Census ACS 5-year, <year>" + income (USD) · median age · owner/renter
  % (rounded), em-dash nulls. Unavailable line: *"Neighborhood demographics
  are unavailable right now — the comps above are unaffected."*
- **Fixtures**: `spike-census-geocode.json` is RECORDED (real geocoder,
  subject-2 coords → tract 04013111700). `census-acs-handbuilt.json` is
  HAND-BUILT to the documented shape — replace with a recording on the
  first keyed run; the name marks the difference on purpose.

**GUARANTEE 3 (operator ruling) — suppression sentinels render as
unavailable, never as a number and never as zero.** ACS returns its
annotations IN the numeric field as negative sentinels. The guard is an
**ENUMERATED LIST, not a threshold** — a range check on "negative" is the
wrong shape (this is the third appearance of the sentinel class, after the
search payload's `daysOnZillow: -1` and the detail DOM):

| Sentinel | Meaning (Census annotation) |
| --- | --- |
| `-666666666` | estimate not computable |
| `-999999999` | suppressed / N-A |
| `-888888888` | not applicable |
| `-222222222` | too few samples |
| `-555555555` | estimate controlled (documented annotation, added to complete the class — flag to operator if unwanted) |
| `-333333333` | median falls in lowest/highest interval (same) |

Any listed value ⇒ null ⇒ em-dash. **The inverse is guarded too: `0` is a
REAL value** — a 0% owner-occupied tract exists (all-rental), and a
"drop anything ≤ 0" filter would eat it. Zero tenure counts flow through
the percentage arithmetic; only a zero DENOMINATOR (no occupied households
returned at all) nulls the percentages.

**GUARANTEE 4 (operator ruling; INSPECTOR's framing adopted) — the
provenance rule, standing:** *a number the member did not supply must carry
its provenance, and if the provenance cannot render, the number must not
render.* One rule, three surfaces today:

1. **The widget ARV pre-fill** (§8.1): label and value live in one object —
   no label, no pre-fill, by construction.
2. **Census figures** (this section): the tract name and "US Census ACS
   5-year, <vintage>" render in the SAME template as the figures — the
   section cannot emit numbers without its geography and vintage.
3. **The aggregates DOM line** (§14.16, when built): the 5-comp-average
   label is load-bearing — if the label cannot render, the line does not
   render.

Any future member-visible number that the member did not type inherits this
rule by default; rendering one bare is a bug without needing a new ruling.

### 14.11 Out of scope

- ~~**Neighbourhood summary** — all of it. Separate block.~~ Superseded:
  the sales-aggregate half is now scoped and ruled (§14.16); Census
  demographics were already in scope (§14.10).

### 14.16 Neighbourhood sales aggregates — RULED, NOT BUILT (operator, 2026-08-10)

Client spec: per lookup, 1-mile radius, past 12 months — total sales, avg
price, avg $/sqft, avg bed/bath, avg DOM. Scoping evidence in
`reports/NEIGHBOURHOOD_AGGREGATES_SCOPING.md` (both recorded search runs hit
the 40-result cap; the pool's "12 months" is really 4–5 weeks deep).

**RULING 1 — dedicated 1-mile fetch with the 12-month window SERVER-SIDE**
(Zillow `doz=12m`), never the candidate pool. Cost was not the deciding
factor: the pool version is structurally wrong in a way no member could
detect. `dedupeSales` runs on the aggregate set BEFORE any average — BUG-010's
duplicate pair sat in a recorded pool and would double-count.

**RULING 2 — DOM is the labelled 5-comp average** (option b): already paid
for by the detail slice. The full-accuracy version (a detail run per sale
over 100+ sales) blows the 90s ceiling — an accurate number that times out is
worth less than a labelled approximation that arrives. **The label is
LOAD-BEARING and non-negotiable: it must read as the average of the 5 comps
shown, never as the neighbourhood figure. If the label cannot render, the
line does not render.** (An instance of the standing provenance rule,
§14.10 Guarantee 4.)

**Build gate — the resultsLimit spike comes FIRST (one run):** does
`MAP_MARKERS` honour a `resultsLimit` above ~40, and how many items does a
real urban 1-mile/12-month query return? Reported to the operator BEFORE any
aggregate code exists; if the cap holds regardless, the approach needs
rethinking.

**SPIKE RUN 2026-08-11 (gate satisfied, reported, build still awaits the
operator's go):** `resultsLimit: 500` returned **235 items in 6.4s** — the
old 40-item wall was OUR limit, not Zillow's — and `doz=12m` held
server-side (dateSold spans a true 12 months). 233 usable sold, all
distinct zpids; **193 inside the 1-mile circle** (box corners excluded —
the CIRCLE subset is the aggregate set); price 100% / sqft 95% / beds 88%.
Cost: one run × ~235 per-result billing units in an urban market; the
per-result rate is in the client's console. Recorded:
`__fixtures__/spike-agg-1mi-12mo.json`. Full table in
`reports/NEIGHBOURHOOD_AGGREGATES_SCOPING.md`.

**Candidate, recorded NOT built (operator):** once the aggregate pool exists
(potentially hundreds of sales), it is a far better basis for outlier
detection than 5 comps — flag when the comp set sits meaningfully above or
below the neighbourhood distribution. Would have caught the Don Frank case
(tight comps, high confidence, subject sold ~15% above every one). A
candidate for a future ruling; nothing here authorizes building it.

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
not agree to give up. 50 lookups ≈ 150 actor runs/day worst case. The old
"provider runs" config comment is fixed; the multiplier is documented next to
the value. **Precise semantics as built:** one provider-hitting lookup
consumes ONE unit regardless of actor-run count; lookups served entirely from
cache are free; a cache-hit lookup that still needs a live detail batch
consumes one unit (every actor run stays behind the cap), and a denial there
degrades to comps-without-detail — never `RATE_LIMITED`.

### 14.14.1 BUILT (this slice) — shapes and pinned decisions

- **Types**: `CompDetail { daysOnMarket, parkingSpaces, yearBuilt,
  architecturalStyle, propertyCondition }` (all `| null`);
  `ScoredComp.detail?: CompDetail` — attached ONLY by the service's
  enrichment step; the pure filter/rank pipeline never sets it.
- **Mapping** (`mapDetailBatchItems`, providers/apifyZillow.ts, pure):
  `daysOnZillow` real in the detail payload (recorded 11–34); negative =
  sentinel class ⇒ null; 0 is a value. Parking:
  `resoFacts.parkingCapacity` falling back to `parking.totalSpaces`
  (both recorded, agreeing); 0 is a value. Items without
  `addressOrUrlFromInput` are dropped (unjoinable — attaching them could
  only be positional). `{isValid:false}` items map to `ok:false` WITH the
  join key intact.
- **Join** (`detail.ts`, pure): `attachDetails` / `joinDetailBatch` —
  address-keyed, exact echo first, §5.1-normalized fallback; items for
  addresses nobody asked for are ignored; order- and length-preserving.
  `detailBatchFor` clamps any batch to `MAX_COMPS_KEPT` as a structural
  rule-2 backstop (tracks the constant, no literal).
- **Detail cache**: table `comps_detail_cache` (zpid PK, detail jsonb,
  expires_at; RLS, service-role only — `sql/add_comps_detail_cache.sql`),
  `DETAIL_CACHE_TTL_DAYS = 90`, expiry enforced on read. Cache rows are
  keyed by the COMP's zpid (the key future lookups probe), not the batch
  item's. **The comps_cache result is stored DETAIL-FREE** and enrichment
  re-attaches on every serve — the 14-day and 90-day lifetimes never
  entangle, and NO ALGO_VERSION bump was needed for this slice.
- **Ceiling** (rule 5): the pipeline clock starts at runComps entry; the
  detail batch gets `PROVIDER_TIMEOUT_MS − elapsed` as its timeout and is
  skipped entirely below `DETAIL_MIN_REMAINING_MS = 20_000` (spike measured
  ~16s for a batch of 5 — starting with less mostly buys a timeout we still
  paid for).
- **NO retry on the detail batch** — a pinned DEVIATION from the §6 seam
  policy (one retry on transient): detail is decoration; a retry doubles
  the bill for it and eats the ceiling. The em-dash degradation IS the
  retry. Subject/search retry behaviour is unchanged.
- **Render** (§14.5 extension): one added per-comp line, label-first —
  `year built <v> · days on market <v> · parking spaces <v>` — em-dash per
  §14.5 for any missing value or a wholly missing detail. Em-dash marker
  exclusivity holds: a fully-enriched, fully-populated render still
  contains zero em dashes.
- **Style / condition: CAPTURED, NOT RENDERED** (operator directive). The
  client waived them as MATCHING criteria, which is not the same as
  declining to SEE them — they ride in `CompDetail` and the detail cache so
  a display ruling is a render change, not a re-scrape. `format.ts` must
  not emit them until that ruling exists.
- **Logs**: skip/failure reasons at info/warn with `cacheKey` and COUNTS
  only — comp addresses never reach info logs (§3).
- **Failure posture**: every enrichment failure (cache read, cache write,
  batch error, ceiling, budget) degrades to comps-without-detail; a detail
  problem can never turn a working comps run into a failure (rule 3).

### 14.15 BUG-011 — manual ARV address binding (operator ruling)

The ARV removal (§14.8) orphaned `subjectAddress`: with `run_comps` writing
nothing, `set_manual_arv`'s inherit-or-`'manual entry'` fallback bound every
manual ARV to a literal placeholder — which the guard then "defended"
(refusing the member's own number on the address they had just named) and
which shipped in member-visible copy ("for manual entry"). INSPECTOR's
mailbox 0024; blocker.

Ruling, binding:

1. `set_manual_arv` gains an **OPTIONAL `address` argument** (§9), bound
   from the member's **CURRENT message only**, never conversation history.
   The binding is verified structurally, not trusted from the model (§8,
   `bindAddressToCurrentMessage`).
2. **No verifiable address ⇒ `subjectAddress: null`** — a real "unbound"
   state, NOT a placeholder string. The block inherits nothing from any
   previous block. **Amended by RULING 0026:** "no address" means *no
   address verifiable in the current message, by argument or extraction* —
   see item 7.
3. **The guard does not fire on null.** An unbound ARV has nothing to
   conflict with and pre-fills wherever the member takes it (chat and form).
   The value-based stale-figure refusal (§8 explicit-ARV rule, case 3)
   still fires when unbound — only its wording drops the address.
4. **A bound ARV on address A still conflicts with address B.** That
   guarantee is untouched, on both surfaces.
5. **Echo on null carries no address clause**: `Using your ARV of $450,000 —
   say "change ARV" to override.` The placeholder never renders anywhere;
   form label reads "the ARV you set earlier".
6. **Legacy shim**: rows already storing the literal `'manual entry'` are
   coerced to null on read (`sessionState.ts`), so the placeholder class
   cannot re-enter from production data.
7. **RULING 0026 (operator, closes INSPECTOR's residual): extraction
   fallback on omission.** The original shape bound only when the model
   PASSED the address — so model non-compliance alone ("use 450k for 123
   Main St" → `set_manual_arv({arv})`) reached the guard-free unbound path
   and failed toward a silent number on the wrong property. Now, when the
   argument yields no binding (omitted or unverifiable), the handler
   extracts from the member's CURRENT message itself
   (`extractAddressFromMessage`): the ONE distinct address fragment,
   over-capture-refined, passed through the SAME verification the argument
   route uses. Zero or multiple DISTINCT addresses in the message ⇒ stays
   unbound — **ambiguity is never guessed**. History is never consulted on
   either route; the prohibition that matters is unchanged.
8. **RULING 0026, unbinding is announced.** The fresh-statement rule means
   re-stating a number without an address DROPS a previous binding — that
   is correct and stands, but it is member-visible: the tool result carries
   `unbound_from` and the echo must say the new ARV replaces the one set
   for that property and is no longer tied to it, so the member sees the
   address clause disappear rather than discovering it at the calculator.

Known, flagged, not fixed (needs its own ruling if wanted):
`ADDRESS_FRAGMENT_RE` over-captures when a pure dollar figure precedes the
address ("my ARV is 620000 for 830 W America St" fragments as "620000 for
830 …"). Binding compensates (street-part check); the guard's pre-existing
behaviour is unchanged — worst case an unnecessary clarifying question,
never a wrong number.

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
| Migrations | `sql/*.sql` run in Supabase SQL editor + check-and-warn in `src/server/migrate.ts` | `sql/add_comps_tables.sql` creates `comps_cache` + `session_state`; `sql/add_comps_detail_cache.sql` creates `comps_detail_cache` (§14.14); `migrate.ts` probes all three |
| Logging | Fastify `request.log` / `Logger` interface (`src/server/logger.ts`) | Same. Log `cacheKey`, never the raw address, at info; never the token |
| Failure style to model | Tool result objects with `error` string; agent instructed not to invent numbers | Comps failures are returned as rendered failure copy (§10), never bare stacks |

Dev server: MASON on port 3000 (already running), INSPECTOR on 3001.

## 2. File layout (all new, additive)

```
src/features/comps/
  types.ts       config.ts      normalize.ts   filter.ts      rank.ts
  format.ts      service.ts     tools.ts       # arv.ts DELETED (§14.8)
  formPrefill.ts sessionState.ts               # §8/§8.1 state + form surface
  detail.ts                                    # §14.14 join + batch bound (pure)
  providers/types.ts  providers/apifyZillow.ts  providers/stub.ts   # geocode.ts dropped — detail scraper takes plain addresses (§6.1)
  cache/compsCache.ts  cache/detailCache.ts    # detail: zpid-keyed, own TTL (§14.14)
  __fixtures__/            # shared with INSPECTOR — hand-written now, real recordings when token lands
sql/add_comps_tables.sql
sql/add_comps_detail_cache.sql
```

## 3. Config — `src/features/comps/config.ts` (named exports; zero magic numbers elsewhere)

| Export | Default | Meaning |
| --- | --- | --- |
| `ALGO_VERSION` | `3` | stamped on every result; cache recompute trigger. **3 as of the ARV removal (§14.8)** — cached v2 blobs carry a dead `arv` key that no longer deserializes into `CompsResult`; the bump forces recompute-from-raw (zero provider calls, verified by spy) rather than trusting the deserializer to tolerate the dead field. The same mechanism retired v1 rows at the 1→2 bump: until the constant advances, stale rows keep serving old-parameter results for 14 days, indistinguishable from fresh. |
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
| ~~`TRIM_FRACTION` / `ARV_ROUND_TO` / `CONF_HIGH` / `CONF_MEDIUM`~~ | REMOVED | deleted with `arv.ts` (§14.8); values preserved in §5.5's struck spec |
| `CACHE_TTL_DAYS` | `14` | comps result + raw payload |
| `DETAIL_CACHE_TTL_DAYS` | `90` | zpid-keyed detail rows (§14.14 rule 4) — the detail slice's main cost lever |
| `DETAIL_MIN_REMAINING_MS` | `20_000` | skip the detail batch below this much pipeline headroom (§14.14 rule 5; spike measured ~16s per batch of 5) |
| `PROVIDER_TIMEOUT_MS` | `90_000` | per Apify run for subject/search AND the whole-pipeline ceiling once detail enters (§14.14 rule 5) |
| `PROVIDER_MAX_RETRIES` | `1` | transient only (timeout/5xx/network); **0 on 4xx**; **detail batch: 0 retries always** (§14.14.1, pinned deviation) |
| `COMPS_DAILY_RUN_CAP` | `50` | env-overridable. Counts **LOOKUPS that touch Apify** (§14.14 cap ruling), up to 3 actor runs each; all-cache lookups free. ~~per-session cap~~ cut (change log #2) |
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
  detailUrl: string | null;   // LOAD-BEARING (§14.9): null renders "link unavailable", never omitted
}

export type RejectReason =
  | 'SUBJECT_PROPERTY'                               // rule 0, BUG-004
  | 'NOT_SOLD' | 'STALE_SALE' | 'SQFT_MISSING' | 'SQFT_OUT_OF_RANGE'
  | 'BEDS_DIFF' | 'BATHS_DIFF' | 'TYPE_MISMATCH' | 'TOO_FAR'
  | 'PRICE_MISSING' | 'NON_ARMS_LENGTH'
  | 'LOT_ANOMALY'                                    // never emitted in v2 (§14.1); kept so cached v1 rows type
  | 'FUTURE_SOLD_DATE'                               // rule 12, BUG-003
  | 'DUPLICATE_SALE';                                // BUG-010: post-gate dedupe, not a numbered rule

export interface RejectedComp { comp: RawComp; reason: RejectReason }

export interface ScoredComp {
  comp: RawComp; distanceMi: number; monthsAgo: number;
  pricePerSqft: number; score: number;               // 0–100, lower better
  // FIVE terms in v2 (§14.3) — weights 35/25/20/10/10, sum 100
  parts: { distance: number; sqft: number; recency: number; bedbath: number; lot: number };
}

// ────────────────────────────────────────────────────────────────────────
// REMOVED — DO NOT REBUILD (§14.8, client decision, ONE-WAY DOOR).
// `ArvConfidence` and `ArvResult` are DELETED from types.ts along with
// arv.ts and `CompsResult.arv`. Their definitions are preserved ONLY in
// §5.5's struck spec, because §14.8 defines reinstatement as "a REBUILD
// from this contract". Nothing that compiles refers to them. If you are
// reading this because you found a reference to either type somewhere:
// that reference is the bug.
// ────────────────────────────────────────────────────────────────────────

export interface CompsResult {
  ok: true; algoVersion: number; runId: string;      // runId = crypto.randomUUID()
  subject: SubjectProperty; radiusTierMi: number;
  recencyTierMonths: number;                         // which recency rung produced the set (§14.2)
  comps: ScoredComp[]; rejected: RejectedComp[];
  fromCache: boolean; provider: string;              // NO `arv` field (§14.8)
}

export type CompsFailureCode =
  | 'ADDRESS_NOT_FOUND' | 'SUBJECT_SQFT_UNKNOWN' | 'TOO_FEW_COMPS'
  | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'RATE_LIMITED';

export interface CompsFailure {
  ok: false; algoVersion: number; code: CompsFailureCode;
  message: string;                                    // plain English, ends offering manual ARV
  detail?: {
    kept?: number; needed?: number; radiusTierMi?: number;
    resolution?: 'unit_mismatch' | 'not_found';       // ADDRESS_NOT_FOUND copy branch (§10)
    inputHasUnit?: boolean;                           // unit_mismatch sub-branch (§10)
    pool?: 'no_type_match';                           // TOO_FEW_COMPS copy branch (§10)
  };
}

export type CompsOutcome = CompsResult | CompsFailure;   // discriminated on `ok`
```

Pure-function signatures INSPECTOR can import directly:

```ts
// normalize.ts
export function normalizeAddress(raw: string): string;
export function cacheKey(normalized: string): string;      // sha256 hex

// filter.ts — both gates are per-rung arguments (§14.2)
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number;
export function applyHardFilters(subject: SubjectProperty, comps: RawComp[], radiusMi: number,
  maxAgeMonths: number, now: Date): { kept: RawComp[]; rejected: RejectedComp[] };
export function selectTiers(subject: SubjectProperty, comps: RawComp[], now: Date): TierSelection;
  // { kept, rejected, radiusTierMi, recencyTierMonths } — renamed from
  // selectRadiusTier: it walks BOTH ladders, and dedupeSales (BUG-010) runs
  // inside it, after the gates and before the sufficiency test

// rank.ts
export function scoreComp(subject: SubjectProperty, comp: RawComp, now: Date): ScoredComp;
export function rankComps(subject: SubjectProperty, kept: RawComp[], now: Date): ScoredComp[]; // sorted asc, capped MAX_COMPS_KEPT

// arv.ts — DELETED (§14.8). pricePerSqft / trimmedMean / calculateArv are
// gone; their spec survives, struck, in §5.5 only.

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
2. `STALE_SALE` — `soldDate` null or older than the **ACTIVE recency rung**
   (`RECENCY_TIERS_MONTHS`, §14.2 — the outer rung equals
   `MAX_COMP_AGE_MONTHS`; months = days / `DAYS_PER_MONTH`). **All date arithmetic (`monthsBetween`) runs at UTC CALENDAR-DAY granularity** (BUG-006): `soldDate` is an ISO date, so a sale "today" is 0 months old at every hour of the day, and comp sets are deterministic per calendar day rather than per hour
3. `SQFT_MISSING` — `livingArea` null or ≤ 0
4. `SQFT_OUT_OF_RANGE` — outside subject ± `SQFT_TOLERANCE`
5. `BEDS_DIFF` — both non-null and |Δbeds| > `MAX_BED_DIFF` (null on either side = no rejection)
6. `BATHS_DIFF` — same rule for baths
7. `TYPE_MISMATCH` — `propertyType` ≠ subject's (OTHER never matches anything, including OTHER)
8. `TOO_FAR` — haversine miles > active radius tier
9. `PRICE_MISSING` — `soldPrice` null or ≤ 0
10. `NON_ARMS_LENGTH` — ppsf < `NON_ARMS_LENGTH_PPSF_FRACTION` × median ppsf of the **DEDUPED candidate set** (BUG-010: `candidateMedianPpsf` runs `dedupeSales` on its own input first. The DUPLICATE_SALE rejection happens after the gates, but this median is computed INSIDE the gate pass, so a later drop cannot reach it — without deduping here, a sale counted twice would skew the very threshold the rule depends on. Implement it as written or the next reader will reintroduce the skew.) Median over all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 — regardless of other filters; median of even n = mean of middle two. Deterministic, order-independent.
11. ~~`LOT_ANOMALY`~~ — **REMOVED in v2** (§14.1): lot is a soft scoring term now. The `RejectReason` union keeps the member so cached v1 results still type, but it is never emitted.
12. `FUTURE_SOLD_DATE` — `soldDate` parses to strictly after `now` (BUG-003: a sale that hasn't happened is not a comp; Zillow emits pending-close and timezone-shifted dates)

Tier ladder (v2, §14.2 — the v1 one-dimensional 0.5/1.0/2.0 radius walk is
GONE): the full filter pass reruns per rung of the ONE ordered ladder
`[1.0, 3.0] mi × [3, 6, 12] mo`, **recency widening BEFORE radius**:
`1.0/3 → 1.0/6 → 1.0/12 → 3.0/3 → 3.0/6 → 3.0/12`. Stop at the first rung
with ≥ `MIN_COMPS_FOR_TIER` (5) kept after dedupe, else use the last rung's
outcome. `radiusTierMi` AND `recencyTierMonths` recorded on the result.
Rejected list reported from the **final** rung only. Rationale and rung
reachability: §14.2.

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

### 5.5 ARV — **REMOVED (§14.8). This subsection is a PRESERVED SPEC, not a live requirement.**

Nothing below this banner describes shipping code: `arv.ts` is deleted,
`CompsResult` has no `arv`, and no confidence grade exists anywhere. The text
is kept solely because §14.8 defines reinstatement as "a REBUILD from this
contract" — this, plus the types below, is that rebuild spec. Implementing
any of it without a new client ruling is the bug §14.8 exists to prevent.

```ts
// Types that lived in types.ts until §14.8 — preserved here only:
// export type ArvConfidence = 'high' | 'medium' | 'low';
// export interface ArvResult {
//   arv: number; arvLow: number; arvHigh: number;    // rounded to ARV_ROUND_TO
//   arvPerSqft: number; sd: number; cv: number;
//   confidence: ArvConfidence;
//   trimmedOut: { zpid: string; pricePerSqft: number; end: 'low' | 'high' }[];
//   compsUsed: number;  // RULING CF-001: kept/ranked count, BEFORE the trim
// }
```

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
Confidence (as last agreed — the §14.4 REBASE, not the original v1 tiers):
`high` if compsUsed ≥ 5 ∧ cv ≤ 0.15 ∧ median distance ≤ 0.75 mi ∧ median age
≤ 6 months (medians over the kept, ranked set); `medium` if compsUsed ≥ 4 ∧
cv ≤ 0.25; else `low`. `low` still returned numbers but the rendered copy had
to call the estimate weak and invite manual override.

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
    // BUG-011 (§14.15): null = UNBOUND — the member stated a number without
    // naming a property. A real state, not a placeholder; the retired
    // 'manual entry' literal is coerced to null on read (legacy shim).
    subjectAddress: string | null;
    subjectSqft: number;
    subjectBeds: number | null; subjectBaths: number | null;
    arv: number; arvLow: number | null; arvHigh: number | null;
    arvConfidence: null;               // the confidence grade is gone (§14.8)
    arvSource: 'comps' | 'manual';
    compsRunId: string | null;
    computedAt: string;                // ISO timestamp
  }
  // state.comps: CompsStateBlock | undefined — the whole block or nothing
  ```
- ~~The block is CLEARED at the START of every `run_comps` call~~ —
  **REVERSED by §14.8**: `run_comps` no longer touches `session_state` at
  all, and the clear would now only ever destroy a number the MEMBER typed.
- `set_manual_arv` (BUG-011, §14.15) writes the shape above with
  `arvSource: 'manual'`, `arvLow/arvHigh/arvConfidence/compsRunId: null`,
  `subjectSqft: 0`, `subjectBeds/Baths: null` — **a fresh statement,
  inheriting NOTHING from any previous block.** `subjectAddress` binds in
  this order (RULING 0026), history never consulted on either route:
  1. the optional `address` argument, **verified against the member's
     CURRENT message** (`bindAddressToCurrentMessage`: an
     ADDRESS_FRAGMENT_RE fragment of the message contained in the
     normalized candidate, OR the candidate's street part contained
     verbatim in the normalized message — the same normalizer the guard
     uses, so a binding can never conflict with the message that bound it);
  2. failing that (argument omitted OR unverifiable), **extraction from the
     CURRENT message** (`extractAddressFromMessage`): the message's ONE
     distinct address fragment, over-capture-refined, then passed through
     the SAME verification. Zero fragments, or two-plus DISTINCT fragments
     (compared normalized), extract nothing — **ambiguity is never
     guessed**. Without this fallback, model non-compliance alone reached
     the guard-free path and failed toward a silent number.
  "Unbound" therefore means: **no address verifiable in the current
  message, by argument or extraction.** Failure direction is always
  "unbound", never "bound wrong".
- **Unbinding is announced (RULING 0026)**: when a fresh statement stores
  `subjectAddress: null` and the previous block was a manual ARV bound to a
  property, the tool result carries `unbound_from: <that address>` and the
  echo must SAY the new ARV replaces the one set for that property and is
  no longer tied to it — the member sees the address clause disappear at
  the moment it disappears, not at the calculator.
- Pre-fill: when `flip_calculator` / `brrrr_calculator` is invoked **without**
  `after_repair_value` and `state.comps` exists, the agent layer injects
  `state.comps.arv` before `assertRequired` runs. The reply MUST echo the bound
  address — `using ARV $402,000 from the comps on 123 Main St — say "change
  ARV" to override` — non-negotiable; the echo is what makes a stale value
  visible instead of silently wrong.
- **Address-mismatch guard**: if the user's message states an address that is
  not the same property as `subjectAddress` (compare normalized forms), do NOT
  pre-fill. Ask which deal they mean. **The guard requires a real binding
  (BUG-011): `subjectAddress: null` never conflicts** — an unbound ARV
  applies wherever the member takes it, and every echo of it drops the
  address clause (`Using your ARV of $450,000 — say "change ARV" to
  override.`) rather than naming a placeholder. A BOUND ARV keeps the full
  A-vs-B refusal on both surfaces.
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
  override.` Manual-source variant: `Pre-filled from the ARV you set for
  <subjectAddress> — edit to override.`, or, when the binding is null
  (BUG-011), `Pre-filled from the ARV you set earlier — edit to override.`
  Label and value live in ONE object — **no label means no pre-fill, by
  construction**. (An instance of the standing provenance rule, §14.10
  Guarantee 4.)
- **Mismatch ⇒ blank**: if the member's current message names a different
  property (same `findConflictingAddress` discriminator as chat), the form
  renders WITHOUT a default — never a silent carry. **Bound blocks only
  (BUG-011): a null binding pre-fills regardless of what the message names**
  — nothing claims it belongs to any property, and the label says so.
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

// set_manual_arv — address OPTIONAL (BUG-011, §14.15): the model passes the
// property the member named IN THE CURRENT MESSAGE, or omits it entirely.
// The handler verifies the claim structurally (bindAddressToCurrentMessage,
// §8) — an unverifiable address is never trusted. On omission or failed
// verification the handler falls back to extracting the message's ONE
// unambiguous address itself (RULING 0026), so binding does not depend on
// model compliance; nothing verifiable ⇒ null.
{ "name": "set_manual_arv",
  "parameters": { "type": "object",
    "properties": {
      "arv": { "type": "number", "description": "User-supplied ARV in dollars, > 0" },
      "address": { "type": "string", "description": "Property the member tied this ARV to in THIS message; omit when none is named" } },
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
comps request by summarising an earlier result from memory: every comps
figure the member sees must come from a `run_comps` result in that turn
(the ruling predates §14.8 and originally said "every ARV" — the substance,
never answer from memory, stands unchanged). (The previous
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

Success (v2/v3 — the ARV block, trim narrative and confidence line are GONE,
§14.8): emit order is `COMPS_OPENING` → header → table → `COMPS_CLOSING` →
footer, with no gap where the ARV used to sit. The header names the subject
(beds/baths/sqft/type), BOTH tiers used (`radiusTierMi`,
`recencyTierMonths`) and the rejected count. Per comp: address, sold price,
sold date, sqft, $/sqft, beds, baths, lot size, distance, and the
LOAD-BEARING property link (§14.9 — null renders the literal "link
unavailable"). Null fields render an explicit `—` (§14.5), never omitted or
inferred. Footer: *automated estimate from public sold data, not a formal
appraisal — verify these comps with your agent* (de-ARVed wording; ours to
edit, unlike the §14.7 prescribed copy).

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
