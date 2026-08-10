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
