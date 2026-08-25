/**
 * Phase 1 multi-chat — the server contract.
 *
 * T2 (history isolation), T3 (owner-scoped mutations 404), T4 (listing never
 * crosses owners) and the R5 auto-create live here. The through-line of every
 * case is that owner_key is a CAPABILITY, not a hint: it is resolved in one
 * place, it scopes every WHERE, and a chat belonging to someone else is
 * indistinguishable from a chat that does not exist.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { chatRecord, makeChatsSupabase, type ChatRecord } from './helpers/chatsFakes.js';
import { resolveOwnerKey, OwnerKeyError, OWNER_KEY_HEADER } from '../src/server/ownerKey.js';
import {
  touchChat,
  generateChatTitle,
  fallbackTitle,
  normalizeTitle,
  MAX_ACTIVE_CHATS,
} from '../src/server/chats.js';
import { makeFakeOpenAI } from './helpers/fakes.js';

const OWNER_A = 'device:11111111-1111-4111-8111-111111111111';
const OWNER_B = 'device:22222222-2222-4222-8222-222222222222';
const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

function appWith(seed: ChatRecord[], options: { failChats?: boolean } = {}) {
  const fake = makeChatsSupabase(seed, options);
  const app = buildApp(config, { supabase: fake.client as never });
  return { app, fake };
}

const auth = (owner: string) => ({ [OWNER_KEY_HEADER]: owner });

/**
 * RE-POINTED (Phase 3 S3): resolveOwnerKey grew its ruled second parameter —
 * the seam finally took its Phase 3 shape. These cases now exercise the
 * DEV FALLBACK path (allowDeviceFallback: true, which callers derive from
 * !config.isProduction); the token path and the production posture are pinned
 * in tests/phase3Gate.test.ts. The subjects below are unchanged: the device
 * key shape rules and the never-guess-ambiguity rule.
 */
const DEV_OPTS = { allowDeviceFallback: true } as const;

describe('resolveOwnerKey — the single seam, now in its Phase 3 shape (R3)', () => {
  it('returns the device key from the header', () => {
    expect(resolveOwnerKey({ headers: auth(OWNER_A) }, DEV_OPTS)).toBe(OWNER_A);
  });

  it('throws when the header is absent — never a shared "anonymous" owner', () => {
    // A fallback owner would pool every keyless client into ONE owner, letting
    // each of them list and delete the others' chats.
    expect(() => resolveOwnerKey({ headers: {} }, DEV_OPTS)).toThrow(OwnerKeyError);
  });

  it('REJECTS a non-device key, which is the Phase 3 pre-seeding defence', () => {
    // The dev fallback accepts EXACTLY the device shape. An asserted
    // email:<addr> header must never mint an owner — email owners come only
    // from verified tokens, so an attacker cannot plant chats under a
    // victim's owner key by asserting it. (The original comment described a
    // planned key REWRITE; superseded — owner_key is email:<verified> from
    // the first write, table empty, no migration.)
    expect(() => resolveOwnerKey({ headers: auth('email:victim@example.com') }, DEV_OPTS)).toThrow(
      OwnerKeyError,
    );
    expect(() => resolveOwnerKey({ headers: auth('device:not-a-uuid') }, DEV_OPTS)).toThrow(OwnerKeyError);
  });

  it('a repeated header is ambiguity, and ambiguity is never guessed', () => {
    expect(() =>
      resolveOwnerKey({ headers: { [OWNER_KEY_HEADER]: [OWNER_A, OWNER_B] } }, DEV_OPTS),
    ).toThrow(OwnerKeyError);
  });
});

