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

/**
 * BUG-013: an ACS value that is negative but NOT an enumerated sentinel.
 * The member never sees it (nulled by the domain floor); the caller LOGS it
 * — that log line is how we learn Census added a seventh annotation,
 * instead of finding out from a member screenshot.
 */
export interface UnrecognizedAcsValue {
  variable: string;
  value: number;
  tractGeoid: string;
}

export interface DemographicsProviderLike {
  /** Null when the coordinates resolve to no tract (offshore, bad data). */
  resolveTract(lat: number, lng: number, opts?: { timeoutMs?: number }): Promise<TractRef | null>;
  fetchDemographics(
    tract: TractRef,
    opts?: { timeoutMs?: number; onUnrecognized?: (anomaly: UnrecognizedAcsValue) => void },
  ): Promise<Demographics>;
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
 * ACS suppression/annotation sentinels (CONTRACT §14.10 GUARANTEE 3) — an
 * ENUMERATED LIST, deliberately not a threshold. A "drop anything ≤ 0"
 * check would eat true zeros (a 0% owner-occupied tract is real), and a
 * "drop negatives" check is the wrong SHAPE for a sentinel class — this is
 * its third appearance after daysOnZillow's -1. Exported so tests assert
 * the list itself, not a behavioural shadow of it.
 */
export const ACS_SENTINELS: ReadonlySet<number> = new Set([
  -666666666, // estimate not computable
  -999999999, // suppressed / N/A
  -888888888, // not applicable
  -222222222, // too few samples
  -555555555, // estimate controlled (documented annotation; completes the class)
  -333333333, // median falls in lowest/highest interval (same)
]);

/**
 * ACS body ([[headers],[values,...]]) → Demographics. Columns BY NAME, never
 * position.
 *
 * Value guard is TWO layers with different jobs (BUG-013, operator ruling):
 *  1. the ENUMERATED sentinel set — named, documented suppression, nulled
 *     SILENTLY because it is expected;
 *  2. a DOMAIN FLOOR beneath it: none of these four measures (income, age,
 *     household counts) can be negative, so an unlisted negative is bad
 *     data — nulled AND reported through `onUnrecognized`, which the
 *     service logs at WARN. The log line is the point: it is how we learn
 *     Census added a seventh annotation, rather than from a member
 *     screenshot. A bare threshold would have hidden that forever; the
 *     enumeration alone rendered "renter-occupied 150%".
 */
export function mapDemographicsFromAcs(
  body: unknown,
  tract: TractRef,
  acsYear: number = CENSUS_ACS_YEAR,
  onUnrecognized?: (anomaly: UnrecognizedAcsValue) => void,
): Demographics {
  const rows = Array.isArray(body) ? (body as unknown[][]) : [];
  const headers = Array.isArray(rows[0]) ? rows[0].map((h) => String(h)) : [];
  const values = Array.isArray(rows[1]) ? rows[1] : [];
  const col = (name: string): unknown => {
    const i = headers.indexOf(name);
    return i >= 0 ? values[i] : undefined;
  };

  /** Strings → numbers; sentinel → null silently; unlisted negative → null + report; 0 is a value. */
  const acsNumber = (variable: string): number | null => {
    const raw = col(variable);
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (ACS_SENTINELS.has(n)) return null;
    if (n < 0) {
      onUnrecognized?.({ variable, value: n, tractGeoid: tract.geoid });
      return null;
    }
    return n;
  };

  const owner = acsNumber(ACS_VARIABLES.tenureOwner);
  const renter = acsNumber(ACS_VARIABLES.tenureRenter);
  // Percentages are ARITHMETIC ON RETURNED COUNTS (§14.10 allows arithmetic,
  // never inference) — and only when both counts exist and sum above zero.
  const occupied = owner !== null && renter !== null ? owner + renter : null;
  const pct = (part: number | null): number | null =>
    part !== null && occupied !== null && occupied > 0
      ? Math.round((part / occupied) * 1000) / 10
      : null;

  let ownerPct = pct(owner);
  let renterPct = pct(renter);
  // Structural backstop (BUG-013, operator: "clamp is wrong, null is
  // right"): a percentage outside [0,100] is data we do not understand, and
  // we do not repair data we do not understand — both lines render
  // unavailable. Unreachable while the domain floor holds (non-negative
  // counts cannot leave the range); kept so the guarantee survives any
  // future refactor of the floor, and reported when it fires.
  if (ownerPct !== null && renterPct !== null && (ownerPct < 0 || ownerPct > 100 || renterPct < 0 || renterPct > 100)) {
    onUnrecognized?.({ variable: 'B25003 tenure reconciliation', value: ownerPct, tractGeoid: tract.geoid });
    ownerPct = null;
    renterPct = null;
  }

  return {
    tractGeoid: tract.geoid,
    tractName: tract.name,
    acsYear,
    medianHouseholdIncome: acsNumber(ACS_VARIABLES.medianHouseholdIncome),
    medianAge: acsNumber(ACS_VARIABLES.medianAge),
    ownerOccupiedPct: ownerPct,
    renterOccupiedPct: renterPct,
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

  async fetchDemographics(
    tract: TractRef,
    opts?: { timeoutMs?: number; onUnrecognized?: (anomaly: UnrecognizedAcsValue) => void },
  ): Promise<Demographics> {
    const vars = Object.values(ACS_VARIABLES).join(',');
    const url =
      `${CENSUS_ACS_BASE}/${CENSUS_ACS_YEAR}/acs/acs5?get=${vars}` +
      `&for=tract:${encodeURIComponent(tract.tract)}` +
      `&in=state:${encodeURIComponent(tract.state)}%20county:${encodeURIComponent(tract.county)}` +
      `&key=${encodeURIComponent(this.apiKey)}`;
    const body = await this.getJson(url, 'census acs', opts?.timeoutMs);
    return mapDemographicsFromAcs(body, tract, CENSUS_ACS_YEAR, opts?.onUnrecognized);
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
