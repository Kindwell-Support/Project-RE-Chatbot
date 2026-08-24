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
/**
 * RE-POINTED (Phase 2 S3.1): rows now carry a relative timestamp INSIDE the
 * open button, so .jb-chat-open's textContent is "title + time" once a chat
 * has real activity. These helpers are ABOUT the title, so they read the
 * .jb-chat-title element — the subject did not change, its address did.
 */
const railLabels = () =>
  railRows().map((row) => row.querySelector('.jb-chat-title')?.textContent ?? '');
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

/**
 * Delete is TWO deliberate steps now (S2.2), because this control sits beside
 * the one you tap to switch chats and on touch both are permanently visible.
 * Step one only opens the question; step two is the destructive act.
 */
function rowById(id: string | null): Element {
  const found = document.querySelector(`#james-bot .jb-chat-row[data-chat-id="${id}"]`);
  if (!found) throw new Error(`no rail row for chat ${id}`);
  return found;
}

function clickDelete(row: Element) {
  const id = row.getAttribute('data-chat-id');
  row.querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
  // Step one re-renders the whole rail, so the node above is now detached and
  // the confirmation lives on its replacement. Re-query by chat id rather than
  // reusing the stale reference.
  const confirm = rowById(id).querySelector<HTMLButtonElement>(
    '[aria-label="Confirm delete chat"]',
  );
  if (!confirm) throw new Error('no confirm step appeared - delete is one tap from destructive');
  confirm.click();
}

function clickRowByLabel(label: string) {
  const row = railRows().find((r) => (r.querySelector('.jb-chat-title')?.textContent ?? '') === label);
  row!.querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
}

/**
 * RE-POINTED (Phase 2 S2.2). This used to stub window.confirm to `true` so the
 * delete path would run. The widget no longer calls it: a native dialog inside
 * a GHL SPA embed is fragile and reads as the page breaking rather than as the
 * widget asking, and mobile browsers may suppress it entirely, which would make
 * delete a silently dead control.
 *
 * The stub is KEPT and inverted into a tripwire. Deleting it would leave
 * nothing asserting that the native dialog stays gone, and a regression to
 * window.confirm would then pass every case in this file — jsdom's own confirm
 * returns undefined, and the old code treated anything but an explicit false as
 * consent, so the deletes would still go through and look correct.
 */
