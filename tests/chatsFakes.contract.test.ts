/**
 * The chats fake's OWN contract.
 *
 * A test double is only worth what its shape is worth: a fake that is more
 * permissive than production, or that hands back rows in an order production
 * never would, converts every suite built on it into a claim about the fake.
 * Both gaps closed here were found by INSPECTOR and neither caused a false
 * green — but the second one has the same shape as the bug it exists to catch,
 * which is the reason to close it now rather than after it costs something.
 *
 * The subject under test in this file is ALWAYS the fake, never the production
 * code that happens to drive it.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { chatRecord, makeChatsSupabase } from './helpers/chatsFakes.js';
import { getHistory } from '../src/server/memory.js';

const OWNER = 'device:11111111-1111-4111-8111-111111111111';
const CHAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const config = loadConfig({
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

const silent = { warn: () => {}, error: () => {} } as never;

describe('GAP 1 — the fake must hand /history back in CHRONOLOGICAL order', () => {
  /**
   * getHistory queries NEWEST-FIRST and calls .reverse() to get chronological
   * order back. A fake that ignores `.order()` therefore returns the exact
   * INVERSE of the truth: push user-then-assistant, read back
   * assistant-then-user.
   *
   * Subject: the fake's ordering. It distinguishes "the fake models .order()"
   * from "the fake returns insertion order and production's .reverse() flips
   * it" — the specific defect. A single-message transcript could not tell those
   * apart, which is why every case below uses at least two.
   */
  it('a two-message exchange reads back question-then-answer', async () => {
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    // Written the way appendExchange writes it: ONE insert, both rows.
    await fake.client.from('chat_messages').insert([
      { session_id: CHAT, role: 'user', content: 'Flip: 350k purchase' },
      { session_id: CHAT, role: 'assistant', content: 'Net profit is $101,916.' },
    ]);

    const history = await getHistory(fake.client as never, CHAT, silent);

    expect(history.map((m) => m.role), 'the answer came back above the question').toEqual([
      'user',
      'assistant',
    ]);
    expect(history.map((m) => m.content)).toEqual([
      'Flip: 350k purchase',
      'Net profit is $101,916.',
    ]);
  });

  it('holds across MULTIPLE exchanges, not just within one insert', async () => {
    // Within-insert order and across-insert order are different claims: a fake
    // could stamp one shared timestamp per insert and still scramble the turns
    // relative to each other.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    for (const n of [1, 2, 3]) {
      await fake.client.from('chat_messages').insert([
        { session_id: CHAT, role: 'user', content: `q${n}` },
        { session_id: CHAT, role: 'assistant', content: `a${n}` },
      ]);
    }

    const history = await getHistory(fake.client as never, CHAT, silent);

    expect(history.map((m) => m.content)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
  });

  it('the same order reaches a member through GET /history', async () => {
    // The unit above pins getHistory; this pins the route, because the widget
    // paints whatever the ROUTE emits and that is the member-visible artefact.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    await fake.client.from('chat_messages').insert([
      { session_id: CHAT, role: 'user', content: 'question' },
      { session_id: CHAT, role: 'assistant', content: 'answer' },
    ]);
    const app = buildApp(config, { supabase: fake.client as never });

    const res = await app.inject({ method: 'GET', url: `/history?session_id=${CHAT}` });

    expect(res.json().messages).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ]);
    await app.close();
  });

  it('models the TWO-KEY sort production actually issues, not just the last one', async () => {
    // getHistory chains .order('created_at').order('id'). A fake where the
    // second .order() OVERWRITES the first models a query production never
    // sends. Asserted directly so the multi-key support cannot be dropped back
    // to last-one-wins while the cases above stay green on insertion order.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    await fake.client.from('chat_messages').insert([
      { session_id: CHAT, role: 'user', content: 'first' },
      { session_id: CHAT, role: 'assistant', content: 'second' },
    ]);

    const { data } = await fake.client
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', CHAT)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50);

    // Newest first — this is the RAW query result, before getHistory reverses.
    expect((data as Array<{ content: string }>).map((r) => r.content)).toEqual([
      'second',
      'first',
    ]);
  });

  it('the rows of ONE insert share a created_at, so `id` is the live tiebreaker', async () => {
    // Production's comment says the pair shares created_at to the microsecond
    // and that `id` is what preserves their order. A fake that stamped a
    // distinct created_at per ROW would resolve the pair on created_at alone
    // and never exercise the tiebreaker at all — the ordering cases above
    // would pass while saying nothing about the mechanism that carries them.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    await fake.client.from('chat_messages').insert([
      { session_id: CHAT, role: 'user', content: 'q' },
      { session_id: CHAT, role: 'assistant', content: 'a' },
    ]);

    const [user, assistant] = fake.messages;
    expect(user.created_at, 'the pair no longer shares a timestamp').toBe(assistant.created_at);
    expect(String(assistant.id) > String(user.id), 'ids do not increase within the insert').toBe(
      true,
    );
  });

  it('ids sort correctly past the 10th message — string compare, so zero-padded', async () => {
    // The trap in modelling an id as a string: "10" sorts before "2". Twelve
    // messages is the smallest case that catches it.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    for (let n = 1; n <= 6; n += 1) {
      await fake.client.from('chat_messages').insert([
        { session_id: CHAT, role: 'user', content: `q${n}` },
        { session_id: CHAT, role: 'assistant', content: `a${n}` },
      ]);
    }

    const history = await getHistory(fake.client as never, CHAT, silent);

    expect(history.map((m) => m.content)).toEqual([
      'q1', 'a1', 'q2', 'a2', 'q3', 'a3', 'q4', 'a4', 'q5', 'a5', 'q6', 'a6',
    ]);
  });
});

