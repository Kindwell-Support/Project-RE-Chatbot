/**
 * §14.20 — the completeness tie-breaker. Landed at ALGO_VERSION 6; the
 * version is deliberately NOT pinned in these assertions, because §14.3's
 * attached-lot amendment took it to 7 while this file was being written and a
 * hard-coded 6 would have gone stale within the hour.
 *
 * THE RULING. Null beds/baths still score 0 — unknown is not a penalty, and
 * that stays true. But ORDERING adds a shadow term: a comp pays
 * COMPLETENESS_TIEBREAK_PER_FIELD per undisclosed bed/bath field, so within
 * the margin disclosure beats silence, and beyond it the better score still
 * wins.
 *
 * WHY A SHADOW KEY RATHER THAN A COMPARATOR. "Prefer the discloser when the
 * scores are within 5" is not transitive: A beats B (within 5, A discloses),
 * B beats C (within 5, B discloses), C beats A (C's score is 11 better). A
 * comparator like that makes the sort's output depend on the input order,
 * which is a determinism bug that only shows up on some fetches. Adding to a
 * key cannot do that. Asserted below by permutation rather than by argument.
 *
 * WHAT I VERIFIED RATHER THAN ACCEPTED. The margin of 5 is presented as
 * derived: a kept comp can disclose at most a one-unit mismatch, worth
 * WEIGHT_BEDBATH / 2. The operator asked whether that holds against the
 * gates. It does, and the proof is exhaustive rather than illustrative — see
 * "the margin is exactly the concealable advantage" below.
 *
 * ONE PLACE IT DOES NOT HOLD, and it is a finding rather than a quibble: the
 * derivation assumes the concealed field is SCOREABLE. See the last block.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { scoreComp, rankComps, orderingKey, effectiveWeights } from '../../src/features/comps/rank.js';
import { applyHardFilters } from '../../src/features/comps/filter.js';
import {
  COMPLETENESS_TIEBREAK_PER_FIELD,
  WEIGHT_BEDBATH,
  MAX_BED_DIFF,
  MAX_BATH_DIFF,
  EARTH_RADIUS_MI,
} from '../../src/features/comps/config.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['rank', 'config'] as const;

const NOW = new Date('2025-07-15T00:00:00.000Z');
const MI_PER_DEG_LAT = (EARTH_RADIUS_MI * Math.PI) / 180;

const SUBJECT: SubjectProperty = {
  zpid: 'SUBJ', address: '1 TEST STREET', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 47.6, lng: -122.3,
};

const latAt = (miles: number) => SUBJECT.lat + miles / MI_PER_DEG_LAT;

/**
 * The real gate, one comp at a time. Uses applyHardFilters rather than a
 * re-implementation so the sweep below tests the shipped predicate — a
 * hand-rolled copy of the bed/bath rule would agree with itself and prove
 * nothing about the margin.
 */
const admits = (subject: SubjectProperty, c: RawComp) =>
  applyHardFilters(subject, [c], 3, 12, NOW).kept.length === 1;
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

function comp(overrides: Partial<RawComp> = {}): RawComp {
  return {
    zpid: 'C1', address: '2 TEST STREET', status: 'SOLD',
    soldPrice: 400_000, soldDate: daysAgo(0),
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000,
    propertyType: 'SFR', lat: SUBJECT.lat, lng: SUBJECT.lng,
    ...overrides,
  };
}

