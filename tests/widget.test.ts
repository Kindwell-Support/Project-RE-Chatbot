/**
 * Widget tests — I5 and I6 from the test spec.
 *
 * These did not exist before this pass. Both encode specific past failures:
 *   I5 — the old build gated the input box on a history/session fetch, so when
 *        that fetch hung, members got a chat window with no way to type.
 *   I6 — GHL is a SPA that swaps lesson bodies without a reload, so mounting
 *        must be idempotent or the widget stacks up duplicates.
 *
 * Environment: jsdom, declared by the pragma below. The widget is vanilla JS
 * with no build step, so it is loaded and executed as source.
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

/** Evaluate the widget IIFE in the current jsdom window, exposing createJamesBot. */
function loadWidget(): void {
  delete (window as any).createJamesBot;
  // eslint-disable-next-line no-new-func
  new Function(WIDGET_SRC).call(window);
}

function mountTarget(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  return div;
}

/** The input box is the thing members must be able to type into. */
function inputBox(): HTMLInputElement | null {
  return document.querySelector('#james-bot input[type="text"]');
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('I5: the input box renders without waiting on any network call', () => {
  it('renders immediately when fetch REJECTS', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('history fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    expect(inputBox(), 'no input box rendered').not.toBeNull();
    expect(inputBox()!.disabled).toBe(false);
  });

  it('renders immediately when fetch HANGS FOREVER (the old build hung here)', async () => {
    // A promise that never settles. If mounting awaited any network call, the
    // input box would never appear — exactly the old failure.
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    // SYNCHRONOUS check: createJamesBot has returned and nothing has been
    // awaited, so a hanging history fetch cannot have blocked any of this.
    expect(inputBox(), 'input box gated on a hanging fetch').not.toBeNull();
    expect(inputBox()!.disabled).toBe(false);
    expect(document.querySelector('#james-bot button[type="submit"]')).not.toBeNull();

    // Still fully usable while that fetch hangs forever.
    await new Promise((r) => setTimeout(r, 20));
    expect(inputBox()!.disabled, 'hanging fetch disabled the input').toBe(false);
    const input = inputBox()!;
    input.value = 'typed while the network hangs';
    expect(input.value).toBe('typed while the network hangs');

    // NOTE: this deliberately no longer asserts "fetch was never called".
    // The widget now restores prior turns via GET /history AFTER rendering, so
    // a call does happen — but it is fire-and-forget. The property that matters
    // (and that the old build violated) is that rendering and input never WAIT
    // on the network, which is what the synchronous assertions above pin. The
    // ordering is asserted directly in the test below.
  });

  it('renders the UI BEFORE any network call is issued (ordering, not just outcome)', () => {
    const order: string[] = [];
    const fetchMock = vi.fn(() => {
      // At the moment the first request goes out, the UI must already exist.
      order.push(inputBox() ? 'fetch-after-render' : 'fetch-before-render');
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    expect(fetchMock, 'history was never requested').toHaveBeenCalled();
    expect(order, 'a network call was issued before the input box existed').toEqual([
      'fetch-after-render',
    ]);
  });

  it('renders the send button and the opening message locally, with no network reply', () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const button = document.querySelector('#james-bot button[type="submit"]');
    expect(button).not.toBeNull();
    expect(button!.textContent).toMatch(/send/i);

    // Every fetch is pending — nothing has replied. The greeting below is
    // therefore local copy, not server content. (The widget does issue a
    // fire-and-forget /history request after rendering; it cannot have
    // contributed anything here because it never resolves.)
    expect(fetchMock.mock.results.every((r) => r.type === 'return')).toBe(true);

    // The greeting and the disclaimer are STATIC widget copy — deterministic by
    // construction, no model involved. The numbered menu was deliberately
    // removed (it duplicated the chip row and read like a phone tree); what
    // must survive is the greeting, a hint that the calculators exist, and the
    // disclaimer landing BEFORE anyone types deal numbers.
    const text = document.querySelector('#james-bot')!.textContent ?? '';
    expect(text).toContain("I'm James");
    expect(text.toLowerCase()).toContain('flip');
    expect(text.toLowerCase()).toContain('brrrr');
    expect(text.toLowerCase()).toContain('land');
    expect(text).toMatch(/education and estimates only, not financial or investment advice/);
  });

  it('the opening screen is plain: no numbered menu, no chip row', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const text = document.querySelector('#james-bot')!.textContent ?? '';
    expect(text, 'the numbered menu is back').not.toMatch(/^\s*1\.\s/m);
    expect(text).not.toContain('2. Flip');
    expect(document.querySelectorAll('#james-bot .jb-chip'), 'chip row is back').toHaveLength(0);
    // Exactly one bubble on first load, and one input row. Nothing else.
    expect(document.querySelectorAll('#james-bot .jb-bubble')).toHaveLength(1);
    expect(document.querySelectorAll('#james-bot button')).toHaveLength(1); // Send only
  });

  it('the input accepts typed text while the network is down', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const input = inputBox()!;
    input.value = 'Flip: 350k purchase';
    expect(input.value).toBe('Flip: 350k purchase');
  });
});

