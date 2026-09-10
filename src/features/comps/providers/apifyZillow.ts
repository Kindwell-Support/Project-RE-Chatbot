/**
 * Apify Zillow provider — the ONLY file that talks to Apify.
 *
 * Every mapping decision here is grounded in recorded payloads
 * (__fixtures__/spike-*.json, 2026-08-05) and documented in CONTRACT §6.1:
 * two actors, two wire formats for the same concepts (epoch-vs-ISO dateSold,
 * acres-vs-sqft lots, numeric zpid), building-card noise in search results,
 * and TWO distinct address-miss shapes.
 *
 * Mapping functions are exported PURE so they can be tested against the
 * recorded fixtures with zero network. Nothing in this module runs at import
 * time; the class is constructed lazily inside buildApp (CONTRACT §6 seam) —
 * a provider that reaches for the network on import would break "default
 * npm test stays offline", which is blocker-level.
 *
 * The token lives in the Authorization header only. It must never appear in
 * an error message, a log line, or a thrown value.
 */
import { MAX_COMP_AGE_MONTHS, NEIGHBORHOOD_RESULTS_LIMIT, PROVIDER_TIMEOUT_MS } from '../config.js';
import { normalizeAddress } from '../normalize.js';
import type { CompDetail, PropertyType, RawComp, SubjectProperty } from '../types.js';
import {
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
  type DetailBatchItem,
  type PropertyDataProvider,
  type SubjectResolutionMismatch,
} from './types.js';

export const APIFY_BASE = 'https://api.apify.com/v2';
export const DETAIL_ACTOR = 'maxcopell~zillow-detail-scraper';
export const SEARCH_ACTOR = 'maxcopell~zillow-scraper';
/**
 * Comps fetched per search (§14.17). Was 40 — OURS, not Zillow's: in dense
 * markets the newest 40 spanned ~11 days, so the recency ladder's 6/12-month
 * rungs re-examined what the 3-month rung already covered and the ladder was
 * decorative exactly where members run comps most. 500 measured live at the
 * dense Tempe subject: 499 returned in 8.6s spanning 3.6 months — still
 * truncated there (and honestly labelled, §14.17), but the 1-mile rungs now
 * genuinely differ (48 → 64 candidates from 3mo → 6mo). Billing: per result,
 * so a dense cold lookup costs ~limit × the per-result rate.
 */
export const SEARCH_RESULTS_LIMIT = 500;

const SQFT_PER_ACRE = 43_560;
const MILES_PER_DEG_LAT = 69;

/**
 * BOTH ACTOR WIRE FORMATS (CONTRACT §6.2) — the reason every mapper below
 * reads two paths for one fact.
 *
 * On 2026-09-01 both actors shipped the same change: "the output now has only
 * the mapped fields; Zillow raw fields that the mapping does not use are
 * removed" (their published changelog). The raw fields this module was written
 * against are exactly what was removed:
 *
 *   detail actor  streetAddress / address.*    -> listingAddress.{street,city,state,zipCode}
 *                 latitude / longitude         -> coordinates.{latitude,longitude}
 *                 lotSize, lotAreaValue+Units  -> lotArea.{value,unit}
 *                 resoFacts.architecturalStyle -> propertyFeatures.architecturalStyle
 *                 hasBadGeocode                -> GONE (no replacement)
 *   search actor  hdpData.homeInfo.*           -> the same fields, TOP-LEVEL
 *                 homeInfo.price               -> listingSoldPrice / listingPrice {amount}
 *                 homeInfo.homeStatus          -> listingStatus ("sold", which mapStatus
 *                                                 already lands on SOLD unchanged)
 *                 detailUrl                    -> propertyUrl
 *
 * Reading only the old paths made the subject resolve to a street-less item on
 * EVERY address (-> NO_STREET -> ADDRESS_NOT_FOUND, "I couldn't find that
 * address on Zillow" for valid addresses) and made every search card
 * unmappable. Both formats are accepted rather than swapped: the recorded
 * fixtures and any cached raw payload are the old shape, and a scraper that
 * reshaped its output once can do it again.
 */

