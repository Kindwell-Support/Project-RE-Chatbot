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
import { selectRadiusTier } from '../../src/features/comps/filter.js';
import { rankComps } from '../../src/features/comps/rank.js';
import { calculateArv } from '../../src/features/comps/arv.js';
import { ALGO_VERSION } from '../../src/features/comps/config.js';
import { golden01, golden03, type GoldenCase } from '../fixtures/golden/index.js';
import type { CompsFailureCode } from '../../src/features/comps/types.js';

const MODS = ['format'] as const;

/** Build a real CompsResult from a golden case, through the real pipeline. */
function resultFor(gc: GoldenCase) {
  const tier = selectRadiusTier(gc.subject as never, gc.comps as never, gc.now);
  const ranked = rankComps(gc.subject as never, tier.kept, gc.now);
  const arv = calculateArv(gc.subject as never, ranked);
  return {
    ok: true as const,
    algoVersion: ALGO_VERSION,
    runId: 'run-fixed-for-determinism',
    subject: gc.subject,
    radiusTierMi: tier.radiusTierMi,
    comps: ranked,
    rejected: tier.rejected,
    arv,
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

      const permitted = new Set<number>();
      permitted.add(outcome.arv.arv);
      permitted.add(outcome.arv.arvLow);
      permitted.add(outcome.arv.arvHigh);
      permitted.add(Math.round(outcome.arv.arvPerSqft));
      permitted.add(Number(outcome.arv.arvPerSqft.toFixed(2)));
      for (const c of outcome.comps) {
        permitted.add(c.comp.soldPrice!);
        permitted.add(Math.round(c.pricePerSqft));
        permitted.add(Number(c.pricePerSqft.toFixed(2)));
      }
      for (const t of outcome.arv.trimmedOut) {
        permitted.add(Math.round(t.pricePerSqft));
        permitted.add(Number(t.pricePerSqft.toFixed(2)));
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
    it('shows the trimmed $/sqft, the subject sqft, and the ARV', () => {
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);
      const digits = text.replace(/[$,\s]/g, '');

      // golden 01, all hand-computed: 201.3333 $/sqft x 2,000 sqft = $403,000
      expect(digits, 'the ARV is missing').toContain('403000');
      expect(text, 'the subject square footage is missing').toMatch(/2,?000/);
      expect(text, 'the trimmed $/sqft is missing').toMatch(/201/);
      expect(digits, 'the low end of the band is missing').toContain('394000');
      expect(digits, 'the high end of the band is missing').toContain('412000');
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

    it('names the trimmed comps and which end they came off', () => {
      // Without this the table shows 8 comps and an ARV derived from 6, and
      // nothing explains the gap. §11 requires trimmedOut and why.
      const outcome = resultFor(golden01);
      const text = renderCompsForChat(outcome as never);
      expect(outcome.arv.trimmedOut.length).toBe(2);
      expect(text.toLowerCase()).toMatch(/trim|excluded|discard|set aside/);
      for (const t of outcome.arv.trimmedOut) {
        expect(text.replace(/[$,\s]/g, ''), `trimmed $/sqft ${t.pricePerSqft} not shown`)
          .toContain(String(Math.round(t.pricePerSqft)));
      }
    });

    it('states the radius tier that was actually used', () => {
      const g1 = renderCompsForChat(resultFor(golden01) as never); // tier 0.5
      const g3 = renderCompsForChat(resultFor(golden03) as never); // tier 2.0
      expect(g1).toMatch(/0\.5/);
      expect(g3).toMatch(/2(\.0)?\s*mi/i);
      // The tier is not cosmetic — golden 03 searched four times the area for
      // three comps, and the block must say so.
      expect(g3).not.toMatch(/\b0\.5\s*mi/i);
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
    it('golden 03 (3 comps, low) warns in prose, not just in a JSON field', () => {
      // A confidence tier nobody reads is not a warning. §5.5: low still
      // returns numbers, but the rendered copy must call the estimate weak and
      // invite a manual override.
      const outcome = resultFor(golden03);
      expect(outcome.arv.confidence).toBe('low');
      const text = renderCompsForChat(outcome as never);
      expect(text.toLowerCase(), 'no weak-estimate warning on a low-confidence result')
        .toMatch(/weak|thin|limited|few comps|low confidence|treat .* caution|rough/);
      expect(text.toLowerCase(), 'no manual-override invitation on a low-confidence result')
        .toMatch(/manual|your own|override|change arv|if you have/);
    });

    it('a high-confidence result does NOT carry the weak-estimate warning', () => {
      // Otherwise the warning is decoration and members learn to ignore it.
      const outcome = resultFor(golden01);
      expect(outcome.arv.confidence).toBe('high');
      const text = renderCompsForChat(outcome as never);
      expect(text.toLowerCase()).not.toMatch(/weak estimate|low confidence/);
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
