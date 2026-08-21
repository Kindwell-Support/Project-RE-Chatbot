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
      // R6: a PURE READ. This fake used to auto-create on an empty list,
      // modelling a server behaviour that has been deleted — and which,
      // per BUG-020, could never have worked: the server cannot see
      // localStorage, so it could not know a legacy session was about to be
      // adopted. A fake that resolves an ordering the live server does not
      // guarantee is a dead guard, and this one hid the race.
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

  return { fetchMock, chats, history, calls };
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

  it('deleting the LAST chat leaves a PLACEHOLDER, not a row (R6/R6b)', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Only chat' }] });
    boot(server.fetchMock);
    await tick();

    const row = railRows()[0];
    row.querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(
      server.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/chats')),
      'a replacement row was written for a chat nobody has spoken in',
    ).toHaveLength(0);
    expect(server.chats, 'the server holds a row it should not').toHaveLength(0);
    expect(railRows(), 'the sidebar was left empty').toHaveLength(1);
    expect(railLabels(), 'the placeholder is not labelled as a new chat').toEqual(['New chat']);
    expect(bubbles(), 'the placeholder did not open on the welcome state').toHaveLength(1);
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

describe('T7 (REWRITTEN): legacy adoption is a placeholder, decided AFTER the list', () => {
  it('legacy key + empty list -> ONE sidebar row, ZERO db rows, no /history before /chats', async () => {
    // The old version asserted a rule no real server could honour (BUG-020):
    // adoption lived in the widget, auto-create lived in GET /chats, and the
    // server cannot see localStorage. It passed only because a fake could
    // satisfy an ordering the live server could not.
    const server = makeServer({
      chats: [],
      history: { [LEGACY]: [{ role: 'user', content: 'my old conversation' }] },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();

    // ORDERING: the list comes first. Nothing asks for a legacy transcript
    // before the empty-list decision has been taken.
    const firstChatsIndex = server.calls.findIndex((c) => c.url.endsWith('/chats'));
    const firstHistoryIndex = server.calls.findIndex((c) => c.url.includes('/history'));
    expect(firstChatsIndex, 'the chat list was never requested').toBeGreaterThanOrEqual(0);
    expect(firstHistoryIndex, 'the legacy transcript was never requested').toBeGreaterThanOrEqual(0);
    expect(
      firstHistoryIndex > firstChatsIndex,
      '/history was issued before /chats resolved — the BUG-020 race',
    ).toBe(true);

    expect(railRows(), 'the rail does not hold exactly one chat').toHaveLength(1);
    expect(server.chats, 'adoption wrote a database row').toHaveLength(0);
    expect(
      server.calls.filter((c) => c.method === 'POST'),
      'adoption issued a write',
    ).toHaveLength(0);
    expect(
      document.querySelector('#james-bot')!.textContent,
      'the adopted transcript was not shown',
    ).toContain('my old conversation');
  });

  it('a NON-EMPTY list means adoption does not apply at all', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Existing chat' }],
      history: {
        [LEGACY]: [{ role: 'user', content: 'legacy words' }],
        [CHAT_A]: [{ role: 'user', content: 'existing words' }],
      },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();

    expect(railLabels(), 'a legacy placeholder was added beside real chats').toEqual([
      'Existing chat',
    ]);
    const text = document.querySelector('#james-bot').textContent ?? '';
    expect(text, 'the legacy transcript was adopted anyway').not.toContain('legacy words');
    expect(text, 'the own chat was not opened').toContain('existing words');
    expect(
      server.calls.some((c) => c.url.includes('/history') && c.url.includes(LEGACY)),
      'the legacy session was probed despite the device having chats',
    ).toBe(false);
  });

  it('B4: a planted session id with NO messages is discarded, not adopted', async () => {
    // Planting a UUID in localStorage must not conjure a chat. Only a session
    // that actually holds a conversation is adoptable.
    const server = makeServer({ chats: [], history: {} });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();

    expect(railRows(), 'the rail should still hold one placeholder').toHaveLength(1);
    expect(server.chats, 'an empty planted session created a row').toHaveLength(0);
    expect(
      window.localStorage.getItem('james-bot-legacy-adopted'),
      'the empty legacy key was not discarded, so it will be probed forever',
    ).toBe('1');

    // The placeholder must NOT be the planted id — it is a fresh chat.
    await send('hello');
    const posted = server.calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST');
    expect(posted[0].body.session_id, 'the planted id was adopted anyway').not.toBe(LEGACY);
  });

  it('an unsent adoption is still adoptable on the next boot', async () => {
    // The flag is deliberately NOT set on a successful adoption: if the member
    // never sends, their history must still be reachable next time.
    const server = makeServer({
      chats: [],
      history: { [LEGACY]: [{ role: 'user', content: 'my old conversation' }] },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();
    expect(document.querySelector('#james-bot').textContent).toContain('my old conversation');

    document.body.innerHTML = '';
    boot(server.fetchMock);
    await tick();
    expect(
      document.querySelector('#james-bot')!.textContent,
      'a legacy session that was never sent into became unreachable',
    ).toContain('my old conversation');
    expect(server.chats, 'a row was written without a message being sent').toHaveLength(0);
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
  it('lands in exactly one chat — not zero, not two — and writes nothing', async () => {
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();

    expect(railRows(), 'the rail shows the wrong number of chats').toHaveLength(1);
    expect(server.chats, 'a cold boot wrote a row before any message (R6)').toHaveLength(0);
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

describe('R6/R6a: placeholders are ephemeral and write nothing', () => {
  it('five "+ New chat" clicks give five rows and ZERO writes; a reload collapses them', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Real chat' }] });
    boot(server.fetchMock);
    await tick();

    const newChat = () =>
      document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    for (let i = 0; i < 5; i++) {
      newChat();
      await tick(1);
    }

    expect(
      server.calls.filter((c) => c.method !== 'GET'),
      'clicking New chat wrote to the server',
    ).toHaveLength(0);
    expect(server.chats, 'placeholder rows reached the database').toHaveLength(1);
    // Only ONE placeholder is live at a time: each click replaces the last,
    // because an unsent chat is not worth a row OR a rail entry of its own.
    expect(railLabels(), 'placeholders accumulated in the rail').toEqual(['New chat', 'Real chat']);

    // Reload: nothing about the placeholder survived.
    document.body.innerHTML = '';
    boot(server.fetchMock);
    await tick();
    expect(server.chats, 'a reload created rows for placeholders').toHaveLength(1);
    expect(railLabels(), 'a placeholder survived a reload').toEqual(['Real chat']);
  });

  it('switching AWAY from an unsent placeholder discards it (FINDING-019)', async () => {
    // The invariant lives in resetChatState, not in the call sites. Without a
    // case that leaves a placeholder without materialising it, moving that
    // line is unobservable — the dead-guard sweep caught exactly that.
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Real chat' }] });
    boot(server.fetchMock);
    await tick();

    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick(1);
    expect(railLabels(), 'no placeholder to discard').toEqual(['New chat', 'Real chat']);

    clickRowByLabel('Real chat');
    await tick();

    expect(railLabels(), 'the abandoned placeholder survived the switch').toEqual(['Real chat']);
    expect(activeRow()?.textContent, 'the switch did not land on the real chat').toContain(
      'Real chat',
    );
  });

  it('a placeholder becomes a real, persisted chat the moment its first turn lands', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Real chat' }] });
    boot(server.fetchMock);
    await tick();
    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick(1);
    expect(window.localStorage.getItem('james-bot-active-chat'), 'a placeholder was persisted').toBe(
      CHAT_A,
    );

    await send('first words');
    const posted = server.calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST');
    const newId = posted[posted.length - 1].body.session_id;
    expect(newId, 'the placeholder reused the existing chat id').not.toBe(CHAT_A);
    expect(
      window.localStorage.getItem('james-bot-active-chat'),
      'a materialised chat was not remembered for the next reload',
    ).toBe(newId);
    expect(railLabels(), 'the materialised chat left the rail').toEqual(['New chat', 'Real chat']);
  });

  it('a send into a chat deleted elsewhere fails QUIETLY, with no error bubble', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }] });
    const gone = vi.fn(async (url: string, init?: any) => {
      if (String(url).endsWith('/chat') && (init?.method ?? 'GET') === 'POST') {
        return { ok: false, status: 404, json: async () => ({ error: 'gone' }) };
      }
      return server.fetchMock(url, init);
    });
    boot(gone);
    await tick();

    await send('into a deleted chat');

    expect(
      document.querySelector('#james-bot .jb-retry'),
      'a 404 put a retry/error bubble in the member face',
    ).toBeNull();
    expect(
      document.querySelector('#james-bot')!.textContent,
      'a connection error was shown for a deleted chat',
    ).not.toContain('Connection hiccup');
    expect(
      document.querySelector('#james-bot .jb-think-label'),
      'the thinking indicator was left spinning',
    ).toBeNull();
    expect(chatInput().disabled, 'the composer was left locked').toBe(false);
  });
});