/** A nested payload object, or undefined — the v2 fields all arrive nested. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Observed homeType values -> the closed contract enum. Unknown -> OTHER, which rule 7 rejects. */
function mapHomeType(raw: unknown): PropertyType {
  switch (String(raw ?? '').toUpperCase()) {
    case 'SINGLE_FAMILY':
      return 'SFR';
    case 'CONDO':
      return 'CONDO';
    // Operator ruling (recorded case: 16402 N 31st St #236): Zillow types
    // condo units in apartment-style complexes as APARTMENT. Mapping them to
    // OTHER made every such subject PERMANENTLY incapable of an ARV (rule 7:
    // OTHER matches nothing) — and an apartment-typed unit IS the comp class
    // of a condo, on both the subject and comp sides.
    case 'APARTMENT':
      return 'CONDO';
    case 'TOWNHOUSE':
      return 'TOWNHOUSE';
    case 'MANUFACTURED':
      return 'MANUFACTURED';
    default:
      return 'OTHER'; // LOT, MULTI_FAMILY, HOME_TYPE_UNKNOWN, ...
  }
}

/**
 * RECENTLY_SOLD is Zillow's word for what the contract calls SOLD.
 *
 * §6.2 needs nothing here: v1 wrote `homeStatus: "RECENTLY_SOLD"`, v2 writes
 * `listingStatus: "sold"` (recorded), and the uppercase pass-through already
 * lands the second one on `SOLD` — which is what rule 1 tests for
 * case-insensitively (filter.ts, aggregates.ts, service.ts). Pinned by
 * apifyPayloadV2.test.ts rather than guarded by extra code here.
 */
function mapStatus(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  return s === 'RECENTLY_SOLD' ? 'SOLD' : s;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * §6.2 money: v2 wraps prices as `{ amount, currency, formatted }` where v1
 * carried a bare number. `amount` is the ONLY field read.
 *
 * `formatted` is deliberately NOT a fallback, though the recorded v2-era
 * payload (spike-comps.json, 2026-08-05, when the actor still emitted both
 * formats) carried `amount: null` with the figure only in `formatted`.
 * Zillow abbreviates above a million — "$1.01M" is any of 1,005,000-1,014,999
 * — so parsing that string invents precision (§14.5), and parsing only the
 * exact forms ("$425,000") would silently drop every million-plus comp and
 * hand back a comp set biased low, which is worse than none. A comp with no
 * price is rejected by the hard filters: the honest outcome.
 */
function mapMoney(value: unknown): number | null {
  return asFiniteNumber(asObject(value)?.amount);
}

/** §14.14.3 rule 2 helper: a count is only a claim when it is > 0. */
function positiveCount(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/**
 * Lot arrives as sqft or acres depending on actor and row; normalize to
 * WHOLE sqft. Rounding is BUG-018's class (BUG-012's sibling): an acreage
 * conversion rendered "97,199.784 sqft" to a member, and even sqft-native
 * values carry float artifacts (recorded: 15682.000000000002). A lot size
 * with three decimals is not a measurement anyone took.
 */
function mapLotSize(value: unknown, unit: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n === null) return null;
  return Math.round(String(unit ?? '').toLowerCase().startsWith('acre') ? n * SQFT_PER_ACRE : n);
}

/**
 * Subject dateSold is ISO already; comps carry epoch millis. Accept both and
 * emit the CALENDAR DATE ("2026-08-05"), never the instant (BUG-006): Zillow's
 * epochs are local-midnight-in-UTC (07:00Z for Phoenix), and preserving the
 * time component made rule 12 reject every same-day sale for seven hours of
 * each UTC day — eating the freshest comps during the client's evening, then
 * freezing whichever set computed first into the 14-day cache. All US markets
 * sit west of UTC, so the UTC date of local midnight IS the local date.
 */
function mapSoldDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value && !Number.isNaN(Date.parse(value))) {
    return value.slice(0, 10);
  }
  return null;
}

/**
 * Map one detail-scraper item to a SubjectProperty, or null when it is a miss.
 * BOTH miss shapes (CONTRACT §6.1) are handled:
 *  1. `{ isValid: false, invalidReason }` — the clean miss.
 *  2. The fuzzy WRONG-PROPERTY match ("123 E Coronado Rd" -> "319 E Coronado
 *     Rd #1234"): guarded by requiring the normalized input to start with the
 *     normalized returned street. The §5.1 normalizer already unifies honest
 *     formatting drift (Blvd/Boulevard, W/WEST — verified on the recorded
 *     pair), so a mismatch means a different property, and running comps
 *     against a property the member didn't name is worse than failing.
 */
export type SubjectMissKind = 'INVALID' | 'BAD_GEOCODE' | 'STREET_MISMATCH' | 'NO_STREET' | 'NO_COORDS';

