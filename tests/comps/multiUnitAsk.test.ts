/**
 * §14.22 (RULING 1 + FINDING-015) — a bare multi-unit address ASKS for the unit.
 *
 * WHY THE NEGATIVES CARRY THE WEIGHT. A wrong unit is a wrong figure: bad, and
 * the failure this module guards against everywhere. A SPURIOUS ask is
 * different in kind — it fires on an ordinary house, makes the tool look broken
 * on the most common input there is, and teaches the member that the address
 * they typed was somehow wrong. They do not type it again. Three of the six
 * rows below are must-NOT-ask.
 *
 * THE THREE CONDITIONS, all conjunctive:
 *   1. the member supplied no unit
 *   2. the RESOLVED card shows unit evidence — a designator OR an attached-type
 *      resolution
 *   3. 2+ DISTINCT unit cards at that street in the pool
 *
 * CONDITION 2's SECOND ARM IS A DEVIATION from the ruling's literal text, and
 * the operator approved it on evidence. I verified that evidence independently
 * rather than taking the handoff: `spike-mesquite-bare-detail.json` resolves
 * `700 E Mesquite Cir` with `streetAddress`, `abbreviatedAddress` and
 * `listingAddress.full` all carrying NO unit, `listingAddress.unit` explicitly
 * null — and `homeType: CONDO`, `livingArea: 804`. So a literal reading of
 * condition 2 would have silenced the ask on the very row the ruling exists to
 * catch. The deviation is the ruling's intent, not a relaxation of it, and the
 * case below pins the recording so the justification cannot rot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { runComps } from '../../src/features/comps/service.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { ATTACHED_SUBJECT_TYPES } from '../../src/features/comps/config.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['service'] as const;

const NOW = new Date('2026-08-11T00:00:00.000Z');
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const BASE_SUBJECT: SubjectProperty = {
  zpid: 'SUBJ', address: '700 E MESQUITE CIR, TEMPE, AZ', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 33.4, lng: -112.0,
};

const sale = (o: Partial<RawComp> = {}): RawComp => ({
  zpid: 'C', address: '2 FAR AWAY RD, TEMPE, AZ', status: 'SOLD',
  soldPrice: 400_000, soldDate: daysAgo(20), beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, propertyType: 'SFR',
  lat: 33.401, lng: -112.0, ...o,
});

/**
 * Enough ordinary comps that the run SUCCEEDS whenever nothing asks — MATCHED
 * to the subject's type and size.
 *
 * Both condo rows first failed as ok:false with no ask, which is neither
 * outcome the matrix is about: an 804-sqft CONDO subject against 2,000-sqft
 * SFR filler is rejected by the type and sqft gates, so the run died of
 * TOO_FEW_COMPS before §14.22 was ever consulted. My fixture, not the build,
 * and the sort of thing that reads as "the guard is silent" when the guard
 * never ran.
 */
const fillerFor = (subject: SubjectProperty) =>
  Array.from({ length: 5 }, (_, i) =>
    sale({
      zpid: `F${i}`, address: `${10 + i} PINE RD, TEMPE, AZ`,
      soldPrice: 400_000 + i * 1_000,
      propertyType: subject.propertyType,
      livingArea: subject.livingArea,
    }));
/** SFR default, for the rows whose subject is the base SFR. */
const FILLER = fillerFor(BASE_SUBJECT);

/** Two DISTINCT unit cards on the subject's street — condition 3 satisfied. */
const twoUnitsFor = (subject: SubjectProperty) => [
  sale({
    zpid: 'U1', address: '700 E MESQUITE CIR UNIT 1, TEMPE, AZ',
    propertyType: subject.propertyType, livingArea: subject.livingArea,
  }),
  sale({
    zpid: 'U2', address: '700 E MESQUITE CIR UNIT 2, TEMPE, AZ',
    propertyType: subject.propertyType, livingArea: subject.livingArea,
  }),
];
const TWO_UNITS = twoUnitsFor(BASE_SUBJECT);
/** One lone unit card — the stale-record shape condition 3 exists to block. */
const oneUnitFor = (subject: SubjectProperty) => [
  sale({
    zpid: 'U1', address: '700 E MESQUITE CIR APT B, TEMPE, AZ',
    propertyType: subject.propertyType, livingArea: subject.livingArea,
  }),
];
const ONE_UNIT = oneUnitFor(BASE_SUBJECT);

