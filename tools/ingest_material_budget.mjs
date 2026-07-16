#!/usr/bin/env node
/**
 * Ingestion script for the client's material-allowance / spec-tier sheet.
 *
 *   node tools/ingest_material_budget.mjs <sheet.xlsx> [--sheet "Tab Name"] [--dry-run]
 *
 * Emits src/data/material_budget.json in the shape materialLookup.ts expects:
 *   { loaded, source, items: [{ category, item, spec_tier, unit, low, high }] }
 *
 * The source sheet has corrupted "#REF!" item names (formulas pointing at
 * deleted cells). Excel stores the *cached* text alongside the error in many
 * cases, so this script recovers what it can and reports what it cannot.
 * Rows whose item name is unrecoverable are DROPPED and listed — never
 * guessed at, because a wrong item label on a real rate is worse than a
 * missing row.
 *
 * This script has NOT been run against the real sheet (not yet supplied). It is
 * written against the documented shape and covered by tests/materialBudget.test.ts
 * using a synthetic fixture. Expect column-mapping tuning on first real run:
 * check --dry-run output before committing the result.
 */
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../src/data/material_budget.json');

const SPEC_TIERS = ['Budget', 'Basic', 'Standard', 'Premium'];

/** Header aliases -> canonical field. Extend when the real sheet arrives. */
const HEADER_MAP = {
  category: ['category', 'group', 'section', 'trade'],
  item: ['item', 'material', 'line item', 'description', 'name'],
  spec_tier: ['spec tier', 'spec_tier', 'tier', 'spec', 'grade', 'level'],
  unit: ['unit', 'uom', 'units', 'per'],
  low: ['low', 'min', 'minimum', 'low $', 'from'],
  high: ['high', 'max', 'maximum', 'high $', 'to'],
};

export function isCorrupt(value) {
  if (value === null || value === undefined) return true;
  const s = String(value).trim();
  if (!s) return true;
  return /^#(REF|VALUE|NAME|N\/A|DIV\/0|NULL|NUM)[!?]?$/i.test(s);
}

/** Excel keeps a cached string for some error cells; recover it if present. */
export function recoverItemName(cell) {
  if (!cell) return null;
  if (typeof cell === 'string') return isCorrupt(cell) ? null : cell.trim();
  // xlsx cell object: .w = formatted text, .v = raw value, .t = type ('e' = error)
  for (const candidate of [cell.w, cell.v]) {
    if (candidate !== undefined && candidate !== null && !isCorrupt(candidate)) {
      return String(candidate).trim();
    }
  }
  return null;
}

export function normalizeTier(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  const hit = SPEC_TIERS.find((t) => t.toLowerCase() === s);
  if (hit) return hit;
  // Common variants seen in contractor sheets.
  if (/^(econ|cheap|value)/.test(s)) return 'Budget';
  if (/^(mid|std)/.test(s)) return 'Standard';
  if (/^(high|lux|prem)/.test(s)) return 'Premium';
  return null;
}

export function parseMoney(value) {
  if (value === null || value === undefined || isCorrupt(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function resolveHeaders(headerRow) {
  const resolved = {};
  headerRow.forEach((raw, index) => {
    const h = String(raw ?? '').trim().toLowerCase();
    if (!h) return;
    for (const [field, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(h) && resolved[field] === undefined) resolved[field] = index;
    }
  });
  return resolved;
}

/**
 * @returns {{ items: object[], dropped: object[] }}
 */
export function buildTable(rows) {
  if (rows.length === 0) return { items: [], dropped: [] };
  const headers = resolveHeaders(rows[0]);
  const missing = ['item', 'spec_tier', 'low', 'high'].filter((f) => headers[f] === undefined);
  if (missing.length) {
    throw new Error(
      `Could not locate required column(s): ${missing.join(', ')}. ` +
        `Headers seen: ${JSON.stringify(rows[0])}. Extend HEADER_MAP in this script.`,
    );
  }

  const items = [];
  const dropped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const item = recoverItemName(row[headers.item]);
    const tier = normalizeTier(row[headers.spec_tier]);
    const low = parseMoney(row[headers.low]);
    const high = parseMoney(row[headers.high]);

    const reasons = [];
    if (!item) reasons.push('item name corrupt/unrecoverable (#REF!)');
    if (!tier) reasons.push(`spec_tier unrecognised: ${JSON.stringify(row[headers.spec_tier])}`);
    if (low === null) reasons.push('low not numeric');
    if (high === null) reasons.push('high not numeric');

    if (reasons.length) {
      dropped.push({ excelRow: r + 1, reasons, raw: row });
      continue;
    }

    items.push({
      category:
        headers.category !== undefined
          ? (recoverItemName(row[headers.category]) ?? 'Uncategorised')
          : 'Uncategorised',
      item,
      spec_tier: tier,
      unit: headers.unit !== undefined ? String(row[headers.unit] ?? '').trim() || 'each' : 'each',
      low,
      high,
    });
  }
  return { items, dropped };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const sheetArg = args.indexOf('--sheet');
  const sheetName = sheetArg !== -1 ? args[sheetArg + 1] : null;

  if (!file) {
    console.error('usage: node tools/ingest_material_budget.mjs <sheet.xlsx> [--sheet "Tab"] [--dry-run]');
    process.exit(1);
  }

  const wb = XLSX.read(fs.readFileSync(file));
  const tab = sheetName ?? wb.SheetNames[0];
  if (!wb.Sheets[tab]) {
    console.error(`Sheet "${tab}" not found. Available: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: true, defval: null });

  const { items, dropped } = buildTable(rows);

  console.log(`Parsed ${items.length} item(s) from "${tab}".`);
  if (dropped.length) {
    console.warn(`\n${dropped.length} row(s) DROPPED — not guessed at:`);
    for (const d of dropped) console.warn(`  row ${d.excelRow}: ${d.reasons.join('; ')}`);
    console.warn('\nFix these in the source sheet and re-run, or accept them as missing.');
  }
  const tiers = [...new Set(items.map((i) => i.spec_tier))].sort();
  console.log(`Tiers present: ${tiers.join(', ') || '(none)'}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written. Sample:');
    console.log(JSON.stringify(items.slice(0, 5), null, 2));
    return;
  }
  if (items.length === 0) {
    console.error('\nRefusing to write an empty table with loaded:true.');
    process.exit(1);
  }

  const out = {
    loaded: true,
    source: `${path.basename(file)} / sheet "${tab}" — ingested by tools/ingest_material_budget.mjs`,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${items.length} items to ${path.relative(process.cwd(), OUT)}`);
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