describe('GET /chats', () => {
  it('T4: never returns a chat owned by someone else', async () => {
    const { app } = appWith([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, title: 'A only' }),
      chatRecord({ id: CHAT_B, owner_key: OWNER_B, title: 'B only' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; title: string }>;
    expect(body.map((c) => c.id), "another owner's chat was listed").toEqual([CHAT_A]);
    await app.close();
  });

  it('excludes archived chats (R4: delete is soft, not a tombstone in the list)', async () => {
    const { app } = appWith([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A }),
      chatRecord({ id: CHAT_B, owner_key: OWNER_A, archived_at: '2026-08-02T00:00:00.000Z' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) });
    expect((res.json() as Array<{ id: string }>).map((c) => c.id)).toEqual([CHAT_A]);
    await app.close();
  });

  it('never leaks owner_key in the listing payload', async () => {
    const { app } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const res = await app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) });
    expect(res.body, 'the owner key is a credential and must not round-trip').not.toContain(
      OWNER_A,
    );
    await app.close();
  });

  it('R6: is a PURE READ — a fresh owner gets [] and NOTHING is written', async () => {
    // This replaces the old R5 auto-create case. The server cannot see
    // localStorage, so a server-side create could never know a legacy session
    // was about to be adopted — it was guaranteed to race it (BUG-020). The
    // empty-list answer is now a client-side placeholder.
    const { app, fake } = appWith([]);
    const res = await app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(fake.rows, 'a safe verb wrote a row').toHaveLength(0);
    expect(fake.inserts, 'a safe verb issued an insert').toHaveLength(0);
    await app.close();
  });

  it('R6: N parallel calls for a fresh owner still create ZERO rows', async () => {
    // The old create-if-empty branch had no lock, so concurrent boots raced
    // each other into duplicate rows. A pure read cannot.
    const { app, fake } = appWith([]);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(responses.every((r) => r.json().length === 0)).toBe(true);
    expect(fake.rows, 'concurrent reads created rows').toHaveLength(0);
    await app.close();
  });

  it('400 without an owner key, and the reply says which header', async () => {
    const { app } = appWith([]);
    const res = await app.inject({ method: 'GET', url: '/chats' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain(OWNER_KEY_HEADER);
    await app.close();
  });

  it('a dead chats table degrades to 503, never a 500 stack', async () => {
    const { app } = appWith([], { failChats: true });
    const res = await app.inject({ method: 'GET', url: '/chats', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe('POST /chats', () => {
  it('creates a chat for the caller and returns its id', async () => {
    const { app, fake } = appWith([]);
    const res = await app.inject({ method: 'POST', url: '/chats', headers: auth(OWNER_A), payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().id, 'no id returned').toBeTruthy();
    expect(fake.rows[0].owner_key).toBe(OWNER_A);
    await app.close();
  });

  it('a client-supplied id is IGNORED — ids are always server-generated', async () => {
    // The `id` option existed only for W1 legacy adoption. A client naming the
    // id of a chat is a client asserting ownership of whatever transcript
    // already sits under that session, which with day-one gating would bind it
    // into a VERIFIED account. Ignoring the field closes that structurally —
    // there is no longer a request shape that can express the attack.
    const { app, fake } = appWith([]);
    const res = await app.inject({
      method: 'POST',
      url: '/chats',
      headers: auth(OWNER_A),
      payload: { id: CHAT_A },
    });
    expect(res.statusCode, 'a client id was rejected rather than ignored').toBe(201);
    expect(res.json().id, 'the client chose the chat id').not.toBe(CHAT_A);
    expect(fake.rows[0].id, 'the client id reached the database').not.toBe(CHAT_A);
    await app.close();
  });

  it("a client cannot bind a create onto someone else's existing chat", async () => {
    const { app, fake } = appWith([
      chatRecord({ id: CHAT_A, owner_key: OWNER_B, title: 'B owns this' }),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/chats',
      headers: auth(OWNER_A),
      payload: { id: CHAT_A },
    });
    expect(res.statusCode).toBe(201);
    expect(fake.rows.length, 'the existing row was touched instead of a new one created').toBe(2);
    const victim = fake.rows.find((r) => r.id === CHAT_A)!;
    expect(victim.owner_key, 'ownership was reassigned by a create').toBe(OWNER_B);
    expect(victim.title, "the victim's chat was modified").toBe('B owns this');
    await app.close();
  });
});

describe('PATCH /chats/:id — T3', () => {
  it("404s on another owner's chat, and does NOT rename it", async () => {
    const { app, fake } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_B, title: 'B title' })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/chats/${CHAT_A}`,
      headers: auth(OWNER_A),
      payload: { title: 'stolen' },
    });
    expect(res.statusCode, '403 would confirm the id exists; 404 must not').toBe(404);
    expect(fake.rows[0].title, "another owner's chat was renamed").toBe('B title');
    await app.close();
  });

  it('renames the caller’s own chat', async () => {
    const { app, fake } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/chats/${CHAT_A}`,
      headers: auth(OWNER_A),
      payload: { title: '  Duplex on 5th   St ' },
    });
    expect(res.statusCode).toBe(200);
    expect(fake.rows[0].title, 'whitespace was not normalized').toBe('Duplex on 5th St');
    await app.close();
  });

  it('an empty title is a 400, not a chat named ""', async () => {
    const { app } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/chats/${CHAT_A}`,
      headers: auth(OWNER_A),
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('a malformed id is a 404, not a 500 from Postgres', async () => {
    const { app } = appWith([]);
    const res = await app.inject({
      method: 'PATCH',
      url: '/chats/not-a-uuid',
      headers: auth(OWNER_A),
      payload: { title: 'x' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /chats/:id — T3 + R4', () => {
  it("404s on another owner's chat and leaves it active", async () => {
    const { app, fake } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_B })]);
    const res = await app.inject({
      method: 'DELETE',
      url: `/chats/${CHAT_A}`,
      headers: auth(OWNER_A),
    });
    expect(res.statusCode).toBe(404);
    expect(fake.rows[0].archived_at, "another owner's chat was archived").toBeNull();
    await app.close();
  });

  it('soft-deletes: 204, archived_at stamped, transcript rows untouched', async () => {
    const { app, fake } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    fake.messages.push({ session_id: CHAT_A, role: 'user', content: 'keep me' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/chats/${CHAT_A}`,
      headers: auth(OWNER_A),
    });
    expect(res.statusCode).toBe(204);
    expect(fake.rows[0].archived_at, 'the row was not archived').not.toBeNull();
    expect(fake.rows, 'the row was hard-deleted').toHaveLength(1);
    expect(fake.messages, 'chat_messages must survive a soft delete').toHaveLength(1);
    await app.close();
  });

  it('deleting twice is a 404 the second time (already archived)', async () => {
    const { app } = appWith([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const first = await app.inject({ method: 'DELETE', url: `/chats/${CHAT_A}`, headers: auth(OWNER_A) });
    const second = await app.inject({ method: 'DELETE', url: `/chats/${CHAT_A}`, headers: auth(OWNER_A) });
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(404);
    await app.close();
  });
});

describe('T2: /history is per chat, because a chat IS a session', () => {
  it('returns only the rows of the requested chat', async () => {
    const { app, fake } = appWith([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A }),
      chatRecord({ id: CHAT_B, owner_key: OWNER_A }),
    ]);
    fake.messages.push(
      { session_id: CHAT_A, role: 'user', content: 'question in A' },
      { session_id: CHAT_A, role: 'assistant', content: 'answer in A' },
      { session_id: CHAT_B, role: 'user', content: 'question in B' },
    );
    const res = await app.inject({ method: 'GET', url: `/history?session_id=${CHAT_B}` });
    const contents = (res.json().messages as Array<{ content: string }>).map((m) => m.content);
    expect(contents, "chat A's transcript leaked into chat B").toEqual(['question in B']);
    await app.close();
  });
});

describe('touchChat — sidebar ordering, and the row it can self-heal', () => {
  const logger = { warn: vi.fn(), error: vi.fn() };
  beforeEach(() => logger.warn.mockClear());

  it('bumps last_message_at on an existing chat', async () => {
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, last_message_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, logger, new Date('2026-08-09T12:00:00Z'));
    expect(fake.rows[0].last_message_at).toBe('2026-08-09T12:00:00.000Z');
    await Promise.resolve();
  });

  it('creates the row when absent and an owner was proved (the legacy/lazy path)', async () => {
    const fake = makeChatsSupabase([]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, logger);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].id).toBe(CHAT_A);
    expect(fake.rows[0].owner_key).toBe(OWNER_A);
  });

  it('creates NOTHING without an owner — a chat cannot be conjured ownerless', async () => {
    const fake = makeChatsSupabase([]);
    await touchChat(fake.client as never, CHAT_A, undefined, logger);
    expect(fake.rows).toHaveLength(0);
  });

  it('never reassigns ownership of an existing chat', async () => {
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_B })]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, logger);
    expect(fake.rows[0].owner_key, 'a /chat call moved a chat between owners').toBe(OWNER_B);
  });

  it('a dead table warns and resolves — a member reply is never at risk', async () => {
    const fake = makeChatsSupabase([], { failChats: true });
    await expect(touchChat(fake.client as never, CHAT_A, OWNER_A, logger)).resolves.toBeUndefined();
    expect(logger.warn, 'the failure was swallowed silently').toHaveBeenCalled();
  });
});

