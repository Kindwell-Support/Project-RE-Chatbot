/**
 * In-memory `calculations` table for the calculation-library suites.
 *
 * Same contract as chatsFakes.ts: it models exactly the query surface
 * src/server/calculations.ts uses — including the PostgREST JSON-path alias
 * `outputs:result->outputs` the list projection relies on — and THROWS on any
 * builder method it does not implement, so a query that changes shape cannot
 * silently resolve to nothing and leave a suite green against a path it never
 * ran.
 */
import { vi } from 'vitest';

export interface CalculationRecord {
  id: string;
  owner_key: string;
  chat_id: string | null;
  calculator: string;
  property_name: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  archived_at: string | null;
}

export interface CalculationsFake {
  client: any;
  rows: CalculationRecord[];
  inserts: Array<Record<string, unknown>>;
}

let counter = 0;
function fakeUuid(): string {
  counter += 1;
  return `cccccccc-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function calculationRecord(over: Partial<CalculationRecord> = {}): CalculationRecord {
  return {
    id: over.id ?? fakeUuid(),
    owner_key: over.owner_key ?? 'device:00000000-0000-4000-8000-000000000001',
    chat_id: over.chat_id ?? null,
    calculator: over.calculator ?? 'flip',
    property_name: over.property_name ?? 'Test property',
    inputs: over.inputs ?? { property_name: over.property_name ?? 'Test property' },
    result: over.result ?? { calculator: 'flip', outputs: { est_net_profit: 101916 } },
    created_at: over.created_at ?? '2026-10-01T00:00:00.000Z',
    archived_at: over.archived_at ?? null,
  };
}

/** `outputs:result->outputs` → read result.outputs, emit it as `outputs`. */
function projectColumn(row: any, spec: string): [string, unknown] {
  const alias = spec.includes(':') ? spec.split(':')[0].trim() : null;
  const path = spec.includes(':') ? spec.split(':')[1].trim() : spec;
  if (path.includes('->')) {
    const [column, ...keys] = path.split('->').map((p) => p.trim());
    let value: any = row[column];
    for (const key of keys) value = value == null ? undefined : value[key];
    return [alias ?? keys[keys.length - 1], value ?? null];
  }
  return [alias ?? path, row[path]];
}

export function makeCalculationsSupabase(
  seed: CalculationRecord[] = [],
  options: { fail?: boolean } = {},
): CalculationsFake {
  const rows: CalculationRecord[] = seed.map((r) => ({ ...r }));
  const inserts: Array<Record<string, unknown>> = [];
  let insertSeq = 0;

  function build(table: string) {
    if (table !== 'calculations') {
      throw new Error(`calculations fake: unexpected table "${table}"`);
    }
    const filters: Array<(row: any) => boolean> = [];
    const sortKeys: Array<{ column: string; ascending: boolean }> = [];
    let take: number | null = null;
    let columns: string[] | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingError: { code?: string; message: string } | null = null;
    let insertedId: string | null = null;

    const project = (row: any) => {
      if (!columns) return { ...row };
      const out: any = {};
      for (const spec of columns) {
        const [key, value] = projectColumn(row, spec);
        out[key] = value;
      }
      return out;
    };

    function matched(): any[] {
      let out = rows.filter((row) => filters.every((f) => f(row)));
      if (sortKeys.length) {
        out = out.slice().sort((a: any, b: any) => {
          for (const { column, ascending } of sortKeys) {
            const left = String(a[column] ?? '');
            const right = String(b[column] ?? '');
            const cmp = ascending ? left.localeCompare(right) : right.localeCompare(left);
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
      }
      if (take !== null) out = out.slice(0, take);
      return out;
    }

    function settle(): { data: any; error: any } {
      if (options.fail) return { data: null, error: { message: 'calculations unavailable', code: 'PGRST205' } };
      if (pendingError) return { data: null, error: pendingError };
      if (insertedId !== null) {
        const row = rows.find((r) => r.id === insertedId);
        return { data: row ? [project(row)] : [], error: null };
      }
      const hits = matched();
      if (pendingUpdate) for (const row of hits) Object.assign(row, pendingUpdate);
      return { data: hits.map(project), error: null };
    }

    const chain: any = {
      select: (cols?: string) => {
        if (cols && cols !== '*') columns = cols.split(',').map((c) => c.trim()).filter(Boolean);
        return proxy;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) === String(value));
        return proxy;
      },
      is: (column: string, value: null) => {
        filters.push((row) => (row[column] ?? null) === value);
        return proxy;
      },
      /** Postgres ILIKE with `\` escapes: % = any run, _ = one char. */
      ilike: (column: string, pattern: string) => {
        let re = '';
        for (let i = 0; i < pattern.length; i++) {
          const ch = pattern[i];
          if (ch === '\\' && i + 1 < pattern.length) {
            re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          } else if (ch === '%') re += '.*';
          else if (ch === '_') re += '.';
          else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        const matcher = new RegExp(`^${re}$`, 'is');
        filters.push((row) => matcher.test(String(row[column] ?? '')));
        return proxy;
      },
      order: (column: string, opts: { ascending?: boolean } = {}) => {
        sortKeys.push({ column, ascending: opts.ascending !== false });
        return proxy;
      },
      limit: (n: number) => {
        take = n;
        return proxy;
      },
      update: (patch: Record<string, unknown>) => {
        pendingUpdate = patch;
        return proxy;
      },
      insert: (payload: any) => {
        inserts.push(payload);
        if (options.fail) return proxy;
        // NOT NULL columns, enforced like Postgres would.
        for (const column of ['owner_key', 'calculator', 'property_name', 'inputs', 'result']) {
          if (payload[column] === undefined || payload[column] === null) {
            pendingError = { code: '23502', message: `null value in column "${column}"` };
            return proxy;
          }
        }
        insertSeq += 1;
        const row = calculationRecord({
          ...payload,
          id: fakeUuid(),
          created_at: new Date(Date.UTC(2026, 9, 8, 0, 0, insertSeq)).toISOString(),
        });
        rows.push(row);
        insertedId = row.id;
        return proxy;
      },
      single: async () => {
        const result = settle();
        if (result.error) return result;
        const row = (result.data as any[])[0];
        return { data: row ?? null, error: row ? null : { message: 'no rows' } };
      },
      then: (resolve: (v: any) => unknown, reject?: (e: any) => unknown) => {
        try {
          return Promise.resolve(settle()).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };

    const proxy: any = new Proxy(chain, {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop in target) return (target as any)[prop];
        throw new Error(
          `calculations fake: unimplemented builder call .${String(prop)}() — ` +
            'the production query changed shape and this fake would have silently returned nothing.',
        );
      },
    });
    return proxy;
  }

  const client = { from: vi.fn((table: string) => build(table)) };
  return { client, rows, inserts };
}
