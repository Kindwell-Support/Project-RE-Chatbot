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
  messages: Array<MessageRecord>;
}

/**
 * A chat_messages row. `id` and `created_at` are MODELLED rather than omitted:
 * getHistory orders on both and then reverses, so a fake without them returns
 * the exact INVERSE of the real transcript (INSPECTOR, gap 1).
 *
 * `id` is a zero-padded string because the sort compares stringified keys —
 * unpadded, "10" would sort before "2" and a transcript would scramble at the
 * tenth message.
 */
export interface MessageRecord {
  session_id: string;
  role: string;
  content: string;
  id?: string;
  created_at?: string;
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
  const messages: Array<MessageRecord> = [];

  // Per-fake, so each instance starts from a known point and one suite's
  // message ids can never depend on another's.
  let messageSeq = 0;
  let insertSeq = 0;
  /**
   * Stamp a message row the way Postgres would. Rows written by ONE insert
   * share a created_at — that is not incidental, it is the exact condition
   * getHistory's `id` tiebreaker exists to resolve, and a fake that gave each
   * row its own timestamp would never exercise it.
   */
  function stampMessage(row: MessageRecord, stamp: string) {
    messageSeq += 1;
    row.id = String(messageSeq).padStart(12, '0');
    row.created_at = stamp;
  }
  function nextInsertStamp(): string {
    insertSeq += 1;
    return new Date(Date.UTC(2026, 7, 1, 0, 0, insertSeq)).toISOString();
  }

  function build(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    let pendingUpdate: Record<string, unknown> | null = null;
    let selecting = false;
    // A LIST, not a single key. getHistory chains .order('created_at') then
    // .order('id'); a last-one-wins field modelled a query production never
    // sends and silently discarded the primary sort.
    const sortKeys: Array<{ column: string; ascending: boolean }> = [];
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

    const source = () => {
      if (table === 'chats') return rows;
      // A test may push straight onto `fake.messages` instead of going through
      // insert(). Stamp those on first read, in array order, so a hand-seeded
      // transcript sorts exactly like an inserted one — otherwise the two ways
      // of seeding the fake would disagree about order.
      for (const row of messages) {
        if (row.id === undefined) stampMessage(row, nextInsertStamp());
      }
      return messages;
    };

    function matched(): any[] {
      let out = source().filter((row) => filters.every((f) => f(row)));
      if (sortKeys.length) {
        out = out.slice().sort((a: any, b: any) => {
          // Keys applied in the order production declared them: the first is
          // primary and later ones only break its ties.
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
        const list = Array.isArray(payload) ? payload : [payload];
        const insertStamp = nextInsertStamp();
        if (options.failChats && table === 'chats') {
          pendingError = { message: 'chats unavailable' };
          return proxy;
        }
        for (const row of list) {
          inserts.push(row);
          if (table === 'chats') {
            // FINDING-025: owner_key is NOT NULL in Postgres. String(undefined)
            // is the literal "undefined", so a fake that coerced would ACCEPT
            // an insert the real database rejects — the worst kind of fake,
            // one that is more permissive than production.
            if (row.owner_key === undefined || row.owner_key === null) {
              pendingError = { code: '23502', message: 'null value in column "owner_key" violates not-null constraint' };
              return proxy;
            }
            const id = String(row.id ?? fakeUuid());
            if (rows.some((existing) => existing.id === id)) {
              // Primary-key conflict, exactly as Postgres reports it.
              pendingError = { code: '23505', message: 'duplicate key value' };
              return proxy;
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
            const stamped: MessageRecord = {
              session_id: String(row.session_id),
              role: String(row.role),
              content: String(row.content),
            };
            // Every row of THIS insert shares one stamp, as a single statement
            // does in Postgres; the ids inside it still increase.
            stampMessage(stamped, insertStamp);
            messages.push(stamped);
          }
        }
        // supabase-js returns a thenable that may be chained further with
        // .select().single(); both shapes resolve through `settle`.
        return proxy;
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

    /**
     * The guard. It was applied ONCE, to the object `from()` hands back, while
     * every builder method returned the raw `chain` — so it only ever saw the
     * FIRST call and `.eq(...).is(...)` was past it by the second link. That is
     * the same shape as the bug it exists to catch, so every method now returns
     * THIS proxy and the guard covers the chain to any depth.
     */
    const proxy: any = new Proxy(chain, {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop in target) return (target as any)[prop];
        throw new Error(
          `chats fake: unimplemented builder call .${String(prop)}() on ${table} — ` +
            'the production query changed shape and this fake would have silently returned nothing.',
        );
      },
    });

    return proxy;
  }

  const client = { from: vi.fn((table: string) => build(table)) };

  return { client, rows, inserts, messages };
}
