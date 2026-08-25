/**
 * Phase 3 S4 — the widget gate.
 *
 * Subjects: gate-first in an ungated session (nothing behind it — no welcome,
 * no composer, and NO network), sessionStorage-only token handling, the three
 * failure states pairwise distinct with retry on lookup_failed alone, and
 * mid-session expiry re-authing back INTO the same conversation.
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
const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

interface ServerOpts {
  authStatus?: number;
  authBody?: unknown;
  chats?: Array<{ id: string; title: string | null }>;
  history?: Record<string, Array<{ role: string; content: string }>>;
  expireChat?: boolean; // /chat answers 401 expired
}

function makeServer(opts: ServerOpts = {}) {
  const calls: Array<{ method: string; url: string; headers: any; body: any }> = [];
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    calls.push({
      method,
      url: u,
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : null,
    });
    if (u.endsWith('/auth')) {
      return json(opts.authStatus ?? 200, opts.authBody ?? { token: 'fresh-token', email: 'member@example.com' });
    }
    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      return json(200, { messages: opts.history?.[id] ?? [] });
    }
    if (u.endsWith('/chats') && method === 'GET') {
      return json(200, (opts.chats ?? []).map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' })));
    }
    if (u.endsWith('/chat') && method === 'POST') {
      if (opts.expireChat) return json(401, { error: 'Not authorized.', reason: 'expired' });
      return json(200, { output: 'an answer' });
    }
    return json(404, {});
  });
  return {
    fetchMock,
    calls,
    authCalls: () => calls.filter((c) => c.url.endsWith('/auth')),
    apiCalls: () => calls.filter((c) => !c.url.endsWith('/auth')),
  };
}

const tick = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function boot(fetchMock: any) {
  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const gate = () => document.querySelector('#james-bot .jb-gate');
const gateInput = () => document.querySelector<HTMLInputElement>('#james-bot .jb-gate-input')!;
const gateBtn = () => document.querySelector<HTMLButtonElement>('#james-bot .jb-gate-btn')!;
const gateStatus = () => document.querySelector<HTMLElement>('#james-bot .jb-gate-status');
const gateRetry = () => document.querySelector<HTMLButtonElement>('#james-bot .jb-gate-retry');
const bubbleText = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-bubble')).map((b) => b.textContent ?? '');
const chatInput = () => document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;

async function enterEmail(email: string) {
  gateInput().value = email;
  gateBtn().click();
  await tick();
}

async function send(text: string) {
  chatInput().value = text;
  document
    .querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear(); // NO token — these suites test the gate itself
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S4 — gate first, nothing behind it', () => {
  it('an ungated session sees the gate: no welcome, no composer, and NO network', async () => {
    const server = makeServer({});
    boot(server.fetchMock);
    await tick();

    expect(gate(), 'no gate rendered').not.toBeNull();
    expect(bubbleText().some((t) => t.includes("I'm James")), 'the welcome rendered behind the gate').toBe(false);
    const form = document.querySelector<HTMLElement>('#james-bot .jb-form')!;
    expect(getComputedStyle(form).display, 'the composer is visible behind the gate').toBe('none');
    // The strongest half: NOTHING was fetched. No /chats, no /history — the
    // gate is not a curtain over a booted chat.
    expect(server.calls, 'the widget talked to the API before the member authenticated').toEqual([]);
  });

  it('P3 contract: createJamesBot still accepts memberEmail and ignores it for auth', async () => {
    const server = makeServer({});
    vi.stubGlobal('fetch', server.fetchMock);
    loadWidget();
    const div = document.createElement('div');
    div.id = 'james-bot';
    document.body.appendChild(div);
    (window as any).createJamesBot({
      apiUrl: 'https://api.example.com',
      target: '#james-bot',
      memberEmail: 'ignored@example.com',
    });
    await tick();

    expect(gate(), 'memberEmail bypassed the gate').not.toBeNull();
    expect(server.authCalls(), 'memberEmail was submitted to /auth by itself').toEqual([]);
  });
});

describe('S4 — the allow flow', () => {
  it('valid email -> /auth -> token in SESSIONSTORAGE only -> chat boots with Authorization', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }], history: { [CHAT_A]: [] } });
    boot(server.fetchMock);
    await tick();
    await enterEmail('member@example.com');

    expect(server.authCalls()[0]?.body).toEqual({ email: 'member@example.com' });
    expect(window.sessionStorage.getItem('james-bot-token')).toBe('fresh-token');
    expect(window.localStorage.getItem('james-bot-token'), 'the token leaked into localStorage').toBeNull();
    expect(gate(), 'the gate did not come down').toBeNull();
    expect(bubbleText().some((t) => t.includes("I'm James")), 'the chat did not boot').toBe(true);
    // Every subsequent API call carries the token.
    for (const c of server.apiCalls()) {
      expect(c.headers.authorization, `${c.url} went out without the token`).toBe('Bearer fresh-token');
      expect(c.headers['x-james-owner']).toBeUndefined();
    }
    expect(server.apiCalls().length).toBeGreaterThan(0);
  });

  it('a seeded token skips the gate and never calls /auth (the suite-seeding mechanism itself)', async () => {
    window.sessionStorage.setItem('james-bot-token', 'seeded');
    const server = makeServer({ chats: [] });
    boot(server.fetchMock);
    await tick();

    expect(gate()).toBeNull();
    expect(server.authCalls()).toEqual([]);
    expect(bubbleText().some((t) => t.includes("I'm James"))).toBe(true);
  });
});

describe('S4 — the three failure states, pairwise distinct', () => {
  const bootFail = async (status: number, reason: string) => {
    const server = makeServer({ authStatus: status, authBody: { error: 'x', reason } });
    boot(server.fetchMock);
    await tick();
    await enterEmail('someone@example.com');
    return server;
  };

  it('not_found: names the email problem, NO retry control', async () => {
    await bootFail(403, 'not_found');
    expect(gateStatus()!.textContent).toContain("couldn't find that email");
    expect(gateRetry(), 'retry offered for a wrong email — wrong next action').toBeNull();
  });

  it('denied: names the access problem, NO retry control', async () => {
    await bootFail(403, 'denied');
    expect(gateStatus()!.textContent).toContain('does not currently have course access');
    expect(gateRetry(), 'retry offered for a denial — wrong next action').toBeNull();
  });

  it('lookup_failed: names OUR problem and offers RETRY, which resubmits', async () => {
    const server = await bootFail(503, 'lookup_failed');
    expect(gateStatus()!.textContent).toContain("couldn't check your access");
    expect(gateStatus()!.textContent).toContain('on our side');
    const retry = gateRetry();
    expect(retry, 'the one state where retrying can succeed has no retry').not.toBeNull();

    retry!.click();
    await tick();
    expect(server.authCalls().length, 'retry did not resubmit').toBe(2);
  });

  it('the three states are PAIRWISE distinct in copy', async () => {
    const texts: string[] = [];
    for (const [status, reason] of [[403, 'not_found'], [403, 'denied'], [503, 'lookup_failed']] as const) {
      document.body.innerHTML = '';
      window.sessionStorage.clear();
      await bootFail(status, reason);
      texts.push(gateStatus()!.textContent ?? '');
    }
    expect(new Set(texts).size, 'two failure states read identically').toBe(3);
  });

  it('a network failure on /auth is lookup_failed with retry', async () => {
    const server = makeServer({});
    server.fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth')) throw new Error('down');
      return json(404, {});
    });
    boot(server.fetchMock);
    await tick();
    await enterEmail('someone@example.com');

    expect(gateStatus()!.textContent).toContain("couldn't check");
    expect(gateRetry()).not.toBeNull();
  });

  it('junk email is caught client-side without a request', async () => {
    const server = makeServer({});
    boot(server.fetchMock);
    await tick();
    await enterEmail('not-an-email');

    expect(gateStatus()!.textContent).toContain('does not look like an email');
    expect(server.authCalls()).toEqual([]);
  });
});

describe('S4 — mid-session expiry re-auths INTO the same conversation', () => {
  it('401 expired on send -> gate in expired mode -> re-auth -> same chat, history repainted, text preserved', async () => {
    window.sessionStorage.setItem('james-bot-token', 'old-token');
    const server = makeServer({
      expireChat: true,
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'yesterday: the numbers' }] },
    });
    boot(server.fetchMock);
    await tick();
    expect(bubbleText().some((t) => t.includes('yesterday: the numbers')), 'precondition: history restored').toBe(true);

    await send('my unsent question');

    // The gate, in expired mode; the dead token gone from sessionStorage.
    expect(gate(), 'no re-auth gate appeared').not.toBeNull();
    expect(document.querySelector('#james-bot .jb-gate-title')!.textContent).toContain('session ended');
    expect(window.sessionStorage.getItem('james-bot-token'), 'the dead token survived').toBeNull();

    // Re-auth: the server stops expiring, mints fresh.
    server.fetchMock.mockImplementation(async (url: string, init?: any) => {
      const u = String(url);
      if (u.endsWith('/auth')) return json(200, { token: 'fresh-token', email: 'member@example.com' });
      if (u.includes('/history')) return json(200, { messages: [{ role: 'user', content: 'yesterday: the numbers' }] });
      if (u.endsWith('/chats')) return json(200, [{ id: CHAT_A, title: 'Deal in Tacoma', created_at: 'x', last_message_at: 'x' }]);
      return json(200, { output: 'ok' });
    });
    await enterEmail('member@example.com');
    await tick();

    // THE RULED OUTCOME: the member is back in THEIR chat, not a fresh one —
    // ACTIVE_KEY survived, boot landed in it, history repainted...
    expect(gate()).toBeNull();
    expect(bubbleText().some((t) => t.includes('yesterday: the numbers')), 'the member lost their conversation').toBe(true);
    // ...and the unsent message is back in the composer, armed to resend.
    expect(chatInput().value, 'the unsent message was lost').toBe('my unsent question');
  });

  it('the token is cleared in exactly one place — a 401 on /chats mid-boot gates too', async () => {
    window.sessionStorage.setItem('james-bot-token', 'old-token');
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/chats')) return json(401, { error: 'Not authorized.', reason: 'expired' });
      if (u.includes('/history')) return json(200, { messages: [] });
      return json(200, {});
    });
    boot(fetchMock);
    await tick();

    expect(gate(), 'an expired boot did not gate').not.toBeNull();
    expect(window.sessionStorage.getItem('james-bot-token')).toBeNull();
  });
});
