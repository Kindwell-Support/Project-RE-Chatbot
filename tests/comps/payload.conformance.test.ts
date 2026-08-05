/**
 * Payload reconciliation — does the data actually match CONTRACT §4?
 *
 * THIS RUNS BEFORE ANYTHING ELSE IS TRUSTED. Every other comps test assumes the
 * fixture it loads has the shape §4 declares. If the real Apify payload
 * disagrees — `zpid` as a number, `livingArea` as `"2,140"`, `soldDate` as
 * epoch ms, a `propertyType` outside the closed union — then the downstream
 * suites are green against data the production pipeline will never see.
 *
 * TypeScript can't catch this: the types are erased at runtime, and a fixture
 * cast through `as RawComp[]` type-checks perfectly while carrying strings
 * where numbers belong. `"2,140"` divides to `NaN`, `NaN` propagates through the
 * mean, and the ARV renders as `$NaN` or coerces to `$0`.
 *
 * The validators in `tests/helpers/contractShape.ts` are transcribed from the
 * contract, not from `src/features/comps/types.ts` — the question is whether
 * the payload matches the SPEC, not whether it matches the code.
 *
 * Discovery is automatic: any `subject-*.json` / `comps-*.json` MASON drops into
 * `src/features/comps/__fixtures__/` is picked up on the next run without me
 * editing this file.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import {
  validateSubject,
  validateRawComp,
  formatProblems,
  missingKeys,
  extraKeys,
  SUBJECT_KEYS,
  RAW_COMP_KEYS,
  PROPERTY_TYPES,
} from '../helpers/contractShape.js';
import { GOLDEN_CASES } from '../fixtures/golden/index.js';
import { mapCompItems } from '../../src/features/comps/providers/apifyZillow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MASON_FIXTURES = resolve(HERE, '..', '..', 'src', 'features', 'comps', '__fixtures__');

function fixtureFiles(prefix: string): string[] {
  if (!existsSync(MASON_FIXTURES)) return [];
  return readdirSync(MASON_FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => resolve(MASON_FIXTURES, f));
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));

const subjectFiles = fixtureFiles('subject-');
const compsFiles = fixtureFiles('comps-');

describe('payload conformance to CONTRACT §4', () => {
  // -------------------------------------------------------------------------
  // My own fixtures first. If the validators are wrong, they are wrong here
  // too — and a validator that passes everything catches nothing.
  // -------------------------------------------------------------------------
  describe('self-check: the golden fixtures conform', () => {
    it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))(
      '%s subject and comps match §4',
      (_id, gc) => {
        const subjectProblems = validateSubject(gc.subject);
        expect(subjectProblems, `subject: ${formatProblems(subjectProblems)}`).toEqual([]);
        gc.comps.forEach((c, i) => {
          const problems = validateRawComp(c, `comps[${i}]`);
          expect(problems, `${formatProblems(problems)}`).toEqual([]);
        });
      },
    );

    it('the validators actually reject — they are not a rubber stamp', () => {
      // A conformance harness that passes everything is worse than none, so
      // prove each check bites before trusting a green run on real data.
      const good = GOLDEN_CASES[0].comps[0];
      const cases: Array<[string, Record<string, unknown>]> = [
        ['zpid as a number', { ...good, zpid: 12345 }],
        ['livingArea as a numeric string', { ...good, livingArea: '2,140' }],
        ['soldDate as epoch ms', { ...good, soldDate: 1747353600000 }],
        ['soldDate as a full timestamp', { ...good, soldDate: '2025-05-16T00:00:00.000Z' }],
        ['propertyType outside the union', { ...good, propertyType: 'SINGLE_FAMILY' }],
        ['propertyType null', { ...good, propertyType: null }],
        ['lat missing', { ...good, lat: undefined }],
        ['lat/lng at Null Island', { ...good, lat: 0, lng: 0 }],
        ['lat out of range', { ...good, lat: 470.6 }],
        ['soldPrice as NaN', { ...good, soldPrice: NaN }],
      ];
      for (const [label, bad] of cases) {
        expect(validateRawComp(bad).length, `"${label}" was accepted`).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // MASON's fixtures. Skips with a visible note until they land; the moment a
  // recorded payload appears it is reconciled without me editing this file.
  // -------------------------------------------------------------------------
  describe.skipIf(subjectFiles.length === 0)('MASON subject-*.json fixtures', () => {
    it.each(subjectFiles.map((f) => [basename(f), f] as const))(
      '%s matches §4 SubjectProperty',
      (_name, file) => {
        const data = readJson(file);
        const problems = validateSubject(data);
        expect(problems, `${basename(file)}: ${formatProblems(problems)}`).toEqual([]);

        const missing = missingKeys(data, SUBJECT_KEYS);
        expect(missing, `${basename(file)} is missing §4 keys: ${missing.join(', ')}`).toEqual([]);

        // Extra keys are not a failure — the mapper may carry provenance — but
        // they are worth seeing, because an extra `squareFeet` next to a null
        // `livingArea` is a mapping bug wearing a disguise.
        const extra = extraKeys(data, SUBJECT_KEYS);
        if (extra.length) {
          console.warn(`[conformance] ${basename(file)} has extra keys: ${extra.join(', ')}`);
        }
      },
    );
  });

  describe.skipIf(compsFiles.length === 0)('MASON comps-*.json fixtures', () => {
    it.each(compsFiles.map((f) => [basename(f), f] as const))(
      '%s is an array of §4 RawComp',
      (_name, file) => {
        const data = readJson(file);
        expect(Array.isArray(data), `${basename(file)} is not an array`).toBe(true);
        const comps = data as unknown[];

        const allProblems = comps.flatMap((c, i) => validateRawComp(c, `[${i}]`));
        expect(allProblems, `${basename(file)}: ${formatProblems(allProblems)}`).toEqual([]);

        comps.forEach((c, i) => {
          const missing = missingKeys(c, RAW_COMP_KEYS);
          expect(missing, `${basename(file)}[${i}] missing: ${missing.join(', ')}`).toEqual([]);
        });
      },
    );

    it('reports the propertyType and status domains actually present', () => {
      // Not a pass/fail — an inventory. §5.3 #7 makes OTHER match nothing
      // including OTHER, so if the mapper is funnelling real inventory
      // (LOT, MULTI_FAMILY, ...) into OTHER, those comps are silently unusable
      // and the only symptom is a thinner comp set. Same for status: rule 1 is
      // an exact case-insensitive 'SOLD' match, so 'RECENTLY_SOLD' rejects
      // every comp in the file.
      const types = new Set<string>();
      const statuses = new Set<string>();
      for (const file of compsFiles) {
        for (const c of readJson(file) as Array<Record<string, unknown>>) {
          types.add(String(c.propertyType));
          statuses.add(String(c.status));
        }
      }
      console.warn(`[conformance] propertyType values present: ${[...types].join(', ')}`);
      console.warn(`[conformance] status values present: ${[...statuses].join(', ')}`);

      for (const t of types) {
        expect(
          (PROPERTY_TYPES as readonly string[]).includes(t),
          `propertyType "${t}" is outside the §4 union`,
        ).toBe(true);
      }
      // At least one comp must be usable, or the fixture proves nothing.
      expect(
        [...statuses].some((s) => s.toUpperCase() === 'SOLD'),
        `no comp has status SOLD (present: ${[...statuses].join(', ')}) — rule 1 rejects every one`,
      ).toBe(true);
    });

    it('every SOLD comp carries the fields the ARV math needs', () => {
      // A comp can be perfectly §4-shaped and still useless: null livingArea
      // and null soldPrice are legal per the type and rejected by rules 3 and 9.
      // If a whole recorded payload is like that, the fixture cannot exercise
      // the ARV path and a green downstream suite means nothing.
      let usable = 0;
      let sold = 0;
      for (const file of compsFiles) {
        for (const c of readJson(file) as Array<Record<string, unknown>>) {
          if (String(c.status).toUpperCase() !== 'SOLD') continue;
          sold++;
          if (
            typeof c.soldPrice === 'number' && c.soldPrice > 0 &&
            typeof c.livingArea === 'number' && c.livingArea > 0 &&
            typeof c.soldDate === 'string'
          ) usable++;
        }
      }
      console.warn(`[conformance] ${usable}/${sold} SOLD comps have price + sqft + date`);
      expect(sold, 'no SOLD comps at all in the recorded fixtures').toBeGreaterThan(0);
      expect(
        usable,
        `${sold} SOLD comps but ${usable} usable — the recorded payload cannot exercise the ARV path`,
      ).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // THE MAPPING RULE ITSELF — §6.1's homeType table.
  //
  // Nothing pinned this before. The fixture distributions shift whenever a
  // recording is regenerated, so a silent revert of the APARTMENT ruling would
  // change only the counts in a JSON file and no test would notice. This
  // asserts the RULE, through the exported mapper, so the ruling is pinned
  // independently of whatever any recording happens to contain.
  // -------------------------------------------------------------------------
  describe('homeType maps per CONTRACT §6.1', () => {
    /** Minimal search card in the shape §6.1 documents. */
    const card = (homeType: unknown) => ({
      hdpData: {
        homeInfo: {
          zpid: 1, streetAddress: '1 TEST ST', homeStatus: 'RECENTLY_SOLD',
          homeType, price: 400000, dateSold: 1785481200000, livingArea: 2000,
          bedrooms: 3, bathrooms: 2, latitude: 33.47, longitude: -112.08,
          lotAreaValue: 6000, lotAreaUnit: 'sqft',
        },
      },
    });
    const mappedType = (homeType: unknown) => mapCompItems([card(homeType)])[0]?.propertyType;

    it.each([
      ['SINGLE_FAMILY', 'SFR'],
      ['CONDO', 'CONDO'],
      ['TOWNHOUSE', 'TOWNHOUSE'],
      ['MANUFACTURED', 'MANUFACTURED'],
      ['LOT', 'OTHER'],
      ['MULTI_FAMILY', 'OTHER'],
      ['HOME_TYPE_UNKNOWN', 'OTHER'],
    ])('%s -> %s', (raw, expected) => {
      expect(mappedType(raw)).toBe(expected);
    });

    it('APARTMENT -> CONDO (operator ruling, CONTRACT_CHANGE 0021)', () => {
      // The ruling that matters most, because getting it wrong is SILENT and
      // TERMINAL: rule 7 says OTHER matches nothing including OTHER, so an
      // apartment-typed subject mapped to OTHER can never produce an ARV under
      // any input. Not a thin market — a permanently dead address.
      expect(mappedType('APARTMENT')).toBe('CONDO');
      expect(mappedType('APARTMENT'), 'the APARTMENT ruling was reverted').not.toBe('OTHER');
    });

    it('anything unrecognised, missing or malformed falls to OTHER', () => {
      // OTHER is the honest default: we would rather refuse than comp a house
      // against a property class we could not identify.
      for (const raw of [null, undefined, '', 'FARM', 'BOAT', 42, {}, []]) {
        expect(mappedType(raw), `${JSON.stringify(raw)} did not fall to OTHER`).toBe('OTHER');
      }
    });

    it('every mapped value is inside the §4 union', () => {
      for (const raw of [
        'SINGLE_FAMILY', 'CONDO', 'APARTMENT', 'TOWNHOUSE', 'MANUFACTURED',
        'LOT', 'MULTI_FAMILY', 'HOME_TYPE_UNKNOWN', null, 'GARBAGE',
      ]) {
        expect(PROPERTY_TYPES as readonly string[]).toContain(mappedType(raw));
      }
    });
  });

  // -------------------------------------------------------------------------
  it('states plainly whether real payloads have been reconciled yet', () => {
    // Deliberately not a skip. A skipped suite is invisible in a summary line;
    // this one always runs and always says where things stand, so "conformance
    // passed" can never be read as "the real payload was checked" when no real
    // payload exists.
    const reconciled = subjectFiles.length > 0 && compsFiles.length > 0;
    if (!reconciled) {
      console.warn(
        '[conformance] NO recorded provider fixtures found in src/features/comps/__fixtures__/ — ' +
          'only INSPECTOR\'s hand-written goldens have been reconciled against §4. ' +
          'Downstream suites are green against hand-written data only.',
      );
    }
    expect(typeof reconciled).toBe('boolean');
  });
});
