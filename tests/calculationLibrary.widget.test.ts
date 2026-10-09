/**
 * The calculation library — in the browser.
 *
 * The descriptors fed to the widget are the REAL ones from formSchema.ts, so
 * the property-name field this suite drives is the one the server derives.
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

const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CALC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Summary {
  id: string;
  calculator: string;
  property_name: string;
  property_key?: string;
  chat_id: string | null;
  created_at: string;
  headline: { label: string; value: number; unit: 'usd' } | null;
}

const SUMMARY_A: Summary = {
  id: CALC_A,
  calculator: 'flip',
  property_name: 'Tacoma duplex',
  property_key: 'name:TACOMA DUPLEX',
  chat_id: CHAT,
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  headline: { label: 'Net profit', value: 101916, unit: 'usd' },
};
const SUMMARY_B: Summary = {
  id: CALC_B,
  calculator: 'brrrr',
  property_name: 'Oak St rental',
  property_key: 'name:OAK STREET RENTAL',
  chat_id: null,
  created_at: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  headline: { label: 'Cash flow / mo', value: 412, unit: 'usd' },
};

const DETAIL_A = {
  ...SUMMARY_A,
  inputs: {
    property_name: 'Tacoma duplex',
    purchase_price: 350000,
    rehab_budget: 75000,
    after_repair_value: 600000,
    holding_months: 4,
    interest_rate: 0.15,
  },
  result: {
    calculator: 'flip',
    property_name: 'Tacoma duplex',
    inputs_used: {
      purchase_price: 350000,
      rehab_budget: 75000,
      after_repair_value: 600000,
      holding_months: 4,
      interest_rate: 0.15,
      down_payment_pct: 0.2,
    },
    defaults_applied: { down_payment_pct: 0.2 },
    outputs: { total_direct_costs: 440000, est_net_profit: 101916, cash_on_cash_return: 1.008 },
    note: 'All figures are estimates for education only.',
  },
  form: CALCULATOR_FORMS.flip,
};

const CALC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DETAIL_C = {
  id: CALC_C,
  calculator: 'comps',
  property_name: '123 MAIN STREET, SEATTLE, WA 98101',
  chat_id: null,
  created_at: '2026-10-09T15:00:00.000Z',
  inputs: { property_name: '123 MAIN STREET, SEATTLE, WA 98101', requested_address: '123 Main St, Seattle WA' },
  result: {
    calculator: 'comps',
    property_name: '123 MAIN STREET, SEATTLE, WA 98101',
    pulled_at: '2026-10-09T15:00:00.000Z',
    run_id: 'run-1',
    rendered_block: '### Comparable sales\n- **4520 Alder St** — sold $575,000\n- **4433 Birch Ave** — sold $548,500',
    outputs: { comp_count: 2, median_price_per_sqft: 340 },
  },
};

interface Call {
  method: string;
  url: string;
  body: any;
}

let calls: Call[];
let library: Summary[];
let chatReplies: Array<Record<string, unknown>>;

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function boot(options: { chats?: Array<{ id: string; title: string }> } = {}) {
  const fetchMock = vi.fn((rawUrl: string, init: any = {}) => {
    const url = String(rawUrl);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    const pathname = url.replace('https://api.example.com', '');
    if (pathname.startsWith('/history')) return json(200, { messages: [] });
    if (pathname === '/chats' && method === 'GET') {
      return json(200, (options.chats ?? []).map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' })));
    }
    if (pathname.startsWith('/calculations/')) {
      const id = pathname.split('/')[2];
      if (method === 'GET') {
        if (id === CALC_A) return json(200, DETAIL_A);
        if (id === CALC_C) return json(200, DETAIL_C);
        return json(404, { error: 'Calculation not found.' });
      }
      if (method === 'PATCH') return json(200, { ...SUMMARY_A, property_name: body.property_name });
      if (method === 'DELETE') {
        library = library.filter((c) => c.id !== id);
        return Promise.resolve({ ok: true, status: 204, json: async () => null });
      }
    }
    if (pathname.startsWith('/calculations')) {
      const q = new URL(url).searchParams.get('q');
      return json(
        200,
        q ? library.filter((c) => c.property_name.toLowerCase().includes(q.toLowerCase())) : library,
      );
    }
    if (pathname === '/chat') return json(200, chatReplies.shift() ?? { output: 'ok' });
    return json(404, {});
  });
  vi.stubGlobal('fetch', fetchMock);
  delete (window as any).createJamesBot;
  // eslint-disable-next-line no-new-func
  new Function(WIDGET_SRC).call(window);
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const tick = async (ms = 10) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(`#james-bot ${sel}`);
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(`#james-bot ${sel}`));
const click = (node: Element | null) => {
  if (!node) throw new Error('nothing to click');
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
const buttonWithText = (text: string) =>
  $$<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').includes(text)) ?? null;

async function sendChat(text: string) {
  $<HTMLInputElement>('.jb-input')!.value = text;
  $<HTMLFormElement>('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
}

function fillFlip(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    $<HTMLInputElement>(`.jb-calc [name="${name}"]`)!.value = value;
  }
}

const F2 = {
  property_name: 'Tacoma duplex',
  purchase_price: '350000',
  rehab_budget: '75000',
  after_repair_value: '600000',
  holding_months: '4',
};

async function openLibrary() {
  click($('.jb-nav-lib'));
  await tick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
  calls = [];
  library = [SUMMARY_A, SUMMARY_B];
  chatReplies = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the calculator form asks for the property name', () => {
  it('renders it FIRST, as a text field with an example', async () => {
    chatReplies.push({ output: 'Fill it in.', render_form: CALCULATOR_FORMS.flip });
    boot();
    await sendChat('run a flip');
    const controls = $$<HTMLInputElement>('.jb-calc .jb-control');
    expect(controls[0].name).toBe('property_name');
    expect(controls[0].getAttribute('inputmode'), 'the name box opens a numeric keypad').toBeNull();
    expect(controls[0].getAttribute('maxlength')).toBe('120');
    expect(controls[0].placeholder).toMatch(/Main St/);
    expect(controls[0].hasAttribute('required')).toBe(true);
  });

  it('Calculate with no property name names the field and sends nothing', async () => {
    chatReplies.push({ output: 'Fill it in.', render_form: CALCULATOR_FORMS.flip });
    boot();
    await sendChat('run a flip');
    const { property_name: _skip, ...numbersOnly } = F2;
    fillFlip(numbersOnly);
    const posts = calls.filter((c) => c.method === 'POST').length;
    click(buttonWithText('Calculate'));
    await tick();
    expect($('.jb-calc-error')!.textContent).toContain('Property name');
    expect(calls.filter((c) => c.method === 'POST').length, 'a nameless form was submitted').toBe(posts);
  });

  it('submits the property name with the numbers', async () => {
    chatReplies.push({ output: 'Fill it in.', render_form: CALCULATOR_FORMS.flip });
    boot();
    await sendChat('run a flip');
    fillFlip(F2);
    click(buttonWithText('Calculate'));
    await tick();
    const submission = calls.filter((c) => c.method === 'POST').pop()!;
    expect(submission.body.form_submission.values.property_name).toBe('Tacoma duplex');
  });
});

describe('the receipt under a calculator reply', () => {
  it('shows "Saved to Calculations" from the server receipt, and View opens the entry', async () => {
    chatReplies.push({ output: 'Fill it in.', render_form: CALCULATOR_FORMS.flip });
    chatReplies.push({
      output: 'Net profit is about $101,916.',
      user_message: 'Run the Fix & Flip calculator for Tacoma duplex: ...',
      saved_calculations: [{ id: CALC_A, calculator: 'flip', property_name: 'Tacoma duplex' }],
    });
    boot();
    await sendChat('run a flip');
    fillFlip(F2);
    click(buttonWithText('Calculate'));
    await tick();
    const receipt = $('.jb-saved');
    expect(receipt, 'no receipt under the answer').not.toBeNull();
    expect(receipt!.textContent).toContain('Saved to Calculations as "Tacoma duplex"');
    click(receipt!.querySelector('.jb-saved-open'));
    await tick();
    expect(calls.some((c) => c.url.endsWith(`/calculations/${CALC_A}`))).toBe(true);
    expect($('.jb-lib-title')!.textContent).toBe('Tacoma duplex');
  });

  it('a typed calculation gets the same receipt', async () => {
    chatReplies.push({
      output: 'Here is the BRRRR.',
      saved_calculations: [{ id: CALC_B, calculator: 'brrrr', property_name: 'Oak St rental' }],
    });
    boot();
    await sendChat('BRRRR on Oak St rental: 200k, 40k rehab, 300k ARV, 2400 rent');
    expect($('.jb-saved')!.textContent).toContain('"Oak St rental"');
  });

  it('a run the library could not keep says so — never a silent "saved"', async () => {
    chatReplies.push({ output: 'Here is the flip.', library_unsaved: 1 });
    boot();
    await sendChat('flip on Tacoma duplex 350k 75k 600k 4 months');
    expect($('.jb-saved-warn')!.textContent).toMatch(/couldn't be saved/);
    expect($('.jb-saved-open'), 'an unsaved run offered a View link').toBeNull();
  });

  it('no receipt at all on an ordinary answer', async () => {
    chatReplies.push({ output: 'A BRRRR is buy, rehab, rent, refinance, repeat.' });
    boot();
    await sendChat('what is a BRRRR?');
    expect($('.jb-saved')).toBeNull();
  });
});

describe('the Calculations view', () => {
  it('is empty and inert until opened — the closed pane adds no controls', async () => {
    boot();
    await tick();
    expect($('.jb-lib')!.hasAttribute('hidden')).toBe(true);
    expect($('.jb-lib')!.children.length).toBe(0);
    expect($$('.jb-main button'), 'the conversation pane gained a control').toHaveLength(1);
  });

  it('opens over the conversation and lists one FOLDER per property', async () => {
    boot();
    await tick();
    await openLibrary();
    expect($('.jb-root')!.classList.contains('jb-lib-open')).toBe(true);
    expect($('.jb-nav-lib')!.getAttribute('aria-pressed')).toBe('true');
    const names = $$('.jb-lib-folder-name').map((n) => n.textContent);
    expect(names).toEqual(['Tacoma duplex', 'Oak St rental']);
    const firstHead = $$('.jb-lib-folder-head')[0];
    expect(firstHead.querySelector('.jb-lib-meta')!.textContent).toBe('1 run · Fix & Flip');
    // Several folders start closed; opening one shows its runs.
    expect(firstHead.getAttribute('aria-expanded')).toBe('false');
    expect($$('.jb-lib-folder-body')[0].hasAttribute('hidden')).toBe(true);
    click(firstHead);
    expect(firstHead.getAttribute('aria-expanded')).toBe('true');
    const body = $$('.jb-lib-folder-body')[0];
    expect(body.hasAttribute('hidden')).toBe(false);
    const run = body.querySelector('.jb-lib-row')!;
    expect(run.querySelector('.jb-lib-name')!.textContent, 'a run does not name its type').toBe('Fix & Flip');
    expect(run.querySelector('.jb-lib-meta')!.textContent, 'a run does not show its timestamp').toMatch(/\d{4}/);
    expect(run.querySelector('.jb-lib-fig-value')!.textContent).toBe('$101,916');
    click(firstHead);
    expect(body.hasAttribute('hidden'), 'the folder did not close again').toBe(true);
  });

  it('runs of one property group into ONE folder — calculations and comps together, every run kept', async () => {
    library = [
      { id: 'r1', calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101', property_key: 'addr:123 MAIN STREET', chat_id: null, created_at: '2026-10-10T12:00:00.000Z', headline: { label: 'Median $/sq ft', value: 340, unit: 'usd' } },
      { id: 'r2', calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101', property_key: 'addr:123 MAIN STREET', chat_id: null, created_at: '2026-10-10T11:00:00.000Z', headline: { label: 'Median $/sq ft', value: 338, unit: 'usd' } },
      { id: 'r3', calculator: 'flip', property_name: '123 Main St', property_key: 'addr:123 MAIN STREET', chat_id: null, created_at: '2026-10-09T10:00:00.000Z', headline: { label: 'Net profit', value: 50000, unit: 'usd' } },
      { id: 'r4', calculator: 'brrrr', property_name: 'Oak St rental', property_key: 'name:OAK STREET RENTAL', chat_id: null, created_at: '2026-10-08T10:00:00.000Z', headline: null },
    ];
    boot();
    await tick();
    await openLibrary();
    expect($$('.jb-lib-folder-name').map((n) => n.textContent)).toEqual([
      // Titled by the comps snapshot's resolved address, the fullest spelling.
      '123 MAIN STREET, SEATTLE, WA 98101',
      'Oak St rental',
    ]);
    const head = $$('.jb-lib-folder-head')[0];
    expect(head.querySelector('.jb-lib-meta')!.textContent).toBe('3 runs · Comps, Fix & Flip');
    click(head);
    const runs = Array.from($$('.jb-lib-folder-body')[0].querySelectorAll('.jb-lib-row'));
    expect(runs.map((r) => r.querySelector('.jb-lib-name')!.textContent), 'a comps run went missing').toEqual([
      'Comps',
      'Comps',
      'Fix & Flip',
    ]);
    // The flip was filed under a different spelling — shown, not hidden.
    expect(runs[2].querySelector('.jb-lib-meta')!.textContent).toContain('as "123 Main St"');
    expect(runs[0].querySelector('.jb-lib-meta')!.textContent).not.toContain('as "');
  });

  it('back from a run returns to the list with that run\'s folder open', async () => {
    boot();
    await tick();
    await openLibrary();
    click($$('.jb-lib-folder-head')[1]);
    click($$('.jb-lib-folder-body')[1].querySelector('.jb-lib-row'));
    await tick();
    click($('.jb-lib-back'));
    await tick();
    const heads = $$('.jb-lib-folder-head');
    expect(heads[1].getAttribute('aria-expanded')).toBe('true');
    expect(heads[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('an empty library explains how entries get there', async () => {
    library = [];
    boot();
    await tick();
    await openLibrary();
    expect($('.jb-lib-empty')!.textContent).toMatch(/Run any calculator/);
  });

  it('search queries the server by property name', async () => {
    boot();
    await tick();
    await openLibrary();
    const search = $<HTMLInputElement>('.jb-lib-search')!;
    search.value = 'oak';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick(320);
    expect(calls.some((c) => c.url.endsWith('/calculations?q=oak'))).toBe(true);
    expect($$('.jb-lib-folder-name').map((n) => n.textContent)).toEqual(['Oak St rental']);
    // A search opens what it found.
    expect($$('.jb-lib-folder-head')[0].getAttribute('aria-expanded')).toBe('true');
    expect($('.jb-lib-search'), 'the search box was rebuilt and lost the member\'s place').toBe(search);
  });

  it('the detail view shows results, inputs with defaults marked, and the disclaimer', async () => {
    boot();
    await tick();
    await openLibrary();
    click($$('.jb-lib-row')[0]);
    await tick();
    expect($('.jb-lib-title')!.textContent).toBe('Tacoma duplex');
    const strong = $('.jb-kv-strong')!;
    expect(strong.textContent).toContain('Estimated net profit');
    expect(strong.textContent).toContain('$101,916');
    const text = $('.jb-lib')!.textContent!;
    expect(text).toContain('Cash-on-cash return');
    expect(text).toContain('100.8%');
    expect(text).toContain('Purchase price');
    const downPayment = $$('.jb-kv').find((r) => r.textContent!.includes('Down payment'))!;
    expect(downPayment.querySelector('.jb-tag')!.textContent).toBe('default');
    expect(text).toContain('estimates for education only');
  });

  it('Run again opens the pre-filled form in a fresh chat', async () => {
    boot({ chats: [{ id: CHAT, title: 'Deal chat' }] });
    await tick();
    await openLibrary();
    click($$('.jb-lib-row')[0]);
    await tick();
    click(buttonWithText('Run again'));
    await tick();
    expect($('.jb-root')!.classList.contains('jb-lib-open')).toBe(false);
    expect($<HTMLInputElement>('.jb-calc [name="property_name"]')!.value).toBe('Tacoma duplex');
    expect($<HTMLInputElement>('.jb-calc [name="purchase_price"]')!.value).toBe('350000');
    // A non-default optional (interest 0.15) opens the advanced section so
    // the change is visible.
    expect($('.jb-adv-body')!.style.display).toBe('block');
    expect($('.jb-calc-sub')!.textContent).toMatch(/new entry/);
  });

  it('Open chat appears only for a chat still in the rail, and switches to it', async () => {
    boot({ chats: [{ id: CHAT, title: 'Deal chat' }] });
    await tick();
    await openLibrary();
    click($$('.jb-lib-row')[0]);
    await tick();
    const open = buttonWithText('Open chat');
    expect(open).not.toBeNull();
    click(open);
    await tick();
    expect($('.jb-root')!.classList.contains('jb-lib-open')).toBe(false);
  });

  it('rename sends the new property name', async () => {
    boot();
    await tick();
    await openLibrary();
    click($$('.jb-lib-row')[0]);
    await tick();
    click($('.jb-lib-icon[aria-label="Rename"]'));
    const field = $<HTMLInputElement>('.jb-lib-rename')!;
    field.value = '123 Main St, Tacoma';
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain(`/calculations/${CALC_A}`);
    expect(patch.body).toEqual({ property_name: '123 Main St, Tacoma' });
    expect($('.jb-lib-title')!.textContent).toBe('123 Main St, Tacoma');
  });

  it('delete asks first, then removes the entry and returns to the list', async () => {
    boot();
    await tick();
    await openLibrary();
    click($$('.jb-lib-row')[0]);
    await tick();
    click($('.jb-lib-icon[aria-label="Delete"]'));
    expect(calls.some((c) => c.method === 'DELETE'), 'deleted without asking').toBe(false);
    click($('.jb-lib-confirm .jb-chat-confirm-yes'));
    await tick(30);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/calculations/${CALC_A}`))).toBe(true);
    expect($$('.jb-lib-folder-name').map((n) => n.textContent)).toEqual(['Oak St rental']);
  });

  it('a comps snapshot shows the block as it was pulled — and cannot run again', async () => {
    library = [
      {
        id: CALC_C,
        calculator: 'comps',
        property_name: DETAIL_C.property_name,
        property_key: 'addr:123 MAIN STREET',
        chat_id: null,
        created_at: DETAIL_C.created_at,
        headline: { label: 'Median $/sq ft', value: 340, unit: 'usd' },
      },
    ];
    boot();
    await tick();
    await openLibrary();
    // A single property's folder opens without a click.
    expect($$('.jb-lib-folder-head')[0].getAttribute('aria-expanded')).toBe('true');
    const row = $$('.jb-lib-row')[0];
    expect(row.querySelector('.jb-lib-name')!.textContent).toBe('Comps');
    expect(row.querySelector('.jb-lib-fig-value')!.textContent).toBe('$340');
    click(row);
    await tick();
    expect($('.jb-lib-title')!.textContent).toBe('123 MAIN STREET, SEATTLE, WA 98101');
    expect($('.jb-lib-sub')!.textContent).toMatch(/^Comps · pulled /);
    expect($('.jb-lib-snapshot-note')!.textContent).toMatch(/not refreshed/);
    const snapshot = $('.jb-lib-snapshot')!;
    expect(snapshot.querySelector('h4')!.textContent).toBe('Comparable sales');
    expect(snapshot.textContent).toContain('4520 Alder St');
    expect(buttonWithText('Run again'), 'a snapshot offered to re-run (a paid refresh)').toBeNull();
    expect($('.jb-lib-icon[aria-label="Delete"]')).not.toBeNull();
  });

  it('the receipt names a comps snapshot as such', async () => {
    chatReplies.push({
      output: 'Here are the comps.',
      saved_calculations: [{ id: CALC_C, calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101' }],
    });
    boot();
    await sendChat('run comps on 123 Main St, Seattle WA');
    expect($('.jb-saved')!.textContent).toContain(
      'Comps snapshot saved to Calculations under "123 MAIN STREET, SEATTLE, WA 98101"',
    );
  });

  it('New chat and picking a chat both leave the library', async () => {
    boot({ chats: [{ id: CHAT, title: 'Deal chat' }] });
    await tick();
    await openLibrary();
    click($('.jb-new'));
    await tick();
    expect($('.jb-root')!.classList.contains('jb-lib-open')).toBe(false);
    expect($('.jb-lib')!.children.length, 'the closed library kept its DOM').toBe(0);

    await openLibrary();
    click($$('.jb-chat-open').find((b) => b.textContent!.includes('Deal chat'))!);
    await tick();
    expect($('.jb-root')!.classList.contains('jb-lib-open')).toBe(false);
  });
});
