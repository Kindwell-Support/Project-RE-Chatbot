/**
 * Scoring + ranking (CONTRACT §5.4). Pure; `now` injected.
 *
 * Lower score = better comp. The four weighted components are exposed on the
 * result (`parts`) so a member — or the client — can ask "why is this comp
 * ranked above that one?" and get arithmetic, not vibes.
 */
import {
  COMPLETENESS_TIEBREAK_PER_FIELD,
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

  const parts = {
    distance: Math.min(distanceMi / DISTANCE_NORM_MI, 1) * WEIGHT_DISTANCE,
    sqft: Math.min(sqftFrac, 1) * WEIGHT_SQFT,
    lot: Math.min(lotFrac, 1) * WEIGHT_LOT,
    // max(…, 0) is BUG-003's defensive half: min() alone only capped the TOP
    // of the range, so a future-dated comp scored NEGATIVE and sorted ahead of
    // flawless comps — bad data promoted, not just tolerated. Rule 12 rejects
    // such comps at the filter; this keeps §5.4's 0-100 range structural no
    // matter what reaches the function.
    recency: Math.min(Math.max(monthsAgo, 0) / RECENCY_NORM_MONTHS, 1) * WEIGHT_RECENCY,
    bedbath: Math.min((Math.abs(dBeds) + Math.abs(dBaths)) / 2, 1) * WEIGHT_BEDBATH,
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
 * §14.20 (operator ruling): the ORDERING key. Null bed/bath diffs score 0
 * (the pin stands), but "unknown is not a penalty" must not become
 * "unknown is an advantage": a comp that disclosed a mismatch should not
 * lose to one that disclosed nothing. Each missing bed/bath field adds
 * COMPLETENESS_TIEBREAK_PER_FIELD to the comp's ordering key ONLY — the
 * score and its parts are untouched and still rendered/asserted as
 * computed. The shadow key makes the rule transitive and deterministic
 * (a pairwise within-margin comparator is not), and its effect is exactly
 * the ruling: within the margin, disclosure wins; beyond it, the better
 * score still wins.
 */
export function orderingKey(scored: ScoredComp): number {
  const missingFields = (scored.comp.beds === null ? 1 : 0) + (scored.comp.baths === null ? 1 : 0);
  return scored.score + missingFields * COMPLETENESS_TIEBREAK_PER_FIELD;
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
        orderingKey(a) - orderingKey(b) ||
        a.score - b.score ||
        a.distanceMi - b.distanceMi ||
        a.comp.zpid.localeCompare(b.comp.zpid),
    )
    .slice(0, MAX_COMPS_KEPT);
}