describe('I6: the data-mounted guard survives SPA remounting', () => {
  // NOTE: counting input boxes after a double-mount does NOT test the guard.
  // mount() does `target.innerHTML = ''` first, so a re-mount renders exactly
  // one input box with or without the guard — that assertion passes even with
  // the guard deleted (verified by mutation). What the guard actually protects
  // is conversation state: re-mounting blows away the member's chat history.
  // These tests assert that instead.
  it('a second createJamesBot call does not wipe the existing conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: 'Net profit is about $101,916.' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    const target = mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    // Hold a real conversation.
    const input = inputBox()!;
    input.value = 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(target.textContent).toContain('101,916');

    // GHL re-runs the loader on the same, still-mounted div.
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    expect(target.textContent, 'remount wiped the conversation').toContain('101,916');
    expect(target.textContent, 'remount lost the user message').toContain('350k purchase');
    expect(document.querySelectorAll('#james-bot input[type="text"]')).toHaveLength(1);
  });

  it('a second mount does not re-render (guard short-circuits before innerHTML wipe)', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    loadWidget();
    const target = mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    // Identity check: the guard means the original nodes are untouched, not
    // replaced by fresh equivalents.
    const firstInput = inputBox();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
    expect(inputBox(), 'widget was torn down and rebuilt on remount').toBe(firstInput);
    expect(document.querySelectorAll('#james-bot input[type="text"]')).toHaveLength(1);
  });

  it('the guard is the data-mounted attribute, and it is set on mount', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    loadWidget();
    const target = mountTarget();
    expect(target.getAttribute('data-mounted')).toBeNull();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
    expect(target.getAttribute('data-mounted')).toBe('true');
  });

  it('a fresh target div (GHL lesson swap) re-mounts exactly one widget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
    expect(document.querySelectorAll('#james-bot input[type="text"]')).toHaveLength(1);

    // GHL swaps the lesson body: the old node is replaced by a fresh one with
    // no data-mounted attribute. The MutationObserver should re-mount it.
    document.body.innerHTML = '';
    const fresh = mountTarget();

    // MutationObserver callbacks are microtask-scheduled in jsdom.
    await new Promise((r) => setTimeout(r, 20));

    expect(fresh.getAttribute('data-mounted'), 'observer did not re-mount').toBe('true');
    expect(
      document.querySelectorAll('#james-bot input[type="text"]'),
      'lesson swap produced duplicate or zero widgets',
    ).toHaveLength(1);
  });
});

