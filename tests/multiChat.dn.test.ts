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

  // N1's two cases are DELETED, not re-pointed. RULING 2 removed the
  // adopted_legacy column and the inference behind it, so there is no adjacent
  // behaviour left for them to assert — a re-point here would be a test about
  // nothing, kept alive because it used to pass. The mis-flagging observation
  // they proved survives in the report as the reason the column was dropped.

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

  it('FINDING-025 FLIPPED: the fake now REJECTS a null owner_key as Postgres does', async () => {
    // This was a sentinel recording a gap: String(row.owner_key) coerced
    // undefined to the literal "undefined", so the fake accepted a row that
    // Postgres NOT NULL rejects. MASON closed it — the fake now answers 23502.
    // Flipped to verify the fix rather than deleted, per the FINDING-013
    // pattern: the case that found the gap becomes the case that keeps it shut.
    const fake = makeChatsSupabase([]);
    await expect(createChat(fake.client as never, undefined as never)).rejects.toBeTruthy();
    expect(fake.rows.length, 'a row with no owner survived the rejection').toBe(0);
  });

  it('CONTROL: a VALID owner_key is still accepted — the fake did not start rejecting everything', async () => {
    // Without this the sentinel above passes against a fake that refuses all
    // inserts, which would look like a fix and be a broken double. Subject:
    // the fake's discrimination, not merely its rejection.
    const fake = makeChatsSupabase([]);
    const chat = await createChat(fake.client as never, OWNER);
    expect(chat?.id, 'a valid create no longer returns a row').toBeTruthy();
    expect(fake.rows.length, 'a valid owner_key was rejected too').toBe(1);
  });
});