describe('titles', () => {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const openaiWith = (content: string | null, fail = false) =>
    ({
      chat: {
        completions: {
          create: vi.fn(async () => {
            if (fail) throw new Error('model down');
            return { choices: [{ message: { content } }] };
          }),
        },
      },
    }) as never;

  beforeEach(() => logger.warn.mockClear());

  it('writes the generated title, stripped of quotes and capped at six words', async () => {
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    await generateChatTitle(
      fake.client as never,
      openaiWith('"Duplex Deal In North Tempe Today Extra"'),
      CHAT_A,
      'looking at a duplex',
      'here are the numbers',
      logger,
    );
    expect(fake.rows[0].title).toBe('Duplex Deal In North Tempe Today');
    });

  it('falls back to the first message, truncated, when the model fails', async () => {
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const long = 'I am looking at a duplex in north Tempe with a detached garage';
    await generateChatTitle(fake.client as never, openaiWith(null, true), CHAT_A, long, 'ok', logger);
    expect(fake.rows[0].title).toBe(long.slice(0, 40).trimEnd());
    expect(fake.rows[0].title!.length).toBeLessThanOrEqual(40);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('NEVER regenerates: a chat that already has a title is left alone', async () => {
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, title: 'Member renamed this' }),
    ]);
    await generateChatTitle(
      fake.client as never,
      openaiWith('A Brand New Title'),
      CHAT_A,
      'hello',
      'hi',
      logger,
    );
    expect(fake.rows[0].title, 'the WHERE title IS NULL guard did not hold').toBe(
      'Member renamed this',
    );
  });

  it('fallbackTitle and normalizeTitle handle the empty cases without inventing text', () => {
    expect(fallbackTitle('   ')).toBe('New chat');
    expect(fallbackTitle('short one')).toBe('short one');
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle(42)).toBeNull();
    expect(normalizeTitle('x'.repeat(400))!.length).toBe(120);
  });
});

