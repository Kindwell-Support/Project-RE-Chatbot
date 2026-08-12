/**
 * Scoring + ranking (CONTRACT §5.4). Pure; `now` injected.
 *
 * Lower score = better comp. The four weighted components are exposed on the
 * result (`parts`) so a member — or the client — can ask "why is this comp
 * ranked above that one?" and get arithmetic, not vibes.
 */
import {
  ATTACHED_REDISTRIBUTION_FACTOR,
  ATTACHED_SUBJECT_TYPES,
  DISTANCE_NORM_MI,
  LOT_NORM_RATIO,
  MAX_COMPS_KEPT,
  RECENCY_NORM_MONTHS,
  SQFT_TOLERANCE,
  WEIGHT_BEDBATH,
  WEIGHT_DISTANCE,
  WEIGHT_LOT,
  WEIGHT_RECENCY,
  WEIGHT_SQFT,
} from './config.js';
import { haversineMiles, monthsBetween } from './filter.js';
import type { RawComp, ScoredComp, SubjectProperty } from './types.js';

export function scoreComp(subject: SubjectProperty, comp: RawComp, now: Date): ScoredComp {
  const distanceMi = haversineMiles(subject.lat, subject.lng, comp.lat, comp.lng);
  // Raw, deliberately: a negative value is the EVIDENCE that a comp is
  // future-dated, and hiding it here would mask what rule 12 rejects. The
  // BUG-003 clamp lives in the recency TERM below — the score range holds
  // structurally while the field stays honest.
  const monthsAgo = monthsBetween(comp.soldDate, now);
  const subjectSqft = subject.livingArea ?? 0;

  // Kept comps are guaranteed positive price/sqft by the hard filters, but
  // scoreComp is exported standalone — degrade to 0 rather than NaN so a
  // direct call on dirty data stays inspectable.
  const pricePerSqft =
    (comp.soldPrice ?? 0) > 0 && (comp.livingArea ?? 0) > 0
      ? (comp.soldPrice as number) / (comp.livingArea as number)
      : 0;

  const sqftFrac =
    subjectSqft > 0 && (comp.livingArea ?? 0) > 0
      ? Math.abs((comp.livingArea as number) - subjectSqft) / subjectSqft / SQFT_TOLERANCE
      : 1; // unknown sqft saturates the component

  // Null diffs count 0 (CONTRACT §5.4) — unknown is not a penalty.
  const dBeds = comp.beds !== null && subject.beds !== null ? comp.beds - subject.beds : 0;
  const dBaths = comp.baths !== null && subject.baths !== null ? comp.baths - subject.baths : 0;

  // Lot as a SOFT term (CONTRACT §14.3) — v1 rejected on it outright, which
  // decimated thin markets. Null lot on either side scores 0, exactly as null
  // beds/baths do: unknown is not a penalty.
  const lotFrac =
    (subject.lotSize ?? 0) > 0 && comp.lotSize !== null
      ? Math.abs(comp.lotSize - (subject.lotSize as number)) / (subject.lotSize as number) / LOT_NORM_RATIO
      : 0;

  const w = effectiveWeights(subject.propertyType);
  const parts = {
    distance: Math.min(distanceMi / DISTANCE_NORM_MI, 1) * w.distance,
    sqft: Math.min(sqftFrac, 1) * w.sqft,
    lot: Math.min(lotFrac, 1) * w.lot,
    // max(…, 0) is BUG-003's defensive half: min() alone only capped the TOP
    // of the range, so a future-dated comp scored NEGATIVE and sorted ahead of
    // flawless comps — bad data promoted, not just tolerated. Rule 12 rejects
    // such comps at the filter; this keeps §5.4's 0-100 range structural no
    // matter what reaches the function.
    recency: Math.min(Math.max(monthsAgo, 0) / RECENCY_NORM_MONTHS, 1) * w.recency,
    bedbath: Math.min((Math.abs(dBeds) + Math.abs(dBaths)) / 2, 1) * w.bedbath,
  };

  return {
    comp,
    distanceMi,
    monthsAgo,
    pricePerSqft,
    score: parts.distance + parts.sqft + parts.recency + parts.bedbath + parts.lot,
    parts,
  };
}

