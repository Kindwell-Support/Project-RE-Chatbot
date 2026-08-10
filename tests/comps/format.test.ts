/**
 * PRIORITY 3 — `format.ts` renders ONLY from data. CONTRACT §11.
 *
 * This is the structural half of the honesty guarantee. The model is handed a
 * rendered block and told to relay it; if the renderer can emit a number that
 * isn't in its input, then "the model never authors comp data" is false no
 * matter how good the system prompt is.
 *
 * The load-bearing test here is `every dollar figure traces back to an input
 * field` — it extracts every currency amount from the rendered string and
 * requires each one to be derivable from the outcome object. A renderer that
 * rounds, averages, or "helpfully" totals something on its own fails it.
 *
 * Second guarantee: the block must be DEFENSIBLE. A human reading it should be
 * able to reconstruct the ARV — the trimmed $/sqft, the subject sqft, the
 * multiplication, and which comps were discounted and why.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import { selectTiers } from '../../src/features/comps/filter.js';
import { rankComps } from '../../src/features/comps/rank.js';
import { ALGO_VERSION } from '../../src/features/comps/config.js';
import { golden01, golden03, type GoldenCase } from '../fixtures/golden/index.js';
import type { CompsFailureCode } from '../../src/features/comps/types.js';

const MODS = ['format'] as const;

/** Build a real CompsResult from a golden case, through the real pipeline. */
function resultFor(gc: GoldenCase) {
  const tier = selectTiers(gc.subject as never, gc.comps as never, gc.now);
  const ranked = rankComps(gc.subject as never, tier.kept, gc.now);
  return {
    ok: true as const,
    algoVersion: ALGO_VERSION,
    runId: 'run-fixed-for-determinism',
    subject: gc.subject,
    radiusTierMi: tier.radiusTierMi,
    recencyTierMonths: tier.recencyTierMonths,
    comps: ranked,
    rejected: tier.rejected,
    fromCache: false,
    provider: 'stub',
  };
}

const failure = (code: CompsFailureCode, detail?: Record<string, number>) => ({
  ok: false as const,
  algoVersion: ALGO_VERSION,
  code,
  message: '',
  ...(detail ? { detail } : {}),
});

/** Every `$1,234` / `$1,234.56` amount in the rendered text, as numbers. */
function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

