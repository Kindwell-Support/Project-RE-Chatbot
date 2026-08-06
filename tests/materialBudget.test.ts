/**
 * Material-budget lookup + ingestion tests.
 *
 * The real spec-tier sheet has not been supplied, so these run against a
 * synthetic fixture. The rates below are INVENTED FOR TESTING and must never
 * reach src/data/material_budget.json — the shipped table stays loaded:false
 * until the client's sheet arrives.
 */
import { describe, it, expect } from 'vitest';
import {
  lookupMaterialBudget,
  type MaterialBudgetTable,
} from '../src/agent/materialLookup.js';
// @ts-expect-error — plain .mjs helper, no types
import { buildTable, isCorrupt, recoverItemName, normalizeTier, parseMoney } from '../tools/ingest_material_budget.mjs';

const FIXTURE: MaterialBudgetTable = {
  loaded: true,
  source: 'synthetic test fixture — NOT real rates',
  items: [
    { category: 'Flooring', item: 'LVP flooring', spec_tier: 'Budget', unit: 'sf', low: 2, high: 3 },
    { category: 'Flooring', item: 'LVP flooring', spec_tier: 'Standard', unit: 'sf', low: 4, high: 6 },
    { category: 'Flooring', item: 'Hardwood flooring', spec_tier: 'Premium', unit: 'sf', low: 12, high: 18 },
    { category: 'Kitchen', item: 'Countertops', spec_tier: 'Basic', unit: 'sf', low: 30, high: 45 },
    { category: 'Kitchen', item: 'Countertops', spec_tier: 'Premium', unit: 'sf', low: 80, high: 140 },
  ],
};

const EMPTY: MaterialBudgetTable = { loaded: false, source: 'scaffold', items: [] };

describe('lookup with no data loaded (the shipped state)', () => {
  it('reports unavailable, redirects to the knowledge base, never invents a rate', () => {
    const r = lookupMaterialBudget('flooring', 'Standard', EMPTY) as any;
    expect(r.available).toBe(false);
    expect(r.message).toMatch(/not loaded/i);
    // The miss is a redirect, not a dead end: James's narrative rates ARE in
    // the documents table (verified live), so the model is told to retrieve
    // and quote them — and only them.
    expect(r.message).toMatch(/search_knowledge_base/);
    expect(r.message).toMatch(/ONLY dollar figures that appear in the retrieved passages/);
    expect(r.message).toMatch(/NEVER invent a rate/);
    expect(r).not.toHaveProperty('matches');
    // No digits that could be mistaken for a rate.
    expect(r.message).not.toMatch(/\$\s*\d/);
  });

  it('the SHIPPED table is still loaded:false (no invented rates committed)', async () => {
    const shipped = (await import('../src/data/material_budget.json', {
      with: { type: 'json' },
    })) as any;
    const table = shipped.default ?? shipped;
    expect(table.loaded).toBe(false);
    expect(table.items).toHaveLength(0);
  });
});

describe('lookup against a loaded table', () => {
  it('finds an item at a specific tier', () => {
    const r = lookupMaterialBudget('LVP flooring', 'Standard', FIXTURE) as any;
    expect(r.available).toBe(true);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ spec_tier: 'Standard', low: 4, high: 6, unit: 'sf' });
  });

  it('returns every tier when none is specified', () => {
    const r = lookupMaterialBudget('LVP flooring', undefined, FIXTURE) as any;
    expect(r.available).toBe(true);
    expect(r.matches.map((m: any) => m.spec_tier).sort()).toEqual(['Budget', 'Standard']);
  });

  it('matches by category too', () => {
    const r = lookupMaterialBudget('Kitchen', undefined, FIXTURE) as any;
    expect(r.available).toBe(true);
    expect(r.matches).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    const r = lookupMaterialBudget('lvp FLOORING', 'budget', FIXTURE) as any;
    expect(r.available).toBe(true);
    expect(r.matches[0].low).toBe(2);
  });

  it('is deterministic — identical calls give identical results', () => {
    // POSITIVE PRECONDITION added during the BUG-001 audit. Without it this
    // test survived a `lookupMaterialBudget` that returned `undefined`:
    // JSON.stringify(undefined) === JSON.stringify(undefined) is trivially
    // true, so the only determinism test in the suite proved nothing.
    const first = lookupMaterialBudget('Countertops', 'Premium', FIXTURE) as any;
    expect(first.available, 'precondition: the lookup did not succeed').toBe(true);
    expect(first.matches).toHaveLength(1);

    const a = JSON.stringify(first);
    const b = JSON.stringify(lookupMaterialBudget('Countertops', 'Premium', FIXTURE));
    expect(a).toBe(b);
    expect(a, 'precondition: the result serialised to nothing').not.toBe(undefined);
  });

  it('substring queries match, and match only what they should', () => {
    // Untested before the BUG-001 audit and load-bearing: the model sends
    // free text ("flooring"), not exact item names, so substring behaviour IS
    // the production path.
    const flooring = lookupMaterialBudget('flooring', undefined, FIXTURE) as any;
    expect(flooring.available).toBe(true);
    // LVP x2 (Budget, Standard) + Hardwood x1.
    expect(flooring.matches).toHaveLength(3);

    const counter = lookupMaterialBudget('counter', undefined, FIXTURE) as any;
    expect(counter.available).toBe(true);
    expect(counter.matches).toHaveLength(2);
    for (const m of counter.matches) expect(m.item).toMatch(/Countertops/i);
  });

  it('BUG-009: a blank item must not return the ENTIRE table', () => {
    // FAILS ON PURPOSE — this is the repro.
    //
    // `agent.ts` calls `lookupMaterialBudget(String(args.item ?? ''), ...)`.
    // The schema marks `item` required, but the call site coerces a missing
    // one to `''`, and `''` substring-matches every row. So a model that omits
    // the argument gets the whole rate table back as "matches" and relays it
    // as though it answered the member's question.
    //
    // This is the frozen-$148,466 shape exactly: a missing required input
    // silently defaulted instead of rejected. The calculators guard it with
    // MissingRequiredInputError; this tool has no equivalent.
    //
    // Unreachable TODAY only because the shipped table is loaded:false. It
    // goes live the day the client's sheet lands — which is the entire point
    // of the feature.
    for (const blank of ['', '   ', '\t']) {
      const r = lookupMaterialBudget(blank, undefined, FIXTURE) as any;
      expect(
        r.available === false || (r.matches?.length ?? 0) < FIXTURE.items.length,
        `a blank item (${JSON.stringify(blank)}) returned the whole table ` +
          `(${r.matches?.length} of ${FIXTURE.items.length} rows)`,
      ).toBe(true);
    }
  });

  it('an unknown item returns unavailable with the KB-fallback instruction', () => {
    const r = lookupMaterialBudget('gold-plated faucet', undefined, FIXTURE) as any;
    expect(r.available).toBe(false);
    expect(r.message).toMatch(/No entry found for "gold-plated faucet"/);
    expect(r.message).toMatch(/search_knowledge_base/);
    expect(r.message).toMatch(/NEVER invent a rate/);
    expect(r).not.toHaveProperty('matches');
  });

  it('a known item at an absent tier does not fall back to another tier', () => {
    // Hardwood exists only at Premium. Asking for Budget must not return the
    // Premium rate — a silently substituted tier is a wrong number.
    const r = lookupMaterialBudget('Hardwood flooring', 'Budget', FIXTURE) as any;
    expect(r.available).toBe(false);
  });
});

