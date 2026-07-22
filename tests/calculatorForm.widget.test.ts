/**
 * Inline calculator form — rendering and submission in the browser.
 *
 * The descriptor these tests feed the widget is the REAL one from
 * formSchema.ts, not a fixture. So if the derived shape and the renderer ever
 * disagree, this suite fails rather than the member seeing an empty card.
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

interface ChatReply {
  ok?: boolean;
  status?: number;
  body: Record<string, unknown>;
}

/** Mount the widget, send one message, and reply with `reply`. */
async function openChat(reply: ChatReply) {
  const posts: any[] = [];
  const fetchMock = vi.fn((url: string, init?: any) => {
    if (String(url).includes('/history')) return new Promise(() => {});
    posts.push(JSON.parse(init.body));
    // Later POSTs (form submissions) are answered by `nextReply`.
    const current = posts.length === 1 ? reply : nextReply;
    return Promise.resolve({
      ok: current.ok !== false,
      status: current.status ?? 200,
      json: async () => current.body,
    });
  });
  let nextReply: ChatReply = { body: { output: 'done' } };

  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  mountTarget();
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

  // `.jb-input` specifically: once a form is on screen, its `.jb-control`
  // fields are also input[type=text], so the generic selector is ambiguous.
  chatInput().value = 'run a flip';
  document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await new Promise((r) => setTimeout(r, 10));

  return {
    posts,
    setNextReply: (r: ChatReply) => {
      nextReply = r;
    },
  };
}

function card(): HTMLElement | null {
  return document.querySelector('#james-bot .jb-calc');
}

/** The chat text box, never a form field. */
function chatInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;
}

/** The most recent member bubble — the chat opens with earlier ones. */
function lastUserBubble(): HTMLElement {
  const bubbles = document.querySelectorAll<HTMLElement>('#james-bot .jb-user .jb-bubble');
  return bubbles[bubbles.length - 1];
}

function control(name: string): HTMLInputElement | HTMLSelectElement | null {
  return document.querySelector(`#james-bot .jb-calc [name="${name}"]`);
}

function clickText(text: string): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#james-bot button'));
  const target = buttons.find((b) => b.textContent?.includes(text));
  if (!target) throw new Error(`no button matching "${text}"`);
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

const FLIP_REPLY: ChatReply = {
  body: { output: 'Fill that in and I will run it.', render_form: CALCULATOR_FORMS.flip },
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('5.1 the form renders from the server descriptor', () => {
  it('renders a control for every required field, marked required', async () => {
    await openChat(FLIP_REPLY);
    expect(card(), 'no form card rendered').not.toBeNull();

    for (const field of CALCULATOR_FORMS.flip.required) {
      const node = control(field.name);
      expect(node, `${field.name} control missing`).not.toBeNull();
      expect(node!.hasAttribute('required')).toBe(true);
    }
    expect(card()!.textContent).toContain('Purchase price');
    expect(card()!.textContent).toContain('After-repair value (ARV)');
  });

  it('shows the unit hint so a decimal is not typed as a percent', async () => {
    await openChat(FLIP_REPLY);
    expect(card()!.textContent).toContain('($)');
    expect(card()!.textContent).toContain('(months)');
    clickText('Show advanced options');
    expect(card()!.textContent).toContain('(decimal, e.g. 0.12)');
  });

  it('collapses optional fields behind a toggle, pre-filled with the defaults', async () => {
    await openChat(FLIP_REPLY);
    const advanced = card()!.querySelector<HTMLElement>('.jb-adv-body')!;
    expect(advanced.style.display).toBe('none');

    clickText('Show advanced options');
    expect(advanced.style.display).toBe('block');
    expect((control('interest_rate') as HTMLInputElement).value).toBe('0.12');
    expect((control('annual_taxes') as HTMLInputElement).value).toBe('3000');
  });

  it('renders enum fields as selects with their options', async () => {
    await openChat(FLIP_REPLY);
    clickText('Show advanced options');
    const select = control('interest_reserve') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['Yes', 'No']);
    expect(select.value).toBe('No');
  });

  it('renders the BRRRR field set when the BRRRR form is sent', async () => {
    await openChat({ body: { output: 'ok', render_form: CALCULATOR_FORMS.brrrr } });
    expect(control('monthly_rent')).not.toBeNull();
    clickText('Show advanced options');
    const method = control('refinance_method') as HTMLSelectElement;
    expect(Array.from(method.options).map((o) => o.value)).toEqual(['LTV', 'DSCR']);
  });
});

