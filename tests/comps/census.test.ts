/**
 * CENSUS DEMOGRAPHICS — CONTRACT §14.10 + the operator's four guarantees.
 * Written BEFORE the build, from the ruling, so the shape is pinned by
 * intent rather than by whatever the ACS adapter happens to return.
 *
 * The four:
 *   1. a Census failure is NON-FATAL — comps render in full, the section
 *      says unavailable
 *   2. never infer a figure the API did not return
 *   3. suppressed or missing values render UNAVAILABLE, never zero
 *   4. every figure names its GEOGRAPHY and its VINTAGE
 *
 * WHY (3) IS THE ONE THAT WILL BITE. The ACS API does not omit unavailable
 * values — it returns negative sentinels in the same numeric field:
 *
 *     -666666666  estimate not computable for this geography
 *     -999999999  suppressed (too few samples to publish)
 *     -888888888  not applicable
 *     -222222222  too few samples for a reliable estimate
 *
 * These are the `daysOnZillow: -1` class exactly, and this project has already
 * shipped that class once. Two ways to get it wrong and both are worse than
 * silence: pass it through and render "median household income −$666,666,666",
 * or coalesce with `|| 0` and render "$0" — a real-looking figure claiming a
 * neighbourhood has no income. Unavailable is the only honest render.
 *
 * WHY (4) IS NOT COSMETIC. A tract is a few thousand people. A figure from the
 * NEIGHBOURING tract is a confident, invisible, wrong fact about the member's
 * property — the wrong-house bug in demographic clothing. Naming the geography
 * is what makes it checkable. And ACS 5-year estimates lag ~2 years, so an
 * unvintaged figure reads as current when it is not; a member cannot verify a
 * number without knowing which release it came from.
 *
 * CONTRACT GAP, raised in the mailbox: §14.10 carries guarantees 1 and 2 but
 * NOT 3 and 4. They are the operator's ruling and are pinned here; they need a
 * CONTRACT_CHANGE to become binding, and the contract is the referee.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';

const MODS = ['census'] as const;

/**
 * The ACS sentinel set. Kept as data, not scattered through cases, so adding a
 * newly-observed sentinel extends every test at once.
 */
const ACS_SENTINELS = [-666666666, -999999999, -888888888, -222222222] as const;

describe(`census demographics${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('suppressed and missing values (guarantee 3)', () => {
    it.each(ACS_SENTINELS)('the %i sentinel renders UNAVAILABLE, never a number', async (sentinel) => {
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      const out = mapCensusFigures({ medianHouseholdIncome: sentinel } as never);
      expect(
        out.medianHouseholdIncome,
        `the ACS sentinel ${sentinel} was carried through as a value — it renders ` +
          'as a real dollar figure to the member',
      ).toBeNull();
    });

    it('a sentinel is not coalesced to ZERO — that is a worse lie than a dash', async () => {
      // `value || 0` and `value ?? 0` both produce "$0", which reads as a
      // measured fact: this neighbourhood has no income / nobody owns their
      // home. Null is the only honest mapping.
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      for (const sentinel of ACS_SENTINELS) {
        const out = mapCensusFigures({
          medianHouseholdIncome: sentinel,
          medianAge: sentinel,
          ownerOccupiedPct: sentinel,
        } as never);
        for (const [k, v] of Object.entries(out)) {
          if (typeof v === 'number') {
            expect(v, `${k} became ${v} from sentinel ${sentinel}`).not.toBe(0);
          }
        }
      }
    });

    it('a genuine ZERO is still a value', async () => {
      // The inverse trap, and the one that a too-eager sentinel filter creates.
      // 0% owner-occupied is real in a tract that is all rentals.
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      const out = mapCensusFigures({ ownerOccupiedPct: 0 } as never);
      expect(out.ownerOccupiedPct, 'a real 0% was discarded as if it were a sentinel').toBe(0);
    });

    it('an ABSENT field is null, not zero and not omitted', async () => {
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      const out = mapCensusFigures({} as never);
      for (const [k, v] of Object.entries(out)) {
        if (k === 'geography' || k === 'vintage') continue;
        expect(v, `${k} was invented from an absent field`).toBeNull();
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('nothing is inferred (guarantee 2)', () => {
    it('no figure is derived from another figure', async () => {
      // The tempting inference: renterPct = 100 - ownerOccupiedPct. It is
      // arithmetic, it looks free, and it is wrong whenever the ACS
      // denominator differs (vacant units are neither). A derived figure the
      // API did not return is indistinguishable from one it did.
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      const out = mapCensusFigures({ ownerOccupiedPct: 62 } as never);
      const values = Object.entries(out)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k}=${v}`);
      expect(values, 'a second figure appeared from a single returned field')
        .toEqual(['ownerOccupiedPct=62']);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('every figure names geography and vintage (guarantee 4)', () => {
    it('the mapped result carries both, and they are not blank', async () => {
      const { mapCensusFigures } = await import('../../src/features/comps/census.js');
      const out = mapCensusFigures({
        medianHouseholdIncome: 74500,
        geography: 'Census Tract 1132.04, Maricopa County, AZ',
        vintage: 'ACS 2019-2023 5-Year Estimates',
      } as never);
      expect(String(out.geography ?? ''), 'the figure names no geography').toContain('Tract');
      expect(String(out.vintage ?? ''), 'the figure names no vintage').toMatch(/\d{4}/);
    });

    it('a figure WITHOUT a vintage does not render — same rule as an unlabelled ARV', async () => {
      // BUG-008's shape, one surface over. A number the member did not supply,
      // shown with nothing saying where or when it came from, is a number they
      // will treat as current and local. If the provenance cannot render, the
      // figure must not render.
      const { renderCensusSection } = await import('../../src/features/comps/census.js');
      const text = renderCensusSection({
        medianHouseholdIncome: 74500,
        geography: 'Census Tract 1132.04, Maricopa County, AZ',
        vintage: null,
      } as never);
      expect(String(text ?? ''), 'a demographic figure rendered with no vintage')
        .not.toContain('74,500');
    });

    it('a figure WITHOUT a geography does not render either', async () => {
      const { renderCensusSection } = await import('../../src/features/comps/census.js');
      const text = renderCensusSection({
        medianHouseholdIncome: 74500,
        geography: null,
        vintage: 'ACS 2019-2023 5-Year Estimates',
      } as never);
      expect(String(text ?? ''), 'a demographic figure rendered with no geography')
        .not.toContain('74,500');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('failure is NON-FATAL (guarantee 1)', () => {
    it('the section says unavailable rather than vanishing', async () => {
      // A section that disappears on failure is indistinguishable from a
      // section that was never requested. The member cannot tell "we could not
      // get this" from "this does not exist", and only one of those is worth
      // retrying.
      const { renderCensusSection } = await import('../../src/features/comps/census.js');
      const text = String(renderCensusSection(null as never) ?? '');
      expect(text.length, 'the section vanished entirely on failure').toBeGreaterThan(0);
      expect(text.toLowerCase(), 'the failure does not say it is unavailable')
        .toMatch(/unavailable|couldn't|could not|not available/);
      expect(text, 'a figure appeared in a FAILED section').not.toMatch(/\$\s?\d/);
    });
  });
});
