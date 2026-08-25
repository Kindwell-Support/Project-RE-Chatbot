/**
 * PHASE 1 ADVERSARIAL — attacking the isolation and ownership claims.
 *
 * Written against the brief's theses, not against MASON's test list. Findings
 * are proved by execution rather than by reading, and each case names whether
 * the behaviour is NEW in this branch or inherited from main.
 */
import { describe, it, expect } from 'vitest';
import { touchChat, listChats, archiveChat, renameChat, normalizeTitle } from '../src/server/chats.js';
import { resolveOwnerKey, OwnerKeyError, OWNER_KEY_HEADER } from '../src/server/ownerKey.js';
import { makeChatsSupabase, chatRecord } from './helpers/chatsFakes.js';
import { createChat } from '../src/server/chats.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const OWNER_A = 'device:11111111-1111-4111-8111-111111111111';
const OWNER_B = 'device:22222222-2222-4222-8222-222222222222';
const CHAT_A = '33333333-3333-4333-8333-333333333333';

describe('BUG-016 — FIXED: the probes flipped, so they now verify the fix', () => {
  it('POST /chat to ANOTHER owner chat id mutates their row (no owner_key filter)', async () => {
    // touchChat updates on `.eq('id', chatId)` alone. The owner key is read
    // and then used ONLY for the self-heal insert; the update path never
    // filters on it. So a caller holding a chat UUID they do not own can
    // reorder the victim sidebar by posting to it.
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, last_message_at: '2020-01-01T00:00:00.000Z' }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_B, undefined, new Date('2026-08-20T00:00:00.000Z'));
    const row = fake.rows.find((r) => r.id === CHAT_A);
    expect(row?.owner_key, 'ownership itself changed').toBe(OWNER_A);
    // FLIPPED. This pinned the defect: the update ran on .eq('id') alone, so a
    // caller holding a uuid they did not own reordered the victim sidebar. The
    // update is now owner-filtered, so the write must NOT land.
    expect(
      row?.last_message_at,
      'a caller who does not own this chat still updated its ordering timestamp',
    ).toBe('2020-01-01T00:00:00.000Z');
  });

  it('a SOFT-DELETED chat still accepts the write — it is hidden, not inert', async () => {
    // The update has no `archived_at is null` filter either, so a chat the
    // member deleted keeps taking writes. It stays out of the sidebar, but
    // the row moves and the turn is still billed upstream.
    const fake = makeChatsSupabase([
      chatRecord({
        id: CHAT_A, owner_key: OWNER_A,
        archived_at: '2026-08-01T00:00:00.000Z',
        last_message_at: '2020-01-01T00:00:00.000Z',
      }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, undefined, new Date('2026-08-20T00:00:00.000Z'));
    const row = fake.rows.find((r) => r.id === CHAT_A);
    expect(row?.archived_at, 'the delete was reversed').not.toBeNull();
    // FLIPPED for the same reason: the update now carries .is('archived_at', null).
    expect(
      row?.last_message_at,
      'an archived chat still took a write — the member believes it is gone',
    ).toBe('2020-01-01T00:00:00.000Z');
    const visible = await listChats(fake.client as never, OWNER_A);
    expect(visible.map((c) => c.id), 'the archived chat resurfaced').not.toContain(CHAT_A);
  });
});

describe('B1 — cross-owner reads and mutations answer 404, never confirm existence', () => {
  it('rename and archive of a chat owned by someone else return null (=> 404)', async () => {
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    expect(
      await renameChat(fake.client as never, OWNER_B, CHAT_A, 'stolen'),
      'a non-owner renamed a chat',
    ).toBeNull();
    expect(
      await archiveChat(fake.client as never, OWNER_B, CHAT_A),
      'a non-owner archived a chat',
    ).toBeFalsy();
    const row = fake.rows.find((r) => r.id === CHAT_A);
    expect(row?.title, 'the title changed under a foreign owner').not.toBe('stolen');
    expect(row?.archived_at, 'a foreign owner archived the row').toBeNull();
  });

  it('a NON-EXISTENT chat and an EXISTS-WRONG-OWNER chat are indistinguishable', async () => {
    // The enumeration oracle: both must take the same shape. A different
    // return value here would let an attacker probe which UUIDs are real.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, owner_key: OWNER_A })]);
    const wrongOwner = await renameChat(fake.client as never, OWNER_B, CHAT_A, 'x');
    const missing = await renameChat(
      fake.client as never, OWNER_B, '99999999-9999-4999-8999-999999999999', 'x',
    );
    expect(wrongOwner, 'exists-wrong-owner and does-not-exist differ').toEqual(missing);
  });
});