/**
 * §14.3 amendment (operator ruling): the weights BRANCH on the subject's
 * type. For ATTACHED subjects (CONDO/TOWNHOUSE) the lot weight is ZERO —
 * Zillow's parcel records for attached housing are inconsistent
 * (raw-verified: same-complex near-identical units at 684/1,202/2,276 sqft
 * lots), and a noisy soft term displaces signal from terms that are not —
 * with the 10 points redistributed PROPORTIONALLY across distance, sqft
 * and recency (each × 9/8, derived). SFR keeps the original weights: lot
 * is real there. Both branches total 100 — exported so it is asserted
 * directly, not inferred from score behaviour.
 */
export function effectiveWeights(subjectType: SubjectProperty['propertyType']): {
  distance: number;
  sqft: number;
  recency: number;
  bedbath: number;
  lot: number;
} {
  if (ATTACHED_SUBJECT_TYPES.includes(subjectType)) {
    return {
      distance: WEIGHT_DISTANCE * ATTACHED_REDISTRIBUTION_FACTOR,
      sqft: WEIGHT_SQFT * ATTACHED_REDISTRIBUTION_FACTOR,
      recency: WEIGHT_RECENCY * ATTACHED_REDISTRIBUTION_FACTOR,
      bedbath: WEIGHT_BEDBATH,
      lot: 0,
    };
  }
  return {
    distance: WEIGHT_DISTANCE,
    sqft: WEIGHT_SQFT,
    recency: WEIGHT_RECENCY,
    bedbath: WEIGHT_BEDBATH,
    lot: WEIGHT_LOT,
  };
}

/**
 * §14.20 (operator ruling): the ORDERING key. Null bed/bath diffs score 0
 * (the pin stands), but "unknown is not a penalty" must not become
 * "unknown is an advantage": a comp that disclosed a mismatch should not
 * lose to one that disclosed nothing. Each CHARGEABLE missing bed/bath
 * field adds the derived margin to the comp's ordering key ONLY — the
 * score and its parts are untouched and still rendered/asserted as
 * computed. The shadow key makes the rule transitive and deterministic
 * (a pairwise within-margin comparator is not), and its effect is exactly
 * the ruling: within the margin, disclosure wins; beyond it, the better
 * score still wins.
 */
export function orderingKey(scored: ScoredComp, subject: SubjectProperty): number {
  // FINDING-013: charge the margin only where disclosure COULD have changed
  // the score. scoreComp zeroes the term when EITHER side is null, so
  // against a bedless subject a comp's missing beds conceals nothing — an
  // unconditional charge was an unearned demotion deciding which five
  // survive the cap. A comp field counts as missing only if the SUBJECT
  // has that field.
  //
  // The margin derives from effectiveWeights (FINDING-013's second half),
  // not WEIGHT_BEDBATH: the two agree today only because the §14.3
  // redistribution skipped bedbath, and a future branch-specific
  // re-weighting must not leave the tie-breaker right for SFR and silently
  // wrong for CONDO. Same derivation: one disclosed field's maximum
  // contribution is bedbath/2 (a kept comp's per-field diff is gate-capped
  // at 1), so one hidden field conceals at most — and can reach — exactly
  // that; two compound to bedbath without the clamp saturating.
  const marginPerField = effectiveWeights(subject.propertyType).bedbath / 2;
  const missingFields =
    (subject.beds !== null && scored.comp.beds === null ? 1 : 0) +
    (subject.baths !== null && scored.comp.baths === null ? 1 : 0);
  return scored.score + missingFields * marginPerField;
}

/**
 * Score, sort ascending BY ORDERING KEY (§14.20), cap at MAX_COMPS_KEPT.
 * Ties break by raw score, then distance asc, then zpid asc (CONTRACT
 * §5.4) so identical inputs always produce the identical list —
 * determinism is a feature, INSPECTOR asserts on it.
 */
export function rankComps(subject: SubjectProperty, kept: RawComp[], now: Date): ScoredComp[] {
  return kept
    .map((comp) => scoreComp(subject, comp, now))
    .sort(
      (a, b) =>
        orderingKey(a, subject) - orderingKey(b, subject) ||
        a.score - b.score ||
        a.distanceMi - b.distanceMi ||
        a.comp.zpid.localeCompare(b.comp.zpid),
    )
    .slice(0, MAX_COMPS_KEPT);
}
