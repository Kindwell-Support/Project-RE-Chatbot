/**
 * In-memory `chats` table for the Phase 1 multi-chat API tests.
 *
 * Deliberately its own fake rather than an extension of makeFakeSupabase: that
 * one is shared by every comps and agent suite, and widening its query builder
 * to cover update/is/single would put a change under all of them to test one
 * new table.
 *
 * It models the query surface src/server/chats.ts actually uses, and — like
 * the shared fake — it THROWS on a builder method it does not implement, so a
 * chain the production code starts using cannot silently resolve to nothing
 * and leave a suite green against a path it never ran.
 */
import { vi } from 'vitest';

export interface ChatRecord {
  id: string;
  owner_key: string;
  title: string | null;
  created_at: string;
  last_message_at: string;
  archived_at: string | null;
}

export interface ChatsFake {
  client: any;
  rows: ChatRecord[];
  /** Every insert that reached the table, in order. */
  inserts: Array<Record<string, unknown>>;
  messages: Array<{ session_id: string; role: string; content: string }>;
}

let counter = 0;
function fakeUuid(): string {
  counter += 1;
  const tail = String(counter).padStart(12, '0');
  return `00000000-0000-4000-8000-${tail}`;
}

export function chatRecord(over: Partial<ChatRecord> = {}): ChatRecord {
  return {
    id: over.id ?? fakeUuid(),
    owner_key: over.owner_key ?? 'device:00000000-0000-4000-8000-000000000001',
    title: over.title ?? null,
    created_at: over.created_at ?? '2026-08-01T00:00:00.000Z',
    last_message_at: over.last_message_at ?? '2026-08-01T00:00:00.000Z',
    archived_at: over.archived_at ?? null,
  };
}

export function makeChatsSupabase(seed: ChatRecord[] = [], options: { failChats?: boolean } = {}): ChatsFake {
  const rows: ChatRecord[] = seed.map((r) => ({ ...r }));
  const inserts: Array<Record<string, unknown>> = [];
  const messages: Array<{ session_id: string; role: string; content: string }> = [];

  function build(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let pendingUpdate: Record<string, unknown> | null = null;
    let selecting = false;
    let sortKey: { column: string; ascending: boolean } | null = null;
    let take: number | null = null;
    // An insert failure has to travel down the SAME chain: production writes
    // `.insert(row).select(cols).single()`, so returning a bare promise here
    // would blow up on `.select` instead of surfacing the error.
    let pendingError: { code?: string; message: string } | null = null;
    let insertedId: string | null = null;
    // The projection is MODELLED, not ignored: production selects an explicit
    // column list precisely so owner_key never round-trips to a client, and a
    // fake that returned whole rows would make that assertion vacuous.
    let columns: string[] | null = null;

    const project = (row: any) => {
      if (!columns) return { ...row };
      const out: any = {};
      for (const column of columns) out[column] = row[column];
      return out;
    };

    const source = () => (table === 'chats' ? rows : messages);

    function matched(): any[] {
      let out = source().filter((row) => filters.every((f) => f(row)));
      if (sortKey) {
        const { column, ascending } = sortKey;
        out = out.slice().sort((a: any, b: any) => {
          const left = String(a[column] ?? '');
          const right = String(b[column] ?? '');
          return ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      if (take !== null) out = out.slice(0, take);
      return out;
    }

    /** Resolve the chain: an update applies here so `.select()` can return the rows it hit. */
    function settle(): { data: any; error: any } {
      if (pendingError) return { data: null, error: pendingError };
      if (options.failChats && table === 'chats') {
        return { data: null, error: { message: 'chats unavailable', code: 'PGRST205' } };
      }
      if (insertedId !== null) {
        const row = rows.find((r) => r.id === insertedId);
        return { data: row ? [project(row)] : [], error: null };
      }
      const hits = matched();
      if (pendingUpdate) {
        for (const row of hits) Object.assign(row, pendingUpdate);
      }
      return { data: hits.map(project), error: null };
    }

    const chain: any = {
      select: (cols?: string) => {
        selecting = true;
        if (cols && cols !== '*') {
          columns = cols.split(',').map((c) => c.trim()).filter(Boolean);
        }
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) === String(value));
        return chain;
      },
      is: (column: string, value: null) => {
        filters.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      order: (column: string, opts: { ascending?: boolean } = {}) => {
        sortKey = { column, ascending: opts.ascending !== false };
        return chain;
      },
      limit: (n: number) => {
        take = n;
        return chain;
      },
      update: (patch: Record<string, unknown>) => {
        pendingUpdate = patch;
        return chain;
      },
      insert: (payload: any) => {
        const list = Array.isArray(payload) ? payload : [payload];
        if (options.failChats && table === 'chats') {
          pendingError = { message: 'chats unavailable' };
          return chain;
        }
        for (const row of list) {
          inserts.push(row);
          if (table === 'chats') {
            const id = String(row.id ?? fakeUuid());
            if (rows.some((existing) => existing.id === id)) {
              // Primary-key conflict, exactly as Postgres reports it.
              pendingError = { code: '23505', message: 'duplicate key value' };
              return chain;
            }
            rows.push(
              chatRecord({
                id,
                owner_key: String(row.owner_key),
                title: (row.title as string | null) ?? null,
                last_message_at: String(row.last_message_at ?? '2026-08-01T00:00:00.000Z'),
              }),
            );
            insertedId = id;
          } else {
            messages.push({
              session_id: String(row.session_id),
              role: String(row.role),
              content: String(row.content),
            });
          }
        }
        // supabase-js returns a thenable that may be chained further with
        // .select().single(); both shapes resolve through `settle`.
        return chain;
      },
      single: async () => {
        const result = settle();
        if (result.error) return result;
        const list = result.data as any[];
        const row = list[0];
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

    return new Proxy(chain, {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop in target) return (target as any)[prop];
        throw new Error(
          `chats fake: unimplemented builder call .${String(prop)}() on ${table} — ` +
            'the production query changed shape and this fake would have silently returned nothing.',
        );
      },
    });
  }

  const client = { from: vi.fn((table: string) => build(table)) };

  return { client, rows, inserts, messages };
}
