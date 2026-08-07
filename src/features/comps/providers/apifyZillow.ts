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
import { PROVIDER_TIMEOUT_MS } from '../config.js';
import { normalizeAddress } from '../normalize.js';
import type { PropertyType, RawComp, SubjectProperty } from '../types.js';
import {
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
  type PropertyDataProvider,
  type SubjectResolutionMismatch,
} from './types.js';

export const APIFY_BASE = 'https://api.apify.com/v2';
export const DETAIL_ACTOR = 'maxcopell~zillow-detail-scraper';
export const SEARCH_ACTOR = 'maxcopell~zillow-scraper';
/** Comps fetched per search; the filters cut from here, so over-fetch a little. */
export const SEARCH_RESULTS_LIMIT = 40;

const SQFT_PER_ACRE = 43_560;
const MILES_PER_DEG_LAT = 69;

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

/** RECENTLY_SOLD is Zillow's word for what the contract calls SOLD. */
function mapStatus(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase();
  return s === 'RECENTLY_SOLD' ? 'SOLD' : s;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Lot arrives as sqft or acres depending on actor and row; normalize to sqft. */
function mapLotSize(value: unknown, unit: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n === null) return null;
  return String(unit ?? '').toLowerCase().startsWith('acre') ? n * SQFT_PER_ACRE : n;
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
  if (item.hasBadGeocode === true) return { miss: 'BAD_GEOCODE' };

  const streetAddress = String(
    item.streetAddress ?? (item.address as Record<string, unknown> | undefined)?.streetAddress ?? '',
  );
  if (!streetAddress) return { miss: 'NO_STREET' };

  const normalizedInput = normalizeAddress(requestedAddress);
  const normalizedReturned = normalizeAddress(streetAddress);
  if (!normalizedReturned || !normalizedInput.startsWith(normalizedReturned)) {
    return { miss: 'STREET_MISMATCH' };
  }

  const lat = asFiniteNumber(item.latitude);
  const lng = asFiniteNumber(item.longitude);
  if (lat === null || lng === null) return { miss: 'NO_COORDS' }; // no coordinates -> no comps search possible

  const addr = (item.address ?? {}) as Record<string, unknown>;
  return { subject: {
    zpid: String(item.zpid ?? ''),
    address: [streetAddress, addr.city, addr.state, addr.zipcode].filter(Boolean).join(', '),
    beds: asFiniteNumber(item.bedrooms),
    baths: asFiniteNumber(item.bathrooms),
    livingArea: asFiniteNumber(item.livingArea),
    // Detail payload carries lotSize already in sqft when known; fall back to value+units.
    lotSize: asFiniteNumber(item.lotSize) ?? mapLotSize(item.lotAreaValue, item.lotAreaUnits),
    yearBuilt: asFiniteNumber(item.yearBuilt),
    propertyType: mapHomeType(item.homeType),
    lastSoldPrice: asFiniteNumber(item.lastSoldPrice),
    lastSoldDate: mapSoldDate(item.dateSold),
    lat,
    lng,
  } };
}

/**
 * Map search-scraper items to RawComps. Skips the recorded noise shapes:
 * building/rental cards with no hdpData.homeInfo or a null zpid (3/40 in the
 * recorded run). Everything else is passed through — REJECTION IS THE
 * FILTERS' JOB, and a skipped-vs-rejected comp is invisible in the "why not
 * this one?" report, so the skip list here stays as small as possible.
 */
export function mapCompItems(items: Array<Record<string, unknown>>): RawComp[] {
  const comps: RawComp[] = [];
  for (const item of items) {
    const homeInfo = (item.hdpData as Record<string, unknown> | undefined)?.homeInfo as
      | Record<string, unknown>
      | undefined;
    if (!homeInfo || homeInfo.zpid == null || item.isBuilding === true) continue;
    const lat = asFiniteNumber(homeInfo.latitude);
    const lng = asFiniteNumber(homeInfo.longitude);
    if (lat === null || lng === null) continue; // unmappable: no distance, no filter decision

    comps.push({
      zpid: String(homeInfo.zpid),
      address: String(
        item.address ??
          [homeInfo.streetAddress, homeInfo.city, homeInfo.state].filter(Boolean).join(', '),
      ),
      status: mapStatus(homeInfo.homeStatus),
      soldPrice: asFiniteNumber(homeInfo.price),
      soldDate: mapSoldDate(homeInfo.dateSold),
      beds: asFiniteNumber(homeInfo.bedrooms),
      baths: asFiniteNumber(homeInfo.bathrooms),
      livingArea: asFiniteNumber(homeInfo.livingArea),
      lotSize: mapLotSize(homeInfo.lotAreaValue, homeInfo.lotAreaUnit),
      propertyType: mapHomeType(homeInfo.homeType),
      lat,
      lng,
      // Load-bearing per CONTRACT §14.9 — prefer the card's own URL, fall back
      // to the canonical zpid form; null only when neither exists.
      detailUrl:
        typeof item.detailUrl === 'string' && item.detailUrl
          ? item.detailUrl
          : homeInfo.zpid != null
            ? `https://www.zillow.com/homedetails/${String(homeInfo.zpid)}_zpid/`
            : null,
    });
  }
  return comps;
}

/** Zillow search URL whose searchQueryState bounds a box of ±radiusMi around the subject. */
export function buildSoldSearchUrl(lat: number, lng: number, radiusMi: number): string {
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

  async fetchSoldComps(subject: SubjectProperty, radiusMi: number): Promise<RawComp[]> {
    const items = await this.runActor(SEARCH_ACTOR, 'sold comps search', {
      searchUrls: [{ url: buildSoldSearchUrl(subject.lat, subject.lng, radiusMi) }],
      extractionMethod: 'MAP_MARKERS',
      resultsLimit: SEARCH_RESULTS_LIMIT,
    });
    return mapCompItems(items);
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
  ): Promise<Array<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
        if (controller.signal.aborted) throw new ProviderTimeoutError(operation, this.timeoutMs);
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
