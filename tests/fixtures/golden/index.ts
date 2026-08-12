/**
 * Golden dataset — the cases whose answers were computed by hand from
 * CONTRACT.md before any implementation existed.
 *
 * See README.md in this directory for how to audit a case and what the fields
 * mean. The one-line version: if the code disagrees with a number in here, do
 * not change the number until you have re-done the arithmetic in the file
 * header and found it wrong.
 */
export * from './types.js';

export { golden01, golden01UndetectedByThisCase } from './golden-01-clean-8.js';
export { golden02, golden02UntrimmedArv } from './golden-02-outlier-6.js';
export { golden03, golden03PopulationSdBand } from './golden-03-thin-3.js';
export { golden04, golden04ConfidenceByReading } from './golden-04-boundary-5.js';
export { golden05, golden05Empty } from './golden-05-too-few-2.js';
export { golden06, golden06MeanInsteadOfMedian } from './golden-06-non-arms-length-order.js';

import type { GoldenCase } from './types.js';
import { golden01 } from './golden-01-clean-8.js';
import { golden02 } from './golden-02-outlier-6.js';
import { golden03 } from './golden-03-thin-3.js';
import { golden04 } from './golden-04-boundary-5.js';
import { golden05, golden05Empty } from './golden-05-too-few-2.js';
import { golden06 } from './golden-06-non-arms-length-order.js';

/** Every case, for table-driven suites. */
export const GOLDEN_CASES: GoldenCase[] = [
  golden01,
  golden02,
  golden03,
  golden04,
  golden05,
  golden05Empty,
  golden06,
];

/** Cases that must produce an ARV. */
export const GOLDEN_SUCCESS_CASES: GoldenCase[] = GOLDEN_CASES.filter((c) => c.expected.ok);

/** Cases that must refuse to produce one. */
export const GOLDEN_FAILURE_CASES: GoldenCase[] = GOLDEN_CASES.filter((c) => !c.expected.ok);

/**
 * At-a-glance summary. Kept in sync by hand with the case files, and asserted
 * against them in `tests/comps/golden.selfcheck.test.ts` so it cannot rot.
 *
 * | case | n kept | trimCount | ARV      | low / high        | conf   | tier |
 * |------|--------|-----------|----------|-------------------|--------|------|
 * v2 (§14). Tier column is radius mi / recency months.
 * | 01   | 5      | 1         | 405,000  | 392,000 / 418,000 | high   | 1.0/3  |
 * | 02   | 5      | 1         | 430,000  | 410,000 / 450,000 | high   | 1.0/3  |
 * | 03   | 3      | 0         | 420,000  | 367,000 / 473,000 | low    | 3.0/12 |
 * | 04   | 5      | 1         | 400,000  | 380,000 / 420,000 | high   | 1.0/6  |
 * | 05   | 2      | —         | none     | —                 | —      | 3.0/12 |
 * | 05b  | 0      | —         | none     | —                 | —      | 3.0/12 |
 * | 06   | 3      | 0         | 380,000  | 350,000 / 410,000 | low    | 3.0/12 |
 */
export const GOLDEN_SUMMARY = [
  { id: 'golden-01-clean-8', kept: 5, trimCount: 1, arv: 405000, tier: 1.0 },
  { id: 'golden-02-outlier-6', kept: 5, trimCount: 1, arv: 430000, tier: 1.0 },
  { id: 'golden-03-thin-3', kept: 3, trimCount: 0, arv: 420000, tier: 3.0 },
  { id: 'golden-04-boundary-5', kept: 5, trimCount: 1, arv: 400000, tier: 1.0 },
  { id: 'golden-05-too-few-2', kept: 2, trimCount: null, arv: null, tier: 3.0 },
  { id: 'golden-05b-empty', kept: 0, trimCount: null, arv: null, tier: 3.0 },
  { id: 'golden-06-non-arms-length-order', kept: 3, trimCount: 0, arv: 380000, tier: 3.0 },
] as const;
