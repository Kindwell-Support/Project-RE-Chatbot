/**
 * Phase 1 multi-chat — the widget.
 *
 * T1 (state isolation across a switch), T5 (delete fallback), T6 (reload lands
 * back), T7 (legacy adoption) and T8 (cold start) live here.
 *
 * T9, the dead-guard sweep, is structural rather than a case of its own: there
 * is not one `if (...) expect(...)` in this file. Every assertion runs
 * unconditionally, and the isolation cases assert their PRECONDITION first
 * (the state really was there in chat A) before asserting its absence in chat
 * B — a test that only checked for absence would pass just as happily against
 * a widget that never rendered anything at all.
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
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEGACY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Msg {
  role: string;
  content: string;
}

/** A stand-in for the /chats + /history + /chat surface, in memory. */
function makeServer(seed: {
  chats?: Array<{ id: string; title: string | null }>;
  history?: Record<string, Msg[]>;
  reply?: any;
}) {
  const chats = (seed.chats ?? []).map((c) => ({ ...c }));
  const history: Record<string, Msg[]> = seed.history ?? {};
  const calls: Array<{ method: string; url: string; body: any }> = [];
  let autoCreated = 0;

  const json = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  const fetchMock = vi.fn(async (url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: String(url), body });
    const u = String(url);

    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      return json(200, { messages: history[id] ?? [] });
    }
    if (u.endsWith('/chats') && method === 'GET') {
      if (!chats.length) {
        autoCreated += 1;
        chats.push({ id: 'auto-0000-4000-8000-00000000000' + autoCreated, title: null });
      }
      return json(200, chats.map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' })));
    }
    if (u.endsWith('/chats') && method === 'POST') {
      const id = body?.id ?? 'new0-0000-4000-8000-000000000001';
      if (chats.some((c) => c.id === id)) return json(409, { error: 'exists' });
      const row = { id, title: null };
      chats.unshift(row);
      return json(201, { ...row, created_at: 'x', last_message_at: 'x' });
    }
    if (u.includes('/chats/') && method === 'PATCH') {
      const id = u.split('/chats/')[1];
      const row = chats.find((c) => c.id === id);
      if (!row) return json(404, { error: 'nope' });
      row.title = body.title;
      return json(200, { ...row, created_at: 'x', last_message_at: 'x' });
    }
    if (u.includes('/chats/') && method === 'DELETE') {
      const id = u.split('/chats/')[1];
      const index = chats.findIndex((c) => c.id === id);
      if (index === -1) return json(404, { error: 'nope' });
      chats.splice(index, 1);
      return { ok: true, status: 204, json: async () => null };
    }
    if (u.endsWith('/chat') && method === 'POST') {
      const id = body.session_id;
      (history[id] ??= []).push({ role: 'user', content: body.message ?? '(form)' });
      const reply = seed.reply ?? { output: 'Answer for ' + id };
      (history[id] ??= []).push({ role: 'assistant', content: reply.output ?? '' });
      return json(200, reply);
    }
    return json(404, { error: 'unrouted ' + method + ' ' + u });
  });

  return { fetchMock, chats, history, calls, autoCreatedCount: () => autoCreated };
}

const tick = async (times = 6) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

function mountTarget(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  return div;
}

