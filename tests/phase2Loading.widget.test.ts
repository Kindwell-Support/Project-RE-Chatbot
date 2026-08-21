/**
 * Phase 2, Slice 1 — HONEST LOADING.
 *
 * T-P2.1 (a skeleton never appears under a member's own message) and T-P2.2
 * (the rail distinguishes loading / empty / error) live here, plus the
 * /history half of S1.3.
 *
 * THE DEFECT BEING FIXED is not "the rail is slow". It is that the rail made a
 * FALSE STATEMENT: `chats = []` was painted as "No chats yet" from the instant
 * of mount, before /chats had been asked, so a returning member with a full
 * sidebar was told they had none for the whole request.
 *
 * That shapes every assertion below. "Loading shows a skeleton" is not enough
 * on its own — a widget that showed a skeleton AND the empty copy together
 * would pass it while still telling the lie. So each state case asserts the
 * copy that belongs to it AND the absence of the two that do not. The states
 * are only meaningful as a partition.
 *
 * The vacuity trap this file is written around: a widget that rendered NOTHING
 * in the rail would satisfy every "does not say No chats yet" assertion
 * perfectly. Every such case therefore asserts its own precondition — that the
 * thing which SHOULD be there is there — before asserting what should not.
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

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/**
 * A server whose /chats and /history can be HELD in flight.
 *
 * The loading state is, by definition, only observable while a request is
 * outstanding. A fake that resolves immediately makes the window unobservable
 * and every assertion about it vacuous — which is precisely how this defect
 * survived to begin with.
 */
