/**
 * Phase 2, Slice 3 — ROW IDENTITY, plus FINDING-027.
 *
 * S3.1 relative time from last_message_at, S3.2 placeholder vs real untitled
 * row, S3.3 title propagation without polling, R3-b welcome suppression, and
 * FINDING-027's prepend with its duplication defence (R3-c).
 *
 * The wrong-subject discipline in this file:
 *  - time cases pin the RENDERED TEXT under a frozen clock, not "an element
 *    exists" — a formatter emitting "NaN ago" produces an element too;
 *  - the S3.3 cases count REQUESTS, because "the title appeared" cannot
 *    distinguish refetch-once from polling — only the request count can;
 *  - the FINDING-027 cases assert EXACTLY-ONCE on both sides (INSPECTOR's
 *    standard: zero is also a bug), and the dedupe case carries a control
 *    where identical TEXT is genuinely historical and must NOT be dropped.
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

interface Msg {
  role: string;
  content: string;
}

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Frozen "now" for every time assertion. */
const NOW = new Date('2026-08-24T12:00:00.000Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function makeServer(seed: {
  chats?: Array<{ id: string; title: string | null; last_message_at?: string }>;
  history?: Record<string, Msg[]>;
  holdHistory?: boolean;
  reply?: string;
}) {
  const chats = (seed.chats ?? []).map((c) => ({ ...c }));
  const history: Record<string, Msg[]> = seed.history ?? {};
  const calls: Array<{ method: string; url: string }> = [];
  const waitingHistory: Array<{ id: string; resolve: (v: unknown) => void }> = [];
  let holdHistory = seed.holdHistory ?? false;

  const listBody = () =>
    chats.map((c) => ({
      id: c.id,
      title: c.title,
      created_at: 'x',
      last_message_at: c.last_message_at ?? 'x',
    }));

  const fetchMock = vi.fn((url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : null;
    const u = String(url);
    calls.push({ method, url: u });
    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      if (holdHistory) {
        return new Promise((resolve) => waitingHistory.push({ id, resolve: resolve as any }));
      }
      return Promise.resolve(json(200, { messages: history[id] ?? [] }));
    }
    if (u.endsWith('/chats') && method === 'GET') {
      return Promise.resolve(json(200, listBody()));
    }
    if (u.endsWith('/chat') && method === 'POST') {
      const id = body.session_id;
      const reply = seed.reply ?? 'Answer for ' + id;
      (history[id] ??= []).push(
        { role: 'user', content: body.message ?? '(form)' },
        { role: 'assistant', content: reply },
      );
      return Promise.resolve(json(200, { output: reply }));
    }
    return Promise.resolve(json(404, {}));
  });

  return {
    fetchMock,
    chats,
    history,
    calls,
    listCalls: () => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/chats')).length,
    setHoldHistory: (v: boolean) => {
      holdHistory = v;
    },
    /**
     * Resolves held /history fetches. `forId` releases only that session's —
     * releasing every held fetch with one body once handed chat B's fetch
     * chat A's transcript, and the "leak" that test then reported was the
     * harness's own, not the widget's (wrong subject, caught in review).
     */
    releaseHistory: (messages: Msg[], forId?: string) => {
      for (let i = waitingHistory.length - 1; i >= 0; i -= 1) {
        if (forId && waitingHistory[i].id !== forId) continue;
        waitingHistory.splice(i, 1)[0].resolve(json(200, { messages }));
      }
    },
    outstandingHistory: () => waitingHistory.length,
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

const rowById = (id: string) =>
  document.querySelector(`#james-bot .jb-chat-row[data-chat-id="${id}"]`);
const railRows = () => Array.from(document.querySelectorAll('#james-bot .jb-chat-row'));
const timeOf = (row: Element | null) => row?.querySelector('.jb-chat-time')?.textContent ?? null;
const titleOf = (row: Element | null) => row?.querySelector('.jb-chat-title')?.textContent ?? null;
const bubbleText = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-bubble')).map((b) => b.textContent ?? '');
const chatInput = () => document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;

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
  vi.restoreAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('S3.1 — relative time on rail rows', () => {
  it('renders the expected text for each age bracket, under a frozen clock', async () => {
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Five minutes', last_message_at: minsAgo(5) },
        { id: CHAT_B, title: 'Two hours', last_message_at: minsAgo(120) },
      ],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();

    expect(timeOf(rowById(CHAT_A))).toBe('5m ago');
    expect(timeOf(rowById(CHAT_B))).toBe('2h ago');
  });

  it('Yesterday and day brackets', async () => {
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'A day', last_message_at: minsAgo(26 * 60) },
        { id: CHAT_B, title: 'Four days', last_message_at: minsAgo(4 * 24 * 60) },
      ],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();

    expect(timeOf(rowById(CHAT_A))).toBe('Yesterday');
    expect(timeOf(rowById(CHAT_B))).toBe('4d ago');
  });

  it('R3-d: an absent or unparsable timestamp renders NO time element — never "NaN"', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Synthesized', last_message_at: 'x' }],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();

    const row = rowById(CHAT_A)!;
    expect(row.querySelector('.jb-chat-time'), 'a time element exists for garbage input').toBeNull();
    // The stronger claim: nothing NaN-shaped anywhere in the row.
    expect(row.textContent).not.toMatch(/NaN/);
    // Precondition: the row itself rendered — the absence above is not the
    // silence of a rail that drew nothing.
    expect(titleOf(row)).toBe('Synthesized');
  });

  it('R3-d: a completed turn stamps the active row locally — "just now", not "2h ago"', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(120) }],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();
    expect(timeOf(rowById(CHAT_A)), 'precondition: the stale age really rendered').toBe('2h ago');

    await send('new numbers');

    expect(
      timeOf(rowById(CHAT_A)),
      'a chat answered seconds ago still shows its pre-send age at the top of the rail',
    ).toBe('just now');
  });
});