describe('markdown rendering (the model replies in markdown)', () => {
  /** Mount, then push one bot reply through the real fetch path. */
  async function botSays(markdown: string): Promise<HTMLElement> {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) return new Promise(() => {});
      return Promise.resolve({ ok: true, json: async () => ({ output: markdown }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    inputBox()!.value = 'go';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const bubbles = document.querySelectorAll<HTMLElement>('#james-bot .jb-bot .jb-bubble');
    return bubbles[bubbles.length - 1];
  }

  it('renders **bold** as <strong>, not literal asterisks (the visible bug)', async () => {
    const bubble = await botSays('- **Cash Left in Deal**: -$7,890');
    expect(bubble.querySelector('strong')?.textContent).toBe('Cash Left in Deal');
    expect(bubble.textContent, 'asterisks leaked to the member').not.toContain('**');
    expect(bubble.textContent).toContain('Cash Left in Deal');
    expect(bubble.textContent).toContain('-$7,890');
  });

  it('renders "- " bullets as a real list', async () => {
    const bubble = await botSays('- Net Profit: $101,916\n- Cash Out: $101,104');
    const items = bubble.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Net Profit: $101,916');
    expect(bubble.textContent).not.toMatch(/^- /m);
  });

  it('renders ### headings and `code`', async () => {
    const bubble = await botSays('### 5-Year Projection\nUse `brrrr_calculator`.');
    expect(bubble.querySelector('h4')?.textContent).toBe('5-Year Projection');
    expect(bubble.querySelector('code')?.textContent).toBe('brrrr_calculator');
    expect(bubble.textContent).not.toContain('###');
    expect(bubble.textContent).not.toContain('`');
  });

  it('keeps numbered menu lines literal (members type the number to choose)', async () => {
    const bubble = await botSays('1. BRRRR\n2. Flip');
    expect(bubble.textContent).toContain('1. BRRRR');
    expect(bubble.textContent).toContain('2. Flip');
    expect(bubble.querySelector('ol'), 'numbers became <ol> markers').toBeNull();
  });

  it('does not mangle snake_case or dollar figures', async () => {
    const bubble = await botSays('Ran flip_calculator: $101,916 net at 100.8%.');
    expect(bubble.textContent).toContain('flip_calculator');
    expect(bubble.querySelector('em'), 'underscores were parsed as italics').toBeNull();
    expect(bubble.textContent).toContain('$101,916');
  });

  it('SECURITY: markup in model output is escaped, never executed', async () => {
    const bubble = await botSays('<img src=x onerror="window.__pwned=1"> <script>alert(1)</script>');
    expect(bubble.querySelector('img'), 'model output injected a live element').toBeNull();
    expect(bubble.querySelector('script')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();
    expect(bubble.textContent).toContain('<img');
  });

  it('SECURITY: member input is never parsed as markup', async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    inputBox()!.value = '<b>hi</b> **not bold**';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    const userBubble = document.querySelector<HTMLElement>('#james-bot .jb-user .jb-bubble')!;
    expect(userBubble.querySelector('b')).toBeNull();
    expect(userBubble.textContent).toBe('<b>hi</b> **not bold**');
  });
});

describe('history restore (memory is server-side; repaint what the bot remembers)', () => {
  function mountWithHistory(messages: Array<{ role: string; content: string }>) {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) {
        return Promise.resolve({ ok: true, json: async () => ({ messages }) });
      }
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
    return fetchMock;
  }

  it('requests /history for the stored session id', () => {
    const fetchMock = mountWithHistory([]);
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/history'));
    expect(call, '/history was never requested').toBeDefined();
    expect(String(call![0])).toMatch(/\/history\?session_id=.+/);
  });

  it('repaints prior turns, with markdown, after mount', async () => {
    mountWithHistory([
      { role: 'user', content: 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months' },
      { role: 'assistant', content: '- **Estimated Net Profit**: $101,916' },
    ]);
    await new Promise((r) => setTimeout(r, 20));

    const text = document.querySelector('#james-bot')!.textContent ?? '';
    expect(text).toContain('350k purchase');
    expect(text).toContain('$101,916');
    expect(text).not.toContain('**');
    expect(document.querySelector('#james-bot .jb-user .jb-bubble')?.textContent).toBe(
      'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
    );
  });

  it('an empty history leaves the opening message alone', async () => {
    mountWithHistory([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('#james-bot')!.textContent).toContain("I'm James");
    expect(document.querySelectorAll('#james-bot .jb-bubble')).toHaveLength(1);
  });

  it('a FAILING history fetch is silent — no error shown, input still works', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) return Promise.reject(new Error('down'));
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
    await new Promise((r) => setTimeout(r, 20));

    const text = (document.querySelector('#james-bot')!.textContent ?? '').toLowerCase();
    expect(text, 'a history failure was shown to the member').not.toMatch(/hiccup|error|failed/);
    expect(inputBox()!.disabled).toBe(false);
  });

  it('does not reorder the chat if the member typed before history arrived', async () => {
    let resolveHistory: (v: any) => void = () => {};
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) {
        return new Promise((resolve) => {
          resolveHistory = resolve;
        });
      }
      return new Promise(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    // Member gets in first.
    inputBox()!.value = 'my new question';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    // ...then the slow history lands.
    resolveHistory({ ok: true, json: async () => ({ messages: [{ role: 'user', content: 'STALE TURN' }] }) });
    await new Promise((r) => setTimeout(r, 20));

    expect(
      document.querySelector('#james-bot')!.textContent,
      'late history was pasted under the live conversation',
    ).not.toContain('STALE TURN');
    expect(document.querySelector('#james-bot .jb-user .jb-bubble')?.textContent).toBe(
      'my new question',
    );
  });
});

describe('widget wiring', () => {
  it('POSTs to {apiUrl}/chat with message, session_id and member_email', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) return new Promise(() => {});
      return Promise.resolve({
        ok: true,
        json: async () => ({ output: 'Net profit is about $101,916.' }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({
      apiUrl: 'https://api.example.com',
      target: '#james-bot',
      memberEmail: 'member@example.com',
    });

    const input = inputBox()!;
    input.value = 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );

    await new Promise((r) => setTimeout(r, 10));

    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/chat'));
    expect(chatCall, '/chat was never called').toBeDefined();
    const [url, init] = chatCall as unknown as [string, any];
    expect(url).toBe('https://api.example.com/chat');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.message).toBe('Flip: 350k purchase, 75k rehab, 600k ARV, 4 months');
    expect(body.member_email).toBe('member@example.com');
    expect(body.session_id).toBeTruthy();

    // The reply is rendered.
    expect(document.querySelector('#james-bot')!.textContent).toContain('101,916');
  });

  it('a failed send shows a recoverable message, not a dead widget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const input = inputBox()!;
    input.value = 'hello';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('#james-bot')!.textContent?.toLowerCase()).toMatch(
      /hiccup|again|try/,
    );
    // The input must still work afterwards.
    expect(inputBox()!.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('#james-bot button[type="submit"]')!.disabled).toBe(
      false,
    );
  });

  it('a failed send offers Retry, which re-sends without duplicating the question', async () => {
    let attempt = 0;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) return new Promise(() => {});
      attempt++;
      if (attempt === 1) return Promise.reject(new Error('network down'));
      return Promise.resolve({ ok: true, json: async () => ({ output: 'Back online.' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    inputBox()!.value = 'Flip: 350k purchase';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));

    const retry = document.querySelector<HTMLButtonElement>('#james-bot .jb-retry');
    expect(retry, 'no retry affordance on failure').not.toBeNull();
    retry!.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector('#james-bot')!.textContent).toContain('Back online.');
    // The member's question is echoed once, not twice.
    const userBubbles = document.querySelectorAll('#james-bot .jb-user .jb-bubble');
    expect(userBubbles).toHaveLength(1);
    // ...and the error bubble is gone.
    expect(document.querySelector('#james-bot .jb-retry')).toBeNull();
  });

  it('the send button is disabled while a reply is in flight', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/history')) return new Promise(() => {});
      return new Promise(() => {}); // /chat never resolves
    });
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const button = document.querySelector<HTMLButtonElement>('#james-bot button[type="submit"]')!;
    expect(button.disabled).toBe(false);
    inputBox()!.value = 'hello';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    expect(button.disabled, 'double-send was possible').toBe(true);
  });

  it('accessibility: the transcript is a live region and controls are labelled', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    loadWidget();
    mountTarget();
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const log = document.querySelector('#james-bot .jb-list')!;
    expect(log.getAttribute('role')).toBe('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(inputBox()!.getAttribute('aria-label')).toBe('Message James');
  });
});
