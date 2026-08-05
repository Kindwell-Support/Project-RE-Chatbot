/**
 * ARV from ranked comps: trimmed-mean $/sqft × subject sqft (CONTRACT §5.5).
 *
 * Pure arithmetic, and every intermediate that the chat renders (what was
 * trimmed, the sd, the cv) is on the result object — the ARV must be
 * defensible line by line, never a black box.
 */
import { ARV_ROUND_TO, CONF_HIGH, CONF_MEDIUM, TRIM_FRACTION } from './config.js';
import { median } from './filter.js';
import type { ArvConfidence, ArvResult, ScoredComp, SubjectProperty } from './types.js';

export function pricePerSqft(soldPrice: number, livingArea: number): number {
  return soldPrice / livingArea;
}

/**
 * Sorted trim: with n >= 5, drop max(1, floor(n * TRIM_FRACTION)) from EACH
 * end; below 5 there is nothing safe to trim. Returns the removed values so
 * the render can say exactly which comps were excluded and from which end.
 */
export function trimmedMean(values: number[]): {
  mean: number;
  trimmedOut: number[];
  used: number[];
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const trimCount = n >= 5 ? Math.max(1, Math.floor(n * TRIM_FRACTION)) : 0;
  const used = sorted.slice(trimCount, n - trimCount);
  const trimmedOut = [...sorted.slice(0, trimCount), ...sorted.slice(n - trimCount)];
  const mean = used.reduce((sum, v) => sum + v, 0) / used.length;
  return { mean, trimmedOut, used };
}

/** Sample standard deviation (n − 1); 0 when fewer than 2 values (CONTRACT §5.5). */
function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function confidence(
  compsUsed: number,
  cv: number,
  medianDistanceMi: number,
  medianAgeMonths: number,
): ArvConfidence {
  if (
    compsUsed >= CONF_HIGH.minComps &&
    cv <= CONF_HIGH.maxCv &&
    medianDistanceMi <= CONF_HIGH.maxMedianDistanceMi &&
    medianAgeMonths <= CONF_HIGH.maxMedianAgeMonths
  ) {
    return 'high';
  }
  if (compsUsed >= CONF_MEDIUM.minComps && cv <= CONF_MEDIUM.maxCv) return 'medium';
  return 'low';
}

/**
 * `ranked` must be the post-filter, post-rank set (>= MIN_COMPS_TO_COMPUTE,
 * every comp with positive price and sqft) and the subject must have known
 * sqft — service.ts gates both before calling. Violations are programmer
 * errors, so they throw rather than fabricating a number.
 */
export function calculateArv(subject: SubjectProperty, ranked: ScoredComp[]): ArvResult {
  const subjectSqft = subject.livingArea ?? 0;
  if (subjectSqft <= 0) {
    throw new TypeError('calculateArv called with unknown subject sqft — service must gate SUBJECT_SQFT_UNKNOWN first');
  }
  if (ranked.length === 0) {
    throw new TypeError('calculateArv called with zero comps — service must gate TOO_FEW_COMPS first');
  }

  // Sort by ppsf (zpid tie-break) so trimmed VALUES map deterministically back
  // to the comps that carried them, even with duplicate ppsf.
  const byPpsf = [...ranked].sort(
    (a, b) => a.pricePerSqft - b.pricePerSqft || a.comp.zpid.localeCompare(b.comp.zpid),
  );
  const n = byPpsf.length;
  const trimCount = n >= 5 ? Math.max(1, Math.floor(n * TRIM_FRACTION)) : 0;
  const usedComps = byPpsf.slice(trimCount, n - trimCount);
  const trimmedOut: ArvResult['trimmedOut'] = [
    ...byPpsf.slice(0, trimCount).map((s) => ({
      zpid: s.comp.zpid,
      pricePerSqft: s.pricePerSqft,
      end: 'low' as const,
    })),
    ...byPpsf.slice(n - trimCount).map((s) => ({
      zpid: s.comp.zpid,
      pricePerSqft: s.pricePerSqft,
      end: 'high' as const,
    })),
  ];

  const usedPpsf = usedComps.map((s) => s.pricePerSqft);
  const arvPerSqft = usedPpsf.reduce((sum, v) => sum + v, 0) / usedPpsf.length;
  const sd = sampleStdDev(usedPpsf);
  const cv = sd / arvPerSqft;

  const arv = roundTo(arvPerSqft * subjectSqft, ARV_ROUND_TO);
  const band = roundTo(sd * subjectSqft, ARV_ROUND_TO);

  // Confidence medians run over the full kept/ranked set, not the trimmed one
  // (CONTRACT §5.5) — trimming is about price outliers, not about pretending
  // the far or stale comps aren't in the set.
  const medianDistanceMi = median(ranked.map((s) => s.distanceMi));
  const medianAgeMonths = median(ranked.map((s) => s.monthsAgo));

  return {
    arv,
    arvLow: arv - band,
    arvHigh: arv + band,
    arvPerSqft,
    sd,
    cv,
    confidence: confidence(ranked.length, cv, medianDistanceMi, medianAgeMonths),
    trimmedOut,
    compsUsed: ranked.length,
  };
}