describe(`format.ts renders only from data${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('determinism', () => {
    it('is byte-identical across renders of the same outcome', () => {
      // A cached result and a freshly computed one must render the same block,
      // or the member sees the estimate "change" on a refresh that changed
      // nothing. No Date.now(), no randomness, no Map iteration order.
      const outcome = resultFor(golden01) as never;
      expect(renderCompsForChat(outcome)).toBe(renderCompsForChat(outcome));
    });

    it('two independently-built results for the same input render identically', () => {
      expect(renderCompsForChat(resultFor(golden01) as never))
        .toBe(renderCompsForChat(resultFor(golden01) as never));
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('THE DATA-ONLY GUARANTEE', () => {
    it('every dollar figure traces back to an input field', () => {
      // The one that makes "the model cannot author comp data" structural.
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);

      // The ARV removal makes this test STRICTER, not weaker: the permitted
      // set used to include five derived figures (arv, low, high, per-sqft in
      // two roundings) plus the trimmed values. Now the ONLY currency that may
      // appear is a comp's own sold price or its $/sqft. Anything else in the
      // block is invented, and there is no longer any legitimate derived
      // number for an invented one to hide behind.
      const permitted = new Set<number>();
      for (const c of outcome.comps) {
        permitted.add(c.comp.soldPrice!);
        permitted.add(Math.round(c.pricePerSqft));
        permitted.add(Number(c.pricePerSqft.toFixed(2)));
      }

      const found = dollarAmounts(text);
      expect(found.length, 'the block contains no currency at all').toBeGreaterThan(0);
      for (const amount of found) {
        expect(
          permitted.has(amount),
          `rendered $${amount.toLocaleString()} is not derivable from the outcome — ` +
            `the renderer invented or recomputed a figure`,
        ).toBe(true);
      }
    });

    it('emits exactly one row per comp — no more, no fewer', () => {
      // A renderer that pads to a fixed row count, or drops rows past a limit,
      // makes the table disagree with the ARV it is supposed to justify.
      for (const gc of [golden01, golden03]) {
        const outcome = resultFor(gc);
        const text = renderCompsForChat(outcome as never);
        for (const c of outcome.comps) {
          expect(text, `comp ${c.comp.zpid} is missing from the table`).toContain(c.comp.address);
        }
        // And nothing that isn't a comp appears as one.
        for (const r of outcome.rejected) {
          const asComp = outcome.comps.some((c) => c.comp.zpid === r.comp.zpid);
          if (!asComp) {
            const rows = text.split('\n').filter((l) => l.includes(r.comp.address));
            for (const row of rows) {
              expect(row.toLowerCase(), `rejected comp ${r.comp.zpid} is rendered as a used comp`)
                .toMatch(/reject|excluded|skip|not used|trim/);
            }
          }
        }
      }
    });

    it('cannot emit a comp row from an outcome with no comps', () => {
      // Data-only, stated at its limit: given nothing, it must render nothing.
      const empty = { ...resultFor(golden01), comps: [], rejected: [] };
      const text = renderCompsForChat(empty as never);
      for (const c of golden01.comps) {
        expect(text, 'a comp appeared in a render of an empty comp set').not.toContain(c.address);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the block is defensible — a human can rebuild the ARV', () => {
    it('shows the subject sqft and EVERY comp\'s own $/sqft', () => {
      // RE-POINTED. There is no ARV, band or trimmed mean to show. What makes
      // the block defensible now is that the member can do the arithmetic
      // themselves: subject size, and each comparable's price per square foot.
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);
      const digits = text.replace(/[$,\s]/g, '');

      expect(text, 'the subject square footage is missing').toMatch(/2,?000/);
      expect(outcome.comps.length, 'precondition: no comps to check').toBe(5);
      for (const c of outcome.comps) {
        expect(digits, `comp ${c.comp.zpid} sold price missing`)
          .toContain(String(c.comp.soldPrice));
        expect(digits, `comp ${c.comp.zpid} $/sqft missing`)
          .toContain(String(Math.round(c.pricePerSqft)));
      }

      // ...and the figures the module used to derive are ABSENT. golden 01's
      // v1 answer was $403,000 with a $394,000-$412,000 band. If any of those
      // reappear, something is still computing an ARV.
      for (const gone of ['403000', '394000', '412000']) {
        expect(digits, `a v1 derived figure (${gone}) is back in the block`)
          .not.toContain(gone);
      }
    });

    it('shows each comp\'s price, sqft, $/sqft, sold date and distance', () => {
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);
      const first = outcome.comps[0];
      const digits = text.replace(/[$,\s]/g, '');
      expect(digits).toContain(String(first.comp.soldPrice));
      expect(text).toContain(first.comp.soldDate!);
      expect(text).toMatch(/mi\b|mile/i);
      expect(text).toMatch(/sq ?ft|\/sf|per sq/i);
    });

    it('RETIRED trim reporting — every comp shown is a comp USED, with no gap to explain', () => {
      // The old case existed because the table showed 8 comps while the ARV
      // came from 6, and §11 required the block to name the two that were
      // dropped. There is no trim now and no ARV, so the gap it explained
      // cannot exist — which is worth asserting rather than merely deleting:
      // any surviving trim language would be describing something that no
      // longer happens.
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);
      expect(outcome.comps.length, 'precondition: nothing rendered').toBeGreaterThan(0);
      expect(text.toLowerCase(), 'trim language survived the removal of the trim')
        .not.toMatch(/trimmed mean|trim(med)? (out|off)|set aside|outlier/);
    });

    it('states BOTH rungs that were actually used, not just the radius', () => {
      // §14.2: "CompsResult records BOTH radiusTierMi and recencyTierMonths.
      // The rendered block names both." Naming only the radius hides half of
      // how hard the search had to work — a set found within a mile over
      // twelve months is a different quality of evidence from one found within
      // a mile over three, and the member cannot tell them apart.
      const r1 = resultFor(golden01);
      const r3 = resultFor(golden03);
      const g1 = renderCompsForChat(r1 as never);
      const g3 = renderCompsForChat(r3 as never);

      // POSITIVE PRECONDITION — the two cases must land on DIFFERENT rungs, or
      // "the block names the rung it used" is satisfied by a hardcoded string.
      expect([r1.radiusTierMi, r1.recencyTierMonths], 'golden 01 is not on rung 1')
        .toEqual([1.0, 3]);
      expect([r3.radiusTierMi, r3.recencyTierMonths], 'golden 03 is not on the last rung')
        .toEqual([3.0, 12]);

      expect(g1, 'golden 01 does not name its 1 mi radius').toMatch(/within 1\s*mi/i);
      expect(g1, 'golden 01 does not name its 3-month window').toMatch(/last 3 months/i);
      expect(g3, 'golden 03 does not name its 3 mi radius').toMatch(/within 3\s*mi/i);
      expect(g3, 'golden 03 does not name its 12-month window').toMatch(/last 12 months/i);

      // The rung is not cosmetic — golden 03 searched nine times the area over
      // four times the window to find three comps, and the block must say so
      // rather than reporting the tight search it started with.
      expect(g3, 'golden 03 is reported as a tight, recent search').not.toMatch(/within 1\s*mi/i);
      expect(g3).not.toMatch(/last 3 months/i);
    });

    it('carries the disclaimer footer on every success', () => {
      for (const gc of [golden01, golden03]) {
        const text = renderCompsForChat(resultFor(gc) as never);
        expect(text.toLowerCase(), `no disclaimer for ${gc.id}`)
          .toMatch(/automated estimate|not a formal appraisal|not an appraisal/);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('low confidence says so in the copy', () => {
    it('RETIRED — no confidence grade is emitted for a thin set OR a full one', () => {
      // §14.8: `confidenceLine` is gone. The old pair of cases proved the
      // warning fired on low and stayed silent on high; with no grade to
      // qualify, a surviving line would be grading nothing.
      //
      // What replaces it as the member's signal is the plain comp COUNT, which
      // a list makes self-evident in a way a single number never did: three
      // rows read as three rows.
      const thin = resultFor(golden03);
      const full = resultFor(golden01);
      expect([thin.comps.length, full.comps.length], 'precondition: these sets are the same size')
        .toEqual([3, 5]);

      for (const [name, outcome] of [['thin', thin], ['full', full]] as const) {
        const text = renderCompsForChat(outcome as never).toLowerCase();
        expect(text, `a confidence grade survived on the ${name} set`)
          .not.toMatch(/confidence|weak estimate|high confidence|low confidence/);
        expect(text, `the ${name} set does not state its comp count`)
          .toContain(`${outcome.comps.length} sold comps`);
      }
    });

    it('the emit order is opening -> header -> table -> closing -> footer, with no gap', () => {
      // §14.8 pins the order and says there must be "no gap where the ARV used
      // to be". A renderer that leaves the slot behind ships a double blank
      // line mid-block, which reads as a truncated response.
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);

      const at = (needle: string | RegExp) => {
        const i = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
        expect(i, `missing from the block: ${needle}`).toBeGreaterThanOrEqual(0);
        return i;
      };
      const opening = at('Sure. Here are recent comparable sales');
      const header = at(/\*\*Comps for /);
      const table = at(outcome.comps[0].comp.address!);
      const closing = at('Evaluate each property carefully');
      const footer = at(/not a formal appraisal/i);

      expect([opening, header, table, closing, footer], 'the emit order is wrong')
        .toEqual([...[opening, header, table, closing, footer]].sort((a, b) => a - b));

      expect(text, 'a blank slot was left where the ARV block used to be')
        .not.toMatch(/\n{3,}/);
    });
  });

  // =========================================================================
  // EVERY COPY BRANCH — CONTRACT_CHANGE 0019 + the TOO_FEW_COMPS pool branch.
  //
  // Six codes, but two of them BRANCH on `detail`, so the delivered surface is
  // eight distinct member-facing strings. The failure matrix elsewhere covers
  // the default branch of each; a branch nobody exercises is a branch nobody
  // has read, and these are the sentences a member sees at the exact moment
  // the feature has failed them.
  //
  // MASON reports both ADDRESS_NOT_FOUND branches clean. That is his account;
  // this is the evidence.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('all eight failure copy branches', () => {
    const BRANCHES: Array<[string, CompsFailureCode, Record<string, unknown> | undefined]> = [
      ['ADDRESS_NOT_FOUND / not_found', 'ADDRESS_NOT_FOUND', { resolution: 'not_found' }],
      ['ADDRESS_NOT_FOUND / mismatch, unit typed', 'ADDRESS_NOT_FOUND',
        { resolution: 'unit_mismatch', inputHasUnit: true }],
      ['ADDRESS_NOT_FOUND / mismatch, no unit typed', 'ADDRESS_NOT_FOUND',
        { resolution: 'unit_mismatch', inputHasUnit: false }],
      ['ADDRESS_NOT_FOUND / no detail', 'ADDRESS_NOT_FOUND', undefined],
      ['SUBJECT_SQFT_UNKNOWN', 'SUBJECT_SQFT_UNKNOWN', undefined],
      ['TOO_FEW_COMPS / thin market', 'TOO_FEW_COMPS', { kept: 2, needed: 3, radiusTierMi: 2 }],
      ['TOO_FEW_COMPS / no_type_match', 'TOO_FEW_COMPS', { pool: 'no_type_match' }],
      ['TOO_FEW_COMPS / no detail', 'TOO_FEW_COMPS', undefined],
      ['PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT', undefined],
      ['PROVIDER_ERROR', 'PROVIDER_ERROR', undefined],
      ['RATE_LIMITED', 'RATE_LIMITED', undefined],
    ];

    /**
     * Any figure a member could read as a property value.
     *
     * Deliberately NOT "contains a digit": TOO_FEW_COMPS is required by §10 to
     * state its counts ("2 usable sold comps within 2 mi ... at least 3"), and
     * those are the honest part of the message. What must never appear is a
     * VALUE — a dollar amount, a k/m-suffixed figure, or any bare number large
     * enough to read as a price.
     */
    function valueShapedFigures(text: string): string[] {
      const hits: string[] = [];
      for (const m of text.matchAll(/\$\s?[\d,]*\d(?:\.\d+)?/g)) hits.push(m[0]);
      for (const m of text.matchAll(/\b\d[\d,]*(?:\.\d+)?\s*[km]\b/gi)) hits.push(m[0]);
      for (const m of text.matchAll(/\b\d[\d,]*\b/g)) {
        if (Number(m[0].replace(/,/g, '')) >= 1000) hits.push(m[0]);
      }
      return hits;
    }

    it('the value-figure detector actually detects — it is not a rubber stamp', () => {
      // A guard that never fires proves nothing about the copy it guards.
      for (const bad of ['$403,000', 'about 450k', '1.2m', 'roughly 403000', '$0']) {
        expect(valueShapedFigures(bad).length, `missed a figure in "${bad}"`).toBeGreaterThan(0);
      }
      // ...and does not fire on the counts §10 requires.
      for (const ok of ['2 usable sold comps within 2 mi', 'at least 3', '12 months']) {
        expect(valueShapedFigures(ok), `false positive on "${ok}"`).toEqual([]);
      }
    });

    it.each(BRANCHES)('%s: carries no value-shaped figure', (_label, code, detail) => {
      const text = renderCompsForChat(
        failure(code, detail as Record<string, number> | undefined) as never,
      );
      expect(text.trim().length, 'rendered empty').toBeGreaterThan(0);
      expect(
        valueShapedFigures(text),
        `a member could read a property value out of this failure copy:\n${text}`,
      ).toEqual([]);
      expect(text).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
    });

    it.each(BRANCHES)('%s: offers manual ARV entry', (_label, code, detail) => {
      const text = renderCompsForChat(
        failure(code, detail as Record<string, number> | undefined) as never,
      );
      const t = text.toLowerCase();
      const mentionsArv = t.includes('arv') || t.includes('after-repair') || t.includes('after repair');
      const invites = ['tell me', 'give me', 'your own', 'you have', 'already have',
        'manual', 'supply', 'enter', 'provide', 'with yours', 'with it'].some((p) => t.includes(p));
      expect(mentionsArv, `no ARV offer in:\n${text}`).toBe(true);
      expect(invites, `no invitation to supply one in:\n${text}`).toBe(true);
    });

    it('the two ADDRESS_NOT_FOUND branches say genuinely different things', () => {
      // The point of the operator's ruling: a wrong-property match means the
      // address may be perfectly real, so "check the spelling" blames the
      // member for Zillow's index.
      const notFound = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', { resolution: 'not_found' } as never) as never,
      );
      const mismatch = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', {
          resolution: 'unit_mismatch', inputHasUnit: true,
        } as never) as never,
      );
      expect(mismatch).not.toBe(notFound);
      expect(notFound.toLowerCase(), 'the not-found branch should ask about spelling')
        .toMatch(/spelling|city and state/);
      expect(mismatch.toLowerCase(), 'the mismatch branch should name the unit problem')
        .toMatch(/unit/);
      expect(
        mismatch.toLowerCase(),
        'the mismatch branch blames the member for spelling when the address may be fine',
      ).not.toMatch(/spelling/);
    });

    it('an unknown detail value falls back to the default branch, not to nothing', () => {
      // Defensive: a future `resolution` value must not render an empty block.
      const odd = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', { resolution: 'something_new' } as never) as never,
      );
      const base = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', { resolution: 'not_found' } as never) as never,
      );
      expect(odd).toBe(base);
    });

    it('no two branches collapse into the same copy, except the one pair that should', () => {
      const rendered = new Map(
        BRANCHES.map(([label, code, detail]) => [
          label,
          renderCompsForChat(failure(code, detail as Record<string, number> | undefined) as never).trim(),
        ]),
      );

      // The ONE legitimate coincidence: `not_found` IS the default branch, so
      // passing it explicitly and passing no detail must render identically.
      expect(rendered.get('ADDRESS_NOT_FOUND / not_found'))
        .toBe(rendered.get('ADDRESS_NOT_FOUND / no detail'));

      // TOO_FEW_COMPS with and without detail must NOT coincide — the counts
      // are the honest part of that message, and a version that drops them
      // tells the member nothing about how hard we looked.
      expect(
        rendered.get('TOO_FEW_COMPS / thin market'),
        'the counted and uncounted TOO_FEW_COMPS copy are identical — the ' +
          'detail fields are being ignored',
      ).not.toBe(rendered.get('TOO_FEW_COMPS / no detail'));

      // Everything else distinct: exactly 1 intended duplicate.
      expect(new Set(rendered.values()).size, 'two branches share copy unexpectedly')
        .toBe(BRANCHES.length - 1);
    });

    it('never tells a member to check a unit number they did not type', () => {
      // 0f6cd86's point, and the same failure shape as "check the spelling":
      // blaming the member for Zillow's resolution. If no unit designator was
      // in their input, "double-check the unit number" is an instruction to
      // re-examine something that was never there.
      const noUnit = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', {
          resolution: 'unit_mismatch', inputHasUnit: false,
        } as never) as never,
      );
      expect(
        noUnit.toLowerCase(),
        'told the member to double-check a unit number they never entered',
      ).not.toMatch(/double-check the unit|check the unit number/);
      // It should still SUGGEST a unit as a possible fix — that is useful.
      expect(noUnit.toLowerCase(), 'no suggestion that a unit number might help')
        .toMatch(/unit/);
      expect(noUnit.toLowerCase(), 'blamed the spelling instead').not.toMatch(/spelling/);

      // And the typed-unit branch keeps the direct instruction, which is right
      // when they DID give one.
      const withUnit = renderCompsForChat(
        failure('ADDRESS_NOT_FOUND', {
          resolution: 'unit_mismatch', inputHasUnit: true,
        } as never) as never,
      );
      expect(withUnit.toLowerCase()).toMatch(/double-check the unit/);
      expect(withUnit).not.toBe(noUnit);
    });
  });

  // =========================================================================
  // FAILURE PATH — what format.ts actually owns.
  //
  // Established by probe: `renderCompsForChat` RELAYS `outcome.message` for
  // failures. It does not read `code` or `detail` and does not generate §10
  // copy. That contradicts §11's wording ("Failures render their §10 copy",
  // stated under the format.ts heading) — the copy is composed in service.ts.
  //
  // The architecture is defensible; the contract text is not. Raised as
  // FINDING-002. What matters is that SOMETHING guarantees the §10 properties
  // for every code, and that guarantee is asserted at the service layer in
  // `service.test.ts` where the copy is actually built. Testing it here would
  // have been testing the wrong altitude.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('failure rendering (passthrough contract)', () => {
    it('relays the message it is given, unchanged', () => {
      const msg = 'Only 2 sold nearby in the last 12 months — I need at least 3.';
      expect(renderCompsForChat({ ...failure('TOO_FEW_COMPS'), message: msg } as never)).toBe(msg);
    });

    it('relays a different message for a different code — it is not hardcoded', () => {
      const a = renderCompsForChat({ ...failure('ADDRESS_NOT_FOUND'), message: 'A' } as never);
      const b = renderCompsForChat({ ...failure('PROVIDER_TIMEOUT'), message: 'B' } as never);
      expect(a).toBe('A');
      expect(b).toBe('B');
    });

    it('BUG-005: returns a STRING even when `message` is absent', () => {
      // FAILS ON PURPOSE — this is the repro, reported in mailbox 0011.
      //
      // The declared signature is `renderCompsForChat(outcome): string`, but a
      // failure with no `message` returns `undefined`. TypeScript does not
      // catch it because `CompsFailure.message` is declared required — the
      // guarantee is only as strong as every service call site remembering to
      // set it, and one that forgets sends `undefined` to the chat layer, where
      // it renders as the literal word "undefined" or throws on `.length`.
      const rendered = renderCompsForChat({
        ok: false, algoVersion: ALGO_VERSION, code: 'TOO_FEW_COMPS',
      } as never);
      expect(typeof rendered, 'renderCompsForChat returned a non-string for a failure')
        .toBe('string');
      expect(rendered).not.toBeUndefined();
    });

    it('BUG-005: an empty message does not produce an empty block', () => {
      // Same defect, gentler input. An empty string is a silent dead end for
      // the member: the tool "succeeded" and said nothing.
      const rendered = renderCompsForChat({
        ok: false, algoVersion: ALGO_VERSION, code: 'PROVIDER_ERROR', message: '',
      } as never);
      expect(String(rendered ?? '').trim().length, 'a failure rendered as an empty block')
        .toBeGreaterThan(0);
    });
  });
});
