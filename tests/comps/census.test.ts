/**
 * CENSUS DEMOGRAPHICS — CONTRACT §14.10, guarantees 1–4.
 *
 * Re-pointed onto the shipped seams (`providers/census.ts`) and onto the REAL
 * recordings rather than my hand-built fixture, which is now unused. Expected
 * values are hand-derived from the recording below, not read out of the
 * implementation.
 *
 *   spike-census-acs.json — Phoenix tract 04013111700, REAL:
 *     income 93333 · age 37.9 · total 2296 · owner 1427 · renter 869
 *     ownerOccupiedPct  = 1427/2296 = 0.62151568 → ×1000 = 621.51568 → 622 → 62.2
 *     renterOccupiedPct =  869/2296 = 0.37848432 → ×1000 = 378.48432 → 378 → 37.8
 *     (62.2 + 37.8 = 100.0, and 1427 + 869 = 2296 matches the returned total —
 *      the denominator is the SUM of the two counts, not the returned total,
 *      and this recording cannot tell those apart. See the case that can.)
 *
 *   spike-census-acs-sentinel.json — Phoenix tract 04013061017, REAL:
 *     income -666666666 · age 39.5 · total 0 · owner 0 · renter 0
 *     A live sentinel AND a zero denominator in one real tract. This is the
 *     answer to "does a sentinel actually occur" — it does, in Phoenix, in the
 *     client's own market.
 *
 * WHY THE SENTINEL CLASS IS THE ONE THAT BITES. ACS does not omit unavailable
 * values; it returns them as negatives in the same numeric field. Pass one
 * through and the member reads "median household income −$666,666,666";
 * coalesce it with `|| 0` and they read "$0", a real-looking figure claiming a
 * neighbourhood has no income. This is the THIRD appearance of the class after
 * `daysOnZillow: -1` and the detail DOM.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { runComps } from '../../src/features/comps/service.js';
import { golden01 } from '../fixtures/golden/index.js';
import type { Demographics } from '../../src/features/comps/types.js';
import {
  ACS_SENTINELS,
  ACS_VARIABLES,
  mapDemographicsFromAcs,
  mapTractFromGeocoder,
  tenurePercentagesReconcile,
  type TractRef,
} from '../../src/features/comps/providers/census.js';

const MODS = ['providers/census'] as const;

const FIX = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'features', 'comps', '__fixtures__',
);
const load = (n: string) => JSON.parse(readFileSync(resolve(FIX, n), 'utf8'));

const REAL = load('spike-census-acs.json') as string[][];
const REAL_SENTINEL = load('spike-census-acs-sentinel.json') as string[][];
const GEOCODE = load('spike-census-geocode.json');

const TRACT: TractRef = { geoid: '04013111700', name: 'Census Tract 1117' } as TractRef;

/** Build an ACS body from a header→value map, so cases read as data. */
const body = (cols: Record<string, string | number>): string[][] => [
  Object.keys(cols),
  Object.values(cols).map(String),
];

const ALL = [
  ACS_VARIABLES.medianHouseholdIncome,
  ACS_VARIABLES.medianAge,
  ACS_VARIABLES.tenureOwner,
  ACS_VARIABLES.tenureRenter,
];