/** Compatibility wrapper: subject or null, miss kind discarded. */
export function mapSubjectItem(item: Record<string, unknown>, requestedAddress: string): SubjectProperty | null {
  const mapped = mapSubjectItemWithReason(item, requestedAddress);
  return 'subject' in mapped ? mapped.subject : null;
}

/**
 * mapSubjectItem with the miss KIND, so the caller can distinguish "no such
 * address" from "Zillow returned the wrong property" (operator ruling: the
 * copy branches on this; the failure code does not).
 */
export function mapSubjectItemWithReason(
  item: Record<string, unknown>,
  requestedAddress: string,
): { subject: SubjectProperty } | { miss: SubjectMissKind } {
  if (item.isValid === false) return { miss: 'INVALID' };
  // The provider's own miss signal (INSPECTOR 0009): the fuzzy wrong-property
  // match carried hasBadGeocode: true, the genuine subject false. First-line
  // check ALONGSIDE the street-prefix guard below, not instead of it.
  //
  // §6.2: v2 dropped this field, so on a v2 payload this check is a no-op and
  // the street-prefix guard below is the only wrong-property defence left. It
  // catches BOTH recorded cases on its own (asked "123 E Coronado Rd", got
  // "319 E Coronado Rd #1234"; asked "#429", got "#318") — verified in
  // tests/comps/apifyPayloadV2.test.ts, which is why nothing else was added
  // to replace the flag.
  if (item.hasBadGeocode === true) return { miss: 'BAD_GEOCODE' };

  // v1 address sources first, then v2's listingAddress (§6.2).
  const v1Address = asObject(item.address);
  const v2Address = asObject(item.listingAddress);
  const streetAddress = String(item.streetAddress ?? v1Address?.streetAddress ?? v2Address?.street ?? '');
  if (!streetAddress) return { miss: 'NO_STREET' };

  const normalizedInput = normalizeAddress(requestedAddress);
  const normalizedReturned = normalizeAddress(streetAddress);
  if (!normalizedReturned || !normalizedInput.startsWith(normalizedReturned)) {
    return { miss: 'STREET_MISMATCH' };
  }

  const coordinates = asObject(item.coordinates);
  const lat = asFiniteNumber(item.latitude ?? coordinates?.latitude);
  const lng = asFiniteNumber(item.longitude ?? coordinates?.longitude);
  if (lat === null || lng === null) return { miss: 'NO_COORDS' }; // no coordinates -> no comps search possible

  const lotArea = asObject(item.lotArea);
  return { subject: {
    zpid: String(item.zpid ?? ''),
    address: [
      streetAddress,
      v1Address?.city ?? v2Address?.city,
      v1Address?.state ?? v2Address?.state,
      v1Address?.zipcode ?? v2Address?.zipCode,
    ]
      .filter(Boolean)
      .join(', '),
    beds: asFiniteNumber(item.bedrooms),
    baths: asFiniteNumber(item.bathrooms),
    livingArea: asFiniteNumber(item.livingArea),
    // Detail payload carries lotSize already in sqft when known; fall back
    // to value+units — v1's lotAreaValue/lotAreaUnits, else v2's lotArea
    // (whose unit reads "Square Feet"/"Acres"; mapLotSize is case-insensitive
    // on the acre prefix). Rounded either way (BUG-018).
    lotSize:
      asFiniteNumber(item.lotSize) !== null
        ? Math.round(asFiniteNumber(item.lotSize) as number)
        : mapLotSize(item.lotAreaValue ?? lotArea?.value, item.lotAreaUnits ?? lotArea?.unit),
    yearBuilt: asFiniteNumber(item.yearBuilt),
    propertyType: mapHomeType(item.homeType),
    lastSoldPrice: asFiniteNumber(item.lastSoldPrice),
    lastSoldDate: mapSoldDate(item.dateSold),
    lat,
    lng,
  } };
}

/**
 * Map search-scraper items to RawComps, in either wire format (§6.2). Skips
 * the recorded noise shapes: building/rental cards, which carry a null zpid in
 * BOTH formats and additionally `isBuilding` in v1 (3/40 in the recorded run).
 * Everything else is passed through — REJECTION IS THE
 * FILTERS' JOB, and a skipped-vs-rejected comp is invisible in the "why not
 * this one?" report, so the skip list here stays as small as possible.
 */
