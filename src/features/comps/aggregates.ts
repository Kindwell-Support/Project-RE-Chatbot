/**
 * Neighbourhood sales aggregates (CONTRACT §14.16/.1) — pure,
 * offline-testable. Order is contract-bound and each step exists for a
 * recorded reason:
 *
 *   1. SOLD + computable in-window soldDate + inside the CIRCLE (haversine
 *      ≤ radius) — never the bounding box: the spike recorded 40 of 233
 *      sales living in the box corners, and counting them misstates "within
 *      1 mile" on every figure at once.
 *   2. dedupeSales BEFORE any average (BUG-010: one sale under two zpids
 *      sat in a recorded pool; undeduped it double-counts totalSales and
 *      double-weights every mean).
 *   3. Averages — with the SPAN actually covered (earliest/latest sale)
 *      carried on the result, because a truncated window produces plausible
 *      figures and only the span exposes it.
 *
 * DOM is Ruling 2: the mean over the DISPLAYED comps' detail, never the
 * neighbourhood pool — a pool-derived DOM would need a detail run per sale
 * and, silently substituted, nothing about the number would look wrong.
 */
import {
  NEIGHBORHOOD_RADIUS_MI,
  NEIGHBORHOOD_RESULTS_LIMIT,
  NEIGHBORHOOD_WINDOW_MONTHS,
} from './config.js';
import { dedupeSales, haversineMiles, monthsBetween } from './filter.js';
import type { NeighborhoodAggregates, RawComp, ScoredComp, SubjectProperty } from './types.js';

const mean = (xs: number[]): number | null =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
const roundWhole = (v: number | null): number | null => (v === null ? null : Math.round(v));

/**
 * The cap-detection invariant (INSPECTOR's CASE 3; §14.17 amends the
 * boundary). The fetch returning AT OR NEAR its own limit means there is
 * almost certainly older data we did not get — the window cannot honestly
 * be called 12 months, and the render labels the actual span instead.
 *
 * NEAR, not exactly at, and the slack is RECORDED evidence, not caution
 * (spike-comps-3mi-doz12.json): the dense Tempe fetch at limit 500
 * returned 499 RAW items spanning 3.6 months — plainly truncated (317
 * sales sat in the newest 3 months alone), yet `>= limit` misses it by
 * one. The actor's own dedupe jitters the raw count, and the caller often
 * holds the MAPPED count, which sits a further ~3–7% under raw (recorded
 * skip rates). TRUNCATION_DETECT_FRACTION covers both. The error
 * direction is deliberate: a false positive relabels the window to the
 * honest actual span; a false negative ships a 12-month claim over weeks
 * of data — the exact bug this predicate exists to stop.
 */
export const TRUNCATION_DETECT_FRACTION = 0.9;

export function isWindowTruncated(fetchReturnedCount: number, resultsLimit: number = NEIGHBORHOOD_RESULTS_LIMIT): boolean {
  return fetchReturnedCount >= resultsLimit * TRUNCATION_DETECT_FRACTION;
}

export function computeNeighborhoodAggregates(
  sales: RawComp[],
  subject: SubjectProperty,
  displayedComps: ScoredComp[],
  now: Date,
): NeighborhoodAggregates {
  // 1. The aggregate set: sold, in-window, in-CIRCLE.
  const inSet = sales.filter((s) => {
    if (s.status.toUpperCase() !== 'SOLD') return false;
    if (!s.soldDate) return false;
    const months = monthsBetween(s.soldDate, now);
    if (months < 0 || months > NEIGHBORHOOD_WINDOW_MONTHS) return false;
    return haversineMiles(subject.lat, subject.lng, s.lat, s.lng) <= NEIGHBORHOOD_RADIUS_MI;
  });

  // 2. Dedupe BEFORE any average (§14.16 Ruling 1).
  const { kept } = dedupeSales(inSet);

  // 3. Averages over the deduped set; empty subsets are null, never 0.
  const prices = kept.map((s) => s.soldPrice).filter((p): p is number => p !== null && p > 0);
  const ppsf = kept
    .filter((s) => (s.soldPrice ?? 0) > 0 && (s.livingArea ?? 0) > 0)
    .map((s) => (s.soldPrice as number) / (s.livingArea as number));
  const beds = kept.map((s) => s.beds).filter((b): b is number => b !== null);
  const baths = kept.map((s) => s.baths).filter((b): b is number => b !== null);
  const dates = kept
    .map((s) => s.soldDate)
    .filter((d): d is string => d !== null)
    .sort();

  // DOM (Ruling 2): the DISPLAYED comps' detail only.
  const doms = displayedComps
    .map((c) => c.detail?.daysOnMarket)
    .filter((d): d is number => d !== null && d !== undefined);

  return {
    radiusMi: NEIGHBORHOOD_RADIUS_MI,
    windowMonths: NEIGHBORHOOD_WINDOW_MONTHS,
    windowTruncated: isWindowTruncated(sales.length),
    totalSales: kept.length,
    avgSoldPrice: roundWhole(mean(prices)),
    avgPricePerSqft: roundWhole(mean(ppsf)), // mean of per-sale ratios, never ratio of means
    avgBeds: round1(mean(beds)),
    avgBaths: round1(mean(baths)),
    earliestSaleDate: dates.length > 0 ? dates[0] : null,
    latestSaleDate: dates.length > 0 ? dates[dates.length - 1] : null,
    avgDomOfDisplayedComps: roundWhole(mean(doms)),
    domCompCount: doms.length,
  };
}
