/**
 * §14.22 (RULING 1) — a bare multi-unit address ASKS for the unit.
 *
 * WHY THE NEGATIVE CASES CARRY THE WEIGHT, stated once because it drives every
 * choice below. A wrong unit is a wrong figure: bad, and the failure this
 * module guards against everywhere. A SPURIOUS ask is different in kind. It
 * fires on an ordinary house, makes the tool look broken on the most common
 * input there is, and teaches the member that the address they typed was
 * somehow wrong. They do not type it again. So the ask must be rarer than the
 * guess it replaces, not merely safer.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { runComps } from '../../src/features/comps/service.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['service'] as const;

const NOW = new Date('2026-08-11T00:00:00.000Z');
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);

const SUBJECT: SubjectProperty = {
  zpid: 'SUBJ', address: '100 OAK ST, PHOENIX, AZ', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 33.4, lng: -112.0,
};

const sale = (o: Partial<RawComp> = {}): RawComp => ({
  zpid: 'C', address: '2 FAR AWAY RD, PHOENIX, AZ', status: 'SOLD',
  soldPrice: 400_000, soldDate: daysAgo(20), beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, propertyType: 'SFR',
  lat: 33.401, lng: -112.0, ...o,
});

/** Enough ordinary comps that the run would SUCCEED if nothing asked. */
const FILLER = Array.from({ length: 5 }, (_, i) =>
  sale({ zpid: `F${i}`, address: `${10 + i} PINE RD, PHOENIX, AZ`, soldPrice: 400_000 + i * 1_000 }));

async function run(input: string, pool: RawComp[]) {
  const spy = makeProviderSpy({ subject: SUBJECT, comps: pool, noDetailSupport: true });
  const out = await runComps(input, { provider: spy.provider as never, now: () => NOW } as never);
  return out as { ok: boolean; code?: string; detail?: { resolution?: string } };
}
const asked = (o: { ok: boolean; detail?: { resolution?: string } }) =>
  !o.ok && o.detail?.resolution === 'unit_mismatch';

describe(`§14.22 multi-unit ask${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('the NEGATIVE cases — a false ask is the worse failure', () => {
    it('an ordinary SFR with no unit cards anywhere NEVER asks', () => {
      return run('100 Oak St, Phoenix AZ', FILLER).then((out) => {
        expect(asked(out), 'the ask fired on a plain single-family lookup').toBe(false);
        expect(out.ok, 'the ordinary lookup did not even succeed — precondition gone').toBe(true);
      });
    });

    it('a member who SUPPLIED the unit is never asked for it again', () => {
      // Condition one of the ruling. This is the case that proves the ask is
      // about AMBIGUITY rather than about the building: same pool, same
      // siblings, and the only difference is that the member already answered.
      const pool = [
        ...FILLER,
        sale({ zpid: 'U1', address: '100 OAK ST UNIT 1, PHOENIX, AZ' }),
        sale({ zpid: 'U2', address: '100 OAK ST UNIT 2, PHOENIX, AZ' }),
      ];
      return run('100 Oak St #4, Phoenix AZ', pool).then((out) => {
        expect(
          asked(out),
          'the member named a unit and was asked for it anyway — the ask is ' +
            'keyed to the building rather than to what they left out',
        ).toBe(false);
      });
    });
  });

  describe.skipIf(pendingSlice(...MODS))('the POSITIVE case', () => {
    it('a bare address in a genuine multi-unit building asks', () => {
      const pool = [
        ...FILLER,
        sale({ zpid: 'U1', address: '100 OAK ST UNIT 1, PHOENIX, AZ' }),
        sale({ zpid: 'U2', address: '100 OAK ST UNIT 2, PHOENIX, AZ' }),
      ];
      return run('100 Oak St, Phoenix AZ', pool).then((out) => {
        expect(
          asked(out),
          'a bare address in a building with multiple unit cards was answered ' +
            'with one unit silently chosen for the member',
        ).toBe(true);
      });
    });
  });

  describe.skipIf(pendingSlice(...MODS))(
    'DEVIATION PROBES — the ruling has three conditions; the build checks one',
    () => {
      // Not assertions of desired behaviour. These RECORD what the build does
      // where it departs from the ruling as written, so the gap is a decision
      // rather than a discovery. The ruling:
      //
      //   (1) member supplied no unit          -> checked
      //   (2) the RESOLVED CARD has a unit     -> not checked
      //   (3) 2+ DISTINCT unit cards exist     -> not checked; one suffices
      //
      // Both unchecked conditions loosen the trigger, and the ruling's whole
      // emphasis was that a false ask is worse than the guess it replaces.
      it('ONE unit sibling is enough — the ruling asked for two or more', () => {
        const pool = [...FILLER, sale({ zpid: 'U1', address: '100 OAK ST UNIT 1, PHOENIX, AZ' })];
        return run('100 Oak St, Phoenix AZ', pool).then((out) => {
          expect(
            asked(out),
            'if this is FALSE the build now requires 2+ siblings and matches ' +
              'the ruling — delete this probe',
          ).toBe(true);
        });
      });

      it('a stale or adjacent unit card is indistinguishable from a real building', () => {
        // The concrete cost of condition (3) being absent. One unit-bearing
        // card sharing the street prefix — a stale Zillow record, a converted
        // garage apartment, a neighbouring duplex — turns an ordinary SFR
        // lookup into an ask the member cannot satisfy, because their house
        // has no unit number to give.
        const pool = [...FILLER, sale({ zpid: 'X', address: '100 OAK ST APT B, PHOENIX, AZ' })];
        return run('100 Oak St, Phoenix AZ', pool).then((out) => {
          expect(
            asked(out),
            'if this is FALSE the trigger has tightened and this probe is stale',
          ).toBe(true);
        });
      });
    },
  );
});