async function run(input: string, subject: SubjectProperty, pool: RawComp[]) {
  const spy = makeProviderSpy({ subject, comps: pool, noDetailSupport: true });
  return (await runComps(input, {
    provider: spy.provider as never,
    now: () => NOW,
  } as never)) as { ok: boolean; detail?: { resolution?: string }; comps?: unknown[] };
}
const asked = (o: { ok: boolean; detail?: { resolution?: string } }) =>
  !o.ok && o.detail?.resolution === 'unit_mismatch';

describe(`§14.22 multi-unit ask${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('the DEVIATION rests on a recording that still says so', () => {
    it('the bare-Mesquite card is an attached type with NO unit in any address field', () => {
      const raw = JSON.parse(
        readFileSync(
          resolve(
            dirname(fileURLToPath(import.meta.url)), '..', '..',
            'src', 'features', 'comps', '__fixtures__', 'spike-mesquite-bare-detail.json',
          ),
          'utf8',
        ),
      ) as Record<string, any>;
      const card = Array.isArray(raw) ? raw[0] : raw;

      expect(
        ATTACHED_SUBJECT_TYPES,
        'the deviation is justified by an ATTACHED resolution; if CONDO is no ' +
          'longer attached, condition 2 no longer fires on this row',
      ).toContain(card.homeType);
      expect(card.livingArea, 'the 804 sqft that made this obviously not a whole property')
        .toBeLessThan(1_000);

      // The load-bearing half: no unit designator ANYWHERE in the address, so
      // literal condition 2 would silence the ask.
      const addressStrings = [
        card.streetAddress,
        card.abbreviatedAddress,
        card.address?.streetAddress,
        card.listingAddress?.full,
        card.listingAddress?.street,
      ].filter((v): v is string => typeof v === 'string');
      expect(addressStrings.length, 'the recording no longer carries address strings')
        .toBeGreaterThan(2);
      for (const a of addressStrings) {
        expect(
          /(?:\b(?:unit|apt|apartment|ste|suite|bldg|building|fl|floor|rm|room)\b|#)\s*[\w-]+/i.test(a),
          `an address field DOES carry a unit ("${a}") — the deviation's premise ` +
            'is gone and literal condition 2 would have sufficed',
        ).toBe(false);
      }
      expect(card.listingAddress?.unit ?? null, 'the unit field is populated after all')
        .toBeNull();
    });
  });

  // ==========================================================================
  // THE SIX-CASE MATRIX. Negatives first — they are the ones that constrain.
  // ==========================================================================
  describe.skipIf(pendingSlice(...MODS))('MUST NOT ASK — three rows', () => {
    it('2. an SFR with ONE stale unit card is SILENT (condition 3)', async () => {
      // The exact failure I demonstrated under the old build. One
      // unit-bearing card sharing the street — a stale record, a garage
      // conversion, a neighbouring duplex — turned an ordinary lookup into an
      // ask the member could not satisfy.
      const out = await run('700 E Mesquite Cir, Tempe AZ', BASE_SUBJECT, [...FILLER, ...ONE_UNIT]);
      expect(asked(out), 'a single stale unit card still produces a false ask').toBe(false);
      expect(out.ok, 'the ordinary lookup did not succeed — the precondition is gone').toBe(true);
    });

    it('3. an SFR with TWO distinct unit cards is SILENT (condition 2)', async () => {
      // Condition 3 is satisfied here and condition 2 is not, which is what
      // makes this row worth having: it isolates condition 2 rather than
      // testing both at once. An SFR resolution is a WHOLE property — there
      // is nothing ambiguous to ask about, whatever else sits in the pool.
      const out = await run('700 E Mesquite Cir, Tempe AZ', BASE_SUBJECT, [...FILLER, ...TWO_UNITS]);
      expect(
        asked(out),
        'a whole single-family property was asked which unit the member meant, ' +
          'because other buildings on the street have units',
      ).toBe(false);
      expect(out.ok, 'the SFR lookup did not succeed').toBe(true);
    });

    it('4. a bare CONDO with ONE unit card is SILENT (condition 3)', async () => {
      // The mirror of row 3: condition 2 satisfied via the attached arm,
      // condition 3 not. Together they prove the conjunction — neither
      // condition alone is sufficient.
      const condo: SubjectProperty = { ...BASE_SUBJECT, propertyType: 'CONDO', livingArea: 804 };
      const out = await run(
        '700 E Mesquite Cir, Tempe AZ', condo, [...fillerFor(condo), ...oneUnitFor(condo)],
      );
      expect(
        asked(out),
        'one unit card was enough again — condition 3 is not holding for ' +
          'attached subjects, which is where the false ask is most likely',
      ).toBe(false);
      expect(out.ok, 'the condo lookup did not succeed').toBe(true);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('MUST ASK — two rows', () => {
    it('1. bare MESQUITE asks — attached resolution plus two unit cards', async () => {
      const condo: SubjectProperty = { ...BASE_SUBJECT, propertyType: 'CONDO', livingArea: 804 };
      const out = await run(
        '700 E Mesquite Cir, Tempe AZ', condo, [...fillerFor(condo), ...twoUnitsFor(condo)],
      );
      expect(
        asked(out),
        'the row the ruling exists for was answered with one unit of the ' +
          'complex silently chosen for the member',
      ).toBe(true);
    });

    it('5. a unit-BEARING resolved card with bare input and two siblings asks', async () => {
      // Condition 2's first arm, on its own. Zillow resolved the bare input to
      // a specific unit; the member never named one. Note the subject's own
      // address carries the unit, so the street-prefix match only works
      // because the implementation strips the designator before comparing —
      // this row is what proves that.
      const unitSubject: SubjectProperty = {
        ...BASE_SUBJECT, address: '700 E MESQUITE CIR UNIT 3, TEMPE, AZ', propertyType: 'SFR',
      };
      const out = await run('700 E Mesquite Cir, Tempe AZ', unitSubject, [...FILLER, ...TWO_UNITS]);
      expect(
        asked(out),
        'the resolved card names a unit the member never did, and the lookup ' +
          'proceeded on it anyway',
      ).toBe(true);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('MUST SERVE UNTOUCHED — the over-tighten guard', () => {
    it('6. an EVERGREEN address with the unit TYPED serves normally', async () => {
      // Condition 1. The member answered the question already, so asking it
      // again is the same false-ask failure wearing a different hat. Asserted
      // as SERVES, not merely as "does not ask": a fix that over-tightened
      // into silence would pass a not-asked check while returning nothing.
      const unitSubject: SubjectProperty = {
        ...BASE_SUBJECT, address: '700 E MESQUITE CIR UNIT 3, TEMPE, AZ', propertyType: 'CONDO',
      };
      const out = await run(
        '700 E Mesquite Cir #3, Tempe AZ', unitSubject,
        [...fillerFor(unitSubject), ...twoUnitsFor(unitSubject)],
      );
      expect(asked(out), 'the member named the unit and was asked for it again').toBe(false);
      expect(out.ok, 'a unit-typed lookup returned no result at all').toBe(true);
      expect(
        (out.comps ?? []).length,
        'the lookup succeeded but served an empty set — over-tightened into silence',
      ).toBeGreaterThanOrEqual(3);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('condition 3 counts DISTINCT units, not rows', () => {
    it('two ZIP variants of the SAME unit are one card, and do not ask', async () => {
      // MASON's claim about the dedupe, checked rather than taken. Zillow
      // routinely carries one property under two ZIPs, and counting rows
      // instead of units would resurrect the single-card false ask with two
      // rows describing the same door.
      const condo: SubjectProperty = { ...BASE_SUBJECT, propertyType: 'CONDO', livingArea: 804 };
      const duplicates = [
        sale({
          zpid: 'Z1', address: '700 E MESQUITE CIR UNIT 1, TEMPE, AZ 85281',
          propertyType: condo.propertyType, livingArea: condo.livingArea,
        }),
        sale({
          zpid: 'Z2', address: '700 E MESQUITE CIR UNIT 1, TEMPE, AZ 85288',
          propertyType: condo.propertyType, livingArea: condo.livingArea,
        }),
      ];
      const out = await run(
        '700 E Mesquite Cir, Tempe AZ', condo, [...fillerFor(condo), ...duplicates],
      );
      expect(
        asked(out),
        'two rows describing the SAME unit counted as two distinct units — the ' +
          'stale-card false ask is reachable again with one duplicated record',
      ).toBe(false);
    });
  });
});