describe('BUG-016: touchChat cannot write across ownership or into archived rows', () => {
  const logger = { warn: vi.fn(), error: vi.fn() };
  beforeEach(() => logger.warn.mockClear());

  it('a cross-owner id changes NOTHING, inserts nothing, and does not collide', async () => {
    // Proved by execution before the fix: POST /chat with a chat UUID you do
    // not own reordered another member's sidebar.
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_B, last_message_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, logger, new Date('2026-08-09T12:00:00Z'));

    expect(fake.rows, "the victim's row was duplicated or a new one inserted").toHaveLength(1);
    expect(fake.rows[0].owner_key, 'ownership moved').toBe(OWNER_B);
    expect(fake.rows[0].last_message_at, "another owner's sidebar was reordered").toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(fake.inserts, 'a blind insert fired and would collide on the primary key').toHaveLength(
      0,
    );
    expect(logger.warn, 'a primary-key collision was swallowed as a warning').not.toHaveBeenCalled();
  });

  it('an ARCHIVED chat of your own is not bumped, and is not re-inserted', async () => {
    const fake = makeChatsSupabase([
      chatRecord({
        id: CHAT_A,
        owner_key: OWNER_A,
        archived_at: '2026-08-02T00:00:00.000Z',
        last_message_at: '2026-08-01T00:00:00.000Z',
      }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, logger, new Date('2026-08-09T12:00:00Z'));

    expect(fake.rows[0].last_message_at, 'a deleted chat was reordered back into the list').toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(fake.inserts, 'a deleted chat was re-created').toHaveLength(0);
    expect(fake.rows[0].archived_at, 'the archive stamp was cleared').not.toBeNull();
  });
});

describe('BUG-016 billing hole: an archived chat never enters the agent loop', () => {
  it('POST /chat on an archived chat is a 404 and calls NO model', async () => {
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, archived_at: '2026-08-02T00:00:00.000Z' }),
    ]);
    const openai = makeFakeOpenAI([{ content: 'should never be produced' }]);
    const app = buildApp(config, { supabase: fake.client as never, openai: openai.client as never });

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: auth(OWNER_A),
      payload: { message: 'spend money for me', session_id: CHAT_A },
    });

    expect(res.statusCode, 'a deleted chat still accepted a turn').toBe(404);
    // Asserted on the MOCK, not on the output: an error reply with no model
    // call and an error reply after a paid one look identical from outside.
    expect(openai.calls, 'the agent loop ran and billed OpenAI').toHaveLength(0);
    expect(openai.embeddingCalls, 'retrieval embedded a query for a dead chat').toBe(0);
    expect(fake.messages, 'the turn was written into a deleted chat').toHaveLength(0);
    await app.close();
  });

  it('CONTROL: the same request against a LIVE chat does reach the model', async () => {
    // Without this, the case above would pass against an app that never calls
    // OpenAI at all.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const openai = makeFakeOpenAI([{ content: 'a real answer' }]);
    const app = buildApp(config, { supabase: fake.client as never, openai: openai.client as never });

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: auth(OWNER_A),
      payload: { message: 'hello', session_id: CHAT_A },
    });

    expect(res.statusCode).toBe(200);
    expect(openai.calls.length, 'the live path never reached the model').toBeGreaterThan(0);
    await app.close();
  });
});

