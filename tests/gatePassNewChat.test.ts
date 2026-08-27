/**
 * NEW CHAT ON A FRESH GATE PASS — not resume-last.
 *
 * The distinction this slice needed did not exist in the widget:
 * startAuthedSession() is reached identically from an accepted email
 * submission and from the cached-token path on mount, so no amount of reading
 * gate state could tell "challenged and accepted now" from "already accepted,
 * passing through". FRESH_KEY ('james-bot-fresh-gate') is that flag.
 *
 * IT LIVES IN sessionStorage, and that is load-bearing rather than
 * incidental: "submit, send nothing, lesson swap -> same empty chat" is a
 * REMOUNT, and a closure variable is gone by then. sessionStorage shares the
 * token's exact store and lifetime — it survives an SPA lesson swap in the
 * tab and dies with the tab, which is the same boundary the gate uses.
 *
 * It is spent in persistActive(), the one choke point where a REAL chat
 * becomes active — by sending the first message (materialisePlaceholder) or
 * by opening a row from the rail (switchToChat).
 *
 * DEAD GUARDS: every assertion that could pass over an empty collection is
 * preceded by a positive precondition. A sidebar assertion that runs against
 * zero rendered rows proves nothing, and this file is full of row counts.
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
const CHAT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

type Row = { id: string; title: string | null };

interface Opts {
  /** chats per TOKEN, so a different email genuinely sees a different list. */
  chatsByToken?: Record<string, Row[]>;
  history?: Record<string, Array<{ role: string; content: string }>>;
  /** email -> token, so submitting a different email mints a different one. */
  tokenFor?: Record<string, string>;
  authStatus?: number;
  authBody?: unknown;
  /** Per TOKEN: that token's sends succeed N times, then 401 'expired'.
   *  Token-scoped on purpose — A's token dying must not also kill B's. */
  expireTokenAfter?: Record<string, number>;
}

function makeServer(opts: Opts = {}) {
  const sendsByToken: Record<string, number> = {};
  const calls: Array<{ method: string; url: string; headers: any; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    const headers = init?.headers ?? {};
    calls.push({ method, url: u, headers, body: init?.body ? JSON.parse(init.body) : null });

    if (u.endsWith('/auth')) {
      if (opts.authStatus && opts.authStatus !== 200) {
        return json(opts.authStatus, opts.authBody ?? { error: 'x', reason: 'denied' });
      }
      const email = init?.body ? JSON.parse(init.body).email : '';
      const token = opts.tokenFor?.[email] ?? 'token-' + email;
      return json(200, { token, email });
    }
    const bearer = String(headers.Authorization ?? headers.authorization ?? '').replace('Bearer ', '');
    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      return json(200, { messages: opts.history?.[id] ?? [] });
    }
    if (u.endsWith('/chats') && method === 'GET') {
      const rows = opts.chatsByToken?.[bearer] ?? [];
      return json(200, rows.map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' })));
    }
    if (u.endsWith('/chat') && method === 'POST') {
      sendsByToken[bearer] = (sendsByToken[bearer] ?? 0) + 1;
      const limit = opts.expireTokenAfter?.[bearer];
      if (limit !== undefined && sendsByToken[bearer] > limit) {
        return json(401, { error: 'Not authorized.', reason: 'expired' });
      }
      return json(200, { output: 'an answer' });
    }
    return json(404, {});
  });
  return {
    fetchMock,
    calls,
    setChats: (token: string, r: Row[]) => {
      opts.chatsByToken = { ...(opts.chatsByToken ?? {}), [token]: r };
    },
    setHistory: (id: string, m: Array<{ role: string; content: string }>) => {
      opts.history = { ...(opts.history ?? {}), [id]: m };
    },
    chatsCalls: () => calls.filter((c) => c.url.endsWith('/chats') && c.method === 'GET'),
    postedChat: () => calls.filter((c) => c.url.endsWith('/chat') && c.method === 'POST'),
  };
}

