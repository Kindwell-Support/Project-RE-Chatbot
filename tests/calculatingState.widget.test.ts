/**
 * The calculating state — Bug 2.
 *
 * The bug was a dead ~2s gap: the member clicked Calculate and nothing changed
 * until the answer arrived. So the assertions here are deliberately made
 * BEFORE the request resolves, against a fetch this harness holds open. If the
 * loading state were applied after an await, or after the response, every test
 * in 7.1 fails.
 *
 * The other half is that the state must always resolve — success, validation
 * error, network failure, or timeout. A stuck spinner is worse than the gap.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CALCULATOR_FORMS } from '../src/agent/formSchema.js';

const WIDGET_SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../widget/widget.js'),
  'utf-8',
);

interface Deferred {
  resolve: (value: { ok?: boolean; status?: number; body: unknown }) => void;
  reject: (err: Error) => void;
}

/**
 * Mount the widget, get the flip form on screen, and hand back a handle that
 * holds the NEXT request open until the test decides how it ends.
 */
async function openFormWithHeldRequest(options: { reducedMotion?: boolean } = {}) {
  if (options.reducedMotion) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: /prefers-reduced-motion/.test(query),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      })),
    );
  }

  const posts: any[] = [];
  const pending: Deferred[] = [];
  let firstAnswered = false;

  const fetchMock = vi.fn((url: string, init?: any) => {
    if (String(url).includes('/history')) return new Promise(() => {});
    posts.push(JSON.parse(init.body));

    // The first POST is the "run a flip" turn that puts the form on screen; it
    // resolves immediately so the test starts from a rendered form.
    if (!firstAnswered) {
      firstAnswered = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          output: 'Fill that in and I will run it.',
          render_form: CALCULATOR_FORMS.flip,
        }),
      });
    }

    // Every later POST (the form submission) is held open.
    return new Promise((resolve, reject) => {
      pending.push({
        resolve: (value) =>
          resolve({
            ok: value.ok !== false,
            status: value.status ?? 200,
            json: async () => value.body,
          }),
        reject,
      });
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  delete (window as any).createJamesBot;
  new Function(WIDGET_SRC).call(window);

  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

  chatInput().value = 'run a flip';
  document
    .querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();

  // A complete, valid deal so local validation never short-circuits the submit.
  fill('purchase_price', '350000');
  fill('rehab_budget', '75000');
  fill('after_repair_value', '600000');
  fill('holding_months', '4');

  return { posts, pending };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function chatInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;
}

function card(): HTMLElement | null {
  return document.querySelector('#james-bot .jb-calc');
}

function control(name: string): HTMLInputElement | HTMLSelectElement {
  return document.querySelector(`#james-bot .jb-calc [name="${name}"]`)!;
}

function fill(name: string, value: string): void {
  (control(name) as HTMLInputElement).value = value;
}

function calculateButton(): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#james-bot .jb-calc button'));
  // Matched by class, not label — the label becomes "Calculating…" mid-run.
  return buttons.find((b) => b.classList.contains('jb-btn'))!;
}

function cancelButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#james-bot .jb-calc .jb-calc-cancel')!;
}

function pendingCard(): HTMLElement | null {
  return document.querySelector('#james-bot [data-pending="true"]');
}

