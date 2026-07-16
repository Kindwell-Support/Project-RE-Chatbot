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

    expect(inputBox(), 'input box gated on a hanging fetch').not.toBeNull();
    expect(inputBox()!.disabled).toBe(false);

    // Stronger: the widget must not have called fetch at all during mount.
    // Rendering is purely local.
    expect(fetchMock, 'mount performed a network call').not.toHaveBeenCalled();
  });

  it('renders the send button and the opening message locally, with no network', () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    loadWidget();
    mountTarget();

    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    const button = document.querySelector('#james-bot button[type="submit"]');
    expect(button).not.toBeNull();
    expect(button!.textContent).toMatch(/send/i);

    // The greeting + full numbered menu + disclaimer is STATIC widget copy
    // (client's spec) — deterministic by construction, no model involved.
    // This replaced the flaky model-side A1: a model at temp 0.3 sometimes
    // paraphrased the menu away; static copy cannot.
    const text = document.querySelector('#james-bot')!.textContent ?? '';
    expect(text).toContain("I'm James");
    expect(text).toContain('1. BRRRR');
    expect(text).toContain('2. Flip');
    expect(text).toContain('3. Land Acquisition');
    expect(text).toContain('4. Partnership Agreements (coming soon)');
    expect(text).toContain('5. Construction');
    expect(text).toContain('6. Material Allowance');
    expect(text).toMatch(/education and estimates only, not financial or investment advice/);
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('widget wiring', () => {
  it('POSTs to {apiUrl}/chat with message, session_id and member_email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: 'Net profit is about $101,916.' }),
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
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
  });
});
