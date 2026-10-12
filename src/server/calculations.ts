/**
 * The calculation library store. Data access only — like chats.ts, every
 * function takes the owner key resolved by ownerKey.ts and scopes its WHERE
 * to it, and no read path returns owner_key.
 *
 * Writes come from ONE place: the agent's executeTool, after a calculator
 * succeeds or a comps lookup succeeds (a dated snapshot, filed by address —
 * see createCalculationLibrary). Members can rename and delete entries; they
 * never write inputs or results directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from './logger.js';
import { normalizePropertyName } from '../agent/formSubmission.js';
import type { CalculatorKey } from '../agent/formSchema.js';
import { normalizeAddress } from '../features/comps/normalize.js';

/**
 * What a library entry can be: one of the three calculators, or a comps
 * snapshot (client ruling: comps are saved as dated snapshots, by address).
 */
export type LibraryKind = CalculatorKey | 'comps';

export interface CalculationSummary {
  id: string;
  calculator: LibraryKind;
  property_name: string;
  /**
   * The property FOLDER this run belongs to (see propertyKey). Runs whose
   * names differ in spelling but denote the same property share it — so a
   * comps snapshot filed under "123 MAIN STREET, SEATTLE, WA 98101" and a
   * flip the member named "123 Main St" land in one folder.
   */
  property_key: string;
  chat_id: string | null;
  created_at: string;
  /** The one figure the library list shows per entry. Null when unavailable. */
  headline: { label: string; value: number; unit: 'usd' } | null;
}

/**
 * Street-type words that END the street part of an address. Normalized forms
 * (normalizeAddress expands ST -> STREET etc.), plus common suffixes the
 * expansion table does not abbreviate.
 */
