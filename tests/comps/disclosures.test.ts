/**
 * §14.21 thin-market and §14.23 price-outlier disclosures — RULING 2 and the
 * final slice.
 *
 * BOTH ARE DISCLOSURE ONLY. Nothing re-ranks, excludes or rescales, so the
 * strongest available assertion is also the cheapest: render with the trigger
 * firing and with it forced off, and the difference must be EXACTLY the copy.
 * That catches a disclosure implemented by re-running the pipeline with
 * different parameters — which would pass every content assertion while
 * quietly changing which comps a member sees.
 *
 * ON THE RULING 2 THRESHOLD. I raised that the operator's discriminator kills
 * any spread-based trigger: Mesquite $138–276 and Grandview $215–364 have
 * absolute spreads of $138 and $149, so GRANDVIEW'S IS WIDER, and by ratio it
 * is 2.00 vs 1.69 — a 0.31 band to sit in. MASON's build does not use spread
 * at all. The trigger is composite and structural (rung exceeded 1 mile AND
 * fewer than 3 in-band same-type sales inside it), and the ppsf range is
 * quoted as a FACT rather than used as the signal. That is the right shape:
 * the two rows differ in geography, not in dispersion, and the trigger now
 * keys on the thing that actually differs.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import { selectTiers } from '../../src/features/comps/filter.js';
import { rankComps } from '../../src/features/comps/rank.js';
import {
  ALGO_VERSION,
  MIN_COMPS_TO_COMPUTE,
  NEIGHBORHOOD_RADIUS_MI,
  OUTLIER_PPSF_RATIO,
  OUTLIER_REFERENCE_MIN_COUNT,
} from '../../src/features/comps/config.js';
import { golden01, type GoldenCase } from '../fixtures/golden/index.js';

const MODS = ['format', 'config'] as const;

/** A real CompsResult through the real pipeline, with the §14.21/§14.23 fields open. */
function resultFor(gc: GoldenCase, extra: Record<string, unknown> = {}) {
  const tier = selectTiers(gc.subject as never, gc.comps as never, gc.now);
  return {
    ok: true as const,
    algoVersion: ALGO_VERSION,
    runId: 'run-fixed-for-determinism',
    subject: gc.subject,
    radiusTierMi: tier.radiusTierMi,
    recencyTierMonths: tier.recencyTierMonths,
    comps: rankComps(gc.subject as never, tier.kept, gc.now),
    rejected: tier.rejected,
    fromCache: false,
    provider: 'stub',
    nearInBandSameTypeSales: 40,
    nearInBandMedianPpsf: null,
    nearInBandPpsfCount: 0,
    ...extra,
  };
}
const render = (extra: Record<string, unknown> = {}) =>
  String(renderCompsForChat(resultFor(golden01, extra) as never));

/** Lines present with the disclosure on but absent with it off. */
const addedLines = (on: string, off: string) => {
  const offLines = new Set(off.split('\n'));
  return on.split('\n').filter((l) => !offLines.has(l) && l.trim() !== '');
};