function clickCalculate(): void {
  calculateButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function errorText(): string {
  return card()?.querySelector('.jb-calc-error')?.textContent ?? '';
}

const ANSWER = {
  body: { output: 'Net profit is about $101,916.', user_message: 'Run the Fix & Flip calculator.' },
};

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  // Phase 3 S4 (announced re-point, uniform across widget suites): the
  // widget now gates on a session token before ANY chat UI. Seeding one
  // keeps each suite's original subject - chat behaviour - unchanged;
  // the gate's own behaviour is pinned in phase3Widget.test.ts.
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// 7.1 The click is acknowledged with zero delay
// ---------------------------------------------------------------------------

describe('7.1 clicking Calculate shows the loading state before the result resolves', () => {
  it('disables the button and relabels it, synchronously on click', async () => {
    const chat = await openFormWithHeldRequest();
    expect(calculateButton().disabled).toBe(false);
    expect(calculateButton().textContent).toContain('Calculate');

    clickCalculate();

    // No await between the click and these assertions: the state must already
    // be applied in the same synchronous turn the member clicked in.
    expect(calculateButton().disabled).toBe(true);
    expect(calculateButton().getAttribute('aria-busy')).toBe('true');
    expect(calculateButton().textContent).toContain('Calculating…');
    // And the request really is still open — this is a genuine mid-flight check.
    expect(chat.pending.length).toBe(1);
  });

  it('stands a calculating placeholder where the result will appear', async () => {
    await openFormWithHeldRequest();
    expect(pendingCard()).toBeNull();

    clickCalculate();

    const placeholder = pendingCard();
    expect(placeholder, 'no calculating indicator was shown').not.toBeNull();
    expect(placeholder!.textContent).toContain('Calculating…');
    expect(placeholder!.getAttribute('role')).toBe('status');
    // A skeleton of the result card, lead figure first.
    expect(placeholder!.querySelectorAll('.jb-bar').length).toBe(3);
    expect(placeholder!.querySelector('.jb-bar-lead')).not.toBeNull();
  });

  it('reuses the app’s own thinking treatment rather than a bolted-on spinner', async () => {
    await openFormWithHeldRequest();
    const root = document.querySelector('#james-bot .jb-root')!;
    expect(root.classList.contains('jb-busy')).toBe(false);

    clickCalculate();

    // jb-busy is the existing state that warms and quickens the ambient orbs —
    // the same one the typed-message thinking indicator turns on.
    expect(root.classList.contains('jb-busy')).toBe(true);
    // And the same amber dot motif the thinking bubble uses.
    expect(pendingCard()!.querySelector('.jb-think-dots')).not.toBeNull();
    expect(pendingCard()!.classList.contains('jb-glass')).toBe(true);
  });

  it('locks the inputs while the run is in flight', async () => {
    await openFormWithHeldRequest();
    clickCalculate();

    expect((control('purchase_price') as HTMLInputElement).disabled).toBe(true);
    expect(cancelButton().disabled).toBe(true);
    expect(card()!.getAttribute('data-busy')).toBe('true');
  });

  it('transitions the result in and clears the placeholder when the answer lands', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    expect(pendingCard()).not.toBeNull();

    chat.pending[0].resolve(ANSWER);
    await tick();

    expect(pendingCard(), 'the placeholder outlived the result').toBeNull();
    expect(document.querySelector('#james-bot .jb-root')!.classList.contains('jb-busy')).toBe(false);
    expect(card(), 'the form stayed up after a successful run').toBeNull();
    const text = document.querySelector('#james-bot')!.textContent!;
    expect(text).toContain('101,916');
    // The existing entry animation carries the result card in.
    const rows = document.querySelectorAll('#james-bot .jb-row');
    expect(rows[rows.length - 1].className).toContain('jb-row');
  });
});

// ---------------------------------------------------------------------------
// 7.2 Click-once
// ---------------------------------------------------------------------------