describe('ingestion: corrupted #REF! handling', () => {
  it('detects the Excel error strings', () => {
    for (const bad of ['#REF!', '#ref!', '#VALUE!', '#N/A', '#NAME?', '', '   ', null, undefined]) {
      expect(isCorrupt(bad), `${bad} should be corrupt`).toBe(true);
    }
    for (const ok of ['LVP flooring', 'Countertops', '0']) {
      expect(isCorrupt(ok), `${ok} should be fine`).toBe(false);
    }
  });

  it('recovers a cached item name from an error cell when Excel kept one', () => {
    // xlsx cell object: type 'e' (error) but .w holds the cached display text.
    expect(recoverItemName({ t: 'e', v: '#REF!', w: 'LVP flooring' })).toBe('LVP flooring');
    // Nothing recoverable -> null, never a guess.
    expect(recoverItemName({ t: 'e', v: '#REF!', w: '#REF!' })).toBeNull();
    expect(recoverItemName('#REF!')).toBeNull();
  });

  it('normalizes tier variants and rejects unknown ones', () => {
    expect(normalizeTier('premium')).toBe('Premium');
    expect(normalizeTier('  Standard ')).toBe('Standard');
    expect(normalizeTier('Luxury')).toBe('Premium');
    expect(normalizeTier('Economy')).toBe('Budget');
    expect(normalizeTier('#REF!')).toBeNull();
    expect(normalizeTier('Gold')).toBeNull();
  });

  it('parses money and rejects junk', () => {
    expect(parseMoney('$1,250')).toBe(1250);
    expect(parseMoney(4.5)).toBe(4.5);
    expect(parseMoney('#REF!')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('DROPS unrecoverable rows rather than guessing a label', () => {
    const rows = [
      ['Category', 'Item', 'Spec Tier', 'Unit', 'Low', 'High'],
      ['Flooring', 'LVP flooring', 'Standard', 'sf', 4, 6],
      ['Flooring', '#REF!', 'Budget', 'sf', 2, 3], // unrecoverable name
      ['Kitchen', 'Countertops', 'Gold', 'sf', 30, 45], // bad tier
      ['Kitchen', 'Backsplash', 'Basic', 'sf', '#REF!', 20], // bad money
    ];
    const { items, dropped } = buildTable(rows);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ item: 'LVP flooring', spec_tier: 'Standard', low: 4, high: 6 });

    expect(dropped).toHaveLength(3);
    expect(dropped[0].reasons.join()).toMatch(/#REF!/);
    expect(dropped[1].reasons.join()).toMatch(/spec_tier/);
    expect(dropped[2].reasons.join()).toMatch(/low not numeric/);
  });

  it('keeps a row whose name is recoverable from the cached text', () => {
    const rows = [
      ['Category', 'Item', 'Spec Tier', 'Unit', 'Low', 'High'],
      ['Flooring', { t: 'e', v: '#REF!', w: 'LVP flooring' }, 'Budget', 'sf', 2, 3],
    ];
    const { items, dropped } = buildTable(rows);
    expect(dropped).toHaveLength(0);
    expect(items[0].item).toBe('LVP flooring');
  });

  it('throws a useful error when a required column is missing', () => {
    expect(() => buildTable([['Thing', 'Cost'], ['x', 1]])).toThrow(/Could not locate required column/);
  });

  it('handles an empty sheet without throwing', () => {
    expect(buildTable([])).toEqual({ items: [], dropped: [] });
  });
});