describe('C1: the active-chat cap', () => {
  const atLimit = () =>
    Array.from({ length: MAX_ACTIVE_CHATS }, (_, i) =>
      chatRecord({
        // Prefixed away from the fake's own uuid counter: colliding ids would
        // make these cases pass on a DUPLICATE-KEY 409 instead of the cap.
        id: 'ffffffff-ffff-4fff-8fff-' + String(i).padStart(12, '0'),
        owner_key: OWNER_A,
      }),
    );

  it('the 51st active chat is a 409', async () => {
    const { app, fake } = appWith(atLimit());
    const res = await app.inject({ method: 'POST', url: '/chats', headers: auth(OWNER_A), payload: {} });
    expect(res.statusCode).toBe(409);
    // The message matters: a duplicate-key 409 and a cap 409 are the same
    // status, and this case is worthless if it cannot tell them apart.
    expect(res.json().error, 'the 409 was not the cap').toContain('maximum number of chats');
    expect(fake.rows, 'a row was created past the cap').toHaveLength(MAX_ACTIVE_CHATS);
    await app.close();
  });

  it('ARCHIVED chats do not count toward it', async () => {
    const seed = atLimit();
    seed[0].archived_at = '2026-08-02T00:00:00.000Z';
    const { app, fake } = appWith(seed);
    const res = await app.inject({ method: 'POST', url: '/chats', headers: auth(OWNER_A), payload: {} });
    expect(res.statusCode, 'a soft-deleted chat still occupied a slot').toBe(201);
    expect(fake.rows).toHaveLength(MAX_ACTIVE_CHATS + 1);
    await app.close();
  });

  it("another owner's chats do not count toward yours", async () => {
    const seed = atLimit().map((row) => ({ ...row, owner_key: OWNER_B }));
    const { app } = appWith(seed);
    const res = await app.inject({ method: 'POST', url: '/chats', headers: auth(OWNER_A), payload: {} });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('the cap also holds on the self-heal path, which is where rows are really made', async () => {
    // After R6 the widget never calls POST /chats, so capping only that route
    // would be a cap that enforces nothing.
    const logger = { warn: vi.fn(), error: vi.fn() };
    const fake = makeChatsSupabase(atLimit());
    await touchChat(fake.client as never, CHAT_B, OWNER_A, logger, new Date(), {
      hadPriorHistory: false,
    });
    expect(fake.rows, 'the self-heal insert walked past the cap').toHaveLength(MAX_ACTIVE_CHATS);
    expect(logger.warn, 'the refusal was silent').toHaveBeenCalled();
  });
});
