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

/**
 * What a library entry can be: one of the three calculators, or a comps
 * snapshot (client ruling: comps are saved as dated snapshots, by address).
 */
export type LibraryKind = CalculatorKey | 'comps';

export interface CalculationSummary {
  id: string;
  calculator: LibraryKind;
  property_name: string;
  chat_id: string | null;
  created_at: string;
  /** The one figure the library list shows per entry. Null when unavailable. */
  headline: { label: string; value: number; unit: 'usd' } | null;
}

export interface CalculationRow extends Omit<CalculationSummary, 'headline'> {
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
  return ((data ?? []) as unknown as Array<Omit<CalculationSummary, 'headline'> & { outputs: unknown }>).map(
    ({ outputs, ...row }) => ({ ...row, headline: headlineFor(row.calculator, outputs) }),
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
  const rows = (data ?? []) as unknown as Array<Omit<CalculationSummary, 'headline'> & { outputs: unknown }>;
  if (!rows[0]) return null;
  const { outputs, ...row } = rows[0];
  return { ...row, headline: headlineFor(row.calculator, outputs) };
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
  /**
   * Idempotency key for snapshots: when set, an existing active entry of the
   * same kind for this owner carrying the same `result.run_id` is returned
   * instead of writing a second one. A comps cache hit replays the original
   * run's id, so asking for the same comps twice files one snapshot, not two.
   */
  runId?: string;
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
        if (entry.runId) {
          const { data: existing, error: lookupError } = await supabase
            .from('calculations')
            .select('id, calculator, property_name')
            .eq('owner_key', ownerKey)
            .eq('calculator', entry.calculator)
            .eq('result->>run_id', entry.runId)
            .is('archived_at', null)
            .limit(1);
          if (lookupError) throw lookupError;
          const found = ((existing ?? []) as unknown as SavedCalculation[])[0];
          if (found) return found;
        }
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