describe('GAP 2 — the unimplemented-builder guard must cover the WHOLE chain', () => {
  /**
   * The guard exists so a production query that grows a new link fails LOUDLY
   * instead of silently resolving to nothing. It was installed on the object
   * `from()` returns, but every builder method returned the raw chain, so the
   * guard only ever saw the FIRST call. `.eq(...).is(...)` — the exact chain
   * renameChat and generateChatTitle issue — was past the guard by its second
   * link.
   *
   * Subject: WHERE the guard is reachable. Each case names the link depth,
   * because a guard that covers link 1 and a guard that covers link 4 both
   * "throw on an unknown method" if you only ever test link 1.
   */
  const unimplemented = /unimplemented builder call/;

  it('link 1 — the case that already worked', () => {
    const fake = makeChatsSupabase([]);
    expect(() => fake.client.from('chats').notAMethod()).toThrow(unimplemented);
  });

  it('link 2 — after .select(), the depth that let .eq().is through', () => {
    const fake = makeChatsSupabase([]);
    expect(() => fake.client.from('chats').select('id').notAMethod()).toThrow(unimplemented);
  });

  it('link 3 — after a filter', () => {
    const fake = makeChatsSupabase([]);
    expect(() => fake.client.from('chats').select('id').eq('id', CHAT).notAMethod()).toThrow(
      unimplemented,
    );
  });

  it('link 4 — after .update(), the write path', () => {
    const fake = makeChatsSupabase([]);
    expect(() =>
      fake.client.from('chats').update({ title: 'x' }).eq('id', CHAT).is('title', null).notAMethod(),
    ).toThrow(unimplemented);
  });

  it('deep in the chain after .insert(), which returns a chainable too', () => {
    const fake = makeChatsSupabase([]);
    expect(() =>
      fake.client
        .from('chats')
        .insert({ id: CHAT, owner_key: OWNER })
        .select('id')
        .notAMethod(),
    ).toThrow(unimplemented);
  });

  it('the message names the METHOD and the TABLE, so the diagnostic is actionable', () => {
    const fake = makeChatsSupabase([]);
    let caught = '';
    try {
      fake.client.from('chat_messages').select('role').upsert({});
    } catch (err) {
      caught = String((err as Error).message);
    }
    expect(caught).toContain('.upsert()');
    expect(caught).toContain('chat_messages');
  });

  it('CONTROL: implemented methods still chain and still resolve', async () => {
    // Without this, a guard that threw on EVERY property access past link 1
    // would pass every case above and be completely broken. This is the case
    // that distinguishes "the guard reaches the whole chain" from "the whole
    // chain is now a trap".
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT, owner_key: OWNER, title: 'kept' }),
    ]);
    const { data, error } = await fake.client
      .from('chats')
      .select('id, title')
      .eq('owner_key', OWNER)
      .is('archived_at', null)
      .order('last_message_at', { ascending: false })
      .limit(10);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: CHAT, title: 'kept' }]);
  });

  it('CONTROL: the projection still hides owner_key deep in a chain', async () => {
    // The guard change touches what every method RETURNS, so the modelled
    // projection is re-pinned here — it is the property that makes "never
    // leaks owner_key" a real assertion rather than a vacuous one.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT, owner_key: OWNER })]);
    const { data } = await fake.client
      .from('chats')
      .select('id, title, created_at, last_message_at')
      .eq('owner_key', OWNER);

    expect(Object.keys((data as Array<unknown>)[0] as object)).not.toContain('owner_key');
  });
});