export function mapCompItems(items: Array<Record<string, unknown>>): RawComp[] {
  const comps: RawComp[] = [];
  for (const item of items) {
    // §6.2: ONE card, two wire formats — v1 nests every fact under
    // hdpData.homeInfo, v2 removed that container and mapped the same facts
    // to the top level. A card is read entirely in ONE format, never a blend:
    // the recorded transitional payload carries both, and letting a v1 null
    // be back-filled from v2 would change numbers the golden fixtures pin.
    const homeInfo = asObject(asObject(item.hdpData)?.homeInfo);
    const v2Address = homeInfo ? undefined : asObject(item.listingAddress);
    const v2Lot = homeInfo ? undefined : asObject(item.lotArea);
    const zpid = homeInfo ? homeInfo.zpid : item.zpid;
    // v1 skipped building/rental noise by `isBuilding` and a null zpid; v2
    // marks those cards with a null zpid too (recorded: all 3 of them) and
    // adds its own per-item `isValid` flag.
    if (zpid == null || item.isBuilding === true || item.isValid === false) continue;
    const lat = asFiniteNumber(homeInfo ? homeInfo.latitude : asObject(item.coordinates)?.latitude);
    const lng = asFiniteNumber(homeInfo ? homeInfo.longitude : asObject(item.coordinates)?.longitude);
    if (lat === null || lng === null) continue; // unmappable: no distance, no filter decision

    comps.push({
      zpid: String(zpid),
      address: String(
        item.address ??
          (homeInfo
            ? [homeInfo.streetAddress, homeInfo.city, homeInfo.state].filter(Boolean).join(', ')
            : (v2Address?.full ??
              [v2Address?.street, v2Address?.city, v2Address?.state].filter(Boolean).join(', '))),
      ),
      status: mapStatus(homeInfo ? homeInfo.homeStatus : item.listingStatus),
      // v2 splits the figure across listingSoldPrice (the sale) and
      // listingPrice (the card's headline); a sold card is the sale.
      soldPrice: homeInfo
        ? asFiniteNumber(homeInfo.price)
        : (mapMoney(item.listingSoldPrice) ?? mapMoney(item.listingPrice)),
      soldDate: mapSoldDate(homeInfo ? homeInfo.dateSold : item.dateSold),
      beds: asFiniteNumber(homeInfo ? homeInfo.bedrooms : item.bedrooms),
      baths: asFiniteNumber(homeInfo ? homeInfo.bathrooms : item.bathrooms),
      livingArea: asFiniteNumber(homeInfo ? homeInfo.livingArea : item.livingArea),
      lotSize: homeInfo
        ? mapLotSize(homeInfo.lotAreaValue, homeInfo.lotAreaUnit)
        : mapLotSize(v2Lot?.value, v2Lot?.unit),
      propertyType: mapHomeType(homeInfo ? homeInfo.homeType : item.homeType),
      lat,
      lng,
      // Load-bearing per CONTRACT §14.9 — prefer the card's own URL (v1
      // detailUrl, v2 propertyUrl), fall back to the canonical zpid form.
      detailUrl:
        typeof item.detailUrl === 'string' && item.detailUrl
          ? item.detailUrl
          : typeof item.propertyUrl === 'string' && item.propertyUrl
            ? item.propertyUrl
            : `https://www.zillow.com/homedetails/${String(zpid)}_zpid/`,
    });
  }
  return comps;
}

/** Non-empty trimmed string or null — detail text fields ("Ranch", "Fixer") arrive blank sometimes. */
function nonEmptyString(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length > 0 ? s : null;
}

/**
 * daysOnZillow is REAL in the detail payload (recorded: 25/34/23/23/11) —
 * unlike the search payload, where it is a −1 sentinel on every sold comp
 * (§14.6) and never reaches this code. Negative values are the sentinel
 * class and map to null; 0 is a value.
 */
function mapDaysOnMarket(value: unknown): number | null {
  const n = asFiniteNumber(value);
  return n !== null && n >= 0 ? n : null;
}

/**
 * Map detail-scraper batch items (CONTRACT §14.14). Pure, fixture-testable.
 *
 *  - `addressOrUrlFromInput` is preserved verbatim on every item — valid AND
 *    invalid (recorded in spike-detail-batch-mixed.json) — because it is the
 *    join key. An item WITHOUT it is unjoinable and is dropped here: keeping
 *    it could only ever be attached by position, which §14.14 rule 1 bans.
 *  - `{isValid:false, invalidReason}` items come through as ok:false with the
 *    key intact, so the caller can say WHICH input failed (rule 3).
 *  - Style/condition are captured but NOT rendered (operator directive):
 *    waived as matching criteria ≠ declined as display; display needs its own
 *    client ruling and then it is a render change, not a re-scrape.
 */
