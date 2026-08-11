# Which comp fields Zillow/Apify actually returns

**Verified 2026-08-08 against 73 real sold comps** across both recorded Apify
search runs (`spike-comps.json`, `spike-comps-2.json`) plus both recorded
detail runs. Not inferred from documentation — counted from the payloads.

Written as a standalone file because it is the answer to a client question and
needs to outlive a chat scroll. Also recorded in `.agents/CONTRACT.md`
§14.5–§14.6.

---

## The structural fact everything else follows from

The feature makes **two different Apify calls**, and they return **different
data**:

| Call | Actor | Returns |
| --- | --- | --- |
| **Subject** (the member's property) | `maxcopell/zillow-detail-scraper` | Rich detail, incl. a `resoFacts` block of ~75 fields |
| **Comps** (the comparable sales) | `maxcopell/zillow-scraper` (search) | Search-result cards — a much thinner field set |

So a field can be available for the member's own property and unavailable for
every comp. That is the case for most of what was asked about.

---

## The three fields asked about

### 1. Days on market — **NOT AVAILABLE** for comps

| Field | Result |
| --- | --- |
| `daysOnZillow` | Present on 73/73, but the value is **`-1` on all 73**. A sentinel meaning "not supplied", not data. |
| `timeOnZillow` | Present on 73/73, in milliseconds (observed 5.6–14.6 days). **Meaning unverified for a sold listing** — plausibly time-on-site rather than marketing time. |
| `daysOnMarket`, `cumulativeDaysOnMarket`, `onMarketDate`, `datePosted`, `listingDateTime` | **Absent entirely** from the comps payload. |

**Not rendered.** `-1` is not a number to show a member, and `timeOnZillow`
would be a guess presented as a fact. Note the subject's own detail payload
*does* carry a real `daysOnZillow` (observed 4 and 26) and `resoFacts.onMarketDate` —
so DOM is obtainable for the subject, just not for the comps.

### 2. Lot size — **AVAILABLE**, and shipped

| Field | Result |
| --- | --- |
| `lotAreaValue` | **73/73** |
| `lotAreaUnit` | **73/73** — 68 in `sqft`, 5 in `acres` |
| `lotSize` (single field) | Absent; composed from the two above |

Units are mixed in the raw feed, so acres are converted (× 43,560) and
everything renders in sqft. **Now shown on every comp, and used as a soft
scoring factor.**

### 3. Parking — **NOT AVAILABLE** for comps

Every candidate field name checked against both the card and `homeInfo`:
`parking`, `parkingSpaces`, `garageSpaces`, `hasGarage`, `parkingCapacity`,
`garageParkingCapacity`, `coveredParkingCapacity`, `carportParkingCapacity`,
`parkingFeatures` — **all absent, on both.**

The data exists, but only in the **detail** payload: the subject's `resoFacts`
carries `parkingCapacity` (observed 4 and 0), `garageParkingCapacity` (2 and 0)
and `hasGarage` (true and false).

---

## Also absent from comps (same reason)

| Criterion | In comps? | Where it does exist |
| --- | --- | --- |
| Year built | No | detail `yearBuilt` (1940, 1945) |
| Architectural style | No | detail `resoFacts.architecturalStyle` ("Ranch", "Spanish") |
| Construction quality / condition | No | detail `resoFacts.propertyCondition` ("Fixer") — **and only on 1 of 2 subjects**, so inconsistent even there |
| Basement | No | **Absent from the detail payload too**, on both subjects |
| ADU / accessory structures | No | No field at all (`hasAdditionalParcels` is not an ADU) |

---

## What it would cost to get them

Every missing field lives in the detail payload, so obtaining them per comp
means one **detail actor run per comp**:

| | Actor runs per lookup |
| --- | --- |
| Today | **2** (1 subject + 1 comps search) |
| With detail data for 5 comps | **7** |

**~3.5× the Apify spend on every comps lookup**, against a quota the client
pays for — and a slower response, since the runs are sequential. Worth a
decision rather than an assumption; nothing has been built toward it.

---

## Currently rendered per comp

Address · sold price · sold date · living area · $/sqft · **beds** · **baths** ·
**lot size** · distance · **property link**

Availability of the new four: beds 70/73, baths 71/73, lot 73/73, link 73/73.
Anything null renders as an explicit em dash (`—`), never omitted, never
inferred. A comp whose link cannot be built says "link unavailable" — the link
is the client's stated substitute for the style/condition/quality criteria she
waived, so its absence is reported rather than hidden.

---

## UPDATE 2026-08-10 — detail batching built (client approved)

The cost table above is superseded: the detail scraper accepts a **batched
address list**, so the final 5 comps cost ONE extra actor run, not five.
Approved and shipped as **3 actor runs per lookup** (subject + search + one
batched detail), with detail facts cached by property for 90 days — repeat
and nearby lookups usually skip the third run entirely.

**Now rendered per comp, in addition to the list above:**

| Field | Source | Notes |
| --- | --- | --- |
| **Year built** | detail `yearBuilt` | 5/5 in the recorded batch |
| **Days on market** | detail `daysOnZillow` | REAL here (11–34 observed) — unlike the search payload's −1 sentinel |
| **Parking spaces** | detail `resoFacts.parkingCapacity` (fallback `parking.totalSpaces`) | 0 renders as 0, not as unknown |

Anything missing still renders an explicit em dash. A comp whose detail
lookup fails keeps all its sale data and shows dashes on these three columns
only — a detail problem never blocks the comps themselves.

**Available but awaiting a display decision:** architectural style
(`resoFacts.architecturalStyle` — "Ranch", "Bungalow", "Other" observed 5/5)
and property condition (`resoFacts.propertyCondition` — "Fixer" observed 1/5,
often absent). Both are captured and stored with the other detail facts, so
showing them is a formatting change, not a new scrape — but they were waived
as MATCHING criteria and displaying them is a separate call the client should
make explicitly.

---

## COVERAGE NOTE 2026-08-12 — MULTI_FAMILY (operator question, logged not built)

Prompted by a real lookup: **1218 S Farmer Ave, Tempe AZ 85281** (raw
`MULTI_FAMILY`, 7bd/8ba, 6,250 sqft) correctly returned the `no_type_match`
copy. Question: does the comps search surface MULTI_FAMILY at all, or is
this the condo-pool shape (fetch-level absence)?

**Answer: the search DOES surface them — this is NOT the condo-pool shape.**
Raw `homeType` across every recorded search payload:

| Payload | MULTI_FAMILY in raw pool |
| --- | --- |
| spike-comps.json (central Phoenix, 40) | 4 |
| spike-comps-2.json (central Phoenix, 40) | 3 |
| spike-agg-1mi-12mo.json (235) | 17 |
| spike-farmer-multifam.json (Tempe, this address, 40) | **0** |

The gap is downstream, in the MAPPER: `MULTI_FAMILY → OTHER` on both the
subject and comp sides, and `OTHER` matches nothing including itself (Q5
ruling). A MULTI_FAMILY subject is therefore permanently incapable of a
comp set regardless of pool composition — the same STRUCTURAL shape as the
APARTMENT→CONDO case that earned its own ruling, one property class over.

**The rejection table for this address** (live reproduction, one standard
2-run lookup; raw payload recorded as `spike-farmer-multifam.json`):
40 raw items (cap hit), 39 usable candidates — 31 SFR / 2 condo / 6
townhouse, zero MULTI_FAMILY in this Tempe pool. Walked to the last rung
(3 mi / 12 mo), **kept 0, all 39 rejected `SQFT_OUT_OF_RANGE`** — the
6,250 sqft subject's ±20% band (5,000–7,500) contains nothing residential
nearby, so the sqft gate fires before type ever gets tested (rule order 4
before 7). `no_type_match` still branched correctly because the branch
keys on pool composition, not first-match reasons.

**Implication if a ruling is ever wanted (nothing built):** mapping
MULTI_FAMILY to its own class would let 7-bed multi-family subjects find
multi-family comps where pools contain them (they do, in central Phoenix)
— but for THIS address the binding constraint is sqft, not type: a
6,250 sqft property has no ±20% neighbours in a 40-item pool either way.
