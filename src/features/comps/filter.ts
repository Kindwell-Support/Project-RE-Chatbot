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
  DUPLICATE_COORD_TOLERANCE_MI,
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
  // Deduped FIRST (BUG-010): the operator's rationale for the dedupe includes
  // "can't skew the candidate-set median the non-arms-length rule depends on",
  // and dropping duplicates after the gates cannot achieve that — this median
  // is computed inside the gate pass. So the median gets its own deduped view
  // while the REJECTION still happens after filtering, where the semantics are
  // honest (only a comp that would otherwise be kept is called a duplicate).
  const ppsf = dedupeSales(comps).kept
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
  const seed = applyHardFilters(subject, comps, widestRadius, widestAge, now);
  const seedDeduped = dedupeSales(seed.kept);
  let last: TierSelection = {
    kept: seedDeduped.kept,
    rejected: [...seed.rejected, ...seedDeduped.duplicates],
    radiusTierMi: widestRadius,
    recencyTierMonths: widestAge,
  };
  for (const radiusMi of RADIUS_TIERS_MI) {
    for (const maxAgeMonths of RECENCY_TIERS_MONTHS) {
      const pass = applyHardFilters(subject, comps, radiusMi, maxAgeMonths, now);
      // BUG-010 dedupe sits HERE — after the gates, before ranking — so a
      // duplicate can never consume one of the five slots, and only a comp
      // that would otherwise have been KEPT is ever labelled DUPLICATE_SALE.
      // The tier's sufficiency test runs on the DEDUPED count, otherwise a
      // rung could "reach 5" on four real sales plus a copy.
      const deduped = dedupeSales(pass.kept);
      last = {
        kept: deduped.kept,
        rejected: [...pass.rejected, ...deduped.duplicates],
        radiusTierMi: radiusMi,
        recencyTierMonths: maxAgeMonths,
      };
      if (deduped.kept.length >= MIN_COMPS_FOR_TIER) return last;
    }
  }
  return last;
}

/**
 * BUG-010 — collapse duplicate SALES (not duplicate ids).
 *
 * Zillow carried one Wickenburg sale under two zpids with different address
 * formatting ("830 America St" / "830 W AMERICA Street"), and it occupied TWO
 * of five comp slots: it double-weighted that sale in a trimmed mean of three
 * values, displaced a genuine comp, and — because duplicates shrink variance —
 * pushed the confidence tier up. Identity is therefore the SALE, never the id.
 *
 * Match = same price, same living area, same sold date, and coordinates within
 * DUPLICATE_COORD_TOLERANCE_MI. A distance threshold, not float equality: the
 * recorded pair differed in the sixth decimal of latitude.
 *
 * Winner = the record carrying more real data (lot, beds, baths, link), so the
 * survivor is the more complete row; ties break on the longer street address,
 * which is the better-formatted of the two in the recorded case. Deterministic
 * either way — INSPECTOR asserts on which survives.
 */
/**
 * §14.19: union the comps-search pool with the neighbourhood-sales payload
 * BEFORE the hard filters — the aggregate fetch is an exhausted 1-mile
 * 12-month universe, and the truncated comps fetch loses exactly the near
 * sales the ladder wants most. Unioned sales face EVERY gate identically;
 * nothing here bypasses a filter.
 *
 * Same-ZPID records collapse at union time with the PRIMARY (comps-search)
 * record winning — both payloads come from the same actor through the same
 * mapper, so the records are near-identical and the choice is a
 * deterministic tiebreak, not a data decision. Same-SALE-different-zpid
 * overlap (BUG-010's shape, this slice's main risk) is deliberately LEFT to
 * `dedupeSales`, which runs over the union inside selectTiers and inside
 * candidateMedianPpsf and reports DUPLICATE_SALE visibly.
 */
export function unionCandidatePools(primary: RawComp[], secondary: RawComp[] | null): RawComp[] {
  if (!secondary || secondary.length === 0) return primary;
  const seen = new Set(primary.map((c) => c.zpid));
  const merged = [...primary];
  for (const comp of secondary) {
    if (comp.zpid && seen.has(comp.zpid)) continue;
    if (comp.zpid) seen.add(comp.zpid);
    merged.push(comp);
  }
  return merged;
}

export function dedupeSales(comps: RawComp[]): { kept: RawComp[]; duplicates: RejectedComp[] } {
  const completeness = (c: RawComp): number =>
    [c.lotSize, c.beds, c.baths, c.detailUrl].filter((v) => v !== null && v !== undefined).length;

  const kept: RawComp[] = [];
  const duplicates: RejectedComp[] = [];

  for (const comp of comps) {
    const idx = kept.findIndex(
      (k) =>
        k.soldPrice === comp.soldPrice &&
        k.livingArea === comp.livingArea &&
        k.soldDate === comp.soldDate &&
        haversineMiles(k.lat, k.lng, comp.lat, comp.lng) <= DUPLICATE_COORD_TOLERANCE_MI,
    );
    if (idx === -1) {
      kept.push(comp);
      continue;
    }
    const incumbent = kept[idx];
    const challengerWins =
      completeness(comp) > completeness(incumbent) ||
      (completeness(comp) === completeness(incumbent) &&
        comp.address.length > incumbent.address.length);
    if (challengerWins) {
      kept[idx] = comp;
      duplicates.push({ comp: incumbent, reason: 'DUPLICATE_SALE' });
    } else {
      duplicates.push({ comp, reason: 'DUPLICATE_SALE' });
    }
  }
  return { kept, duplicates };
}