export function mapDetailBatchItems(items: Array<Record<string, unknown>>): DetailBatchItem[] {
  const mapped: DetailBatchItem[] = [];
  for (const item of items) {
    const key = nonEmptyString(item.addressOrUrlFromInput);
    if (!key) continue;
    if (item.isValid === false) {
      mapped.push({ addressOrUrlFromInput: key, ok: false, zpid: null, detail: null });
      continue;
    }
    // §6.2: v2 removed resoFacts and moved the style to propertyFeatures.
    // parking.totalSpaces survived, which is why the parking count still
    // lands. propertyCondition has NO v2 home — it maps to null there, and
    // neither field is rendered (operator directive below).
    const resoFacts = (item.resoFacts ?? {}) as Record<string, unknown>;
    const propertyFeatures = (item.propertyFeatures ?? {}) as Record<string, unknown>;
    const parking = (item.parking ?? {}) as Record<string, unknown>;
    const detail: CompDetail = {
      daysOnMarket: mapDaysOnMarket(item.daysOnZillow),
      // §14.14.3 rule 2: a parking COUNT renders only when the payload
      // states one > 0. Zillow emits 0 as an unfilled DEFAULT — recorded:
      // parkingCapacity 0 + totalSpaces 0 on a card whose own features say
      // ["Carport"] — so a 0 here is indistinguishable from absence and
      // must map to null (em-dash), never to a rendered "0 parking spaces".
      parkingSpaces: positiveCount(asFiniteNumber(resoFacts.parkingCapacity) ?? asFiniteNumber(parking.totalSpaces)),
      yearBuilt: asFiniteNumber(item.yearBuilt),
      architecturalStyle:
        nonEmptyString(resoFacts.architecturalStyle) ?? nonEmptyString(propertyFeatures.architecturalStyle),
      propertyCondition: nonEmptyString(resoFacts.propertyCondition),
    };
    mapped.push({
      addressOrUrlFromInput: key,
      ok: true,
      zpid: item.zpid != null ? String(item.zpid) : null,
      detail,
    });
  }
  return mapped;
}

/**
 * Zillow search URL whose searchQueryState bounds a box of ±radiusMi around
 * the subject. `dozMonths` (§14.16.1) pushes the sold-within window
 * SERVER-SIDE via Zillow's own `doz` filter — spike-verified: without it
 * the result cap fills with the newest sales and "12 months" is weeks
 * deep. BOTH fetches now pass it (§14.16.1 for aggregates; §14.17 ruled it
 * onto the comps search too).
 */
