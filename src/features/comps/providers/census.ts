/**
 * US Census provider (CONTRACT §14.10) — the ONLY file that talks to the
 * Census APIs. Two calls per cold tract:
 *
 *   1. Geocoder: lat/lng → census tract (GEOID + display name). Free, no
 *      key. Recorded payload: __fixtures__/spike-census-geocode.json.
 *   2. ACS 5-year: tract → median household income (B19013), median age
 *      (B01002), tenure counts (B25003). REQUIRES AN API KEY — verified
 *      2026-08-10: keyless requests 302 to a "Missing Key" page on every
 *      vintage, so §14.10's original "no key at light volume" is stale. The
 *      key is free (api.census.gov/data/key_signup.html) and lives in
 *      CENSUS_API_KEY; without it this provider is never constructed.
 *
 * Mapping functions are exported PURE and fixture-testable. ACS returns all
 * values as STRINGS in a header-row array-of-arrays; columns are located BY
 * HEADER NAME, never by position — same discipline as the detail join, for
 * the same reason. Suppression sentinels (large negatives, e.g. -666666666)
 * and non-numeric values map to null: a null renders an em-dash, a sentinel
 * rendered as a number would be a confident wrong fact.
 *
 * The key rides only in the ACS query string. The typed errors carry the
 * operation name and status ONLY — no URL — so the key cannot leak through
 * an error path.
 */
import { CENSUS_ACS_YEAR, CENSUS_TIMEOUT_MS } from '../config.js';
import type { Demographics } from '../types.js';
import {
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
} from './types.js';

export const CENSUS_GEOCODER_BASE =
  'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
export const CENSUS_ACS_BASE = 'https://api.census.gov/data';

/** ACS variables queried, by meaning. Column lookup is by these names. */
export const ACS_VARIABLES = {
  medianHouseholdIncome: 'B19013_001E',
  medianAge: 'B01002_001E',
  tenureTotal: 'B25003_001E',
  tenureOwner: 'B25003_002E',
  tenureRenter: 'B25003_003E',
} as const;

export interface TractRef {
  geoid: string;
  name: string;
  state: string;
  county: string;
  tract: string;
}

export interface DemographicsProviderLike {
  /** Null when the coordinates resolve to no tract (offshore, bad data). */
  resolveTract(lat: number, lng: number, opts?: { timeoutMs?: number }): Promise<TractRef | null>;
  fetchDemographics(tract: TractRef, opts?: { timeoutMs?: number }): Promise<Demographics>;
}

/** Geocoder response → TractRef, or null when no tract layer came back. */
export function mapTractFromGeocoder(body: unknown): TractRef | null {
  const tracts = (body as { result?: { geographies?: Record<string, unknown> } } | null)?.result
    ?.geographies?.['Census Tracts'];
  const first = Array.isArray(tracts) ? (tracts[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) return null;
  const geoid = typeof first.GEOID === 'string' ? first.GEOID : '';
  const state = typeof first.STATE === 'string' ? first.STATE : '';
  const county = typeof first.COUNTY === 'string' ? first.COUNTY : '';
  const tract = typeof first.TRACT === 'string' ? first.TRACT : '';
  if (!geoid || !state || !county || !tract) return null;
  return {
    geoid,
    name: typeof first.NAME === 'string' && first.NAME ? first.NAME : `Census tract ${geoid}`,
    state,
    county,
    tract,
  };
}

/**
 * ACS values arrive as strings. A usable figure is finite and NON-NEGATIVE —
 * the suppression sentinels are all large negatives, and none of income /
 * age / a household count can legitimately be below zero.
 */
function acsNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** ACS body ([[headers],[values,...]]) → Demographics. Columns BY NAME, never position. */
export function mapDemographicsFromAcs(
  body: unknown,
  tract: TractRef,
  acsYear: number = CENSUS_ACS_YEAR,
): Demographics {
  const rows = Array.isArray(body) ? (body as unknown[][]) : [];
  const headers = Array.isArray(rows[0]) ? rows[0].map((h) => String(h)) : [];
  const values = Array.isArray(rows[1]) ? rows[1] : [];
  const col = (name: string): unknown => {
    const i = headers.indexOf(name);
    return i >= 0 ? values[i] : undefined;
  };

  const owner = acsNumber(col(ACS_VARIABLES.tenureOwner));
  const renter = acsNumber(col(ACS_VARIABLES.tenureRenter));
  // Percentages are ARITHMETIC ON RETURNED COUNTS (§14.10 allows arithmetic,
  // never inference) — and only when both counts exist and sum above zero.
  const occupied = owner !== null && renter !== null ? owner + renter : null;
  const pct = (part: number | null): number | null =>
    part !== null && occupied !== null && occupied > 0
      ? Math.round((part / occupied) * 1000) / 10
      : null;

  return {
    tractGeoid: tract.geoid,
    tractName: tract.name,
    acsYear,
    medianHouseholdIncome: acsNumber(col(ACS_VARIABLES.medianHouseholdIncome)),
    medianAge: acsNumber(col(ACS_VARIABLES.medianAge)),
    ownerOccupiedPct: pct(owner),
    renterOccupiedPct: pct(renter),
  };
}

type FetchLike = typeof globalThis.fetch;

export class CensusAcsProvider implements DemographicsProviderLike {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs: number = CENSUS_TIMEOUT_MS,
  ) {}

  async resolveTract(lat: number, lng: number, opts?: { timeoutMs?: number }): Promise<TractRef | null> {
    const url =
      `${CENSUS_GEOCODER_BASE}?x=${encodeURIComponent(lng)}&y=${encodeURIComponent(lat)}` +
      '&benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Tracts&format=json';
    const body = await this.getJson(url, 'census geocoder', opts?.timeoutMs);
    return mapTractFromGeocoder(body);
  }

  async fetchDemographics(tract: TractRef, opts?: { timeoutMs?: number }): Promise<Demographics> {
    const vars = Object.values(ACS_VARIABLES).join(',');
    const url =
      `${CENSUS_ACS_BASE}/${CENSUS_ACS_YEAR}/acs/acs5?get=${vars}` +
      `&for=tract:${encodeURIComponent(tract.tract)}` +
      `&in=state:${encodeURIComponent(tract.state)}%20county:${encodeURIComponent(tract.county)}` +
      `&key=${encodeURIComponent(this.apiKey)}`;
    const body = await this.getJson(url, 'census acs', opts?.timeoutMs);
    return mapDemographicsFromAcs(body, tract);
  }

  /**
   * ONE attempt, no retry — matching the detail batch's pinned posture, and
   * for a stronger reason: this API is free and the whole feature is
   * decoration, so the degradation line IS the retry. `redirect: 'error'`
   * because the API's failure mode for a bad/missing key is a 302 to an HTML
   * page — following it would hand JSON.parse an HTML document and misreport
   * a key problem as a parse problem.
   */
  private async getJson(url: string, operation: string, timeoutMs?: number): Promise<unknown> {
    const budget = timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'error' });
      } catch (err) {
        if (controller.signal.aborted) throw new ProviderTimeoutError(operation, budget);
        throw new ProviderNetworkError(operation, err);
      }
      if (!response.ok) throw new ProviderHttpError(operation, response.status);
      try {
        return await response.json();
      } catch (err) {
        throw new ProviderNetworkError(operation, err);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