describe('S3.2 — the ephemeral placeholder is visually distinct from a real untitled row', () => {
  it('placeholder: pending class, no timestamp; real untitled row: neither', async () => {
    // A real row with title:null (generation in flight or failed) and the
    // placeholder both LABEL as "New chat" — the distinction has to come from
    // somewhere else, and this is where.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: null, last_message_at: minsAgo(30) }],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();
    // Open the real untitled chat, then mint a placeholder beside it.
    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();

    const rows = railRows();
    expect(rows.length, 'precondition: placeholder + real row').toBe(2);
    const placeholder = rows.find((r) => r.className.includes('jb-chat-pending'))!;
    const real = rows.find((r) => !r.className.includes('jb-chat-pending'))!;

    expect(placeholder, 'no row carries the pending class').toBeTruthy();
    expect(titleOf(placeholder)).toBe('New chat');
    expect(timeOf(placeholder), 'a placeholder shows a timestamp for events that never happened').toBeNull();

    expect(titleOf(real)).toBe('New chat');
    expect(real.getAttribute('data-chat-id')).toBe(CHAT_A);
    expect(timeOf(real), 'the real row lost its timestamp').toBe('30m ago');
  });
});

describe('S3.3 — title propagation: refetch-once, never polling', () => {
  it('after the first turn in an untitled chat, ONE list refetch fires and the title lands', async () => {
    const server = makeServer({ chats: [], history: {} });
    boot(server.fetchMock);
    await tick();
    const bootCalls = server.listCalls();
    expect(bootCalls, 'precondition: boot asked for the list').toBe(1);

    await send('flip in tacoma, 350k');
    // The turn materialised the placeholder; server-side, generation names it.
    server.chats.push({
      id: railRows()[0].getAttribute('data-chat-id')!,
      title: 'Tacoma flip numbers',
      last_message_at: NOW.toISOString(),
    });

    await vi.advanceTimersByTimeAsync(4100);
    await tick();

    expect(server.listCalls(), 'the refetch never fired').toBe(bootCalls + 1);
    expect(titleOf(railRows()[0]), 'the member still stares at "New chat"').toBe(
      'Tacoma flip numbers',
    );
  });

  it('NO further requests without member action — the distinction from polling', async () => {
    // "The title appeared" cannot distinguish refetch-once from a poll loop;
    // only the request count over dead time can.
    const server = makeServer({ chats: [], history: {} });
    boot(server.fetchMock);
    await tick();
    await send('hello');
    server.chats.push({
      id: railRows()[0].getAttribute('data-chat-id')!,
      title: 'Greetings',
      last_message_at: NOW.toISOString(),
    });
    await vi.advanceTimersByTimeAsync(4100);
    await tick();
    const after = server.listCalls();

    await vi.advanceTimersByTimeAsync(120_000); // two idle minutes
    await tick();

    expect(server.listCalls(), 'the widget kept asking on a timer — that is polling').toBe(after);
  });

  it('a titled chat schedules nothing', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Already titled', last_message_at: minsAgo(1) }],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();
    const bootCalls = server.listCalls();

    await send('another question');
    await vi.advanceTimersByTimeAsync(10_000);
    await tick();

    expect(server.listCalls(), 'a refetch fired for a chat that already has its title').toBe(
      bootCalls,
    );
  });

  it('generation slower than the delay: the NEXT turn arms one more — bounded, not looped', async () => {
    const server = makeServer({ chats: [], history: {} });
    boot(server.fetchMock);
    await tick();
    await send('first');
    await vi.advanceTimersByTimeAsync(4100); // fires; server still has no title
    await tick();
    const afterFirst = server.listCalls();

    await vi.advanceTimersByTimeAsync(60_000); // idle — nothing may fire
    await tick();
    expect(server.listCalls(), 'idle time produced a request').toBe(afterFirst);

    await send('second');
    server.chats.push({
      id: railRows()[0].getAttribute('data-chat-id')!,
      title: 'Second time lucky',
      last_message_at: NOW.toISOString(),
    });
    await vi.advanceTimersByTimeAsync(4100);
    await tick();

    expect(server.listCalls(), 'the second turn did not arm a retry').toBe(afterFirst + 1);
    expect(titleOf(railRows()[0])).toBe('Second time lucky');
  });

  it('the silent refetch never flashes the rail back to skeletons', async () => {
    const server = makeServer({ chats: [], history: {} });
    boot(server.fetchMock);
    await tick();
    await send('hello');
    server.chats.push({
      id: railRows()[0].getAttribute('data-chat-id')!,
      title: 'Greetings',
      last_message_at: NOW.toISOString(),
    });

    // Sample through the refetch window: no loading skeleton may appear in a
    // rail that is already populated.
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      await tick(1);
      expect(
        document.querySelectorAll('#james-bot .jb-skel-row').length,
        `the rail flashed skeletons mid-refetch (sample ${i})`,
      ).toBe(0);
    }
    expect(titleOf(railRows()[0]), 'precondition: the refetch really ran').toBe('Greetings');
  });

  it('switching chats mid-wait does not lose the refetch — the title still lands', async () => {
    // The timer is registry state, deliberately outside resetChatState: the
    // title belongs to the rail, not to the conversation being left.
    const server = makeServer({
      chats: [{ id: CHAT_B, title: 'Other chat', last_message_at: minsAgo(60) }],
      history: { [CHAT_B]: [] },
    });
    boot(server.fetchMock);
    await tick();
    // Member starts a NEW chat and sends — placeholder materialises untitled.
    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();
    await send('brand new question');
    const newId = railRows()
      .map((r) => r.getAttribute('data-chat-id'))
      .find((id) => id !== CHAT_B)!;
    server.chats.push({ id: newId, title: 'Brand new', last_message_at: NOW.toISOString() });

    // Switch away BEFORE the refetch fires.
    rowById(CHAT_B)!.querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
    await tick();
    await vi.advanceTimersByTimeAsync(4100);
    await tick();

    expect(titleOf(rowById(newId)), 'the switch killed the title refetch').toBe('Brand new');
  });
});