const STREET_SUFFIXES = new Set([
  'STREET', 'AVENUE', 'ROAD', 'DRIVE', 'BOULEVARD', 'LANE', 'COURT', 'PLACE',
  'WAY', 'TERRACE', 'CIRCLE', 'PARKWAY', 'HIGHWAY', 'LOOP', 'TRAIL', 'ALLEY',
  'SQUARE', 'PIKE', 'ROW', 'RUN', 'CRESCENT', 'POINT', 'PATH', 'PLAZA', 'WALK',
]);
const UNIT_RE = /(?:#|\b(?:unit|apt|apartment|suite|ste)\b)\s*#?\s*([0-9a-z-]+)/i;

/**
 * The folder a run belongs to — the property, not the spelling.
 *
 * A name that starts with a house number is an ADDRESS: the key is its street
 * part (house number through the first street-type word, normalized), plus
 * its unit if it names one. City/state/ZIP are dropped because members type
 * them inconsistently ("123 Main St" vs Zillow's "123 MAIN STREET, SEATTLE,
 * WA 98101") — the stated trade-off is that two properties at the same street
 * address in different cities would share a folder, which within one
 * member's library is rare and visible (both runs are listed, each with its
 * own full name).
 *
 * Anything else ("Tacoma duplex") is a member's label: the key is the label
 * itself, case- and punctuation-insensitive.
 */
export function propertyKey(name: string): string {
  const raw = String(name ?? '');
  const unit = raw.match(UNIT_RE)?.[1]?.toUpperCase();
  const streetPart = raw.split(',')[0];
  const tokens = normalizeAddress(streetPart.replace(UNIT_RE, ' ')).split(' ').filter(Boolean);
  if (tokens.length >= 2 && /^\d+[A-Z]?$/.test(tokens[0])) {
    const end = tokens.findIndex((t, i) => i > 0 && STREET_SUFFIXES.has(t));
    const street = (end === -1 ? tokens : tokens.slice(0, end + 1)).join(' ');
    return `addr:${street}${unit ? ` #${unit}` : ''}`;
  }
  return `name:${normalizeAddress(raw)}`;
}

export interface CalculationRow extends Omit<CalculationSummary, 'headline' | 'property_key'> {
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** Library page size; search narrows within it. */
export const CALCULATION_LIST_LIMIT = 200;

const ROW_COLUMNS = 'id, calculator, property_name, chat_id, created_at, inputs, result';
// PostgREST JSON path select: the list never ships whole results, only the
// outputs object the headline is read from.
const SUMMARY_COLUMNS = 'id, calculator, property_name, chat_id, created_at, outputs:result->outputs';

/**
 * Which output headlines each calculator in the list — the number a member
 * scans for. Keys are the calculators' own output names (calculators/*.ts).
 */
const HEADLINES: Record<LibraryKind, { key: string; label: string }> = {
  flip: { key: 'est_net_profit', label: 'Net profit' },
  brrrr: { key: 'monthly_cash_flow', label: 'Cash flow / mo' },
  land_purchase: { key: 'target_land_contract', label: 'Target land price' },
  comps: { key: 'median_price_per_sqft', label: 'Median $/sq ft' },
};

export function headlineFor(
  calculator: string,
  outputs: unknown,
): CalculationSummary['headline'] {
  const spec = HEADLINES[calculator as LibraryKind];
  if (!spec || !outputs || typeof outputs !== 'object') return null;
  const value = (outputs as Record<string, unknown>)[spec.key];
  return typeof value === 'number' && Number.isFinite(value)
    ? { label: spec.label, value, unit: 'usd' }
    : null;
}

/** Escape LIKE wildcards so a search for "100%" matches the text, not everything. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listCalculations(
  supabase: SupabaseClient,
  ownerKey: string,
  options: { query?: string; limit?: number } = {},
): Promise<CalculationSummary[]> {
  let request = supabase
    .from('calculations')
    .select(SUMMARY_COLUMNS)
    .eq('owner_key', ownerKey)
    .is('archived_at', null);
  const query = typeof options.query === 'string' ? options.query.trim() : '';
  if (query) request = request.ilike('property_name', likePattern(query.slice(0, 120)));
  const { data, error } = await request
    .order('created_at', { ascending: false })
    .limit(options.limit ?? CALCULATION_LIST_LIMIT);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<Omit<CalculationSummary, 'headline' | 'property_key'> & { outputs: unknown }>).map(
    ({ outputs, ...row }) => ({
      ...row,
      property_key: propertyKey(row.property_name),
      headline: headlineFor(row.calculator, outputs),
    }),
  );
}

export async function getCalculation(
  supabase: SupabaseClient,
  ownerKey: string,
  id: string,
): Promise<CalculationRow | null> {
  const { data, error } = await supabase
    .from('calculations')
    .select(ROW_COLUMNS)
    .eq('owner_key', ownerKey)
    .eq('id', id)
    .is('archived_at', null)
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as CalculationRow[];
  return rows[0] ?? null;
}

export async function renameCalculation(
  supabase: SupabaseClient,
  ownerKey: string,
  id: string,
  propertyName: string,
): Promise<CalculationSummary | null> {
  const { data, error } = await supabase
    .from('calculations')
    .update({ property_name: propertyName })
    .eq('owner_key', ownerKey)
    .eq('id', id)
    .is('archived_at', null)
    .select(SUMMARY_COLUMNS);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<Omit<CalculationSummary, 'headline' | 'property_key'> & { outputs: unknown }>;
  if (!rows[0]) return null;
  const { outputs, ...row } = rows[0];
  return { ...row, property_key: propertyKey(row.property_name), headline: headlineFor(row.calculator, outputs) };
}

/** SOFT delete, like chats: the row stays, every read path skips it. */
export async function archiveCalculation(
  supabase: SupabaseClient,
  ownerKey: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from('calculations')
    .update({ archived_at: now.toISOString() })
    .eq('owner_key', ownerKey)
    .eq('id', id)
    .is('archived_at', null)
    .select('id');
  if (error) throw error;
  return ((data ?? []) as unknown[]).length > 0;
}

/** What a successful save reports back to the agent, and on to the widget. */
export interface SavedCalculation {
  id: string;
  calculator: LibraryKind;
  property_name: string;
}

export interface CalculationToSave {
  calculator: LibraryKind;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  // No idempotency key, deliberately (client QA ruling): EVERY run is its own
  // record, comps included — a repeat lookup answered from the comps cache
  // replays the original run id, and an earlier version used that to skip
  // the write, which members experienced as "my second comps run vanished".
}

/** The seam the agent saves through. Tests inject a fake; production builds one per request. */
export interface CalculationLibrary {
  /** Never throws: a failed save is logged and reported as null. */
  save(entry: CalculationToSave): Promise<SavedCalculation | null>;
}

export function createCalculationLibrary(
  supabase: SupabaseClient,
  ownerKey: string,
  chatId: string,
  logger: Logger,
): CalculationLibrary {
  return {
    async save(entry) {
      const propertyName = normalizePropertyName(entry.result.property_name ?? entry.inputs.property_name);
      if (!propertyName) return null; // the runner refuses unnamed runs; belt and braces
      try {
        const { data, error } = await supabase
          .from('calculations')
          .insert({
            owner_key: ownerKey,
            chat_id: chatId,
            calculator: entry.calculator,
            property_name: propertyName,
            inputs: entry.inputs,
            result: entry.result,
          })
          .select('id, calculator, property_name')
          .single();
        if (error) throw error;
        return data as SavedCalculation;
      } catch (err) {
        // The member still gets their numbers; only the library entry is lost,
        // and the widget says so rather than implying it was saved.
        logger.error({ err, calculator: entry.calculator }, 'calculation library save failed');
        return null;
      }
    },
  };
}