function makeServer(seed: {
  chats?: Array<{ id: string; title: string | null }>;
  history?: Record<string, Msg[]>;
  holdChats?: boolean;
  holdHistory?: boolean;
}) {
  const chats = (seed.chats ?? []).map((c) => ({ ...c }));
  const history: Record<string, Msg[]> = seed.history ?? {};
  const calls: Array<{ method: string; url: string }> = [];
  const waitingChats: Waiter[] = [];
  const waitingHistory: Waiter[] = [];
  let holdChats = seed.holdChats ?? false;
  let holdHistory = seed.holdHistory ?? false;

  const listBody = () => chats.map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' }));

  const fetchMock = vi.fn((url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body) : null;
    const u = String(url);
    calls.push({ method, url: u });

    if (u.includes('/history')) {
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      if (holdHistory) {
        return new Promise((resolve, reject) => waitingHistory.push({ resolve, reject }));
      }
      return Promise.resolve(json(200, { messages: history[id] ?? [] }));
    }
    if (u.endsWith('/chats') && method === 'GET') {
      if (holdChats) {
        return new Promise((resolve, reject) => waitingChats.push({ resolve, reject }));
      }
      return Promise.resolve(json(200, listBody()));
    }
    if (u.endsWith('/chat') && method === 'POST') {
      const id = body.session_id;
      (history[id] ??= []).push({ role: 'user', content: body.message ?? '(form)' });
      (history[id] ??= []).push({ role: 'assistant', content: 'Answer for ' + id });
      return Promise.resolve(json(200, { output: 'Answer for ' + id }));
    }
    return Promise.resolve(json(404, { error: 'unrouted ' + method + ' ' + u }));
  });

  return {
    fetchMock,
    chats,
    history,
    calls,
    countCalls: (fragment: string, method = 'GET') =>
      calls.filter((c) => c.url.includes(fragment) && c.method === method).length,
    setHoldChats: (v: boolean) => {
      holdChats = v;
    },
    setHoldHistory: (v: boolean) => {
      holdHistory = v;
    },
    releaseChats: (status = 200, body?: unknown) => {
      waitingChats.splice(0).forEach((w) => w.resolve(json(status, body ?? listBody())));
    },
    failChats: () => {
      waitingChats.splice(0).forEach((w) => w.reject(new Error('network down')));
    },
    releaseHistory: (status = 200, body?: unknown) => {
      waitingHistory.splice(0).forEach((w) =>
        w.resolve(json(status, body ?? { messages: [] })),
      );
    },
    failHistory: () => {
      waitingHistory.splice(0).forEach((w) => w.reject(new Error('network down')));
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

const railText = () => document.querySelector('#james-bot .jb-side-list')?.textContent ?? '';
const skeletonRows = () => document.querySelectorAll('#james-bot .jb-skel-row');
const emptyCopy = () => document.querySelectorAll('#james-bot .jb-side-empty');
const railError = () => document.querySelectorAll('#james-bot .jb-side-error');
const railRetry = () =>
  document.querySelector<HTMLButtonElement>('#james-bot .jb-side-retry');
const chatRows = () => document.querySelectorAll('#james-bot .jb-chat-row');
const histSkeleton = () => document.querySelectorAll('#james-bot .jb-hist-skel');
const bubbleText = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-bubble')).map(
    (b) => b.textContent ?? '',
  );
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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T-P2.2 — the rail distinguishes loading / empty / error', () => {
  it('LOADING: skeletons, and NEITHER the empty copy nor an error', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }], holdChats: true });
    boot(server.fetchMock);
    await tick();

    // Precondition: the request really is outstanding, so this is the window
    // under test and not a resolved state that merely looks like one.
    expect(server.countCalls('/chats'), '/chats was never asked').toBe(1);
    expect(skeletonRows().length, 'no skeleton — nothing marks the wait').toBeGreaterThan(0);
    // THE DEFECT. This is the assertion the whole slice exists for.
    expect(emptyCopy().length, 'the rail claims "no chats" before it has asked').toBe(0);
    expect(railText()).not.toContain('No chats yet');
    expect(railError().length, 'a wait is not a failure').toBe(0);
  });

  it('EMPTY: resolves to a usable placeholder row, not to a claim about nothing', async () => {
    // WHAT "EMPTY" ACTUALLY LOOKS LIKE, and it is worth stating precisely
    // because it reframes the defect. R6b mints a placeholder the moment an
    // empty list resolves, so the rail is never empty for long and
    // .jb-side-empty does not render on this path at all.
    //
    // Which means: in the pre-fix build, EVERY on-screen appearance of "No
    // chats yet" was the false one — the loading window was the only time it
    // was ever visible. The copy is not being suppressed here, it is being
    // moved off the one path where it was always a lie.
    const server = makeServer({ chats: [], holdChats: true });
    boot(server.fetchMock);
    await tick();

    // Same widget, same instant, genuinely-empty account: no claim yet.
    expect(emptyCopy().length, 'the claim was made before the answer arrived').toBe(0);
    expect(skeletonRows().length, 'precondition: this is the loading window').toBeGreaterThan(0);

    server.releaseChats();
    await tick();

    expect(skeletonRows().length, 'skeletons outlived the request').toBe(0);
    expect(railError().length).toBe(0);
    // The honest resolution: somewhere to type, named for what it is.
    expect(chatRows().length, 'the member has no row to type into').toBe(1);
    expect(railText()).toContain('New chat');
    expect(railText()).not.toContain('No chats yet');
  });

  it('EMPTY fallback: "No chats yet" is UNREACHABLE, which is the finding', async () => {
    // Not an oversight, and worth pinning so nobody "fixes" it back.
    //
    // R6b mints a placeholder the moment an empty list resolves, and every
    // other path keeps the active chat in the rail, so the rendered row count
    // is never zero. Combined with the loading state, that means the
    // .jb-side-empty branch can no longer fire AT ALL through the UI — and in
    // the pre-fix build the loading window was the only time it ever did.
    // Every appearance of that copy a member ever saw was a false one.
    //
    // Asserted as the strongest form of the slice's claim: the copy shows in
    // NO reachable state, not merely in fewer of them.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [] },
      holdChats: true,
    });
    const seen: number[] = [];
    boot(server.fetchMock);
    const sample = async () => {
      await tick();
      seen.push(emptyCopy().length);
    };

    await sample(); // loading
    server.failChats();
    await sample(); // error
    server.setHoldChats(false);
    railRetry()!.click();
    await sample(); // retried, resolved with one chat
    server.chats.splice(0, server.chats.length); // emptied from another device
    await send('a message, so the member holds a real chat');
    await sample(); // active chat kept in the rail despite an empty server list

    expect(seen, '"No chats yet" surfaced in a reachable state').toEqual([0, 0, 0, 0]);
    // Precondition: the rail was really being rendered throughout, so the
    // zeroes above are not the silence of a widget that drew nothing.
    expect(chatRows().length, 'the rail is empty — the assertion above is vacuous').toBeGreaterThan(
      0,
    );
  });

  it('ERROR (network): says so, offers retry, and does NOT say "No chats yet"', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }], holdChats: true });
    boot(server.fetchMock);
    await tick();
    server.failChats();
    await tick();

    expect(railError().length, 'the failure is silent').toBe(1);
    expect(railRetry(), 'no way back from the failure').not.toBeNull();
    // The specific defect: a 503 and an empty account read identically.
    expect(emptyCopy().length, 'an unreachable list is reported as an empty one').toBe(0);
    expect(railText()).not.toContain('No chats yet');
    expect(skeletonRows().length, 'still pretending to load after it failed').toBe(0);
  });

  it('ERROR (503): a non-ok RESPONSE reaches the same state as a dead socket', async () => {
    // Two distinct failure modes, one honest state. A widget that only handled
    // rejection would pass the case above and fall through to the empty copy
    // on the failure the brief actually names.
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'x' }], holdChats: true });
    boot(server.fetchMock);
    await tick();
    server.releaseChats(503, { error: 'chats unavailable' });
    await tick();

    expect(railError().length).toBe(1);
    expect(emptyCopy().length).toBe(0);
    expect(railText()).not.toContain('No chats yet');
  });

  it('the three states are mutually exclusive — never two at once', async () => {
    // The partition claim itself. "shows a skeleton", "shows the empty copy"
    // and "shows an error" are independently satisfiable, and the original
    // defect was precisely two of them being true together, so at most one may
    // ever hold. Sampled through every transition rather than at one instant.
    const census = () => [skeletonRows().length > 0, emptyCopy().length > 0, railError().length > 0];
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'x' }], holdChats: true });
    boot(server.fetchMock);
    await tick();

    expect(census(), 'loading must be loading ALONE').toEqual([true, false, false]);

    server.failChats();
    await tick();
    expect(census(), 'error must be error ALONE').toEqual([false, false, true]);

    server.setHoldChats(true);
    railRetry()!.click();
    await tick();
    expect(census(), 'a retry in flight is loading ALONE — the old error must clear').toEqual([
      true,
      false,
      false,
    ]);

    server.setHoldChats(false);
    server.releaseChats();
    await tick();
    expect(census().filter(Boolean).length, 'a resolved rail shows no status affordance').toBe(0);
    // Two rows: the placeholder the failed boot gave the member, PLUS the real
    // chat the retry recovered. Pinned exactly rather than as "at least one",
    // because it is also the non-destructive guarantee — a retry that replaced
    // the rail wholesale would drop the placeholder and show 1.
    expect(chatRows().length, 'the retry discarded the placeholder').toBe(2);
  });

  it('a returning member with chats is NEVER told they have none, at any point', async () => {
    // The member-visible defect end to end, sampled across the whole window
    // rather than at one instant — a single well-timed snapshot could miss a
    // flash of the empty copy.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }, { id: CHAT_B, title: 'BRRRR numbers' }],
      holdChats: true,
    });
    const seen: string[] = [];
    boot(server.fetchMock);
    for (let i = 0; i < 5; i += 1) {
      await tick(1);
      seen.push(railText());
    }
    server.releaseChats();
    for (let i = 0; i < 5; i += 1) {
      await tick(1);
      seen.push(railText());
    }

    expect(seen.some((t) => t.includes('No chats yet')), 'the lie was told at some point').toBe(
      false,
    );
    // Precondition: the chats really did arrive, so the sweep above was not
    // just watching a widget that never rendered anything.
    expect(railText()).toContain('Deal in Tacoma');
    expect(chatRows().length).toBe(2);
  });

  it('the list carries aria-busy while loading, and drops it when done', async () => {
    // Skeletons are aria-hidden, so this is the ONLY signal a screen reader
    // gets. Without it the honest-loading fix is sighted-only.
    const server = makeServer({ chats: [], holdChats: true });
    boot(server.fetchMock);
    await tick();
    const list = document.querySelector('#james-bot .jb-side-list')!;

    expect(list.getAttribute('aria-busy')).toBe('true');

    server.releaseChats();
    await tick();
    expect(list.getAttribute('aria-busy')).toBe('false');
  });

  it('skeleton rows are inert: no text to misread, no control to click', async () => {
    const server = makeServer({ chats: [], holdChats: true });
    boot(server.fetchMock);
    await tick();

    const rows = Array.from(skeletonRows());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.textContent?.trim(), 'a skeleton is readable as content').toBe('');
      expect(row.querySelectorAll('button').length, 'a skeleton is clickable').toBe(0);
      expect(row.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('S1.3 — the rail retry', () => {
  it('re-asks /chats and repairs the rail', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }], holdChats: true });
    boot(server.fetchMock);
    await tick();
    server.failChats();
    await tick();
    expect(railError().length).toBe(1);

    server.setHoldChats(false);
    railRetry()!.click();
    await tick();

    expect(server.countCalls('/chats'), 'retry did not re-ask').toBe(2);
    expect(railError().length, 'the error survived a successful retry').toBe(0);
    expect(railText()).toContain('Deal in Tacoma');
  });

  it('a retry that fails AGAIN returns to the error state, not to "No chats yet"', async () => {
    // The path a member on a flaky connection actually takes. A retry that
    // fell through to the empty copy would reintroduce the original lie one
    // click later.
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'x' }], holdChats: true });
    boot(server.fetchMock);
    await tick();
    server.failChats();
    await tick();

    railRetry()!.click();
    await tick();
    server.failChats();
    await tick();

    expect(railError().length).toBe(1);
    expect(emptyCopy().length).toBe(0);
  });

  it('retry does NOT disturb the conversation the member is in', async () => {
    // refreshChatList exists instead of re-running bootChats precisely for
    // this: boot decides the active chat, and its empty-list branch calls
    // startPlaceholder, which would wipe the pane. Subject: the transcript
    // across a retry, not the rail.
    const server = makeServer({ chats: [], holdChats: true });
    boot(server.fetchMock);
    await tick();
    server.failChats();
    await tick();

    await send('my numbers are 350k purchase');
    const before = bubbleText();
    expect(before.some((t) => t.includes('350k purchase')), 'precondition: the send landed').toBe(
      true,
    );

    server.setHoldChats(false);
    railRetry()!.click();
    await tick();

    const after = bubbleText();
    expect(after.some((t) => t.includes('350k purchase')), 'the retry wiped the pane').toBe(true);
    expect(after.length, 'the retry reordered or dropped messages').toBe(before.length);
  });
});