describe('7.2 the button is click-once', () => {
  it('a rapid double-click fires exactly one calculation', async () => {
    const chat = await openFormWithHeldRequest();

    clickCalculate();
    clickCalculate();

    const submissions = chat.posts.filter((p) => p.form_submission);
    expect(submissions.length, 'a double-click ran the calculator twice').toBe(1);
    expect(chat.pending.length).toBe(1);
  });

  it('a burst of five clicks still fires one', async () => {
    const chat = await openFormWithHeldRequest();
    for (let i = 0; i < 5; i++) clickCalculate();
    expect(chat.posts.filter((p) => p.form_submission).length).toBe(1);
  });

  it('Cancel mid-flight cannot strand a running calculation', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    cancelButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // The card stays until the run resolves, so the result has somewhere to go.
    expect(card()).not.toBeNull();
    chat.pending[0].resolve(ANSWER);
    await tick();
    expect(document.querySelector('#james-bot')!.textContent).toContain('101,916');
  });

  it('re-enabling after an error allows a genuine second attempt', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    chat.pending[0].reject(new Error('network down'));
    await tick();

    expect(calculateButton().disabled).toBe(false);
    clickCalculate();
    expect(chat.posts.filter((p) => p.form_submission).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7.3 Every failure resolves the spinner
// ---------------------------------------------------------------------------

describe('7.3 an error resolves the loading state instead of spinning forever', () => {
  it('a network failure shows a specific message and re-enables the form', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    expect(calculateButton().disabled).toBe(true);

    chat.pending[0].reject(new Error('Failed to fetch'));
    await tick();

    expect(pendingCard(), 'the spinner survived the error').toBeNull();
    expect(errorText()).toContain("Couldn't reach the calculator");
    expect(calculateButton().disabled).toBe(false);
    expect(calculateButton().hasAttribute('aria-busy')).toBe(false);
    expect(calculateButton().textContent).toContain('Calculate');
    expect((control('purchase_price') as HTMLInputElement).disabled).toBe(false);
    expect(cancelButton().disabled).toBe(false);
    expect(card(), 'the form vanished, leaving nothing to retry').not.toBeNull();
  });

  it('a 5xx shows a specific message and re-enables the form', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    chat.pending[0].resolve({ ok: false, status: 502, body: { error: 'upstream' } });
    await tick();

    expect(pendingCard()).toBeNull();
    expect(errorText()).toContain("Couldn't reach the calculator");
    expect(calculateButton().disabled).toBe(false);
  });

  it('a 400 validation error lands on the form, still fixable', async () => {
    const chat = await openFormWithHeldRequest();
    clickCalculate();
    chat.pending[0].resolve({
      ok: false,
      status: 400,
      body: { error: 'Please fill in: After-repair value (ARV).' },
    });
    await tick();

    expect(pendingCard()).toBeNull();
    expect(errorText()).toContain('After-repair value (ARV)');
    expect(calculateButton().disabled).toBe(false);
    expect((control('after_repair_value') as HTMLInputElement).disabled).toBe(false);
  });

  it('a hung request times out rather than spinning indefinitely', async () => {
    const chat = await openFormWithHeldRequest();
    vi.useFakeTimers();
    clickCalculate();
    expect(calculateButton().disabled).toBe(true);

    // Never resolved — exactly the hang the timeout exists for.
    vi.advanceTimersByTime(90_001);

    expect(pendingCard(), 'the placeholder spun past the timeout').toBeNull();
    expect(errorText()).toContain('took too long');
    expect(calculateButton().disabled).toBe(false);
    expect(chat.pending.length).toBe(1);
  });

  it('a late response after a timeout does not double-render', async () => {
    const chat = await openFormWithHeldRequest();
    vi.useFakeTimers();
    clickCalculate();
    vi.advanceTimersByTime(90_001);
    vi.useRealTimers();

    chat.pending[0].resolve(ANSWER);
    await tick();

    expect(document.querySelector('#james-bot')!.textContent).not.toContain('101,916');
    expect(card(), 'the form was dismissed by a response that had already timed out').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7.4 prefers-reduced-motion
// ---------------------------------------------------------------------------

describe('7.4 reduced motion gets feedback without movement', () => {
  it('shows a static "Calculating…" state, no spinner and no animated dots', async () => {
    await openFormWithHeldRequest({ reducedMotion: true });
    clickCalculate();

    // Still fully acknowledged...
    expect(calculateButton().disabled).toBe(true);
    expect(calculateButton().textContent).toContain('Calculating…');
    expect(pendingCard(), 'reduced motion lost the feedback entirely').not.toBeNull();
    expect(pendingCard()!.textContent).toContain('Calculating…');

    // ...but nothing that spins or pulses is built at all.
    expect(calculateButton().querySelector('.jb-spin')).toBeNull();
    expect(pendingCard()!.querySelector('.jb-think-dots')).toBeNull();
  });

  it('the reduced-motion rules disable the skeleton sweep and the spinner', () => {
    const css = document.getElementById('james-bot-styles')?.textContent ?? WIDGET_SRC;
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'));
    expect(block).toContain('.jb-bar::after,.jb-spin{animation:none!important;}');
  });

  it('the motion path does build the spinner, so 7.4 is a real difference', async () => {
    await openFormWithHeldRequest();
    clickCalculate();
    expect(calculateButton().querySelector('.jb-spin')).not.toBeNull();
  });
});
