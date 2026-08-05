/**
 * Provider seam (CONTRACT §6). All network I/O for comps lives behind this
 * interface; everything above it is pure and offline-testable. Tests inject a
 * fake through AppDeps.propertyProvider — never env vars, never module mocks.
 */
import type { RawComp, SubjectProperty } from '../types.js';

/**
 * Zillow resolved a DIFFERENT property than the one named (wrong unit,
 * bad geocode). Distinct from a null miss so the member copy can say
 * "couldn't match that exact unit" instead of "couldn't find that address" —
 * same ADDRESS_NOT_FOUND code either way (operator ruling: copy, not code).
 */
export interface SubjectResolutionMismatch {
  miss: 'RESOLUTION_MISMATCH';
  guard: 'hasBadGeocode' | 'street_prefix';
}

export interface PropertyDataProvider {
  readonly name: string; // 'apify-zillow' | 'stub'
  /**
   * Resolves the subject; null for a genuine empty/invalid result; a
   * SubjectResolutionMismatch when the provider returned a wrong-property
   * match. Implementations returning only `SubjectProperty | null` (fakes,
   * stubs) remain conformant — the mismatch member is optional behaviour.
   */
  lookupSubject(rawAddress: string): Promise<SubjectProperty | SubjectResolutionMismatch | null>;
  /** Sold comps around the subject. May include garbage; the hard filters own rejection. */
  fetchSoldComps(subject: SubjectProperty, radiusMi: number): Promise<RawComp[]>;
}

/** Provider exceeded PROVIDER_TIMEOUT_MS. Retried once, then PROVIDER_TIMEOUT. */
export class ProviderTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/** Non-2xx from the provider. 5xx retries once; 4xx never retries (CONTRACT §3). */
export class ProviderHttpError extends Error {
  constructor(
    operation: string,
    readonly status: number,
  ) {
    super(`${operation} failed with HTTP ${status}`);
    this.name = 'ProviderHttpError';
  }
}

/** Network-level failure (DNS, reset, malformed body). Retried once. */
export class ProviderNetworkError extends Error {
  constructor(operation: string, cause: unknown) {
    // The cause's message is included but never any request detail — the
    // Authorization header must be unable to leak through an error path.
    super(`${operation} network failure: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'ProviderNetworkError';
  }
}