function boot(fetchMock: any) {
  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  mountTarget();
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const railRows = () => Array.from(document.querySelectorAll('#james-bot .jb-chat-row'));
const railLabels = () =>
  railRows().map((row) => row.querySelector('.jb-chat-open')?.textContent ?? '');
const activeRow = () => document.querySelector('#james-bot .jb-chat-active');
const bubbles = () => Array.from(document.querySelectorAll('#james-bot .jb-bubble'));
const chatInput = () => document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;

async function send(text: string) {
  chatInput().value = text;
  document
    .querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

function clickRowByLabel(label: string) {
  const row = railRows().find((r) => (r.querySelector('.jb-chat-open')?.textContent ?? '') === label);
  row!.querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('T1: switching chats is a full client-state reset', () => {
  it('a comps form with an ARV pre-fill in chat A does not survive into chat B', async () => {
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Chat A' },
        { id: CHAT_B, title: 'Chat B' },
      ],
      reply: {
        output: 'Here are the comps.',
        render_form: {
          calculator: 'flip',
          title: 'Flip',
          required: [
            {
              name: 'after_repair_value',
              label: 'ARV',
              type: 'number',
              required: true,
              unit: 'usd',
              prefill: { value: 402000, label: 'Pre-filled from your comps on 123 Main St' },
            },
          ],
          optional: [],
        },
      },
    });
    boot(server.fetchMock);
    await tick();

    await send('run comps on 123 Main St');

    // PRECONDITION — the state really is present in A. Without this, the
    // absence assertions below would pass against a widget that rendered
    // nothing at all.
    expect(document.querySelector('#james-bot .jb-calc'), 'no form rendered in A').not.toBeNull();
    expect(
      document.querySelector('#james-bot .jb-prefill-note')?.textContent,
      'no ARV pre-fill rendered in A',
    ).toContain('123 Main St');
    expect(
      (document.querySelector('#james-bot .jb-control') as HTMLInputElement).value,
      'the ARV value was not pre-filled in A',
    ).toBe('402000');
    expect(bubbles().length, 'chat A has no conversation').toBeGreaterThan(1);

    // Half-typed text that was never sent. This has to be typed AFTER the
    // send: submitMessage empties the composer itself, so asserting on a
    // post-send composer would pass against a reset that never touched it.
    // (Caught by the T9 sweep — the assertion below was vacuous without this.)
    chatInput().value = 'half-typed question';
    chatInput().dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(
      document.querySelector('#james-bot form')!.className,
      'the composer never armed, so the reset below proves nothing',
    ).toContain('jb-armed');

    clickRowByLabel('Chat B');
    await tick();

    // ...and none of it is in B.
    expect(document.querySelector('#james-bot .jb-calc'), 'the calculator form leaked into B').toBeNull();
    expect(
      document.querySelector('#james-bot .jb-prefill-note'),
      'the ARV pre-fill leaked into B',
    ).toBeNull();
    expect(
      document.querySelector('#james-bot .jb-control'),
      'a half-filled control leaked into B',
    ).toBeNull();
    expect(bubbles(), 'B opened with a transcript').toHaveLength(1); // the welcome only
    expect(bubbles()[0].textContent, 'B did not open on the welcome state').toContain("I'm James");
    expect(chatInput().value, 'the composer contents leaked into B').toBe('');
    expect(
      document.querySelector('#james-bot form')!.className,
      'the armed-send hint leaked into B',
    ).not.toContain('jb-armed');

    // The next message goes to B, not A.
    await send('a fresh question');
    const posted = server.calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST');
    expect(posted[posted.length - 1].body.session_id, 'the send went to the wrong chat').toBe(
      CHAT_B,
    );

    // And A is intact when we come back.
    clickRowByLabel('Chat A');
    await tick();
    const text = document.querySelector('#james-bot')!.textContent ?? '';
    expect(text, "chat A's question was lost").toContain('run comps on 123 Main St');
    expect(text, "chat A's answer was lost").toContain('Here are the comps.');
    expect(text, "chat B's message appeared in chat A").not.toContain('a fresh question');
  });

  it('an in-flight answer for chat A never paints into chat B', async () => {
    // The leak this exists to catch: a slow reply that resolves after the
    // member has already moved on.
    let release: (v: any) => void = () => {};
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Chat A' },
        { id: CHAT_B, title: 'Chat B' },
      ],
    });
    const slowFetch = vi.fn((url: string, init?: any) => {
      if (String(url).endsWith('/chat') && (init?.method ?? 'GET') === 'POST') {
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, json: async () => ({ output: 'LATE ANSWER FOR A' }) });
        });
      }
      return server.fetchMock(url, init);
    });
    boot(slowFetch);
    await tick();

    await send('slow question');
    expect(
      document.querySelector('#james-bot .jb-think-label'),
      'the thinking indicator never appeared, so nothing was in flight',
    ).not.toBeNull();

    clickRowByLabel('Chat B');
    await tick();
    release({});
    await tick();

    expect(
      document.querySelector('#james-bot')!.textContent,
      "chat A's late answer painted into chat B",
    ).not.toContain('LATE ANSWER FOR A');
    expect(
      document.querySelector('#james-bot .jb-think-label'),
      'the thinking indicator survived the switch',
    ).toBeNull();
    expect(
      chatInput().disabled,
      'the composer was left disabled by the abandoned request',
    ).toBe(false);
  });
});