// RE-POINTED (Phase 3 S3): resolveOwnerKey took its ruled second parameter.
// These cases pin the DEV-FALLBACK path (the production token path lives in
// tests/phase3Gate.test.ts); their subjects — key shape, ambiguity-never-
// guessed, bearer-capability semantics — are unchanged.
const DEV_OPTS = { allowDeviceFallback: true } as const;

describe('B3/G — owner key forgeability and the Phase 3 pre-seeding defence', () => {
  it('an email-shaped owner key is REJECTED — Phase 3 cannot be pre-seeded', () => {
    // The defence that matters most for Phase 3: if arbitrary keys were
    // accepted, an attacker could create chats under email:victim TODAY and
    // have them appear in the victim sidebar the moment Phase 3 rewrites
    // that member key to exactly that value.
    expect(() =>
      resolveOwnerKey({ headers: { [OWNER_KEY_HEADER]: 'email:victim@example.com' } }, DEV_OPTS),
    ).toThrow(OwnerKeyError);
  });

  it('a REPEATED header is ambiguity and is never guessed', () => {
    expect(() =>
      resolveOwnerKey({ headers: { [OWNER_KEY_HEADER]: [OWNER_A, OWNER_B] } }, DEV_OPTS),
    ).toThrow(OwnerKeyError);
  });

  it('BUT any device key is accepted from any caller — a bearer capability', () => {
    // Stated explicitly because Phase 3 inherits it: the key is client-chosen,
    // travels in a header, and is bound to nothing. Holding another device
    // uuid IS being that device. Unguessable, not unforgeable.
    expect(resolveOwnerKey({ headers: { [OWNER_KEY_HEADER]: OWNER_B } }, DEV_OPTS)).toBe(OWNER_B);
  });
});