describe('5.2 submitting the form', () => {
  it('posts form_submission and omits untouched defaults', async () => {
    const chat = await openChat(FLIP_REPLY);
    chat.setNextReply({ body: { output: 'Net profit is about $101,916.', user_message: 'Run the Fix & Flip calculator: purchase price $350,000.' } });

    (control('purchase_price') as HTMLInputElement).value = '350000';
    (control('rehab_budget') as HTMLInputElement).value = '75000';
    (control('after_repair_value') as HTMLInputElement).value = '600000';
    (control('holding_months') as HTMLInputElement).value = '4';
    clickText('Calculate');
    await new Promise((r) => setTimeout(r, 10));

    const submission = chat.posts[1];
    expect(submission.form_submission.calculator).toBe('flip');
    expect(submission.form_submission.values).toEqual({
      purchase_price: '350000',
      rehab_budget: '75000',
      after_repair_value: '600000',
      holding_months: '4',
    });
    // Untouched optionals must NOT be sent — the server applies the sheet
    // default and the answer discloses it. Echoing them back erases that.
    expect(submission.form_submission.values).not.toHaveProperty('interest_rate');
    expect(submission.form_submission.values).not.toHaveProperty('interest_reserve');
    expect(submission.message, 'form submission also sent a typed message').toBeUndefined();
  });

  it('includes an optional field once it is actually changed', async () => {
    const chat = await openChat(FLIP_REPLY);
    (control('purchase_price') as HTMLInputElement).value = '350000';
    (control('rehab_budget') as HTMLInputElement).value = '75000';
    (control('after_repair_value') as HTMLInputElement).value = '600000';
    (control('holding_months') as HTMLInputElement).value = '4';
    clickText('Show advanced options');
    (control('interest_rate') as HTMLInputElement).value = '0.15';
    (control('interest_reserve') as HTMLSelectElement).value = 'Yes';
    clickText('Calculate');
    await new Promise((r) => setTimeout(r, 10));

    expect(chat.posts[1].form_submission.values.interest_rate).toBe('0.15');
    expect(chat.posts[1].form_submission.values.interest_reserve).toBe('Yes');
  });

  it('replaces the form with the answer on success', async () => {
    const chat = await openChat(FLIP_REPLY);
    chat.setNextReply({
      body: { output: 'Net profit is about $101,916.', user_message: 'Run the Fix & Flip calculator: purchase price $350,000.' },
    });
    (control('purchase_price') as HTMLInputElement).value = '350000';
    (control('rehab_budget') as HTMLInputElement).value = '75000';
    (control('after_repair_value') as HTMLInputElement).value = '600000';
    (control('holding_months') as HTMLInputElement).value = '4';
    clickText('Calculate');
    await new Promise((r) => setTimeout(r, 10));

    expect(card(), 'form stayed up after a successful run').toBeNull();
    const text = document.querySelector('#james-bot')!.textContent!;
    expect(text).toContain('101,916');
    // The server's transcript line is echoed so a later /history replay matches.
    expect(lastUserBubble().textContent).toContain('Fix & Flip');
  });
});

describe('5.3 validation and dismissal', () => {
  it('blocks a blank required field locally and never posts', async () => {
    const chat = await openChat(FLIP_REPLY);
    (control('purchase_price') as HTMLInputElement).value = '350000';
    // ARV deliberately left blank.
    (control('rehab_budget') as HTMLInputElement).value = '75000';
    (control('holding_months') as HTMLInputElement).value = '4';
    clickText('Calculate');
    await new Promise((r) => setTimeout(r, 10));

    expect(chat.posts.length, 'an incomplete form was submitted').toBe(1);
    expect(card()!.querySelector('.jb-calc-error')!.textContent).toContain(
      'After-repair value (ARV)',
    );
    expect(control('after_repair_value')!.getAttribute('aria-invalid')).toBe('true');
    expect(card(), 'form was dismissed on a validation error').not.toBeNull();
  });

  it('shows a server 400 on the form and keeps it open to fix', async () => {
    const chat = await openChat(FLIP_REPLY);
    chat.setNextReply({
      ok: false,
      status: 400,
      body: { error: 'Please fill in: After-repair value (ARV).' },
    });
    // Pass local validation so the request actually reaches the server.
    (control('purchase_price') as HTMLInputElement).value = '350000';
    (control('rehab_budget') as HTMLInputElement).value = '75000';
    (control('after_repair_value') as HTMLInputElement).value = '600000';
    (control('holding_months') as HTMLInputElement).value = '4';
    clickText('Calculate');
    await new Promise((r) => setTimeout(r, 10));

    expect(card(), 'form vanished on a 400, leaving nothing to correct').not.toBeNull();
    expect(card()!.querySelector('.jb-calc-error')!.textContent).toContain(
      'After-repair value (ARV)',
    );
  });

  it('Cancel dismisses the form without posting', async () => {
    const chat = await openChat(FLIP_REPLY);
    clickText('Cancel');
    expect(card()).toBeNull();
    expect(chat.posts.length).toBe(1);
  });

  it('typing a message still works while a form is on screen', async () => {
    const chat = await openChat(FLIP_REPLY);
    chat.setNextReply({ body: { output: 'Net profit is about $101,916.' } });

    chatInput().value = 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months';
    document.querySelector<HTMLFormElement>('#james-bot form')!.dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 10));

    // The natural-language path is untouched: a plain `message`, no form payload.
    expect(chat.posts[1].message).toBe('Flip: 350k purchase, 75k rehab, 600k ARV, 4 months');
    expect(chat.posts[1].form_submission).toBeUndefined();
    expect(document.querySelector('#james-bot')!.textContent).toContain('101,916');
  });

  it('stores no form state in browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await openChat(FLIP_REPLY);
    (control('purchase_price') as HTMLInputElement).value = '350000';
    clickText('Show advanced options');
    // The session id is the one legitimate write; form values must never persist.
    const keys = setItem.mock.calls.map((c) => String(c[0]));
    expect(keys.filter((k) => k !== 'james-bot-session')).toEqual([]);
  });
});