describe('T-P2.4 (R3-b) — welcome suppressed when history exists, present when it does not', () => {
  it('a restored chat opens on its history, not on "Hi! I\'m James…"', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
    });
    boot(server.fetchMock);
    await tick();

    const texts = bubbleText();
    expect(texts.some((t) => t.includes('old question')), 'precondition: history painted').toBe(true);
    expect(
      texts.some((t) => t.includes("I'm James")),
      'the member reads a greeting above yesterday\'s conversation',
    ).toBe(false);
  });

  it('a NEW chat and a placeholder still open on the welcome — with the exact pinned string', async () => {
    const server = makeServer({ chats: [], history: {} });
    boot(server.fetchMock);
    await tick();

    const texts = bubbleText();
    expect(texts).toHaveLength(1);
    // The contract-pinned copy, verbatim anchors: suppression must not have
    // touched the STRING, only whether it shows.
    expect(texts[0]).toContain(
      "Hi! I'm James — ask me anything related to Real Estate Investing",
    );
    expect(texts[0]).toContain('everything here is education and estimates only');
  });

  it('an EMPTY transcript keeps the welcome — absence of history is not history', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Empty chat', last_message_at: minsAgo(60) }],
      history: { [CHAT_A]: [] },
    });
    boot(server.fetchMock);
    await tick();

    expect(bubbleText().some((t) => t.includes("I'm James")), 'the welcome vanished from an empty chat').toBe(
      true,
    );
  });
});

