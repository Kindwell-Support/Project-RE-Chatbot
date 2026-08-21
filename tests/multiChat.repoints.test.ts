/**
 * H — do MASON's re-pointed assertions still catch the defects they were
 * written for? Proved by REINTRODUCING each defect, never by reasoning.
 *
 * A re-point is the most dangerous kind of test edit: it is made by the person
 * whose change made it fail, under pressure to get green, and it looks like
 * maintenance. "Tests green" is partly self-certified until each one is shown
 * to still fail on its original defect.
 */
import { describe, it, expect } from 'vitest';

/** The re-pointed mount-ordering predicate, lifted verbatim from widget.test.ts. */
function mountOrderingVerdict(order: string[]): 'pass' | 'fail' {
  if (!(order.length > 0)) return 'fail'; // vacuity guard
  return order.filter((e) => e !== 'fetch-after-render').length === 0 ? 'pass' : 'fail';
}

/** The re-pointed CORS predicate: SET equality, order-insensitive. */
function corsVerdict(methods: string, headers: string): 'pass' | 'fail' {
  const m = String(methods).split(',').map((s) => s.trim()).sort();
  const h = String(headers).split(',').map((s) => s.trim().toLowerCase()).sort();
  const okM = JSON.stringify(m) === JSON.stringify(['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST']);
  const okH = JSON.stringify(h) === JSON.stringify(['content-type', 'x-james-owner']);
  return okM && okH ? 'pass' : 'fail';
}

const REGISTRY_KEYS = [
  'james-bot-session', 'james-bot-device', 'james-bot-active-chat',
  'james-bot-sidebar-collapsed', 'james-bot-legacy-adopted',
];
const storageVerdict = (keys: string[]) =>
  keys.filter((k) => REGISTRY_KEYS.indexOf(k) === -1).length === 0 ? 'pass' : 'fail';

describe('H1 — every re-point still goes red on its original defect', () => {
  it('MOUNT ORDERING catches a fetch issued BEFORE the input box exists', () => {
    // The original defect: a network call at mount before render. The old
    // assertion caught it by pinning the exact array; the re-point must catch
    // it by filtering. Both directions asserted.
    expect(mountOrderingVerdict(['fetch-after-render']), 'the healthy shape fails').toBe('pass');
    expect(mountOrderingVerdict(['fetch-after-render', 'fetch-after-render']),
      'two legitimate post-render calls are rejected — this is why the count form had to go')
      .toBe('pass');
    expect(
      mountOrderingVerdict(['fetch-before-render', 'fetch-after-render']),
      'THE DEFECT: a call before render is no longer caught',
    ).toBe('fail');
    expect(
      mountOrderingVerdict([]),
      'a mount that issues NO call passes vacuously — the ordering claim would ' +
        'be true of a widget that never fetches anything',
    ).toBe('fail');
  });

  it('CORS catches a wildcard and any widening', () => {
    expect(corsVerdict('GET, POST, PATCH, DELETE, OPTIONS', 'content-type, x-james-owner'))
      .toBe('pass');
    for (const [label, m, h] of [
      ['wildcard headers', 'GET, POST, PATCH, DELETE, OPTIONS', '*'],
      ['wildcard methods', '*', 'content-type, x-james-owner'],
      ['PUT smuggled in', 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'content-type, x-james-owner'],
      ['authorization widened', 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type, x-james-owner, authorization'],
      ['owner header dropped', 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type'],
    ] as const) {
      expect(corsVerdict(m, h), `THE DEFECT (${label}) is no longer caught`).toBe('fail');
    }
  });

  it('STORAGE allow-list catches a form value persisted under a NEW key', () => {
    expect(storageVerdict(['james-bot-device', 'james-bot-active-chat'])).toBe('pass');
    expect(
      storageVerdict(['james-bot-device', 'james-bot-form-arv']),
      'THE DEFECT: a form value persisted to storage is no longer caught',
    ).toBe('fail');
    // The prefix trap the enumeration exists to close.
    expect(
      storageVerdict(['james-bot-session-draft']),
      'a key sharing the james-bot- prefix slipped through',
    ).toBe('fail');
  });

  it('FINDING-021: the storage allow-list checks KEY NAMES, never payloads', () => {
    // The gap the re-point does not close, and it is the one H2 asks about.
    // Conversation content written INTO an allow-listed key passes untouched —
    // the assertion cannot see values at all. Recorded rather than fixed,
    // because today no path writes content there; it is the shape of the guard
    // that is weak, not current behaviour.
    expect(
      storageVerdict(['james-bot-active-chat']),
      'precondition: the allowed key is accepted on its own',
    ).toBe('pass');
    // Same key, now carrying a transcript. Indistinguishable to this guard.
    expect(storageVerdict(['james-bot-active-chat'])).toBe('pass');
  });
});
