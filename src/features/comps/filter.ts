/**
 * Hard filters + radius tiers (CONTRACT §5.3).
 *
 * Pure and clock-free: `now` is a parameter, never Date.now(). A comp that
 * fails several rules is tagged with the FIRST failing reason in contract
 * order — the order is load-bearing, because INSPECTOR asserts exact reasons
 * and a debugging session needs one deterministic answer to "why was this
 * comp dropped?".
 */
import {
  DAYS_PER_MONTH,
  EARTH_RADIUS_MI,
  LOT_ANOMALY_MULTIPLE,
  MAX_BATH_DIFF,
  MAX_BED_DIFF,
  MAX_COMP_AGE_MONTHS,
  MIN_COMPS_FOR_TIER,
  NON_ARMS_LENGTH_PPSF_FRACTION,
  RADIUS_TIERS_MI,
  SQFT_TOLERANCE,
} from './config.js';
import type { RawComp, RejectedComp, SubjectProperty } from './types.js';

/** Great-circle distance in miles. */
export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Months between an ISO date and `now`; Infinity when unparseable (saturates every age check). */
export function monthsBetween(iso: string | null, now: Date): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH);
}

/** Median with the contract's even-n rule: mean of the middle two. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The non-arms-length threshold is computed over the CANDIDATE set — every
 * input comp with a computable $/sqft, regardless of the other filters — so
 * the answer does not depend on filter order or the active radius tier
 * (CONTRACT §5.3.10).
 */
function candidateMedianPpsf(comps: RawComp[]): number {
  const ppsf = comps
    .filter((c) => (c.soldPrice ?? 0) > 0 && (c.livingArea ?? 0) > 0)
    .map((c) => (c.soldPrice as number) / (c.livingArea as number));
  return median(ppsf);
}

/**
 * One pass of the eleven hard filters at a fixed radius. Kept comps preserve
 * input order; ranking is rank.ts's job, not this one's.
 */
export function applyHardFilters(
  subject: SubjectProperty,
  comps: RawComp[],
  radiusMi: number,
  now: Date,
): { kept: RawComp[]; rejected: RejectedComp[] } {
  const kept: RawComp[] = [];
  const rejected: RejectedComp[] = [];
  const medianPpsf = candidateMedianPpsf(comps);
  const subjectSqft = subject.livingArea ?? 0;

  for (const comp of comps) {
    // Contract order, first match wins.
    if (comp.status.toUpperCase() !== 'SOLD') {
      rejected.push({ comp, reason: 'NOT_SOLD' });
      continue;
    }
    if (monthsBetween(comp.soldDate, now) > MAX_COMP_AGE_MONTHS) {
      rejected.push({ comp, reason: 'STALE_SALE' });
      continue;
    }
    if ((comp.livingArea ?? 0) <= 0) {
      rejected.push({ comp, reason: 'SQFT_MISSING' });
      continue;
    }
    const sqftDelta = Math.abs((comp.livingArea as number) - subjectSqft);
    if (subjectSqft > 0 && sqftDelta / subjectSqft > SQFT_TOLERANCE) {
      rejected.push({ comp, reason: 'SQFT_OUT_OF_RANGE' });
      continue;
    }
    // Null on either side means "unknown", and unknown is not a rejection —
    // dropping every comp with a missing bed count would starve thin markets.
    if (
      comp.beds !== null &&
      subject.beds !== null &&
      Math.abs(comp.beds - subject.beds) > MAX_BED_DIFF
    ) {
      rejected.push({ comp, reason: 'BEDS_DIFF' });
      continue;
    }
    if (
      comp.baths !== null &&
      subject.baths !== null &&
      Math.abs(comp.baths - subject.baths) > MAX_BATH_DIFF
    ) {
      rejected.push({ comp, reason: 'BATHS_DIFF' });
      continue;
    }
    // OTHER matches nothing, including OTHER (two unknowns are not comparable).
    if (comp.propertyType !== subject.propertyType || subject.propertyType === 'OTHER') {
      rejected.push({ comp, reason: 'TYPE_MISMATCH' });
      continue;
    }
    if (haversineMiles(subject.lat, subject.lng, comp.lat, comp.lng) > radiusMi) {
      rejected.push({ comp, reason: 'TOO_FAR' });
      continue;
    }
    if ((comp.soldPrice ?? 0) <= 0) {
      rejected.push({ comp, reason: 'PRICE_MISSING' });
      continue;
    }
    const ppsf = (comp.soldPrice as number) / (comp.livingArea as number);
    if (Number.isFinite(medianPpsf) && ppsf < NON_ARMS_LENGTH_PPSF_FRACTION * medianPpsf) {
      rejected.push({ comp, reason: 'NON_ARMS_LENGTH' });
      continue;
    }
    if (
      comp.lotSize !== null &&
      subject.lotSize !== null &&
      subject.lotSize > 0 &&
      comp.lotSize > LOT_ANOMALY_MULTIPLE * subject.lotSize
    ) {
      rejected.push({ comp, reason: 'LOT_ANOMALY' });
      continue;
    }
    // Rule 12 (BUG-003): a sale dated after `now` hasn't happened yet, so it
    // is not a comp. Without this, a future-dated row passed every filter and
    // its NEGATIVE recency score ranked it ahead of flawless comps — bad data
    // promoted, not just tolerated. Zillow emits these (pending-close dates,
    // timezone shifts). Appended as rule 12 so rules 1-11 keep their pinned
    // first-match reasons unchanged.
    if (monthsBetween(comp.soldDate, now) < 0) {
      rejected.push({ comp, reason: 'FUTURE_SOLD_DATE' });
      continue;
    }
    kept.push(comp);
  }

  return { kept, rejected };
}

/**
 * Radius tiers (CONTRACT §5.3): rerun the FULL filter pass at each tier, stop
 * at the first yielding >= MIN_COMPS_FOR_TIER, else return the widest tier's
 * outcome. The reported rejected list is the final tier's only — one coherent
 * story, not three overlaid ones.
 */
export function selectRadiusTier(
  subject: SubjectProperty,
  comps: RawComp[],
  now: Date,
): { kept: RawComp[]; rejected: RejectedComp[]; radiusTierMi: number } {
  let last = {
    ...applyHardFilters(subject, comps, RADIUS_TIERS_MI[0], now),
    radiusTierMi: RADIUS_TIERS_MI[0],
  };
  for (const tier of RADIUS_TIERS_MI) {
    const pass = applyHardFilters(subject, comps, tier, now);
    last = { ...pass, radiusTierMi: tier };
    if (pass.kept.length >= MIN_COMPS_FOR_TIER) break;
  }
  return last;
}
