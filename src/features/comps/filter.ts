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
  MAX_BATH_DIFF,
  MAX_BED_DIFF,
  MIN_COMPS_FOR_TIER,
  NON_ARMS_LENGTH_PPSF_FRACTION,
  RADIUS_TIERS_MI,
  RECENCY_TIERS_MONTHS,
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

/**
 * Months between an ISO date and `now`; Infinity when unparseable (saturates
 * every age check).
 *
 * Compares at UTC CALENDAR-DAY granularity (BUG-006): `soldDate` is an ISO
 * *date* per §4, so a sale "today" is 0 months old at every hour of the day.
 * Instant-granularity comparison made rule 12 reject same-day sales for the
 * seven UTC hours before Phoenix midnight — nondeterministic comp sets that
 * the 14-day cache then froze. Day-truncation also degrades gracefully if a
 * timestamp ever leaks through the adapter again.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function monthsBetween(iso: string | null, now: Date): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  const soldDay = Math.floor(t / MS_PER_DAY);
  const nowDay = Math.floor(now.getTime() / MS_PER_DAY);
  return (nowDay - soldDay) / DAYS_PER_MONTH;
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
  maxAgeMonths: number,
  now: Date,
): { kept: RawComp[]; rejected: RejectedComp[] } {
  const kept: RawComp[] = [];
  const rejected: RejectedComp[] = [];
  const medianPpsf = candidateMedianPpsf(comps);
  const subjectSqft = subject.livingArea ?? 0;

  for (const comp of comps) {
    // Contract order, first match wins.
    // Rule 0 (BUG-004): the subject is inside its own search box and comes
    // back as a flawless comp — distance 0, deltas 0, sold yesterday. Kept,
    // it anchors the ARV to the member's own purchase price. Prepended (not
    // appended) so the reject table names the real reason rather than
    // whatever rule 1-12 happens to also match.
    if (comp.zpid !== '' && subject.zpid !== '' && comp.zpid === subject.zpid) {
      rejected.push({ comp, reason: 'SUBJECT_PROPERTY' });
      continue;
    }
    if (comp.status.toUpperCase() !== 'SOLD') {
      rejected.push({ comp, reason: 'NOT_SOLD' });
      continue;
    }
    // Against the ACTIVE recency rung (CONTRACT §14.1), not a flat constant.
    if (monthsBetween(comp.soldDate, now) > maxAgeMonths) {
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
    // Rule 11 LOT_ANOMALY REMOVED in v2 (CONTRACT §14.1): a hard lot gate
    // decimated thin markets. Lot is now a soft scoring term (rank.ts). The
    // RejectReason member survives so cached v1 results still type, but it is
    // never emitted from here again.
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

export interface TierSelection {
  kept: RawComp[];
  rejected: RejectedComp[];
  radiusTierMi: number;
  recencyTierMonths: number;
}

/**
 * Walk BOTH ladders as ONE ordered sequence (CONTRACT §14.2), rerunning the
 * full filter pass at each rung and stopping at the first yielding
 * >= MIN_COMPS_FOR_TIER:
 *
 *   1mi/3mo -> 1mi/6mo -> 1mi/12mo -> 3mi/3mo -> 3mi/6mo -> 3mi/12mo
 *
 * Recency is the INNER loop, so time widens before distance. Rationale worth
 * keeping next to the code: location is a stronger determinant of value than
 * recency inside a 12-month window, so a same-neighbourhood sale from eight
 * months ago beats one three miles out from last month.
 *
 * If no rung reaches MIN_COMPS_FOR_TIER the LAST rung's outcome is returned —
 * it may still satisfy MIN_COMPS_TO_COMPUTE. The reported rejected list is
 * that final rung's only: one coherent story, not six overlaid ones.
 *
 * Renamed from selectRadiusTier — there are two ladders now, and a name saying
 * "radius" would be a lie about what it walks.
 */
export function selectTiers(
  subject: SubjectProperty,
  comps: RawComp[],
  now: Date,
): TierSelection {
  const widestRadius = RADIUS_TIERS_MI[RADIUS_TIERS_MI.length - 1];
  const widestAge = RECENCY_TIERS_MONTHS[RECENCY_TIERS_MONTHS.length - 1];
  let last: TierSelection = {
    ...applyHardFilters(subject, comps, widestRadius, widestAge, now),
    radiusTierMi: widestRadius,
    recencyTierMonths: widestAge,
  };
  for (const radiusMi of RADIUS_TIERS_MI) {
    for (const maxAgeMonths of RECENCY_TIERS_MONTHS) {
      const pass = applyHardFilters(subject, comps, radiusMi, maxAgeMonths, now);
      last = { ...pass, radiusTierMi: radiusMi, recencyTierMonths: maxAgeMonths };
      if (pass.kept.length >= MIN_COMPS_FOR_TIER) return last;
    }
  }
  return last;
}