describe('welcome keying — DEDICATED coverage, both directions (M30)', () => {
  // The M30 discrepancy: the hoisted-removeWelcome mutation was caught, but
  // by an assertion living INSIDE a prefix-sharing duplication case — one
  // refactor of that case away from unpinned. These two tests have the
  // welcome as their ONLY subject.
  //
  // The keying, confirmed by design and not as a leftover of the D.E2
  // symptom: keep.length is exactly "earlier-than-live history exists to
  // display". Empty keep means everything in the snapshot is the live
  // exchange or later — the pane is EQUIVALENT TO A FRESH CHAT, and S4.4
  // rules the welcome stays for fresh chats. Removing it there would strip
  // the greeting (and the contract-pinned disclaimer above the member's
  // numbers) from a pane with nothing else above the fold.

  it('keep NON-EMPTY: the prepend removes the welcome', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'live-a',
    });
    boot(server.fetchMock);
    await tick();
    await send('live-q');
    expect(
      bubbleText().some((t) => t.includes("I'm James")),
      'precondition: the welcome is up before the snapshot lands',
    ).toBe(true);

    server.releaseHistory([
      { role: 'user', content: 'earlier-q' },
      { role: 'assistant', content: 'earlier-a' },
      { role: 'user', content: 'live-q' },
      { role: 'assistant', content: 'live-a' },
    ]);
    await tick();

    expect(
      bubbleText().some((t) => t.includes("I'm James")),
      'the welcome sits above restored history',
    ).toBe(false);
    expect(bubbleText().some((t) => t.includes('earlier-q')), 'precondition: history really prepended').toBe(
      true,
    );
  });

  it('keep EMPTY: the welcome STAYS — the pane is equivalent to a fresh chat', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'live-a',
    });
    boot(server.fetchMock);
    await tick();
    await send('live-q');

    // The snapshot holds ONLY the live exchange: nothing earlier-than-live
    // exists, keep is empty, nothing prepends.
    server.releaseHistory([
      { role: 'user', content: 'live-q' },
      { role: 'assistant', content: 'live-a' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(
      texts.some((t) => t.includes("I'm James")),
      'the welcome vanished from an effectively-new chat',
    ).toBe(true);
    expect(texts.filter((t) => t === 'live-q'), 'precondition: no duplication either').toHaveLength(1);
  });
});

