/**
 * THE BOOT-ORDERING RULE: the chat list resolves BEFORE any first-chat
 * decision. Nothing paints, mints or fetches a transcript ahead of it.
 *
 * This is BUG-020's rule. That bug was two first-chat decisions racing —
 * client-side legacy adoption against a server-side auto-create — and it was
 * pinned only by the legacy-adoption cases. Those cases are being deleted with
 * adoption itself, so the rule would be left pinned by nothing: green, and
 * about code that no longer exists. This file replaces that pin against the
 * racer that SURVIVES the drop — the boot sequence versus the chat list.
 *
 * SHAPE, deliberately: a filtered RELATION between two events plus a vacuity
 * guard, never a literal sequence or a count. `toEqual([...])` over a call log
 * pins the population of one event, not the relation between two, and breaks
 * on any unrelated request the widget legitimately adds.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WIDGET_SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../widget/widget.js'),
  'utf-8',
);

function loadWidget(): void {
  delete (window as any).createJamesBot;
  // eslint-disable-next-line no-new-func
  new Function(WIDGET_SRC).call(window);
}

const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Event = { phase: 'request' | 'resolve'; url: string };

/**
 * A fetch mock that records BOTH edges of every call. The ordering rule is
 * about a request happening after another call's RESPONSE, so recording only
 * requests cannot express it.
 */
function recordingServer(options: { stallChats?: boolean } = {}) {
  const events: Event[] = [];
  const history = { [CHAT_A]: [{ role: 'user', content: 'remembered conversation' }] };

  const fetchMock = vi.fn((url: string, init?: any) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    events.push({ phase: 'request', url: u });

    const settle = (body: unknown) =>
      new Promise((resolve) => {
        // A real round trip is not synchronous; the delay is what gives the
        // widget a window in which it could misbehave.
        setTimeout(() => {
          events.push({ phase: 'resolve', url: u });
          resolve({ ok: true, status: 200, json: async () => body });
        }, 5);
      });

    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      return settle({ messages: (history as Record<string, unknown[]>)[id] ?? [] });
    }
    if (u.endsWith('/chats') && method === 'GET') {
      // A stalled list never resolves — the widget must simply wait.
      if (options.stallChats) return new Promise(() => {});
      return settle([{ id: CHAT_A, title: 'Remembered', created_at: 'x', last_message_at: 'x' }]);
    }
    return settle({ output: 'ok' });
  });

  return { fetchMock, events };
}

const tick = async (times = 8) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 1));
};

function boot(fetchMock: any) {
  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const railRows = () => document.querySelectorAll('#james-bot .jb-chat-row');
const indexOf = (events: Event[], phase: Event['phase'], match: RegExp) =>
  events.findIndex((e) => e.phase === phase && match.test(e.url));

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  // Phase 3 S4 (announced re-point, uniform across widget suites): the
  // widget now gates on a session token before ANY chat UI. Seeding one
  // keeps each suite's original subject - chat behaviour - unchanged;
  // the gate's own behaviour is pinned in phase3Widget.test.ts.
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('boot ordering: the chat list decides, and it decides first', () => {
  it('every /history request happens AFTER the chat list has resolved', async () => {
    // A returning member: the stored active chat is the one the optimistic
    // repaint used to fetch ahead of the list.
    window.localStorage.setItem('james-bot-active-chat', CHAT_A);
    const server = recordingServer();
    boot(server.fetchMock);
    await tick();

    const listResolved = indexOf(server.events, 'resolve', /\/chats$/);
    const historyRequests = server.events
      .map((e, i) => ({ ...e, i }))
      .filter((e) => e.phase === 'request' && /\/history/.test(e.url));

    // VACUITY GUARDS — both events must actually have happened, or the
    // relation below is a statement about an empty set.
    expect(listResolved, 'the chat list never resolved').toBeGreaterThanOrEqual(0);
    expect(historyRequests.length, 'no transcript was ever requested').toBeGreaterThan(0);

    // THE RELATION. Filtered, not positional: any unrelated request the widget
    // legitimately adds later leaves this untouched.
    expect(
      historyRequests.filter((h) => h.i < listResolved).map((h) => h.url),
      'a transcript was fetched before the chat list resolved — the BUG-020 shape',
    ).toEqual([]);
  });

  it('with the list STALLED, nothing is painted, minted or fetched', async () => {
    window.localStorage.setItem('james-bot-active-chat', CHAT_A);
    const server = recordingServer({ stallChats: true });
    boot(server.fetchMock);
    await tick();

    expect(
      server.events.filter((e) => e.phase === 'request' && /\/history/.test(e.url)),
      'a transcript was fetched while the chat list was still in flight',
    ).toEqual([]);
    expect(railRows(), 'a chat row was painted before the list resolved').toHaveLength(0);
    expect(
      window.localStorage.getItem('james-bot-active-chat'),
      'the active chat was re-decided before the list could contradict it',
    ).toBe(CHAT_A); // unchanged — not rewritten by a boot-time decision

    // The member is never blocked by the wait: this is the half of the rule
    // that must NOT be traded away to get the other half.
    const input = document.querySelector<HTMLInputElement>('#james-bot .jb-input');
    expect(input, 'the composer never rendered').not.toBeNull();
    expect(input!.disabled, 'a stalled chat list disabled the composer').toBe(false);
  });

  it('CONTROL: the same setup DOES paint and fetch once the list resolves', async () => {
    // Without this, the stall case above passes against a widget that never
    // does anything at all.
    window.localStorage.setItem('james-bot-active-chat', CHAT_A);
    const server = recordingServer();
    boot(server.fetchMock);
    await tick();

    expect(
      server.events.filter((e) => e.phase === 'request' && /\/history/.test(e.url)).length,
      'the control never fetched a transcript, so the stall case proves nothing',
    ).toBeGreaterThan(0);
    expect(railRows().length, 'the control never painted a chat row').toBeGreaterThan(0);
    expect(
      document.querySelector('#james-bot')!.textContent,
      'the control never repainted the remembered conversation',
    ).toContain('remembered conversation');
  });
});