describe('T5: deleting a chat', () => {
  it('falls back to the most recent remaining chat when the active one goes', async () => {
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Chat A' },
        { id: CHAT_B, title: 'Chat B' },
      ],
      history: { [CHAT_B]: [{ role: 'user', content: 'B history line' }] },
    });
    boot(server.fetchMock);
    await tick();
    expect(activeRow()?.textContent, 'chat A was not active to begin with').toContain('Chat A');

    const row = railRows().find((r) => (r.textContent ?? '').includes('Chat A'))!;
    row.querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(railLabels(), 'the deleted chat is still in the rail').toEqual(['Chat B']);
    expect(activeRow()?.textContent, 'the fallback chat is not active').toContain('Chat B');
    expect(
      document.querySelector('#james-bot')!.textContent,
      "the fallback chat's history was not repainted",
    ).toContain('B history line');
  });

  it('deleting the LAST chat auto-creates one, so the rail is never empty (R5)', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Only chat' }] });
    boot(server.fetchMock);
    await tick();

    const row = railRows()[0];
    row.querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    const created = server.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/chats'));
    expect(created, 'no replacement chat was created').toHaveLength(1);
    expect(railRows(), 'the sidebar was left empty').toHaveLength(1);
    expect(bubbles(), 'the replacement chat did not open on the welcome state').toHaveLength(1);
  });

  it('a cancelled confirm deletes nothing', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(server.calls.filter((c) => c.method === 'DELETE'), 'delete fired despite cancel').toHaveLength(0);
    expect(railLabels()).toEqual(['Chat A', 'Chat B']);
  });
});

describe('T6: a reload lands back in the chat you were in', () => {
  it('restores the stored active chat and its history, not the newest one', async () => {
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Chat A' },
        { id: CHAT_B, title: 'Chat B' },
      ],
      history: { [CHAT_B]: [{ role: 'user', content: 'mid-conversation in B' }] },
    });
    // The member was in B (which is NOT the first row) when the page reloaded.
    window.localStorage.setItem('james-bot-active-chat', CHAT_B);
    boot(server.fetchMock);
    await tick();

    expect(activeRow()?.textContent, 'the reload landed in the wrong chat').toContain('Chat B');
    expect(
      document.querySelector('#james-bot')!.textContent,
      'the stored chat history was not repainted',
    ).toContain('mid-conversation in B');
    const historyCalls = server.calls.filter((c) => c.url.includes('/history'));
    expect(
      historyCalls.every((c) => c.url.includes(CHAT_B)),
      'history was fetched for a chat the member was not in',
    ).toBe(true);
  });
});