describe(`§14.20 completeness tie-breaker${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the margin is exactly the concealable advantage', () => {
    /** The bed/bath score term, hand-written from CONTRACT §5.4 — NOT imported. */
    const bedbathPenalty = (dBeds: number, dBaths: number) =>
      Math.min((Math.abs(dBeds) + Math.abs(dBaths)) / 2, 1) * WEIGHT_BEDBATH;

    /**
     * Every (beds, baths) a comp could carry, coarse enough to enumerate and
     * fine enough to include the half-bath steps real listings use.
     */
    const BED_VALUES = [1, 2, 3, 4, 5];
    const BATH_VALUES = [1, 1.5, 2, 2.5, 3, 3.5];

    it('a comp that survives the gates can disclose AT MOST a one-unit mismatch per field', () => {
      // The premise the whole margin rests on. Checked against the real
      // predicate rather than against MAX_BED_DIFF, because the constant
      // being 1 does not prove the gate uses it the way the derivation
      // assumes — an inclusive/exclusive slip would let a 2 through.
      let admitted = 0;
      for (const beds of BED_VALUES) {
        for (const baths of BATH_VALUES) {
          const c = comp({ beds, baths });
          if (!admits(SUBJECT, c)) continue;
          admitted += 1;
          expect(
            Math.abs(beds - (SUBJECT.beds as number)),
            `a comp ${beds} beds from the subject survived the gates — the ` +
              'concealment margin is derived from a one-unit ceiling and is ' +
              'too small if this is reachable',
          ).toBeLessThanOrEqual(MAX_BED_DIFF);
          expect(
            Math.abs(baths - (SUBJECT.baths as number)),
            `a comp ${baths} baths from the subject survived the gates`,
          ).toBeLessThanOrEqual(MAX_BATH_DIFF);
        }
      }
      expect(admitted, 'no comp survived the gates — the sweep proved nothing')
        .toBeGreaterThan(0);
    });

    it('so ONE concealed field can hide at most 5, and that bound is TIGHT', () => {
      // Exhaustive over the admissible space, both directions: never more
      // than the margin (or a concealer could outrank a discloser it should
      // lose to), and reaching it at least once (or the margin is too
      // generous and demotes comps that concealed nothing worth having).
      let worst = 0;
      for (const beds of BED_VALUES) {
        for (const baths of BATH_VALUES) {
          if (!admits(SUBJECT, comp({ beds, baths }))) continue;
          const dB = beds - (SUBJECT.beds as number);
          const dBa = baths - (SUBJECT.baths as number);
          // Conceal beds: the term recomputes with dBeds = 0 (rank.ts zeroes
          // a diff when either side is null), so the advantage is the drop.
          worst = Math.max(worst, bedbathPenalty(dB, dBa) - bedbathPenalty(0, dBa));
          worst = Math.max(worst, bedbathPenalty(dB, dBa) - bedbathPenalty(dB, 0));
        }
      }
      expect(
        worst,
        'a single undisclosed field can hide MORE than the margin, so a ' +
          'concealing comp can still outrank a discloser it should lose to',
      ).toBeLessThanOrEqual(COMPLETENESS_TIEBREAK_PER_FIELD);
      expect(
        worst,
        'no admissible comp reaches the margin — 5 over-penalises every ' +
          'concealer and the number is not derived from anything reachable',
      ).toBe(COMPLETENESS_TIEBREAK_PER_FIELD);
    });

    it('the margin matches the EFFECTIVE bedbath weight on BOTH subject branches', () => {
      // A cross-slice interaction that neither ruling mentions, and that only
      // exists because both landed. §14.20 derives the margin as
      // WEIGHT_BEDBATH / 2 — the raw constant. §14.3 then made the weights
      // BRANCH on subject type, redistributing lot's 10 points across
      // distance, sqft and recency by 9/8 for attached subjects.
      //
      // Today they agree, because the redistribution deliberately skipped
      // bedbath. But the margin is pinned to the constant while the score
      // uses the effective weight, so the two are only coincidentally equal.
      // Any future re-weighting that touches bedbath on one branch would make
      // the tie-breaker wrong for CONDO/TOWNHOUSE subjects and right for SFR
      // — a divergence with no symptom, since both still return five comps.
      for (const type of ['SFR', 'CONDO', 'TOWNHOUSE'] as const) {
        expect(
          effectiveWeights(type).bedbath / 2,
          `${type}: the concealment margin no longer equals half the bedbath ` +
            'weight actually used to score this subject type. The margin is ' +
            'derived from WEIGHT_BEDBATH directly, so a branch-specific ' +
            're-weighting silently decouples them.',
        ).toBe(COMPLETENESS_TIEBREAK_PER_FIELD);
      }
    });

    it('TWO concealed fields compound to 10 — the clamp does not saturate it short', () => {
      // The operator's question. min(sum/2, 1) caps the term at 10, so it is
      // fair to ask whether the second field is free. It is not: sum = 2 is
      // reachable (one bed AND one bath out, each within its own gate), the
      // term is 10 there, and concealing both drops it to 0.
      const both = comp({ beds: 4, baths: 3 });
      expect(admits(SUBJECT, both), 'the 1-bed 1-bath case is gated out').toBe(true);
      const full = bedbathPenalty(1, 1);
      expect(full, 'sum = 2 does not reach the clamp, so the compounding case is unreachable')
        .toBe(WEIGHT_BEDBATH);
      expect(
        full - bedbathPenalty(0, 0),
        'two concealed fields hide less than 2 x the margin — the tie-break ' +
          'over-credits the second field and a double-concealer is demoted ' +
          'further than it ever gained',
      ).toBe(2 * COMPLETENESS_TIEBREAK_PER_FIELD);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('ordering moves; the score does NOT', () => {
    it('the reported score and parts are untouched by the tie-breaker', () => {
      // The ruling's other half, and the one a member would notice: the block
      // renders scores. If the shadow key leaked into `score`, every rendered
      // figure would shift by 5 and the block would stop being reproducible
      // by hand.
      const missing = comp({ zpid: 'M', beds: null });
      const scored = scoreComp(SUBJECT, missing, NOW);
      expect(scored.parts.bedbath, 'a null bed diff stopped scoring 0 — unknown became a penalty')
        .toBe(0);
      expect(
        scored.score,
        'the tie-break leaked into the score itself',
      ).toBe(
        scored.parts.distance + scored.parts.sqft + scored.parts.recency +
        scored.parts.bedbath + scored.parts.lot,
      );
      expect(
        orderingKey(scored) - scored.score,
        'the ordering key does not carry exactly one field of demotion',
      ).toBe(COMPLETENESS_TIEBREAK_PER_FIELD);
    });

    it('a ranked comp reports the SAME score it would have scored alone', () => {
      // Guards the leak at the other end: rankComps could re-stamp score from
      // the key on its way out and nothing above would catch it.
      const pool = [
        comp({ zpid: 'A', beds: null, lat: latAt(0.1) }),
        comp({ zpid: 'B', lat: latAt(0.2) }),
        comp({ zpid: 'C', baths: null, lat: latAt(0.3) }),
      ];
      for (const r of rankComps(SUBJECT, pool, NOW)) {
        const alone = scoreComp(SUBJECT, r.comp, NOW);
        expect(r.score, `${r.comp.zpid}: rankComps altered the reported score`)
          .toBeCloseTo(alone.score, 10);
        expect(r.parts, `${r.comp.zpid}: rankComps altered the reported parts`)
          .toEqual(alone.parts);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('demotion, and a control that is not incidental', () => {
    /**
     * A pool where the concealer is genuinely good: best on distance, and
     * missing beds. Disclosers sit just behind it on score, and one comp is
     * far enough back that no margin could reach it.
     */
    const POOL = [
      comp({ zpid: 'CONCEAL', beds: null, lat: latAt(0.00) }),
      comp({ zpid: 'D1', lat: latAt(0.02) }),
      comp({ zpid: 'D2', lat: latAt(0.04) }),
      comp({ zpid: 'D3', lat: latAt(0.06) }),
      comp({ zpid: 'WORSE', lat: latAt(0.90) }),
    ];
    const order = () => rankComps(SUBJECT, POOL, NOW).map((r) => r.comp.zpid);

    it('within the margin, the concealer is demoted below comps it beat on score', () => {
      const scored = Object.fromEntries(
        POOL.map((c) => [c.zpid, scoreComp(SUBJECT, c, NOW).score]),
      );
      // PRECONDITION: it really did beat them on raw score, or the demotion
      // below is just the natural order and this case proves nothing.
      for (const id of ['D1', 'D2', 'D3']) {
        expect(
          scored.CONCEAL,
          `precondition: CONCEAL does not out-score ${id}, so a demotion ` +
            'past it would be ordinary ranking rather than the tie-breaker',
        ).toBeLessThan(scored[id]);
        expect(
          scored[id] - scored.CONCEAL,
          `precondition: the gap to ${id} exceeds the margin, so the ` +
            'tie-breaker could not move it and the case is vacuous',
        ).toBeLessThan(COMPLETENESS_TIEBREAK_PER_FIELD);
      }
      expect(order().indexOf('CONCEAL'), 'the concealer was not demoted at all').toBe(3);
    });

    it('BEYOND the margin the score still wins — and the control is real, not incidental', () => {
      // The control only means something if WORSE is far enough behind that
      // the margin genuinely cannot reach it. Assert that gap explicitly:
      // otherwise "CONCEAL still beats WORSE" could be true by a hair and
      // would flip on any re-weighting, while still reading as a passing
      // control.
      const s = (id: string) =>
        scoreComp(SUBJECT, POOL.find((c) => c.zpid === id) as RawComp, NOW).score;
      expect(
        s('WORSE') - s('CONCEAL'),
        'the control comp is within the margin of the concealer, so it does ' +
          'not test "beyond the margin" at all — it tests a tie',
      ).toBeGreaterThan(COMPLETENESS_TIEBREAK_PER_FIELD);
      const o = order();
      expect(o.indexOf('CONCEAL'), 'the concealer fell past a genuinely worse comp')
        .toBeLessThan(o.indexOf('WORSE'));
    });

    it('two missing fields demote further than one', () => {
      const pool = [
        comp({ zpid: 'ONE', beds: null, lat: latAt(0.00) }),
        comp({ zpid: 'TWO', beds: null, baths: null, lat: latAt(0.00) }),
      ];
      const [a, b] = rankComps(SUBJECT, pool, NOW);
      expect(a.score, 'precondition: the two comps do not score identically')
        .toBeCloseTo(b.score, 10);
      expect([a.comp.zpid, b.comp.zpid], 'the second missing field bought no further demotion')
        .toEqual(['ONE', 'TWO']);
      expect(orderingKey(b) - orderingKey(a), 'the fields did not compound')
        .toBeCloseTo(COMPLETENESS_TIEBREAK_PER_FIELD, 10);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('transitivity, by permutation rather than by argument', () => {
    it('the output order is identical across every permutation of the input', () => {
      // The reason the shadow key exists. A within-margin pairwise comparator
      // is intransitive, and intransitivity does not throw — it silently
      // returns a different top-5 depending on the order the provider
      // happened to return, which is unreproducible and invisible.
      //
      // The pool is built to be adversarial for exactly that: scores spaced
      // inside the margin so the "prefer the discloser" preference chains,
      // with concealers seeded through the chain.
      const pool = [
        comp({ zpid: 'P0', beds: null, lat: latAt(0.00) }),
        comp({ zpid: 'P1', lat: latAt(0.015) }),
        comp({ zpid: 'P2', baths: null, lat: latAt(0.03) }),
        comp({ zpid: 'P3', lat: latAt(0.045) }),
        comp({ zpid: 'P4', beds: null, baths: null, lat: latAt(0.06) }),
        comp({ zpid: 'P5', lat: latAt(0.075) }),
      ];
      const expected = rankComps(SUBJECT, pool, NOW).map((r) => r.comp.zpid);

      // PRECONDITION: the chain really is inside the margin, or the pool is
      // just a sorted list and permutation-invariance is trivial.
      const scores = pool.map((c) => scoreComp(SUBJECT, c, NOW).score).sort((x, y) => x - y);
      for (let i = 1; i < scores.length; i += 1) {
        expect(
          scores[i] - scores[i - 1],
          'the pool is spaced wider than the margin, so no preference can ' +
            'chain and this case cannot detect intransitivity',
        ).toBeLessThan(COMPLETENESS_TIEBREAK_PER_FIELD);
      }

      // Deterministic permutations — no Math.random, so a failure reproduces.
      const rotations = pool.map((_, i) => [...pool.slice(i), ...pool.slice(0, i)]);
      const reversed = [...pool].reverse();
      const swapped = [pool[3], pool[1], pool[5], pool[0], pool[4], pool[2]];
      for (const [n, perm] of [
        ...rotations.map((p, i) => [`rotation ${i}`, p] as const),
        ['reversed', reversed] as const,
        ['swapped', swapped] as const,
      ]) {
        expect(
          rankComps(SUBJECT, perm as RawComp[], NOW).map((r) => r.comp.zpid),
          `${n}: the kept order depends on the INPUT order. The tie-break is ` +
            'behaving intransitively, so which comps a member sees depends on ' +
            'the sequence the provider happened to return them in.',
        ).toEqual(expected);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))(
    'FINDING-013: the margin is charged even where nothing could be concealed',
    () => {
      it('a subject with no beds recorded still demotes comps for not disclosing theirs', () => {
        // THE GAP, and it is in the derivation rather than the arithmetic.
        //
        // The margin is "the largest advantage one undisclosed field could
        // have concealed". rank.ts zeroes a diff when EITHER side is null, so
        // when the SUBJECT's beds are unknown the term is 0 for every comp
        // whether it discloses or not. The concealable advantage is exactly
        // zero — there is nothing to conceal — yet orderingKey counts the
        // comp's nulls unconditionally and charges the full 5.
        //
        // It is not a wrong figure and no score changes. It reorders, and
        // ordering decides which five comps survive MAX_COMPS_KEPT, so in a
        // thin market it can drop a genuinely better comp out of the set in
        // favour of a worse one whose beds happen to be populated — on a
        // subject where beds were never scoreable in the first place.
        //
        // Recorded as a finding, not a bug: the ruling may well intend to
        // reward disclosure unconditionally. But the margin's derivation does
        // not support it here, and the two should agree.
        const noBeds: SubjectProperty = { ...SUBJECT, beds: null };
        const discloser = comp({ zpid: 'HAS', beds: 5, lat: latAt(0.03) });
        const concealer = comp({ zpid: 'NONE', beds: null, lat: latAt(0.00) });

        // Neither is penalised on beds: the subject has none to compare.
        for (const c of [discloser, concealer]) {
          expect(
            scoreComp(noBeds, c, NOW).parts.bedbath,
            `${c.zpid}: the bed term is non-zero against a bedless subject`,
          ).toBe(0);
        }
        // So disclosure bought the discloser nothing...
        const gain =
          scoreComp(noBeds, { ...concealer, beds: 5 }, NOW).parts.bedbath -
          scoreComp(noBeds, concealer, NOW).parts.bedbath;
        expect(gain, 'precondition: disclosure DID affect the score here').toBe(0);

        // ...yet the concealer is still charged the full margin for it.
        const charged =
          orderingKey(scoreComp(noBeds, concealer, NOW)) -
          scoreComp(noBeds, concealer, NOW).score;
        expect(
          charged,
          'if this is 0 the gap is closed and this case should be deleted',
        ).toBe(COMPLETENESS_TIEBREAK_PER_FIELD);
      });
    },
  );
});
