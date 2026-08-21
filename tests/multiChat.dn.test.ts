import { describe, it, expect } from 'vitest';
import { touchChat, listChats, createChat, MAX_ACTIVE_CHATS } from '../src/server/chats.js';
import { makeChatsSupabase, chatRecord } from './helpers/chatsFakes.js';
import { COMPS_ARV_CLOSE as CLOSE } from '../src/features/comps/format.js';

const OWNER = 'device:11111111-1111-4111-8111-111111111111';
const NEW_CHAT = '44444444-4444-4444-8444-444444444444';
const stamp = new Date('2026-08-20T00:00:00.000Z');

/** FINDING-023's predicate, lifted verbatim from arvClosePosition.test.ts. */
function verdict(block: string): 'pass' | 'fail' {
  const lines = block.split('\n').filter((l) => l.trim().length > 0);
  const arvLines = lines.map((l, i) => (/\barv\b/i.test(l) ? i : -1)).filter((i) => i !== -1);
  if (arvLines.length !== 1) return 'fail';
  if (lines[arvLines[0]].trim() !== CLOSE) return 'fail';
  const trailing = lines.slice(arvLines[0] + 1);
  if (trailing.length !== 1) return 'fail';
  return /not a formal appraisal/i.test(trailing[0]) ? 'pass' : 'fail';
}

describe('STEP 5 — FINDING-023: does the assertion catch a duplicate in BOTH directions?', () => {
  const FOOTER = '_This is not a formal appraisal._';
  const healthy = ['**Comps**', '- 123 Main St', CLOSE, FOOTER].join('\n');

  it('the healthy block passes — the predicate is not simply always-red', () => {
    expect(verdict(healthy)).toBe('pass');
  });

  it('a duplicate AFTER the close is caught — the observed FINDING-023 shape', () => {
    const after = ['**Comps**', '- 123 Main St', CLOSE, 'You choose the ARV.', FOOTER].join('\n');
    expect(verdict(after), 'the observed duplicate is not caught').toBe('fail');
  });

  it('a duplicate BEFORE the close is ALSO caught — the shape never observed', () => {
    // The wrong-subject risk: an assertion built only around the instance that
    // was seen. This one counts ARV-bearing LINES and requires exactly one, so
    // a duplicate anywhere fails — position is pinned separately by the
    // identity and trailing-footer checks rather than being the only guard.
    const before = ['**Comps**', 'The ARV is yours to choose.', '- 123 Main St', CLOSE, FOOTER].join('\n');
    expect(verdict(before), 'a duplicate emitted BEFORE the close slips through').toBe('fail');
  });

  it('a presence-only assertion would have MISSED the real defect — why counting matters', () => {
    const after = ['**Comps**', CLOSE, 'You choose the ARV.', FOOTER].join('\n');
    expect(after.includes(CLOSE), 'presence-only would pass the broken output').toBe(true);
    expect(verdict(after), 'the shipped predicate must still reject it').toBe('fail');
  });
});

describe('STEP 2 — D1 / N1 / N2 and the fake NOT NULL gap', () => {
  it('D1: N parallel GET /chats for a fresh owner create ZERO rows', async () => {
    const fake = makeChatsSupabase([]);
    const out = await Promise.all(Array.from({ length: 6 }, () => listChats(fake.client as never, OWNER)));
    expect(fake.rows.length, 'GET /chats still writes').toBe(0);
    expect(fake.inserts.length, 'an insert was ATTEMPTED even if no row landed').toBe(0);
    for (const r of out) expect(r).toEqual([]);
  });

  it('N1: a genuine legacy session IS flagged; a genuinely new chat is NOT', async () => {
    const a = makeChatsSupabase([]);
    await touchChat(a.client as never, NEW_CHAT, OWNER, undefined, stamp, { hadPriorHistory: true });
    expect(a.inserts[0]?.adopted_legacy, 'a genuine adoption was not flagged').toBe(true);
    const b = makeChatsSupabase([]);
    await touchChat(b.client as never, NEW_CHAT, OWNER, undefined, stamp, { hadPriorHistory: false });
    expect(b.inserts[0]?.adopted_legacy, 'a new chat was flagged').toBe(false);
  });

  it('N1 OBSERVATION: a new chat is FALSELY flagged if its first write was skipped', async () => {
    const atCap = Array.from({ length: MAX_ACTIVE_CHATS }, (_, i) =>
      chatRecord({ id: `5${String(i).padStart(7, '0')}-4444-4444-8444-444444444444`, owner_key: OWNER }));
    const fake = makeChatsSupabase(atCap);
    await touchChat(fake.client as never, NEW_CHAT, OWNER, undefined, stamp, { hadPriorHistory: false });
    expect(fake.inserts.filter((r: any) => r?.id === NEW_CHAT).length,
      'precondition: the cap did not skip the insert').toBe(0);
    fake.rows[0].archived_at = '2026-08-21T00:00:00.000Z';
    await touchChat(fake.client as never, NEW_CHAT, OWNER, undefined, stamp, { hadPriorHistory: true });
    expect(fake.inserts.find((r: any) => r?.id === NEW_CHAT)?.adopted_legacy,
      'if false, the hole is closed and this should assert that instead').toBe(true);
  });

  it('N2: the self-heal insert is capped, and the WARN is scoped to its MESSAGE', async () => {
    const atCap = Array.from({ length: MAX_ACTIVE_CHATS }, (_, i) =>
      chatRecord({ id: `6${String(i).padStart(7, '0')}-4444-4444-8444-444444444444`, owner_key: OWNER }));
    const fake = makeChatsSupabase(atCap);
    const warns: string[] = [];
    const logger = { warn: (_o: unknown, m?: unknown) => warns.push(String(m ?? '')),
      info: () => {}, error: () => {}, debug: () => {} };
    await expect(touchChat(fake.client as never, NEW_CHAT, OWNER, logger as never, stamp))
      .resolves.toBeUndefined();
    expect(fake.inserts.filter((r: any) => r?.id === NEW_CHAT).length, 'the cap did not hold').toBe(0);
    // Scoped to the message: chatId/limit appear on other lines, so a
    // field-only matcher would pass on the wrong WARN.
    expect(warns.filter((m) => /active chat limit reached/i.test(m)).length,
      'the skip was silent, or the WARN is not identifiable by its message').toBe(1);
  });

  it('FINDING: the fake coerces an undefined owner_key that Postgres would reject', async () => {
    const fake = makeChatsSupabase([]);
    await createChat(fake.client as never, undefined as never);
    expect(fake.rows[0]?.owner_key,
      'if no longer "undefined", the fake now models NOT NULL').toBe('undefined');
  });
});