describe('FINDING-027 — late history prepends; duplication is the attack surface (R3-c)', () => {
  it('pre-send snapshot WITHOUT the live turn: prepends above, exactly once each', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    expect(server.outstandingHistory(), 'precondition: /history held in flight').toBe(1);
    await send('actually, new question');

    server.releaseHistory([
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
    ]);
    await tick();

    const texts = bubbleText();
    const oldAt = texts.findIndex((t) => t.includes('old question'));
    const liveAt = texts.findIndex((t) => t.includes('actually, new question'));
    expect(oldAt, 'the old transcript was discarded').not.toBe(-1);
    expect(oldAt).toBeLessThan(liveAt);
    expect(texts.filter((t) => t.includes('old question'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('actually, new question'))).toHaveLength(1);
    // R3-b applies to the prepend too: history now exists in this pane.
    expect(texts.some((t) => t.includes("I'm James")), 'the welcome sits above restored history').toBe(
      false,
    );
  });

  it('THE RACE: issued pre-send, server read POST-send — the live exchange is trimmed', async () => {
    // The gate alone cannot stop this: issuance time is not server read time.
    // The snapshot arrives containing the very turns the pane is showing, and
    // the trim is what keeps them from painting twice.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'the answer',
    });
    boot(server.fetchMock);
    await tick();
    await send('my question');

    server.releaseHistory([
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'my question' },
      { role: 'assistant', content: 'the answer' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'my question'), 'the member\'s message painted twice — or zero').toHaveLength(1);
    expect(texts.filter((t) => t.includes('the answer'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('old question')), 'the genuinely old turn was lost').toHaveLength(1);
    const oldAt = texts.findIndex((t) => t.includes('old question'));
    const liveAt = texts.findIndex((t) => t === 'my question');
    expect(oldAt).toBeLessThan(liveAt);
  });

  it('BUG-031 ACCEPTANCE (D.M3): a mid-array live exchange renders EXACTLY once', async () => {
    // Two tabs are supported (A6). The other tab appends AFTER the member's
    // live turn, so the live pair is no longer the snapshot's suffix — the
    // exact shape a suffix matcher is structurally blind to.
    //
    // ENCODING CORRECTED with the last-occurrence ruling: the original
    // 8-element D.M3 array was the RENDERED PANE (this 6-message snapshot
    // plus the pane's own two live turns at the bottom) — the operator's
    // five-case table only computes on that reading. An earlier version of
    // this test fed the 8-element render in as the SNAPSHOT, a strictly
    // different (and content-undecidable) fixture. Flagged for INSPECTOR to
    // reconcile against its rig's D.M3 fixture.
    //
    // The member's turn must render once; h1/h2 above it in order; the other
    // tab's later turns are DISCARDED by rule (they arrived after the live
    // turn and do not belong above it — they surface on the next refetch).
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'live-answer',
    });
    boot(server.fetchMock);
    await tick();
    await send('live-question');

    server.releaseHistory([
      { role: 'user', content: 'h1' },
      { role: 'assistant', content: 'h2' },
      { role: 'user', content: 'live-question' },
      { role: 'assistant', content: 'live-answer' },
      { role: 'user', content: 'from-another-device' },
      { role: 'assistant', content: 'other-reply' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'live-question'), 'the member\'s own turn painted twice — or zero').toHaveLength(1);
    expect(texts.filter((t) => t.includes('live-answer'))).toHaveLength(1);
    const h1At = texts.findIndex((t) => t === 'h1');
    const h2At = texts.findIndex((t) => t.includes('h2'));
    const liveAt = texts.findIndex((t) => t === 'live-question');
    expect(h1At, 'h1 was lost').not.toBe(-1);
    expect(h1At).toBeLessThan(h2At);
    expect(h2At).toBeLessThan(liveAt);
    // The later-arriving turns are discarded, not smuggled in anywhere.
    expect(texts.some((t) => t.includes('from-another-device'))).toBe(false);
    expect(texts.some((t) => t.includes('other-reply'))).toBe(false);
  });

  it('THE SEPARATING CASE (ordered): live text duplicated in genuine history, live pair mid-array', async () => {
    // The construction the corrected ruling required before building: the
    // live pair appears BOTH as a genuine historical duplicate (an identical
    // calculator run a week ago — deterministic output makes this real) AND
    // as the live exchange mid-array with another device's turns after it.
    //
    // Correct output: the genuine duplicate and the old pair PREPEND (the
    // member really had that exchange), the device's post-live turns are
    // discarded, and the member's text appears exactly TWICE — one genuine,
    // one live. First-occurrence would cut at the genuine copy, leave an
    // empty prefix, and throw every real turn away (3 -> 1).
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'sure',
    });
    boot(server.fetchMock);
    await tick();
    await send('yes');

    server.releaseHistory([
      { role: 'user', content: 'yes' }, // genuine, a week old, identical
      { role: 'assistant', content: 'sure' },
      { role: 'user', content: 'other-old' },
      { role: 'assistant', content: 'oo-reply' },
      { role: 'user', content: 'yes' }, // THE live exchange
      { role: 'assistant', content: 'sure' },
      { role: 'user', content: 'from-device2' },
      { role: 'assistant', content: 'dev2-reply' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'yes'), 'genuine history was eaten — or the live turn doubled').toHaveLength(2);
    expect(texts.filter((t) => t.includes('other-old'))).toHaveLength(1);
    expect(texts.some((t) => t.includes('from-device2')), 'post-live turns were prepended').toBe(false);
    // Order: genuine yes, sure, other-old, oo-reply, then the live pair.
    const firstYes = texts.findIndex((t) => t === 'yes');
    const otherOld = texts.findIndex((t) => t.includes('other-old'));
    const lastYes = texts.lastIndexOf('yes');
    expect(firstYes).toBeLessThan(otherOld);
    expect(otherOld).toBeLessThan(lastYes);
    // THE SECOND D.E2 SYMPTOM (INSPECTOR, browser-verified): under the broken
    // rule keep was empty, removeWelcome never fired, and the pane rendered
    // as a brand-new chat — blank plus greeting. With genuine history
    // prepended the welcome must be GONE, and for the right reason: keep is
    // non-empty, which is exactly "earlier-than-live history exists".
    expect(texts.some((t) => t.includes("I'm James")), 'the welcome sits above restored history').toBe(
      false,
    );
  });

  it('a POST-live pair sharing only a PREFIX with the live turns does not resurrect anything', async () => {
    // Qualifier discipline under the last-occurrence scan: a partial match
    // AFTER the live exchange (same question, different answer) must not
    // become the cut point — that would prepend the live copy above itself.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'the answer',
    });
    boot(server.fetchMock);
    await tick();
    await send('my question');

    server.releaseHistory([
      { role: 'user', content: 'my question' }, // the live exchange
      { role: 'assistant', content: 'the answer' },
      { role: 'user', content: 'my question' }, // device2 asked the same...
      { role: 'assistant', content: 'a different answer' }, // ...got a different reply
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'my question'), 'the live copy was prepended above itself').toHaveLength(1);
    expect(texts.some((t) => t.includes('a different answer')), 'post-live turns painted').toBe(false);
    // The welcome keying, other direction: NOTHING earlier-than-live exists
    // to display (keep is empty), so this pane is equivalent to a fresh chat
    // and the welcome STAYS. Together with the separating case's absence
    // assertion, this pins removeWelcome to the RESULT — a version that
    // removed it whenever a snapshot merely arrived would go red here.
    expect(texts.some((t) => t.includes("I'm James")), 'the welcome vanished from an effectively-new chat').toBe(
      true,
    );
  });

  it('BUG-031 CONTROL: two identical ADJACENT historical pairs both survive', async () => {
    // INSPECTOR's surviving control, kept green by ruling: a greedy matcher
    // would eat four turns and leave one pair. The full-coverage/tail rule
    // must not regress it.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'the answer',
    });
    boot(server.fetchMock);
    await tick();
    await send('go');

    server.releaseHistory([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'the answer' },
    ]);
    await tick();

    const texts = bubbleText();
    // Live pair (go/the answer) once; the two identical historical pairs both
    // prepend: three 'go' total, two 'ok'.
    expect(texts.filter((t) => t === 'go'), 'a historical go was eaten').toHaveLength(3);
    expect(texts.filter((t) => t.includes('ok'))).toHaveLength(2);
    expect(texts.filter((t) => t.includes('the answer'))).toHaveLength(1);
  });

  it('BUG-033 (ARM B): partial-persistence tail — two sends, snapshot caught only the first', async () => {
    // THE UNPINNED LOAD-BEARING ARM. The member sends TWICE while /history is
    // out; the server's read landed between the exchanges, so the snapshot
    // ends with the FIRST live exchange: it extends to the snapshot's end but
    // does NOT fully cover the live turns. Only qualifier arm B
    // (extends-to-end) makes that a cut point. With arm B removed the
    // occurrence fails to qualify, the whole snapshot prepends, and the
    // member's first exchange paints twice.
    //
    // Acceptance (operator): removing arm B ALONE must turn exactly this test
    // red. Removing arm A alone is caught by the separating case and the
    // D.M3 acceptance, NOT by this one — the rows are independent.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'a1',
    });
    boot(server.fetchMock);
    await tick();
    await send('q1'); // first exchange completes; the reply is 'a1'
    await send('q2'); // second exchange completes too; liveTurns = q1,a1,q2,a1

    server.releaseHistory([
      { role: 'user', content: 'old-q' },
      { role: 'assistant', content: 'old-a' },
      { role: 'user', content: 'q1' }, // the server read caught only this pair
      { role: 'assistant', content: 'a1' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'q1'), 'the first exchange painted twice — arm B is gone').toHaveLength(1);
    expect(texts.filter((t) => t === 'q2')).toHaveLength(1);
    expect(texts.filter((t) => t.includes('old-q')), 'the genuinely old turn was lost').toHaveLength(1);
    const oldAt = texts.findIndex((t) => t.includes('old-q'));
    const q1At = texts.findIndex((t) => t === 'q1');
    expect(oldAt, 'old history landed below the live turns').toBeLessThan(q1At);
  });

  it('CONTROL: identical TEXT that is genuinely historical is NOT dropped', async () => {
    // The trim compares the ALIGNED SUFFIX, not membership. A member who asked
    // "yes" a week ago and "yes" again live must see both — a dedupe by
    // content would silently eat real history.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      holdHistory: true,
      reply: 'the answer',
    });
    boot(server.fetchMock);
    await tick();
    await send('yes');

    server.releaseHistory([
      { role: 'user', content: 'yes' }, // historical, same text
      { role: 'assistant', content: 'old reply' },
      { role: 'user', content: 'yes' }, // the live turn, caught by the race
      { role: 'assistant', content: 'the answer' },
    ]);
    await tick();

    const texts = bubbleText();
    expect(texts.filter((t) => t === 'yes'), 'content-based dedupe ate a real historical turn').toHaveLength(2);
    expect(texts.filter((t) => t.includes('old reply'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('the answer'))).toHaveLength(1);
  });

  it('R3-c GATE: a fetch ISSUED after the send never prepends — retry-after-send, exactly once', async () => {
    // Sequence: /history fails pre-send (Retry appears), the member sends,
    // THEN clicks Retry. That fetch is issued with started=true and reads a
    // table already holding the member's turn. The gate discards it.
    const failing = { on: true };
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma', last_message_at: minsAgo(60) }],
      history: {},
      reply: 'the answer',
    });
    const inner = server.fetchMock;
    const gated = vi.fn((url: string, init?: any) => {
      if (String(url).includes('/history') && failing.on) {
        return Promise.resolve(json(503, { error: 'nope' }));
      }
      return inner(url, init);
    });
    boot(gated);
    await tick();
    const retry = document.querySelector<HTMLButtonElement>('#james-bot .jb-retry');
    expect(retry, 'precondition: the history error offered a Retry').not.toBeNull();

    await send('my question');
    failing.on = false;
    server.history[CHAT_A] = [
      { role: 'user', content: 'ancient question' },
      { role: 'assistant', content: 'ancient answer' },
      { role: 'user', content: 'my question' },
      { role: 'assistant', content: 'the answer' },
    ];
    retry!.click();
    await tick();

    const texts = bubbleText();
    expect(
      texts.filter((t) => t === 'my question'),
      'a post-send fetch prepended — the gate is gone',
    ).toHaveLength(1);
    expect(
      texts.filter((t) => t.includes('ancient question')),
      'the gated fetch painted anyway',
    ).toHaveLength(0);
  });

  it('a mid-flight chat SWITCH still discards — stale(op) outranks the prepend', async () => {
    // The prepend must not weaken W4: a snapshot for chat A arriving after the
    // member moved to chat B has no business in either pane.
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Chat A', last_message_at: minsAgo(30) },
        { id: CHAT_B, title: 'Chat B', last_message_at: minsAgo(60) },
      ],
      history: {},
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    // Chat A's /history is held. Switch to B (its fetch is held too), then
    // release BOTH with A's content — the stale guard must eat A's.
    rowById(CHAT_B)!.querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
    await tick();

    // Release ONLY chat A's held fetch with A's content; B's stays held, so
    // anything painted can only have come through A's stale op.
    server.releaseHistory([{ role: 'user', content: 'chat A private line' }], CHAT_A);
    await tick();

    expect(
      bubbleText().some((t) => t.includes('chat A private line')),
      "chat A's transcript painted into chat B",
    ).toBe(false);
  });
});