describe('C3/C5 — title output bounds hold structurally, not by prompt instruction', () => {
  it('a 10KB title is capped, not persisted at length', () => {
    const huge = 'A'.repeat(10_000);
    expect(normalizeTitle(huge)?.length, 'a 10KB title survived normalisation').toBe(120);
  });

  it.each([
    ['null', null], ['number', 42], ['array', ['a']], ['object', { a: { b: 1 } }], ['boolean', true],
  ])('a %s title is rejected as unusable rather than coerced', (_label, value) => {
    expect(normalizeTitle(value), 'a non-string title was coerced into one').toBeNull();
  });

  it('title text is NOT sanitised server-side — the render must be the defence', () => {
    // Recorded deliberately. normalizeTitle trims, collapses and caps; it does
    // not strip markup. That is defensible ONLY if every render path treats a
    // title as text. The widget assertion is in the widget suite; this pins
    // the server-side posture so the two are read together.
    expect(normalizeTitle('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('C4 — the sidebar renders titles as TEXT (the only XSS defence there is)', () => {
  it('every title render path uses textContent/value, never innerHTML', () => {
    // Server-side normalizeTitle does not strip markup (pinned above), so the
    // whole defence is that the rail assigns titles as text. Asserted against
    // the SOURCE because a DOM test would only cover the paths it happens to
    // exercise, and a future innerHTML on any one of them is the whole bug.
    const src = readFileSync(resolve(HERE, '..', 'widget', 'widget.js'), 'utf8');
    const titleRenders = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      // The declaration line itself is not a render site; matching it made
      // this sweep fail on its own imprecision rather than on a sink.
      .filter((l) => /chatLabel\(/.test(l.line) && !/function chatLabel/.test(l.line));
    expect(titleRenders.length, 'no title render found — the sweep is vacuous')
      .toBeGreaterThanOrEqual(3);
    for (const { line, n } of titleRenders) {
      expect(
        /innerHTML|insertAdjacentHTML|outerHTML/.test(line),
        `widget.js:${n} renders a chat title as HTML. Titles are model-generated ` +
          'AND member-renamable, and the server does not strip markup.',
      ).toBe(false);
      expect(
        /textContent|\.value|setAttribute\(/.test(line),
        `widget.js:${n} passes a title somewhere that is neither textContent, ` +
          'a form value, nor an attribute — check it is not an HTML sink',
      ).toBe(true);
    }
  });
});

describe('D1 — R5 auto-create has no concurrency guard', () => {
  it('N parallel empty-list checks each create a chat', async () => {
    // The handler is: list, and if empty, create. Read-then-write with no
    // uniqueness constraint (schema has none on owner_key) and no lock. Two
    // instances behind a load balancer make this reachable in production
    // rather than theoretical: a fresh device firing concurrent /chats gets
    // one chat per racer, not one chat.
    const fake = makeChatsSupabase([]);
    const attempt = async () => {
      const existing = await listChats(fake.client as never, OWNER_A);
      if (existing.length === 0) await createChat(fake.client as never, OWNER_A);
    };
    await Promise.all([attempt(), attempt(), attempt(), attempt()]);
    const mine = fake.rows.filter((r) => r.owner_key === OWNER_A && !r.archived_at);
    // PROBE, not a wish: this records what the build DOES so the defect stays
    // visible without reddening the suite over a fix that is not mine to make.
    // Flip it to .toBe(1) the moment a constraint or lock lands.
    expect(
      mine.length,
      'if this is 1, R5 now serialises and this probe should become the real ' +
        'assertion: exactly one chat per fresh owner',
    ).toBeGreaterThan(1);
  });
});

describe('J1/J3 — the self-heal insert fires ONLY on genuine absence', () => {
  const stamp = new Date('2026-08-20T00:00:00.000Z');

  it.each([
    ['exists, NOT yours', { owner_key: OWNER_A, archived_at: null }, OWNER_B],
    ['exists, ARCHIVED', { owner_key: OWNER_A, archived_at: '2026-08-01T00:00:00.000Z' }, OWNER_A],
  ])('%s: zero-rows-updated must NOT trigger an insert (PK collision)', async (_l, over, caller) => {
    // The trap the owner filter created: once the update is scoped, "0 rows
    // changed" stops meaning "no such row". A blind insert on that signal
    // collides on the primary key every time.
    const fake = makeChatsSupabase([chatRecord({ id: CHAT_A, ...over })]);
    const before = fake.rows.length;
    await touchChat(fake.client as never, CHAT_A, caller, undefined, stamp);
    expect(fake.rows.length, 'a duplicate row was inserted for an id that exists')
      .toBe(before);
  });

  it('genuine absence DOES self-heal — the fix did not disable the branch', async () => {
    // The control. A narrow fix could satisfy both cases above by never
    // inserting at all, silently removing legacy self-heal.
    const fake = makeChatsSupabase([]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, undefined, stamp);
    expect(fake.rows.length, 'a genuinely absent chat was not self-healed').toBe(1);
    expect(fake.rows[0].owner_key).toBe(OWNER_A);
  });

  it('J3: only last_message_at is ever in scope — never title/owner/archived', async () => {
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: OWNER_A, title: 'mine', archived_at: null }),
    ]);
    await touchChat(fake.client as never, CHAT_A, OWNER_A, undefined, stamp);
    const row = fake.rows.find((r) => r.id === CHAT_A);
    expect(row?.title, 'touchChat rewrote the title').toBe('mine');
    expect(row?.owner_key, 'touchChat rewrote ownership').toBe(OWNER_A);
    expect(row?.archived_at, 'touchChat cleared the archive flag').toBeNull();
  });

  it('F5: a failing touch is swallowed — the member turn is unaffected', async () => {
    // Fire-and-forget must never reject. A DB outage during the ordering
    // update is a cosmetic problem; it must not surface as an unhandled
    // rejection or a failed reply.
    const fake = makeChatsSupabase([], { failChats: true });
    await expect(
      touchChat(fake.client as never, CHAT_A, OWNER_A, undefined, stamp),
    ).resolves.toBeUndefined();
  });
});
