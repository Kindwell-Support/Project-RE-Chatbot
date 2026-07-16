/**
 * Structured material-allowance / construction install-rate lookup.
 * Deterministic table lookup — deliberately NOT vector search, which returned
 * intermittent "not found" for spec-tier budget questions.
 *
 * TODO(blocker): the source data (client's ChatBot/spec-tier sheet) was not
 * supplied with this build. src/data/material_budget.json is a scaffold; the
 * sheet's corrupted "#REF!" item names must be cleaned before import.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface MaterialBudgetItem {
  category: string;
  item: string;
  spec_tier: 'Budget' | 'Basic' | 'Standard' | 'Premium';
  unit: string;
  low: number;
  high: number;
}

export interface MaterialBudgetTable {
  loaded: boolean;
  source: string;
  items: MaterialBudgetItem[];
}

const defaultTable: MaterialBudgetTable = require('../data/material_budget.json');

export const SPEC_TIERS = ['Budget', 'Basic', 'Standard', 'Premium'] as const;

/**
 * @param table injectable so tests can exercise a fixture without shipping
 *   fake rates in the real data file.
 */
export function lookupMaterialBudget(
  item: string,
  specTier?: string,
  table: MaterialBudgetTable = defaultTable,
) {
  // On any miss the model is redirected to the knowledge base, NOT dead-ended:
  // James's course material contains real narrative rates (verified live —
  // tile ~$10-11/sf installed, flooring $1.50/$2.50/$4 specs, paint $2-3/sf),
  // and quoting retrieved figures is grounding, not fabrication. The structured
  // table stays the preferred, deterministic source once the client's sheet
  // arrives; inventing a number remains forbidden either way.
  const FALLBACK_INSTRUCTION =
    'Fall back to search_knowledge_base for this item and quote ONLY dollar figures that ' +
    'appear in the retrieved passages, attributed as James\'s numbers from his projects ' +
    '(they vary by market and year — say so). If retrieval surfaces no figure, tell the ' +
    'user it is not covered and to price it with their GC or supplier. NEVER invent a rate.';

  if (!table.loaded || table.items.length === 0) {
    return {
      available: false,
      message:
        'The structured material-allowance table is not loaded yet. ' + FALLBACK_INSTRUCTION,
    };
  }
  const needle = item.trim().toLowerCase();
  const matches = table.items.filter((entry) => {
    const itemMatch =
      entry.item.toLowerCase().includes(needle) ||
      entry.category.toLowerCase().includes(needle) ||
      needle.includes(entry.item.toLowerCase());
    const tierMatch = !specTier || entry.spec_tier.toLowerCase() === specTier.toLowerCase();
    return itemMatch && tierMatch;
  });
  if (matches.length === 0) {
    return {
      available: false,
      message:
        `No entry found for "${item}"${specTier ? ` at the ${specTier} tier` : ''} in the ` +
        'structured table. ' + FALLBACK_INSTRUCTION,
    };
  }
  return { available: true, matches };
}