export function buildSoldSearchUrl(lat: number, lng: number, radiusMi: number, dozMonths?: number): string {
  const latDelta = radiusMi / MILES_PER_DEG_LAT;
  const lngDelta = radiusMi / (MILES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const searchQueryState = {
    mapBounds: {
      west: lng - lngDelta,
      east: lng + lngDelta,
      south: lat - latDelta,
      north: lat + latDelta,
    },
    filterState: {
      isRecentlySold: { value: true },
      ...(dozMonths !== undefined ? { doz: { value: `${dozMonths}m` } } : {}),
      isForSaleByAgent: { value: false },
      isForSaleByOwner: { value: false },
      isNewConstruction: { value: false },
      isComingSoon: { value: false },
      isAuction: { value: false },
      isForSaleForeclosure: { value: false },
    },
    isMapVisible: true,
    isListVisible: true,
  };
  return `https://www.zillow.com/homes/recently_sold/?searchQueryState=${encodeURIComponent(
    JSON.stringify(searchQueryState),
  )}`;
}

type FetchLike = typeof globalThis.fetch;

export class ApifyZillowProvider implements PropertyDataProvider {
  readonly name = 'apify-zillow';

  constructor(
    private readonly token: string,
    // Injectable for tests; defaults to the global. Bound lazily per call so
    // constructing the provider never touches the network.
    private readonly fetchImpl: FetchLike = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs: number = PROVIDER_TIMEOUT_MS,
  ) {}

  async lookupSubject(rawAddress: string): Promise<SubjectProperty | SubjectResolutionMismatch | null> {
    const items = await this.runActor(DETAIL_ACTOR, 'subject lookup', {
      addresses: [rawAddress],
      propertyStatus: 'RECENTLY_SOLD',
    });
    if (items.length === 0) return null;
    const mapped = mapSubjectItemWithReason(items[0], rawAddress);
    if ('subject' in mapped) return mapped.subject;
    // BAD_GEOCODE / STREET_MISMATCH = Zillow returned a DIFFERENT property
    // (recorded: asked #429, got #318) — the member's address may be real, so
    // the copy must say "couldn't match that unit", not "no such address".
    if (mapped.miss === 'BAD_GEOCODE') return { miss: 'RESOLUTION_MISMATCH', guard: 'hasBadGeocode' };
    if (mapped.miss === 'STREET_MISMATCH') return { miss: 'RESOLUTION_MISMATCH', guard: 'street_prefix' };
    return null; // INVALID / NO_STREET / NO_COORDS -> a genuine not-found
  }

  async fetchSoldComps(subject: SubjectProperty, radiusMi: number, windowMonths?: number): Promise<RawComp[]> {
    // §14.17: the recency window rides SERVER-SIDE (doz), same as the
    // aggregate fetch — without it the results cap fills with the newest
    // sales and the recency ladder walks an inch-deep pool. The window
    // arrives from the SERVICE (its policy, asserted at this seam).
    const items = await this.runActor(SEARCH_ACTOR, 'sold comps search', {
      searchUrls: [{ url: buildSoldSearchUrl(subject.lat, subject.lng, radiusMi, windowMonths) }],
      extractionMethod: 'MAP_MARKERS',
      resultsLimit: SEARCH_RESULTS_LIMIT,
    });
    return mapCompItems(items);
  }

  /**
   * The dedicated neighbourhood-sales fetch (§14.16.1) — the 4th actor run
   * of a cold lookup. Same actor and mapper as the comps search; different
   * query: doz window server-side, NEIGHBORHOOD_RESULTS_LIMIT instead of
   * the comps cap (spike: 500 returned 235 with the query exhausted).
   */
  async fetchNeighborhoodSales(
    subject: SubjectProperty,
    radiusMi: number,
    windowMonths: number,
    opts?: { timeoutMs?: number },
  ): Promise<RawComp[]> {
    const items = await this.runActor(
      SEARCH_ACTOR,
      'neighborhood sales search',
      {
        searchUrls: [{ url: buildSoldSearchUrl(subject.lat, subject.lng, radiusMi, windowMonths) }],
        extractionMethod: 'MAP_MARKERS',
        resultsLimit: NEIGHBORHOOD_RESULTS_LIMIT,
      },
      opts?.timeoutMs,
    );
    return mapCompItems(items);
  }

  /**
   * ONE batched detail run (§14.14 rule 6 — the third actor run of a
   * lookup). Batch size is the caller's final kept set, structurally bounded
   * by MAX_COMPS_KEPT because the service passes ranked-and-capped comps —
   * never an independent constant (rule 2). `timeoutMs` is the remaining
   * whole-pipeline budget (rule 5).
   */
  async fetchDetailBatch(addresses: string[], opts?: { timeoutMs?: number }): Promise<DetailBatchItem[]> {
    if (addresses.length === 0) return [];
    const items = await this.runActor(
      DETAIL_ACTOR,
      'comps detail batch',
      { addresses, propertyStatus: 'RECENTLY_SOLD' },
      opts?.timeoutMs,
    );
    return mapDetailBatchItems(items);
  }

  /**
   * ONE attempt, no retry here. The retry policy (CONTRACT §3: one retry on
   * transient, never on 4xx) lives in service.ts at the PropertyDataProvider
   * seam — where it is uniform for every provider and assertable offline by
   * counting spy calls. This class only classifies failures into the three
   * typed errors the policy discriminates on.
   */
  private async runActor(
    actor: string,
    operation: string,
    input: Record<string, unknown>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<Array<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${APIFY_BASE}/acts/${actor}/run-sync-get-dataset-items`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new ProviderTimeoutError(operation, timeoutMs);
        throw new ProviderNetworkError(operation, err);
      }
      if (!response.ok) throw new ProviderHttpError(operation, response.status);
      try {
        const body = (await response.json()) as unknown;
        return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
      } catch (err) {
        throw new ProviderNetworkError(operation, err); // malformed body = transport-class failure
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