const tick = async (times = 8) => {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/** Mount into a clean DOM. Storage is NOT touched — that is what makes the
 *  second call a remount rather than a fresh browser. */
function mount(fetchMock: any) {
  vi.stubGlobal('fetch', fetchMock);
  document.body.innerHTML = '';
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

/** A GHL lesson-to-lesson swap: the widget is torn down and re-created in the
 *  same tab, so sessionStorage (token AND the fresh flag) survives. */
const lessonSwap = async (fetchMock: any) => {
  mount(fetchMock);
  await tick();
};

const rows = () => Array.from(document.querySelectorAll('#james-bot .jb-chat-row'));
/** The ephemeral placeholder row: no server row exists behind it. */
const pending = () => Array.from(document.querySelectorAll('#james-bot .jb-chat-pending'));
const titles = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-chat-title')).map((n) => n.textContent ?? '');
const bubbles = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-bubble')).map((b) => b.textContent ?? '');
const gate = () => document.querySelector('#james-bot .jb-gate');
const gateTitle = () =>
  document.querySelector('#james-bot .jb-gate-title')?.textContent ?? '';
const chatInput = () => document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;

async function enterEmail(email: string) {
  const input = document.querySelector<HTMLInputElement>('#james-bot .jb-gate-input')!;
  const btn = document.querySelector<HTMLButtonElement>('#james-bot .jb-gate-btn')!;
  input.value = email;
  btn.click();
  await tick();
}

async function send(text: string) {
  chatInput().value = text;
  document
    .querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

const FRESH_KEY = 'james-bot-fresh-gate';
const ACTIVE_KEY = 'james-bot-active-chat';

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('fresh gate pass — lands on a new chat', () => {
  it('submitting an email with prior chats lands EMPTY, sidebar populated, no new row', async () => {
    const server = makeServer({
      chatsByToken: { 'token-m@x.com': [{ id: CHAT_A, title: 'Tacoma duplex' }, { id: CHAT_B, title: 'Hilltop BRRRR' }] },
      history: { [CHAT_A]: [{ role: 'user', content: 'old message' }] },
    });
    mount(server.fetchMock);
    await tick();
    await enterEmail('m@x.com');

    // DEAD GUARD: the sidebar must actually have rendered, or "no new row"
    // and "prior chats listed" are both statements about nothing.
    expect(rows().length, 'the rail rendered no rows at all').toBeGreaterThan(0);
    // The new chat shows as the EPHEMERAL pending row the + New chat button
    // has always produced — italic, titled "New chat", no server row behind
    // it. The guarantee is that nothing is PERSISTED, asserted below.
    expect(pending().length, 'no pending row — the gate did not start a new chat').toBe(1);
    expect(titles()).toEqual(['New chat', 'Tacoma duplex', 'Hilltop BRRRR']);
    expect(window.localStorage.getItem(ACTIVE_KEY), 'the empty chat was persisted').toBeNull();
    // Nothing auto-loaded: the old chat's history is not on screen.
    expect(bubbles().join(' '), 'a prior conversation was restored').not.toContain('old message');
    expect(bubbles().some((t) => t.includes("I'm James")), 'no welcome — the chat did not boot').toBe(true);
    expect(server.calls.some((c) => c.url.includes('/history')), 'history was fetched for a chat nobody opened').toBe(false);
  });

  it('sending the first message creates EXACTLY ONE row, without a /chats poll', async () => {
    const server = makeServer({
      chatsByToken: { 'token-m@x.com': [{ id: CHAT_A, title: 'Tacoma duplex' }] },
    });
    mount(server.fetchMock);
    await tick();
    await enterEmail('m@x.com');
    expect(pending().length, 'precondition: the gate started a pending chat').toBe(1);
    expect(rows().length, 'precondition: pending row + one prior').toBe(2);
    const chatsCallsBefore = server.chatsCalls().length;

    await send('hello');

    // The placeholder MATERIALISES: same row, now real. One new chat, not two.
    expect(pending().length, 'the row stayed ephemeral after a message').toBe(0);
    expect(rows().length, 'the new chat did not take exactly one row').toBe(2);
    expect(window.localStorage.getItem(ACTIVE_KEY), 'the materialised chat was not persisted').toBeTruthy();
    expect(server.postedChat().length, 'the message was not posted').toBe(1);
    // The row is unshifted locally by materialisePlaceholder — no extra list
    // fetch is required for it to appear.
    expect(server.chatsCalls().length, 'a /chats poll was needed to show the row').toBe(chatsCallsBefore);
  });

  it('pass the gate, send NOTHING, swap lesson: still an empty chat, no duplicate', async () => {
    const server = makeServer({
      chatsByToken: { 'token-m@x.com': [{ id: CHAT_A, title: 'Tacoma duplex' }] },
      history: { [CHAT_A]: [{ role: 'user', content: 'old message' }] },
    });
    mount(server.fetchMock);
    await tick();
    await enterEmail('m@x.com');
    expect(rows().length, 'precondition: pending row + the prior chat').toBe(2);

    await lessonSwap(server.fetchMock);

    expect(gate(), 'the gate re-challenged on a cached pass').toBeNull();
    expect(pending().length, 'the swap left the member off an empty chat').toBe(1);
    expect(rows().length, 'the swap duplicated a row').toBe(2);
    expect(bubbles().join(' '), 'the swap restored the old conversation').not.toContain('old message');
    expect(window.sessionStorage.getItem(FRESH_KEY), 'the flag was spent with nothing sent').toBe('1');
  });

  it('send a message, THEN swap lesson: the active chat is restored intact', async () => {
    const server = makeServer({ chatsByToken: { 'token-m@x.com': [] } });
    mount(server.fetchMock);
    await tick();
    await enterEmail('m@x.com');
    await send('my question');
    expect(pending().length, 'precondition: the message materialised the chat').toBe(0);
    expect(rows().length, 'precondition: the sent message made a row').toBe(1);
    const id = window.localStorage.getItem(ACTIVE_KEY);
    expect(id, 'precondition: the active pointer was written').toBeTruthy();

    // The server now knows that chat, and it carries the exchange.
    const server2 = makeServer({
      chatsByToken: { 'token-m@x.com': [{ id: id!, title: 'My question' }] },
      history: { [id!]: [{ role: 'user', content: 'my question' }, { role: 'assistant', content: 'an answer' }] },
    });
    await lessonSwap(server2.fetchMock);

    expect(window.sessionStorage.getItem(FRESH_KEY), 'the flag outlived the first message').toBeNull();
    expect(rows().length, 'the restored rail lost the chat').toBe(1);
    const text = bubbles().join(' ');
    expect(text, 'the restored chat lost the exchange').toContain('my question');
    expect(text).toContain('an answer');
  });

  it('reload mid-conversation on a cached pass restores, and does not reset', async () => {
    // A reload IS a fresh mount with sessionStorage intact — the token is
    // there, the fresh flag is not, because a message was sent.
    window.sessionStorage.setItem('james-bot-token', 'token-m@x.com');
    window.localStorage.setItem(ACTIVE_KEY, CHAT_B);
    const server = makeServer({
      chatsByToken: { 'token-m@x.com': [{ id: CHAT_A, title: 'Older' }, { id: CHAT_B, title: 'The one I was in' }] },
      history: { [CHAT_B]: [{ role: 'user', content: 'mid conversation' }] },
    });
    mount(server.fetchMock);
    await tick();

    expect(gate(), 'a cached token still showed the gate').toBeNull();
    expect(rows().length, 'precondition: both chats listed').toBe(2);
    expect(bubbles().join(' '), 'the remembered chat was not restored').toContain('mid conversation');
  });

  it('a DIFFERENT email re-scopes the rail: zero rows from the previous owner', async () => {
    const server = makeServer({
      tokenFor: { 'a@x.com': 'token-A', 'b@x.com': 'token-B' },
      chatsByToken: {
        'token-A': [{ id: CHAT_A, title: 'A private one' }, { id: CHAT_B, title: 'A second' }],
        'token-B': [{ id: CHAT_C, title: 'B only' }],
      },
      history: { [CHAT_A]: [{ role: 'user', content: 'member A secret' }] },
    });
    mount(server.fetchMock);
    await tick();
    await enterEmail('a@x.com');
    expect(titles(), 'precondition: member A saw their own list').toEqual([
      'New chat', 'A private one', 'A second',
    ]);

    // Member B now uses the same browser. localStorage still points at A's chat.
    window.localStorage.setItem(ACTIVE_KEY, CHAT_A);
    document.body.innerHTML = '';
    window.sessionStorage.clear(); // B is challenged: a new tab / expired token
    mount(server.fetchMock);
    await tick();
    await enterEmail('b@x.com');

    expect(rows().length, 'the rail rendered nothing for member B').toBeGreaterThan(0);
    expect(titles(), "member B saw member A's chats").toEqual(['New chat', 'B only']);
    expect(bubbles().join(' '), "member A's transcript leaked to member B").not.toContain('member A secret');
  });

  it('a denied gate writes NO chat state at all', async () => {
    const server = makeServer({ authStatus: 403, authBody: { error: 'x', reason: 'denied' } });
    mount(server.fetchMock);
    await tick();
    await enterEmail('nope@x.com');

    expect(gate(), 'the gate let a denied member through').not.toBeNull();
    expect(window.sessionStorage.getItem(FRESH_KEY), 'a denial set the fresh flag').toBeNull();
    expect(window.sessionStorage.getItem('james-bot-token'), 'a denial stored a token').toBeNull();
    expect(window.localStorage.getItem(ACTIVE_KEY), 'a denial wrote an active chat').toBeNull();
    expect(rows().length, 'a denial rendered a sidebar').toBe(0);
    expect(server.chatsCalls().length, 'a denial fetched the chat list').toBe(0);
  });

  it('zero prior chats: the empty state renders clean', async () => {
    const server = makeServer({ chatsByToken: { 'token-new@x.com': [] } });
    mount(server.fetchMock);
    await tick();
    await enterEmail('new@x.com');

    expect(gate(), 'the gate stayed up for an accepted member').toBeNull();
    // One row: the pending chat itself. Nothing from a server that has none.
    expect(rows().length, 'an empty account rendered more than its pending chat').toBe(1);
    expect(pending().length, 'the single row is not the pending one').toBe(1);
    expect(bubbles().some((t) => t.includes("I'm James")), 'no welcome on an empty account').toBe(true);
    expect(server.postedChat().length, 'an empty account wrote a chat').toBe(0);
  });

  it('EXPIRY RECOVERY is exempt: re-auth after a 401 does NOT reset', () => {
    // Found by the existing suite, not predicted by this slice's brief. A
    // token that dies mid-conversation raises the gate in 'expired' mode with
    // the member's unsent text held; re-authenticating there is a
    // CONTINUATION and the ruled behaviour returns them to the same chat.
    // By the brief's letter that is "a fresh email submission" and would have
    // reset them — destroying the recovery. The exemption is keyed to the
    // gate MODE, which is the only thing that distinguishes the two.
    //
    // The behavioural proof lives in phase3Widget.test.ts ("mid-session
    // expiry re-auths INTO the same conversation"); this pins the mechanism
    // so the exemption cannot be removed without a red test here too.
    expect(WIDGET_SRC, 'the expiry-mode capture is gone').toMatch(
      /var isExpiryRecovery = mode === 'expired';/,
    );
    // Mode alone is NOT the exemption — it must also be the same member. The
    // expected email is captured at gate-raise time, before any submission can
    // overwrite lastAuthEmail.
    // Identity comes off the DYING TOKEN, captured before it is discarded —
    // lastAuthEmail is empty for a member who arrived on a cached token.
    expect(WIDGET_SRC, 'the dying token is no longer read for its owner').toMatch(
      /expiredForEmail = emailFromToken\(authToken\) \|\| normaliseEmail\(lastAuthEmail\);/,
    );
    expect(WIDGET_SRC, 'the recovery email is no longer captured at gate-raise').toMatch(
      /var recoveryEmail = isExpiryRecovery \? expiredForEmail : '';/,
    );
    // Whitespace-collapsed: the condition spans lines in the source, and a
    // line-spanning regex here is more fragile than the thing it guards.
    expect(
      WIDGET_SRC.replace(/\s+/g, ' '),
      'the exemption no longer requires a matching email',
    ).toContain('isExpiryRecovery && (!recoveryEmail || normaliseEmail(email) === recoveryEmail)');
    expect(WIDGET_SRC, "a non-recovery no longer clears the previous member's draft").toMatch(
      /if \(!isRecovery\) \{[\s\S]*pendingResendText = '';/,
    );
  });


  it('UNKNOWN owner (undecodable token) fails toward CONTINUATION, deliberately', async () => {
    // A pre-deploy or malformed token cannot say whose it was. Refusing the
    // recovery would destroy the conversation and draft of a member who IS
    // continuing — the loss ruling 1 exists to prevent — so unknown is
    // treated as a continuation. Every token this build mints decodes, so
    // this is a transitional state of at most one tab session.
    window.sessionStorage.setItem('james-bot-token', 'not-a-decodable-token');
    const server = makeServer({
      // Re-auth mints a token for the SAME owner, so the same rows come back —
      // otherwise the empty-list branch would make a placeholder for reasons
      // that have nothing to do with the reset under test.
      tokenFor: { 'someone@x.com': 'not-a-decodable-token' },
      chatsByToken: { 'not-a-decodable-token': [{ id: CHAT_A, title: 'Deal in Tacoma' }] },
      history: { [CHAT_A]: [{ role: 'user', content: 'yesterday: the numbers' }] },
      expireTokenAfter: { 'not-a-decodable-token': 0 },
    });
    mount(server.fetchMock);
    await tick();
    expect(bubbles().join(' '), 'precondition: the cached token restored a chat').toContain(
      'yesterday: the numbers',
    );

    await send('my unsent question');
    expect(gateTitle(), 'precondition: the send expired the token').toContain('session ended');

    await enterEmail('someone@x.com');

    expect(window.sessionStorage.getItem(FRESH_KEY), 'an unknown owner was reset').toBeNull();
    expect(pending().length, 'an unknown owner was moved to a new chat').toBe(0);
  });

  it('the + New chat button and the gate share ONE implementation', () => {
    // Guards the brief's "do not fork a second implementation". Both callers
    // must route through startNewChat, which routes through startPlaceholder.
    const callers = WIDGET_SRC.match(/startNewChat\(/g) ?? [];
    // one definition + two call sites
    expect(callers.length, 'startNewChat gained or lost a caller').toBe(3);
    expect(WIDGET_SRC).toMatch(/function startNewChat\(origin\) \{\s*\n\s*startPlaceholder\(\);/);
    expect(WIDGET_SRC, 'the gate path does not go through startNewChat').toContain("startNewChat('gate')");
  });

  it('FRESH_KEY is set in exactly one place and spent in exactly one place', () => {
    const set = WIDGET_SRC.match(/sessionSet\(FRESH_KEY/g) ?? [];
    const spent = WIDGET_SRC.match(/sessionRemove\(FRESH_KEY/g) ?? [];
    expect(set.length, 'the fresh flag is set from more than the submit handler').toBe(1);
    expect(spent.length, 'the fresh flag is cleared from more than persistActive').toBe(1);
  });
});

describe('expiry recovery — same member continues, a different member does not', () => {
  /** Drive A to a materialised chat, then expire the NEXT send. Returns the
   *  server plus the chat id, so the caller can assert against both owners. */
  async function expireMidThread() {
    const server = makeServer({
      tokenFor: { 'a@x.com': 'token-A', 'b@x.com': 'token-B' },
      chatsByToken: { 'token-A': [], 'token-B': [{ id: CHAT_C, title: 'B only' }] },
      expireTokenAfter: { 'token-A': 1 },
    });
    mount(server.fetchMock);
    await tick();
    await enterEmail('a@x.com');
    await send('first message');
    const id = window.localStorage.getItem(ACTIVE_KEY);
    expect(id, 'precondition: A materialised a chat').toBeTruthy();
    // A's chat now exists server-side and carries the exchange.
    server.setChats('token-A', [{ id: id!, title: 'First message' }]);
    server.setHistory(id!, [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'an answer' },
    ]);
    await send('draft message');
    return { server, id: id! };
  }

  it('SAME email: continuation preserved — history repainted, unsent text kept', async () => {
    const { server } = await expireMidThread();
    expect(gate(), 'precondition: the 401 raised the gate').not.toBeNull();
    expect(gateTitle(), 'precondition: the gate is in EXPIRED mode').toContain('session ended');

    await enterEmail('a@x.com');

    expect(gate(), 'the gate stayed up after a valid re-auth').toBeNull();
    expect(window.sessionStorage.getItem(FRESH_KEY), 'a same-member recovery set the reset flag').toBeNull();
    expect(pending().length, 'a recovery started a new chat instead of continuing').toBe(0);
    const text = bubbles().join(' ');
    expect(bubbles().length, 'nothing was repainted — the assertions below would be empty').toBeGreaterThan(0);
    expect(text, 'the recovered chat lost its history').toContain('first message');
    expect(chatInput().value, "the member's unsent draft was discarded").toBe('draft message');
    void server;
  });

  it('DIFFERENT email: full reset — new chat, no prior transcript, composer cleared', async () => {
    const { server } = await expireMidThread();
    expect(gateTitle(), 'precondition: the gate is in EXPIRED mode').toContain('session ended');
    // Everything painted from here on is watched, not just the end state.
    const seen: string[] = [];
    const watch = () => seen.push(...bubbles());
    watch();

    await enterEmail('b@x.com');
    watch();

    expect(gate(), 'member B was not let through').toBeNull();
    expect(window.sessionStorage.getItem(FRESH_KEY), 'B was treated as a continuation').toBe('1');
    expect(pending().length, 'B did not land on a new chat').toBe(1);
    expect(rows().length, 'the rail rendered nothing for B').toBeGreaterThan(0);
    expect(titles(), "B saw member A's chats").toEqual(['New chat', 'B only']);
    expect(chatInput().value, "A's unsent draft was handed to B").toBe('');
    // DEAD GUARD: `seen` must have collected something, or "never painted" is
    // a claim about an empty array.
    expect(seen.length, 'nothing was ever painted — the leak check is vacuous').toBeGreaterThan(0);
    expect(seen.join(' '), "A's transcript was painted at some point during B's entry").not.toContain(
      'first message',
    );
    expect(seen.join(' '), "A's draft was painted at some point").not.toContain('draft message');
    void server;
  });

  it('DIFFERENT email then a send: the row lands under the NEW token only', async () => {
    const { server, id } = await expireMidThread();
    await enterEmail('b@x.com');
    await send('B first message');

    const posts = server.postedChat();
    expect(posts.length, 'no message was posted — the ownership check is vacuous').toBeGreaterThan(0);
    const last = posts[posts.length - 1];
    const auth = String(last.headers.Authorization ?? last.headers.authorization ?? '');
    expect(auth, "B's message was posted under A's token").toContain('token-B');
    expect(last.body.session_id, "B's message was posted into A's chat").not.toBe(id);
    expect(window.localStorage.getItem(ACTIVE_KEY), 'the active pointer still points at A').not.toBe(id);
  });
});