let confirmSpy: ReturnType<typeof vi.fn>;

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
  confirmSpy = vi.fn(() => true);
  vi.stubGlobal('confirm', confirmSpy);
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
    clickDelete(row);
    await tick();

    expect(confirmSpy, 'a native dialog is back').not.toHaveBeenCalled();
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
    clickDelete(row);
    await tick();

    expect(confirmSpy, 'a native dialog is back').not.toHaveBeenCalled();
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
    // RE-POINTED (S2.2): the cancel is now the widget's own Cancel button
    // rather than window.confirm returning false. Same intent, same subject —
    // that a declined confirmation issues no DELETE and leaves the rail whole.
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }] });
    boot(server.fetchMock);
    await tick();

    const id = railRows()[0].getAttribute('data-chat-id');
    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    rowById(id).querySelector<HTMLButtonElement>('[aria-label="Cancel delete chat"]')!.click();
    await tick();

    expect(server.calls.filter((c) => c.method === 'DELETE'), 'delete fired despite cancel').toHaveLength(0);
    expect(railLabels()).toEqual(['Chat A', 'Chat B']);
    expect(confirmSpy, 'a native dialog is back').not.toHaveBeenCalled();
  });

  it('STEP ONE ALONE DELETES NOTHING - the defect the two-step exists to stop', async () => {
    // The re-points above would all pass against a widget that deleted on the
    // FIRST tap and merely happened to render a confirm afterwards. This is
    // the case that distinguishes them: after step one and nothing else, the
    // chat must still be there and no DELETE may have been issued.
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(
      server.calls.filter((c) => c.method === 'DELETE'),
      'one tap archived a conversation',
    ).toHaveLength(0);
    expect(server.chats, 'the row was archived on the first tap').toHaveLength(2);
    // Precondition: step one really did happen, so the absence above is not
    // the silence of a button that does nothing at all.
    expect(
      railRows()[0].querySelector('[aria-label="Confirm delete chat"]'),
      'step one did not open the confirmation',
    ).not.toBeNull();
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

describe('W1 legacy adoption is GONE — the widget never reads a session id', () => {
  // C-2. The guarantee is now STRUCTURAL: with no code path reading
  // 'james-bot-session', planting a UUID in localStorage cannot surface a
  // chat. Structural guarantees are invisible, and invisible guarantees get
  // re-added by the next person who thinks they are being helpful. This case
  // is the only thing that will tell them it was a decision.
  it('NEVER READS james-bot-session, even when one is sitting there', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const server = makeServer({
      chats: [],
      history: { [LEGACY]: [{ role: 'user', content: 'a planted transcript' }] },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    getItem.mockClear();
    setItem.mockClear();

    boot(server.fetchMock);
    await tick();

    expect(
      getItem.mock.calls.map((c) => String(c[0])).filter((k) => k === 'james-bot-session'),
      'the retired session key was READ — adoption is creeping back',
    ).toEqual([]);
    expect(
      setItem.mock.calls.map((c) => String(c[0])).filter((k) => k === 'james-bot-session'),
      'the retired session key was written',
    ).toEqual([]);

    // VACUITY GUARD: storage really was in use this run, so the absences above
    // are not passing against a widget that never touched storage. RE-POINTED
    // (Phase 3 S4): the guard was keyed to the james-bot-device WRITE, which
    // died with the client-asserted owner — the widget's boot now READS its
    // keys (token, collapse, active-chat), so presence-of-reads is the guard.
    expect(
      getItem.mock.calls.map((c) => String(c[0])),
      'nothing was read at all, so the assertions above prove nothing',
    ).toContain('james-bot-token');

    // ...and the planted transcript never reaches the member.
    expect(
      document.querySelector('#james-bot')!.textContent,
      'a planted session id surfaced its transcript',
    ).not.toContain('a planted transcript');
    expect(
      server.calls.some((c) => c.url.includes('/history') && c.url.includes(LEGACY)),
      'the widget fetched a transcript for a session it found in storage',
    ).toBe(false);
  });

  it('C-3: ERASES the retired key on first load', async () => {
    // A live-looking key we have decided never to honour is how the next
    // reader builds a wrong model. Deleting it states the decision.
    const server = makeServer({ chats: [] });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();

    expect(
      window.localStorage.getItem('james-bot-session'),
      'the retired key survived the mount',
    ).toBeNull();
  });

  it('a planted session id gets a FRESH chat, not the planted one', async () => {
    const server = makeServer({
      chats: [],
      history: { [LEGACY]: [{ role: 'user', content: 'a planted transcript' }] },
    });
    window.localStorage.setItem('james-bot-session', LEGACY);
    boot(server.fetchMock);
    await tick();
    await send('hello');

    const posted = server.calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST');
    expect(posted.length, 'the message was never sent').toBe(1);
    expect(posted[0].body.session_id, 'the planted id was adopted').not.toBe(LEGACY);
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

  it('ASSERTS NO OWNER: the token rides every /chats call and x-james-owner is gone', async () => {
    // RE-POINTED (Phase 3 S4) — a full inversion BY RULING, and the strongest
    // one in the file: this test used to pin that the widget minted a device
    // key and sent it on every call. The client now stops asserting an owner
    // ENTIRELY: identity is the verified session token, x-james-owner never
    // leaves the widget, and the retired device key is ERASED on mount like
    // james-bot-session before it. What survives from the original intent:
    // every /chats call still carries the member's credential — it is just no
    // longer one the client invented.
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();

    expect(
      window.localStorage.getItem('james-bot-device'),
      'a device key was minted — the client is asserting an owner again',
    ).toBeNull();

    const calls = server.fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/chats'));
    expect(calls.length, 'no /chats call was made').toBeGreaterThan(0);
    for (const c of calls) {
      expect(c[1]?.headers?.['x-james-owner'], 'x-james-owner escaped the widget').toBeUndefined();
      expect(c[1]?.headers?.authorization, 'a /chats call went out without the token').toBe(
        'Bearer jsdom-suite-token',
      );
    }
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