describe(`census demographics${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the recording still says what §14.10 was written from', () => {
    it('the real tract carries the values the derivation below assumes', () => {
      const [headers, values] = REAL;
      const at = (n: string) => values[headers.indexOf(n)];
      expect(at(ACS_VARIABLES.medianHouseholdIncome)).toBe('93333');
      expect(at(ACS_VARIABLES.medianAge)).toBe('37.9');
      expect(at(ACS_VARIABLES.tenureOwner)).toBe('1427');
      expect(at(ACS_VARIABLES.tenureRenter)).toBe('869');
    });

    it('a REAL Phoenix tract returns a sentinel — this is not a fixture assumption', () => {
      const [headers, values] = REAL_SENTINEL;
      const income = Number(values[headers.indexOf(ACS_VARIABLES.medianHouseholdIncome)]);
      expect(ACS_SENTINELS.has(income), `${income} is not in the enumerated set`).toBe(true);
      expect(income).toBe(-666666666);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 3 — suppressed values are unavailable, never zero', () => {
    it('all SIX enumerated sentinels are present, as a set not a threshold', () => {
      // The operator's ruling: a partial enumeration is the same failure as a
      // threshold. Asserted as an exact set so adding one is a visible decision
      // and dropping one is a failure.
      expect([...ACS_SENTINELS].sort((a, b) => a - b)).toEqual([
        -999999999, -888888888, -666666666, -555555555, -333333333, -222222222,
      ].sort((a, b) => a - b));
    });

    it.each([...ACS_SENTINELS])('sentinel %i nulls EVERY numeric field it appears in', (s) => {
      const out = mapDemographicsFromAcs(
        body(Object.fromEntries(ALL.map((v) => [v, s]))), TRACT,
      );
      expect(out.medianHouseholdIncome, `income survived sentinel ${s}`).toBeNull();
      expect(out.medianAge, `age survived sentinel ${s}`).toBeNull();
      expect(out.ownerOccupiedPct, `owner% survived sentinel ${s}`).toBeNull();
      expect(out.renterOccupiedPct, `renter% survived sentinel ${s}`).toBeNull();
    });

    it.each([...ACS_SENTINELS])('sentinel %i is never coalesced to ZERO', (s) => {
      // `?? 0` / `|| 0` renders "$0" — a measured-looking claim that a
      // neighbourhood has no income. Worse than a dash, because it is legible.
      const out = mapDemographicsFromAcs(
        body(Object.fromEntries(ALL.map((v) => [v, s]))), TRACT,
      );
      // UNGUARDED, and my own dead-guard sweep is why. This was
      // `if (typeof v === 'number') expect(v).not.toBe(0)` — false for every
      // field precisely when the mapper is CORRECT (all sentinels null), so
      // the assertion never ran. The exact pattern I documented, in a test I
      // had just written. Asserting null directly subsumes "not zero" and
      // cannot go dead.
      expect(
        [out.medianHouseholdIncome, out.medianAge, out.ownerOccupiedPct, out.renterOccupiedPct],
        `sentinel ${s} produced a figure — if any is 0 the member reads a measured ` +
          'claim that a neighbourhood has no income or nobody owns their home',
      ).toEqual([null, null, null, null]);
    });

    it('THE INVERSE: a genuine 0 count is a value, not an absence', () => {
      // An all-rental tract really is 0% owner-occupied. A "drop anything <= 0"
      // filter eats it and reports unavailable for a fact we actually have.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 0,
        [ACS_VARIABLES.tenureRenter]: 250,
      }), TRACT);
      expect(out.ownerOccupiedPct, 'a real 0% was discarded as if it were a sentinel').toBe(0);
      expect(out.renterOccupiedPct).toBe(100);
    });

    it('the REAL sentinel tract: income nulls, age survives, both percentages null', () => {
      // Hand-derived from spike-census-acs-sentinel.json. One real tract
      // exercising the sentinel AND the zero-denominator guard together —
      // and proving a sibling field is not collateral damage.
      const out = mapDemographicsFromAcs(REAL_SENTINEL, TRACT);
      expect(out.medianHouseholdIncome, 'the -666666666 reached the member').toBeNull();
      expect(out.medianAge, 'a GOOD field was nulled because a sibling was suppressed')
        .toBe(39.5);
      expect(out.ownerOccupiedPct, '0/0 produced a percentage').toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });

    it('a zero DENOMINATOR yields null, never NaN and never 0', () => {
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 0,
        [ACS_VARIABLES.tenureRenter]: 0,
      }), TRACT);
      expect(out.ownerOccupiedPct).toBeNull();
      expect(Number.isNaN(out.ownerOccupiedPct as number), '0/0 rendered as NaN').toBe(false);
    });

    it('an ABSENT column is null — never zero, never invented', () => {
      const out = mapDemographicsFromAcs(body({}), TRACT);
      expect(out.medianHouseholdIncome).toBeNull();
      expect(out.medianAge).toBeNull();
      expect(out.ownerOccupiedPct).toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 2 — arithmetic on returned counts, never inference', () => {
    it('the real tract computes both percentages to the hand-derived figures', () => {
      const out = mapDemographicsFromAcs(REAL, TRACT);
      expect(out.medianHouseholdIncome).toBe(93333);
      expect(out.medianAge).toBe(37.9);
      expect(out.ownerOccupiedPct, '1427/2296 = 62.2 to 1dp').toBe(62.2);
      expect(out.renterOccupiedPct, '869/2296 = 37.8 to 1dp').toBe(37.8);
    });

    it('a percentage needs BOTH counts — one suppressed nulls both', () => {
      // The inference boundary. With only the owner count returned, a
      // percentage can still be computed against the returned TOTAL — and that
      // is inference, because the total counts households the tenure split does
      // not. Both counts or neither.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 1427,
        [ACS_VARIABLES.tenureRenter]: -666666666,
        [ACS_VARIABLES.tenureTotal ?? 'B25003_001E']: 2296,
      }), TRACT);
      expect(
        out.ownerOccupiedPct,
        'a percentage was computed against the returned TOTAL while the renter ' +
          'count was suppressed — that denominator was not measured for this split',
      ).toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });

    it('the denominator is the SUM of the two counts, not the returned total', () => {
      // The recording cannot distinguish these (1427 + 869 = 2296 exactly), so
      // this case makes them disagree. A total that exceeds the split is
      // ordinary — it counts households the tenure variables do not classify.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 300,
        [ACS_VARIABLES.tenureRenter]: 100,
        [ACS_VARIABLES.tenureTotal ?? 'B25003_001E']: 500,
      }), TRACT);
      expect(out.ownerOccupiedPct, '300/400 = 75; against the total it would read 60').toBe(75);
      expect(out.renterOccupiedPct).toBe(25);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('columns are located BY NAME, never by position', () => {
    it('a re-ordered ACS response maps every field correctly', () => {
      // The detail-batch lesson, in a second place. ACS is array-of-arrays: a
      // positional read produces a full set of real-looking numbers with the
      // income in the age column, and nothing about it looks broken.
      const ordered = mapDemographicsFromAcs(REAL, TRACT);
      const [headers, values] = REAL;
      const idx = headers.map((_h, i) => i).reverse();
      const shuffled: string[][] = [idx.map((i) => headers[i]), idx.map((i) => values[i])];

      expect(shuffled[0], 'the fixture is not actually re-ordered').not.toEqual(headers);
      const out = mapDemographicsFromAcs(shuffled, TRACT);
      expect(out.medianHouseholdIncome, 'a positional read put another column in income')
        .toBe(ordered.medianHouseholdIncome);
      expect(out.medianAge).toBe(ordered.medianAge);
      expect(out.ownerOccupiedPct).toBe(ordered.ownerOccupiedPct);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 4 — geography and vintage', () => {
    it('the tract resolves from the geocoder recording, with a checkable name', () => {
      const tract = mapTractFromGeocoder(GEOCODE);
      expect(tract, 'the recorded geocoder response did not resolve a tract').not.toBeNull();
      expect(tract!.geoid, 'the GEOID is not the recorded tract').toBe('04013111700');
      expect(String(tract!.name), 'the tract has no member-checkable name').toContain('1117');
    });

    it('a geocoder response with NO tract resolves to null, never a nearby one', () => {
      // A tract is a few thousand people. Falling back to a neighbouring tract
      // is the wrong-house bug in demographic clothing — invisible, confident,
      // and about someone's actual property.
      expect(mapTractFromGeocoder({ result: { geographies: {} } })).toBeNull();
      expect(mapTractFromGeocoder({})).toBeNull();
      expect(mapTractFromGeocoder(null)).toBeNull();
    });

    it('the mapped result carries its vintage', () => {
      const out = mapDemographicsFromAcs(REAL, TRACT);
      expect(out.acsYear, 'no ACS vintage on the figures').toBeTypeOf('number');
      expect(out.acsYear, 'the vintage is not a plausible ACS year').toBeGreaterThan(2015);
      expect(out.tractGeoid, 'no geography on the figures').toBe('04013111700');
    });
  });
  // =========================================================================
  // BUG-013 VERIFICATION — the two layers, and that they do DIFFERENT jobs.
  //
  // An enumerated sentinel that LOGS is as wrong as an unlisted negative that
  // does not: the first floods the log with expected suppression until nobody
  // reads it, the second is the silence that let "renter-occupied 150%" ship.
  // The split is the fix, so the split is what gets asserted.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('BUG-013 — the enumerated set is SILENT', () => {
    it.each([...ACS_SENTINELS])('sentinel %i nulls WITHOUT reporting', (sent) => {
      const seen: unknown[] = [];
      const out = mapDemographicsFromAcs(
        body(Object.fromEntries(ALL.map((v) => [v, sent]))), TRACT, undefined,
        (a) => seen.push(a),
      );
      expect(out.medianHouseholdIncome, `sentinel ${sent} rendered`).toBeNull();
      expect(
        seen,
        `documented suppression reported as an anomaly. Every tract with a ` +
          `suppressed field would log, the WARN stops being read, and the one ` +
          `line that means "Census added an annotation" is lost in it.`,
      ).toEqual([]);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('BUG-013 — the domain floor REPORTS', () => {
    const FIELDS: Array<[string, string]> = [
      ['median income', ACS_VARIABLES.medianHouseholdIncome],
      ['median age', ACS_VARIABLES.medianAge],
      ['owner count', ACS_VARIABLES.tenureOwner],
      ['renter count', ACS_VARIABLES.tenureRenter],
    ];

    it.each(FIELDS)('%s: an unlisted negative nulls AND reports', (label, variable) => {
      // Each field independently — a floor applied to three of four is the
      // partial-enumeration failure one level up.
      const seen: Array<{ variable: string; value: number; tractGeoid: string }> = [];
      const out = mapDemographicsFromAcs(
        body({ [variable]: -5 }), TRACT, undefined, (a) => seen.push(a),
      );

      expect(seen.length, `${label}: an unlisted negative was not reported`).toBe(1);
      // The log CONTENT is the guarantee, not that something fired. A WARN
      // without the variable and the raw value cannot tell you Census added
      // an annotation, which is the only reason the line exists.
      expect(seen[0].variable, `${label}: the report does not name the variable`)
        .toBe(variable);
      expect(seen[0].value, `${label}: the report does not carry the RAW value`).toBe(-5);
      expect(seen[0].tractGeoid, `${label}: the report does not name the tract`)
        .toBe('04013111700');

      // ...and the member still sees nothing.
      const rendered = [
        out.medianHouseholdIncome, out.medianAge, out.ownerOccupiedPct, out.renterOccupiedPct,
      ];
      expect(rendered, `${label}: a negative reached the member`).toEqual([null, null, null, null]);
    });

    it('the original repro: no negative figure, and no percentage over 100', () => {
      const seen: unknown[] = [];
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: -50,
        [ACS_VARIABLES.tenureRenter]: 150,
      }), TRACT, undefined, (a) => seen.push(a));
      expect(out.ownerOccupiedPct, 'a negative tenure percentage reached the member').toBeNull();
      expect(out.renterOccupiedPct, 'a percentage over 100% reached the member').toBeNull();
      expect(seen.length, 'the anomaly was swallowed').toBe(1);
    });

    it('a NON-negative unlisted value is NOT reported — the floor is a floor', () => {
      // The inverse. A floor that reports ordinary data is noise, and noise is
      // how the one line that matters gets missed.
      const seen: unknown[] = [];
      mapDemographicsFromAcs(body({
        [ACS_VARIABLES.medianHouseholdIncome]: 93333,
        [ACS_VARIABLES.medianAge]: 0,
        [ACS_VARIABLES.tenureOwner]: 0,
        [ACS_VARIABLES.tenureRenter]: 250,
      }), TRACT, undefined, (a) => seen.push(a));
      expect(seen, 'ordinary values were reported as anomalies').toEqual([]);
    });

    it('the observer is OPTIONAL — omitting it must not throw', () => {
      // `onUnrecognized?.()` — asserted because a required observer would make
      // every direct caller of the mapper a crash risk on bad data, which is
      // exactly when you least want one.
      expect(() => mapDemographicsFromAcs(
        body({ [ACS_VARIABLES.medianAge]: -5 }), TRACT,
      )).not.toThrow();
    });
  });

  describe.skipIf(pendingSlice(...MODS))('BUG-013 — the reconciliation backstop', () => {
    it('is UNREACHABLE through this seam while the floor holds — proven, not assumed', () => {
      // The operator asked me to exercise it with the floor bypassed. I cannot
      // through the public seam, and that is worth stating precisely rather
      // than faking: the floor nulls every negative, so both counts are >= 0,
      // so part/(owner+renter) is in [0,1], so the percentage is in [0,100].
      // Math.round(x*1000)/10 cannot exceed 100 when x <= 1.
      //
      // Swept rather than argued. If any pair escapes the range, the backstop
      // is reachable and this case fails, which is the signal I actually want.
      const probes = [0, 1, 2, 7, 99, 1427, 869, 1e6, 1e15, Number.MAX_SAFE_INTEGER];
      const computed: Array<{ pair: string; who: string; pct: number }> = [];
      for (const o of probes) {
        for (const r of probes) {
          const out = mapDemographicsFromAcs(body({
            [ACS_VARIABLES.tenureOwner]: o,
            [ACS_VARIABLES.tenureRenter]: r,
          }), TRACT);
          // Collect rather than branch. `if (v !== null) expect(...)` is false
          // for the 0/0 pair, and a branch that skips is one my own sweep has
          // to keep re-classifying. Collecting also buys the precondition the
          // branching form never had.
          for (const [who, v] of [['owner', out.ownerOccupiedPct], ['renter', out.renterOccupiedPct]] as const) {
            if (v !== null) computed.push({ pair: `${o}/${r}`, who, pct: v });
          }
        }
      }

      expect(computed.length, 'no pair produced a percentage — the sweep proves nothing')
        .toBeGreaterThan(probes.length);
      const escaped = computed.filter((c) => c.pct < 0 || c.pct > 100);
      expect(
        escaped,
        'a non-negative count pair produced a percentage outside [0,100] — the ' +
          'backstop is REACHABLE and must be exercised directly, not assumed dead',
      ).toEqual([]);
    });

    it('DISCLOSED GAP: the backstop cannot be exercised from outside', () => {
      // Recorded so its untested-ness is a decision rather than an oversight.
      // The backstop is defensive depth for a future refactor of the floor,
      // and the seam offers no way to break the floor. Exporting the
      // reconciliation predicate would make it directly testable; until then
      // the case above proves the property it depends on (unreachability)
      // rather than the branch itself.
      //
      // Left as a named assertion so it appears in the run and cannot be
      // mistaken for coverage of the branch.
      expect(true).toBe(true);
    });
  });
  // =========================================================================
  // The DISCLOSED design note, confirmed behaviourally rather than by reading
  // the code: the observer fires on LIVE fetches only. An anomalous tract logs
  // once per cold fetch; the cached result re-serves silently.
  //
  // Approved, and the reasoning holds — the WARN exists to tell us Census grew
  // an annotation, which is a per-tract fact, not a per-view one. Logging it
  // on every member view would bury it. But "approved" is not "verified", and
  // the failure mode if it were wrong is the opposite of loud: a warm cache
  // would silently stop reporting a tract that is still anomalous.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the observer fires on LIVE fetches only', () => {
    const SUBJECT = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
    const FRESH = golden01.comps.map((c, i) => ({
      ...c,
      soldDate: new Date(Date.now() - (20 + i * 5) * 86_400_000).toISOString().slice(0, 10),
    }));

    /** A census provider that maps an ANOMALOUS row through the real mapper. */
    function anomalousCensusProvider() {
      let fetches = 0;
      return {
        get fetches() { return fetches; },
        provider: {
          async resolveTract() { return TRACT; },
          async fetchDemographics(
            tract: TractRef,
            opts?: { onUnrecognized?: (a: { variable: string; value: number; tractGeoid: string }) => void },
          ) {
            fetches += 1;
            // -5 is unlisted, so the floor reports it — through whatever
            // observer the SERVICE passed in, which is the thing under test.
            return mapDemographicsFromAcs(
              body({ [ACS_VARIABLES.medianAge]: -5, [ACS_VARIABLES.medianHouseholdIncome]: 93333 }),
              tract, undefined, opts?.onUnrecognized,
            );
          },
        },
      };
    }

    function memoryCensusCache() {
      const store: Record<string, Demographics> = {};
      return {
        get size() { return Object.keys(store).length; },
        cache: {
          async get(geoid: string) { return store[geoid] ?? null; },
          async set(geoid: string, d: Demographics) { store[geoid] = d; },
        },
      };
    }

    /** Collect WARN lines from the service logger. */
    function warnCollector() {
      const warns: Array<Record<string, unknown>> = [];
      return {
        warns,
        logger: {
          warn: (obj: unknown) => { warns.push(obj as Record<string, unknown>); },
          info: () => {}, error: () => {}, debug: () => {},
        },
      };
    }

    it('a COLD fetch reports once; the WARM serve reports nothing and still renders', async () => {
      const census = anomalousCensusProvider();
      const cache = memoryCensusCache();
      const log = warnCollector();

      const cold = await runComps('123 Main St, Seattle WA', {
        provider: makeProviderSpy({ subject: SUBJECT, comps: FRESH, noDetailSupport: true }).provider as never,
        censusProvider: census.provider as never,
        censusCache: cache.cache as never,
        logger: log.logger as never,
      });
      expect(cold.ok, 'the cold lookup failed').toBe(true);

      // PRECONDITION — the anomaly must actually have been reported on the
      // cold path, or "silent on the warm path" is true of a build that never
      // reports at all.
      const anomalies = log.warns.filter((w) => String(w.variable ?? '').length > 0);
      expect(anomalies.length, 'the COLD fetch did not report the anomaly').toBe(1);
      expect(anomalies[0].value, 'the report lost the raw value').toBe(-5);
      expect(anomalies[0].tractGeoid).toBe('04013111700');
      expect(census.fetches, 'the cold path did not fetch').toBe(1);
      expect(cache.size, 'nothing was cached, so the warm path below is not warm')
        .toBeGreaterThan(0);

      // Warm serve, same tract, fresh logger so the count is unambiguous.
      const log2 = warnCollector();
      const warm = await runComps('123 Main St, Seattle WA', {
        provider: makeProviderSpy({ subject: SUBJECT, comps: FRESH, noDetailSupport: true }).provider as never,
        censusProvider: census.provider as never,
        censusCache: cache.cache as never,
        logger: log2.logger as never,
      });
      expect(warm.ok).toBe(true);

      expect(census.fetches, 'the warm serve re-fetched — the cache is not being read').toBe(1);
      expect(
        log2.warns.filter((w) => String(w.variable ?? '').length > 0),
        'the warm serve re-reported — the WARN would fire per member view, not ' +
          'per cold fetch, and the line that means "Census added an annotation" ' +
          'would be buried in repeats',
      ).toEqual([]);

      // ...and the cached anomaly still re-serves as unavailable, not as -5.
      // UNCONDITIONAL: `if (warm.ok && warm.demographics)` went dead here and
      // my own sweep caught it within the run. Asserting directly says which
      // half is missing instead of silently proving nothing.
      const served = warm.ok ? warm.demographics : undefined;
      expect(served, 'the warm serve returned NO demographics — the cache read ' +
        'succeeded but the result never reached the outcome').toBeTruthy();
      expect(served!.medianAge, 'the cached anomaly re-served as a figure').toBeNull();
      expect(served!.medianHouseholdIncome, 'the good sibling was lost in the cache')
        .toBe(93333);
    });
  });
  // =========================================================================
  // The reconciliation backstop, now DIRECTLY testable (MASON exported the
  // predicate after I recorded that I could not reach it through the seam).
  // The disclosed gap is closed: the branch is exercised, not inferred.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('tenurePercentagesReconcile — the backstop branch', () => {
    it('accepts every in-range pair, including both boundaries', () => {
      for (const [o, r] of [[0, 100], [100, 0], [62.2, 37.8], [50, 50], [0, 0]] as const) {
        expect(tenurePercentagesReconcile(o, r), `${o}/${r} was rejected`).toBe(true);
      }
    });

    it('REJECTS the shapes BUG-013 produced — negative and over 100', () => {
      // The exact pair from the original repro: owner -50 / renter 150.
      expect(tenurePercentagesReconcile(-50, 150), 'the BUG-013 pair reconciles').toBe(false);
      expect(tenurePercentagesReconcile(-0.1, 100), 'a fractional negative reconciles').toBe(false);
      expect(tenurePercentagesReconcile(100.1, 0), 'a fractional overshoot reconciles').toBe(false);
      expect(tenurePercentagesReconcile(150, -50), 'the mirrored pair reconciles').toBe(false);
    });

    it('a NULL pair reconciles — unavailable is not a contradiction', () => {
      // Null means "we have no figure", which cannot be out of range. Treating
      // it as a failure would fire the backstop on every suppressed tract and
      // report an anomaly for ordinary, expected suppression — the same
      // signal-drowning failure the enumerated/floor split exists to avoid.
      expect(tenurePercentagesReconcile(null, null)).toBe(true);
      expect(tenurePercentagesReconcile(62.2, null)).toBe(true);
      expect(tenurePercentagesReconcile(null, 37.8)).toBe(true);
    });

    it('the mapper AGREES with the predicate on everything it produces', () => {
      // The two must not drift: whatever the mapper emits has to satisfy the
      // predicate that exists to catch what it emits.
      const probes = [0, 1, 7, 99, 1427, 869, 1e6];
      for (const o of probes) {
        for (const r of probes) {
          const out = mapDemographicsFromAcs(body({
            [ACS_VARIABLES.tenureOwner]: o, [ACS_VARIABLES.tenureRenter]: r,
          }), TRACT);
          expect(
            tenurePercentagesReconcile(out.ownerOccupiedPct, out.renterOccupiedPct),
            `the mapper produced ${out.ownerOccupiedPct}/${out.renterOccupiedPct} from ` +
              `${o}/${r}, which its own backstop rejects`,
          ).toBe(true);
        }
      }
    });
  });
});