describe('T-P2.1 — a skeleton never appears under a member\'s own message', () => {
  it('the transcript skeleton is torn down the moment the member sends', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();

    // PRECONDITION — without this the case passes against a widget that never
    // renders a transcript skeleton at all, which is the whole vacuity trap.
    expect(histSkeleton().length, 'no skeleton was ever shown').toBe(1);

    await send('actually, new question');

    expect(histSkeleton().length, 'a skeleton is sitting with the member\'s own message').toBe(0);
    expect(
      bubbleText().some((t) => t.includes('actually, new question')),
      'precondition: the message is really there',
    ).toBe(true);
  });

  it('and it does not come BACK when the held /history finally lands', async () => {
    // The second half of the same guarantee. Tearing the skeleton down on send
    // is worthless if the in-flight response re-paints one, or paints the old
    // transcript over the live message.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    await send('actually, new question');

    server.releaseHistory(200, { messages: [{ role: 'user', content: 'old question' }] });
    await tick();

    expect(histSkeleton().length).toBe(0);
    // The `started` guard: restored history must not reorder a live chat.
    expect(bubbleText().some((t) => t.includes('old question')), 'history painted over a live chat').toBe(
      false,
    );
    expect(bubbleText().some((t) => t.includes('actually, new question'))).toBe(true);
  });

  it('CONTROL: with no send, the skeleton IS shown and then replaced by history', async () => {
    // The case that proves the two above are about TIMING and not about a
    // skeleton that never renders. Without this control, deleting
    // showHistorySkeleton entirely would turn this whole block green.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();

    expect(histSkeleton().length, 'the skeleton never appeared').toBe(1);

    server.releaseHistory(200, { messages: [{ role: 'user', content: 'old question' }] });
    await tick();

    expect(histSkeleton().length, 'the skeleton outlived its fetch').toBe(0);
    expect(bubbleText().some((t) => t.includes('old question'))).toBe(true);
  });

  it('the skeleton is torn down when the member switches chats mid-flight', async () => {
    // op.cleanup, the same mechanism the thinking indicator uses. A skeleton
    // that survived a switch would sit in the NEW chat describing the old
    // one's fetch.
    const server = makeServer({
      chats: [
        { id: CHAT_A, title: 'Deal in Tacoma' },
        { id: CHAT_B, title: 'BRRRR numbers' },
      ],
      history: { [CHAT_A]: [], [CHAT_B]: [] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    expect(histSkeleton().length, 'precondition: a skeleton is up for chat A').toBe(1);

    const rowB = Array.from(chatRows()).find(
      (r) => (r.querySelector('.jb-chat-open')?.textContent ?? '') === 'BRRRR numbers',
    )!;
    rowB.querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
    await tick();

    // Chat B issues its own /history, which is also held — so exactly one
    // skeleton should be up: B's, not A's leftover plus B's.
    expect(histSkeleton().length, 'chat A\'s skeleton survived into chat B').toBe(1);
  });
});

describe('S1.3 — /history failure is no longer silent', () => {
  it('a 503 says so and offers a retry, instead of an empty-looking chat', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Deal in Tacoma' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    server.releaseHistory(503, { error: 'nope' });
    await tick();

    const retry = document.querySelector<HTMLButtonElement>('#james-bot .jb-retry');
    expect(retry, 'the failure is silent — indistinguishable from an empty chat').not.toBeNull();
    expect(bubbleText().some((t) => t.includes("Couldn't load"))).toBe(true);
    expect(histSkeleton().length, 'the skeleton outlived the failure').toBe(0);
  });

  it('a network rejection reaches the same state', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'x' }],
      history: { [CHAT_A]: [] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    server.failHistory();
    await tick();

    expect(document.querySelector('#james-bot .jb-retry')).not.toBeNull();
    expect(histSkeleton().length).toBe(0);
  });

  it('its Retry re-asks /history and paints the transcript', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'x' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    const asked = server.countCalls('/history');
    server.releaseHistory(503, { error: 'nope' });
    await tick();

    server.setHoldHistory(false);
    document.querySelector<HTMLButtonElement>('#james-bot .jb-retry')!.click();
    await tick();

    expect(server.countCalls('/history'), 'retry did not re-ask').toBe(asked + 1);
    expect(bubbleText().some((t) => t.includes('old question'))).toBe(true);
    expect(
      bubbleText().some((t) => t.includes("Couldn't load")),
      'the error survived a successful retry',
    ).toBe(false);
  });

  it('the error is SUPPRESSED when the member has already started typing', async () => {
    // They are having a live conversation. An error about restoring an old one
    // is noise they cannot act on, and it would land under their message.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'x' }],
      history: { [CHAT_A]: [{ role: 'user', content: 'old question' }] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    await send('new question');

    server.releaseHistory(503, { error: 'nope' });
    await tick();

    expect(
      bubbleText().some((t) => t.includes("Couldn't load")),
      'a history error landed under a live conversation',
    ).toBe(false);
    expect(bubbleText().some((t) => t.includes('new question'))).toBe(true);
  });

  it('an EMPTY transcript is still silent — absence of messages is not an error', async () => {
    // The discrimination that matters: 200-with-no-messages and 503 used to
    // share a code path. Fixing the 503 case is only correct if the empty case
    // stays quiet.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'x' }],
      history: { [CHAT_A]: [] },
      holdHistory: true,
    });
    boot(server.fetchMock);
    await tick();
    server.releaseHistory(200, { messages: [] });
    await tick();

    expect(document.querySelector('#james-bot .jb-retry'), 'an empty chat reads as broken').toBeNull();
    expect(histSkeleton().length).toBe(0);
  });
});