describe(`disclosure slices${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('§14.21 — RULING 2, the operator matrix', () => {
    // Mesquite: served at 3 mi, 2 in-band same-type sales inside 1 mile.
    const MESQUITE = { radiusTierMi: 3, nearInBandSameTypeSales: 2 };
    // Grandview: served at 1 mi, 47 of them. Both signals fail.
    const GRANDVIEW = { radiusTierMi: 1, nearInBandSameTypeSales: 47 };

    it('MESQUITE fires', () => {
      expect(
        render(MESQUITE),
        'the thin-market row does not disclose — a member is handed cross-city ' +
          'comps with nothing saying so',
      ).toMatch(/only 2 comparable sales .* closed within 1 mile/);
    });

    it('GRANDVIEW is SILENT — the half of the matrix that constrains the trigger', () => {
      // The operator's instruction, and the reason it matters more than the
      // firing row: a trigger that fires on everything also "passes" Mesquite.
      // Grandview is genuinely good — sub-mile, 47 sales — and a note telling
      // that member their market is thin is a false alarm on a normal lookup.
      expect(
        render(GRANDVIEW),
        'the disclosure fired on a dense sub-mile set. Whatever the trigger is ' +
          'keyed to, it is not thinness.',
      ).not.toMatch(/A note on this set/);
    });

    it('the trigger is genuinely COMPOSITE — neither signal fires alone', () => {
      // The structural claim behind the matrix, asserted rather than inferred
      // from two rows that happen to differ on both axes at once. Each signal
      // is isolated against the other's silent value.
      expect(
        render({ radiusTierMi: 3, nearInBandSameTypeSales: MIN_COMPS_TO_COMPUTE }),
        'a WIDE rung alone fired the disclosure. A rural set with plenty of ' +
          'nearby in-band sales is not a thin market — that is the Don Frank ' +
          'control, and it would false-alarm on every rural lookup.',
      ).not.toMatch(/A note on this set/);
      expect(
        render({ radiusTierMi: NEIGHBORHOOD_RADIUS_MI, nearInBandSameTypeSales: 1 }),
        'a LOW near-count alone fired the disclosure while the set was served ' +
          'from inside a mile — the comps are local, so the note would ' +
          'contradict the block it sits under',
      ).not.toMatch(/A note on this set/);
    });

    it('DISCLOSURE ONLY: the comp set is byte-identical either way', () => {
      const on = render(MESQUITE);
      const off = render({ ...MESQUITE, nearInBandSameTypeSales: 40 });
      const added = addedLines(on, off);
      expect(added.length, 'the disclosure added more than one line').toBe(1);
      expect(added[0], 'the added line is not the disclosure').toMatch(/A note on this set/);
      // And nothing was REMOVED or reordered — the difference is one-way.
      expect(
        addedLines(off, on),
        'firing the disclosure REMOVED or changed a line. It is copy only, so ' +
          'anything else means the pipeline ran differently.',
      ).toEqual([]);
    });

    it('the copy carries no em dash — §14.5 marker exclusivity', () => {
      // MASON caught one in his own draft of this line and fixed it to a
      // semicolon. Pinned so it cannot come back: the em dash means "value
      // missing" everywhere in this block, and a decorative one in prose
      // teaches a member to read a real gap as punctuation.
      const line = render(MESQUITE).split('\n').find((l) => l.includes('A note on this set')) ?? '';
      expect(line, 'the disclosure line did not render').not.toBe('');
      expect(line, 'an em dash appears as PUNCTUATION in the disclosure copy')
        .not.toContain('—');
    });

    it('singular when exactly one sale — the copy agrees with its own number', () => {
      expect(render({ radiusTierMi: 3, nearInBandSameTypeSales: 1 }))
        .toMatch(/only 1 comparable sale of/);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('§14.23 — the price-outlier disclosure', () => {
    /** Force the fallback path: pool count below the floor. */
    const FALLBACK = { nearInBandPpsfCount: OUTLIER_REFERENCE_MIN_COUNT - 1, nearInBandMedianPpsf: 700 };

    it('a normal set discloses nothing', () => {
      // The precondition for every case below: golden01 is an ordinary set, so
      // any line here is a false positive and the rest of this block would be
      // measuring noise.
      expect(
        render(),
        'the outlier disclosure fires on an ordinary set',
      ).not.toMatch(/weigh its price accordingly/);
    });

    it('the POOL reference is used when its sample clears the floor, and named honestly', () => {
      // A pool median far below the set forces every comp over the high band.
      const out = render({
        nearInBandPpsfCount: OUTLIER_REFERENCE_MIN_COUNT,
        nearInBandMedianPpsf: 50,
      });
      expect(out, 'no outlier line fired against a wildly low pool median')
        .toMatch(/weigh its price accordingly/);
      expect(out, 'the pool reference is not described as a neighbourhood figure')
        .toMatch(/a neighbourhood median of \$[\d,]+\/sqft for this home's type and size/);
    });

    it('the FALLBACK reference must NEVER claim to be a neighbourhood figure', () => {
      // Guarantee 4, and the one wrong word that would break it. The fallback
      // is the median of the OTHER comps in this set — a handful of houses,
      // not a neighbourhood. Calling it one would be BUG-008's class: a figure
      // whose provenance label overstates what produced it.
      const base = resultFor(golden01, FALLBACK) as { comps: Array<{ pricePerSqft: number }> };
      const others = base.comps.slice(1).map((c) => c.pricePerSqft);
      const withOutlier = {
        ...base,
        comps: base.comps.map((c, i) =>
          i === 0 ? { ...c, pricePerSqft: Math.max(...others) * 4 } : c,
        ),
      };
      const out = String(renderCompsForChat(withOutlier as never));
      const lines = out.split('\n').filter((l) => /weigh its price accordingly/.test(l));
      expect(lines.length, 'no fallback line fired, so its wording is untested')
        .toBeGreaterThan(0);
      for (const l of lines) {
        expect(l, `the fallback line claims a neighbourhood provenance: ${l}`)
          .not.toMatch(/neighbourhood/i);
      }
    });

    it('the band is TWO-SIDED — a LOW outlier discloses too', () => {
      // The 0.4x-0.625x gap the ruling exists to cover: NON_ARMS_LENGTH
      // excludes below 0.4x and nothing else was watching underneath.
      const base = resultFor(golden01, FALLBACK) as { comps: Array<{ pricePerSqft: number }> };
      const ref = base.comps[1].pricePerSqft;
      const low = {
        ...base,
        comps: base.comps.map((c, i) =>
          i === 0 ? { ...c, pricePerSqft: ref / (OUTLIER_PPSF_RATIO * 1.2) } : c,
        ),
      };
      expect(
        String(renderCompsForChat(low as never)),
        'a comp priced far BELOW its peers passed silently — the low side of ' +
          'the two-sided band is not wired',
      ).toMatch(/weigh its price accordingly/);
    });

    it('LEAVE-ONE-OUT: a comp cannot drag its own reference', () => {
      // Coronado's 655 among 198-465 is why. If the reference included the
      // comp under test, a single extreme comp would pull the median toward
      // itself and could hide behind it — the disclosure would go quiet on
      // exactly the set that needs it most.
      const base = resultFor(golden01, FALLBACK) as { comps: Array<{ pricePerSqft: number }> };
      const others = base.comps.slice(1).map((c) => c.pricePerSqft);
      const extreme = Math.max(...others) * 4;
      const dragged = {
        ...base,
        comps: base.comps.map((c, i) => (i === 0 ? { ...c, pricePerSqft: extreme } : c)),
      };
      expect(
        String(renderCompsForChat(dragged as never)),
        'an extreme comp did not disclose. If the reference is the median of ' +
          'ALL comps including itself, the worst outlier in a small set moves ' +
          'the median far enough to clear its own band.',
      ).toMatch(/Comp 1 sold at/);
    });

    it('DISCLOSURE ONLY: byte-identical with the lines stripped', () => {
      const on = render({ nearInBandPpsfCount: OUTLIER_REFERENCE_MIN_COUNT, nearInBandMedianPpsf: 50 });
      const off = render();
      const added = addedLines(on, off);
      expect(added.length, 'nothing was added — the case is vacuous').toBeGreaterThan(0);
      for (const l of added) {
        expect(l, `a non-disclosure line changed: ${l}`).toMatch(/weigh its price accordingly/);
      }
      expect(
        addedLines(off, on),
        'firing the outlier disclosure REMOVED or altered a line — it is copy only',
      ).toEqual([]);
    });

    it('no em dash in the outlier copy either', () => {
      const on = render({ nearInBandPpsfCount: OUTLIER_REFERENCE_MIN_COUNT, nearInBandMedianPpsf: 50 });
      for (const l of on.split('\n').filter((x) => /weigh its price accordingly/.test(x))) {
        expect(l, 'an em dash appears as punctuation in the outlier copy')
          .not.toContain('—');
      }
    });
  });
});
