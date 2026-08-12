/**
 * The golden fixture HEADERS must agree with the golden fixture DATA.
 *
 * Every golden file carries a hand-derivation in its header comment, and the
 * charter's whole method rests on it: "read the header of the fixture file, not
 * the test, to check the arithmetic." That only holds if the header describes
 * the data that is actually in the file.
 *
 * It stopped holding. The v2 re-spread (cd2ec42) changed comp prices and sizes
 * and left the STEP 3 tables in the headers describing the v1 numbers — so
 * golden 01's header claimed `G1-C5 344,000 / 1,600 = 215` while the fixture
 * below it held 348,800 / 1,600 = 218. Nothing failed. The arithmetic of record
 * quietly stopped matching the record.
 *
 * A one-time correction fixes today and not the next re-spread, so this is
 * structural instead: the STEP 3 table is parsed straight out of the comment
 * and checked against the objects. A header that drifts now fails.
 *
 * Scope is deliberately narrow — the per-comp `$/sqft` lines only. They are
 * mechanically checkable and they are the figures the member is shown. The
 * prose reasoning around them still has to be read by a human.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { GOLDEN_CASES } from '../fixtures/golden/index.js';

const MODS = ['config'] as const;

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '..', 'fixtures', 'golden');

/** `*   G1-C1  400,000 / 2,000 = 200` */
const PPSF_LINE = /^\s*\*\s+(G\d+-[A-Z0-9]+)\s+([\d,]+)\s*\/\s*([\d,]+)\s*=\s*([\d.]+)(?:\s|$)/gm;

const num = (t: string) => Number(t.replace(/,/g, ''));

interface HeaderClaim {
  zpid: string; price: number; sqft: number; ppsf: number; line: string;
}

function claimsIn(file: string): HeaderClaim[] {
  const src = readFileSync(join(GOLDEN_DIR, file), 'utf8');
  const header = src.slice(0, src.indexOf('*/') + 2);
  return [...header.matchAll(PPSF_LINE)].map((m) => ({
    zpid: m[1], price: num(m[2]), sqft: num(m[3]), ppsf: Number(m[4]),
    line: m[0].trim(),
  }));
}

const FILES: Array<[string, string]> = [
  ['golden-01-clean-8', 'golden-01-clean-8.ts'],
  ['golden-02-outlier-6', 'golden-02-outlier-6.ts'],
  ['golden-03-thin-3', 'golden-03-thin-3.ts'],
  ['golden-04-boundary-5', 'golden-04-boundary-5.ts'],
  ['golden-05-too-few-2', 'golden-05-too-few-2.ts'],
  ['golden-06-non-arms-length-order', 'golden-06-non-arms-length-order.ts'],
];

describe(`golden headers describe the golden data${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('the STEP 3 $/sqft table is not prose', () => {
    it.each(FILES)('%s', (id, file) => {
      const claims = claimsIn(file);

      // POSITIVE PRECONDITION. A header whose table was deleted, or whose
      // formatting drifted past the regex, would pass every check below by
      // having nothing to check. Every golden file has a per-comp table.
      expect(claims.length, `no $/sqft table found in the header of ${file} — ` +
        'either it was removed or its formatting no longer matches the parser')
        .toBeGreaterThanOrEqual(2);

      const comps = new Map(
        GOLDEN_CASES.filter((c) => c.id === id)
          .flatMap((c) => c.comps)
          .map((c) => [c.zpid, c]),
      );
      expect(comps.size, `no comps loaded for ${id}`).toBeGreaterThan(0);

      for (const claim of claims) {
        const comp = comps.get(claim.zpid);
        expect(comp, `the header of ${file} derives ${claim.zpid}, which is not in the fixture`)
          .toBeDefined();

        expect(
          comp!.soldPrice,
          `${file} header says "${claim.line}" but the fixture has soldPrice ${comp!.soldPrice}`,
        ).toBe(claim.price);

        expect(
          comp!.livingArea,
          `${file} header says "${claim.line}" but the fixture has livingArea ${comp!.livingArea}`,
        ).toBe(claim.sqft);

        // ...and the arithmetic ON the header's own numbers has to be right
        // too, which is a different failure: a correct price and sqft with a
        // miscomputed quotient means the derivation below it is built on sand.
        expect(
          claim.price / claim.sqft,
          `${file} header states "${claim.line}" but ${claim.price} / ${claim.sqft} ` +
            `= ${(claim.price / claim.sqft).toFixed(4)}`,
        ).toBeCloseTo(claim.ppsf, 6);
      }
    });

    it('every comp in every fixture is derived in its header, not just some', () => {
      // Partial coverage is how the drift got in: C5 and C6 were re-spread and
      // their header lines were not, while their neighbours matched and made
      // the table look maintained.
      for (const [id, file] of FILES) {
        const gc = GOLDEN_CASES.find((c) => c.id === id)!;
        const derived = new Set(claimsIn(file).map((c) => c.zpid));
        // Only comps with a computable $/sqft can appear in the table.
        const computable = gc.comps.filter(
          (c) => (c.soldPrice ?? 0) > 0 && (c.livingArea ?? 0) > 0,
        );
        for (const c of computable) {
          expect(
            derived.has(c.zpid),
            `${file}: ${c.zpid} exists in the fixture but is not derived in the header`,
          ).toBe(true);
        }
      }
    });
  });
});