describe('T7: legacy adoption (W1)', () => {
  it('claims the pre-multi-chat session as the first chat, and R5 does not also fire', async () => {
    const server = makeServer({
      chats: [],
      history: { [LEGACY]: [{ role: 'user', content: 'my old conversation' }] },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();

    const created = server.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/chats'));
    expect(created, 'the legacy session was not adopted').toHaveLength(1);
    expect(created[0].body.id, 'adoption used a fresh id instead of the legacy one').toBe(LEGACY);
    expect(server.chats, 'R5 auto-create fired as well, leaving a blank chat').toHaveLength(1);
    expect(server.chats[0].id).toBe(LEGACY);
    expect(server.autoCreatedCount(), 'the server auto-created a chat despite adoption').toBe(0);
    expect(
      document.querySelector('#james-bot')!.textContent,
      'the adopted history is not reachable',
    ).toContain('my old conversation');
  });

  it('runs ONCE: a second mount does not re-adopt', async () => {
    const server = makeServer({ chats: [] });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();
    expect(window.localStorage.getItem('james-bot-legacy-adopted')).toBe('1');

    document.body.innerHTML = '';
    boot(server.fetchMock);
    await tick();

    const created = server.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/chats'));
    expect(created, 'adoption ran a second time').toHaveLength(1);
  });

  it('never writes the legacy key again', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();
    await send('hello');
    expect(
      setItem.mock.calls.map((c) => String(c[0])).filter((k) => k === 'james-bot-session'),
      'the retired session key was written again',
    ).toEqual([]);
  });
});

describe('T8: cold start on a fresh device', () => {
  it('lands in exactly one chat — not zero, not two', async () => {
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();

    expect(server.chats, 'the server holds the wrong number of chats').toHaveLength(1);
    expect(railRows(), 'the rail shows the wrong number of chats').toHaveLength(1);
    expect(bubbles(), 'a fresh chat opened with history').toHaveLength(1);
    expect(chatInput().disabled, 'the member cannot type on a fresh device').toBe(false);
  });

  it('mints a device owner key and sends it on every /chats call', async () => {
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();
    const stored = window.localStorage.getItem('james-bot-device') ?? '';
    expect(stored, 'no device key was minted').toMatch(
      /^device:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const headers = server.fetchMock.mock.calls
      .filter((c: any[]) => String(c[0]).includes('/chats'))
      .map((c: any[]) => c[1]?.headers?.['x-james-owner']);
    expect(headers.length, 'no /chats call was made').toBeGreaterThan(0);
    expect(
      headers.every((h: string) => h === stored),
      'a /chats call went out without the owner key',
    ).toBe(true);
  });

  it('a dead chats API still leaves a usable chat (the deploy-before-migration window)', async () => {
    const dead = vi.fn(async (url: string) => {
      if (String(url).includes('/chats')) return { ok: false, status: 503, json: async () => ({}) };
      if (String(url).includes('/history')) return { ok: true, status: 200, json: async () => ({ messages: [] }) };
      return { ok: true, status: 200, json: async () => ({ output: 'still working' }) };
    });
    boot(dead);
    await tick();

    expect(chatInput().disabled, 'a dead chat list disabled the composer').toBe(false);
    await send('does this work');
    expect(document.querySelector('#james-bot')!.textContent).toContain('still working');
  });
});

describe('W2/W3: new chat is lazy, the rail is a rail', () => {
  it('"New chat" creates NO row until the first message is sent', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();

    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();

    expect(
      server.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/chats')),
      'clicking New chat hit the server',
    ).toHaveLength(0);
    expect(bubbles(), 'the pane was not cleared to the welcome state').toHaveLength(1);
    expect(railLabels()[0], 'the pending chat is not shown at the top of the rail').toBe('New chat');

    await send('first message in the new chat');
    const posted = server.calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST');
    expect(posted, 'the message was not sent').toHaveLength(1);
    expect(posted[0].body.session_id, 'the new chat reused the old session id').not.toBe(CHAT_A);
    expect(posted[0].body.session_id, 'no session id was minted').toBeTruthy();
  });

  it('renames a chat inline and persists it', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Rename chat"]')!.click();
    await tick(1);
    const field = document.querySelector<HTMLInputElement>('#james-bot .jb-chat-rename-input')!;
    field.value = 'Duplex on 5th';
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();

    const patched = server.calls.filter((c) => c.method === 'PATCH');
    expect(patched, 'no rename request was sent').toHaveLength(1);
    expect(patched[0].body.title).toBe('Duplex on 5th');
    expect(railLabels(), 'the rail did not show the new name').toEqual(['Duplex on 5th']);
  });

  it('the collapsed rail is remembered across mounts', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();
    document.querySelector<HTMLButtonElement>('#james-bot .jb-side-toggle')!.click();
    expect(window.localStorage.getItem('james-bot-sidebar-collapsed')).toBe('1');

    document.body.innerHTML = '';
    boot(server.fetchMock);
    await tick();
    expect(
      document.querySelector('#james-bot .jb-side')!.className,
      'the rail reopened despite being collapsed before',
    ).toContain('jb-side-collapsed');
  });
});
