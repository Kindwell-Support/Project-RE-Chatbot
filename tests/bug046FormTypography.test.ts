/**
 * BUG-046 — the form-control defensive layer.
 *
 * FINDING-047, THE HARNESS SPLIT — do not "simplify" this into one file:
 *   jsdom  proves the CASCADE (specificity, !important, source order).
 *   Chrome proves PERCENTAGE RESOLUTION and UA form-control defaults.
 * jsdom cannot resolve `font-size: 100%` — it returns the keyword `medium` —
 * so the portal's ACTUAL rule cannot be reproduced here. The fixture below
 * therefore uses an absolute size with the REAL selector: it measures whether
 * our (0,2,0)!important beats a (0,1,1) host rule, which is the half jsdom
 * can measure. The percentage half lives in a real engine.
 *
 * THE ::placeholder CASCADE IS SEPARATE, and the guard for it is
 * LOAD-BEARING (corrected — it was first shipped described as belt-and-
 * braces). Live: control 15px, placeholder 32px — a placeholder inheriting
 * from its control cannot differ from it. The real host selector was still
 * being captured at ship time, so the guard was measured in real Chrome
 * against five plausible shapes at ascending specificity, with the portal
 * reset also present. NO-FIX reproduced the live numbers exactly
 * (root 15px / input 15px / placeholder 32px) in every row:
 *
 *   host ::placeholder rule                  no fix        with fix
 *   bare ::placeholder            (0,0,1)    ph 32px       ph 16px   HOLDS
 *   input::placeholder            (0,0,2)    ph 32px       ph 16px   HOLDS
 *   .mpr input::placeholder       (0,1,2)    ph 32px       ph 16px   HOLDS
 *   .mpr .x input::placeholder    (0,2,2)    ph 32px       ph 16px   HOLDS
 *   .mpr input::placeholder !important       ph 32px       ph 16px   HOLDS
 *
 * The claim this supports is "covers every plausible shape TESTED", not
 * "covers whatever it turns out to be". Instrument:
 * tools/qa/bug046_chrome_check.mjs.
 *
 * Two questions, neither assumed:
 *   1. Do the per-control sizes WIN over the defensive layer? Both sides are
 *      !important, so specificity must decide — not source order.
 *   2. Does the block actually BEAT a hostile host rule of the shape that
 *      caused the bug (`.editor-content input`, specificity (0,1,1))?
 * jsdom resolves the real cascade, so getComputedStyle answers both.
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

const json = (s: number, b: unknown) => ({ ok: s < 300, status: s, json: async () => b });
const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function mount(hostCss?: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      if (String(u).includes('/history')) return json(200, { messages: [] });
      if (String(u).endsWith('/chats')) {
        return json(200, [{ id: CHAT_A, title: 'Chat A', created_at: 'x', last_message_at: 'x' }]);
      }
      return json(404, {});
    }),
  );
  // The HOSTILE CONTAINER, reproduced: a descendant selector at (0,1,1),
  // exactly the shape that beat .jb-input's (0,1,0) in the live portal.
  if (hostCss) {
    const st = document.createElement('style');
    st.textContent = hostCss;
    document.head.appendChild(st);
  }
  const host = document.createElement('div');
  host.className = 'editor-content rich-text-viewer secondary-text';
  document.body.appendChild(host);
  const div = document.createElement('div');
  div.id = 'james-bot';
  host.appendChild(div);
  delete (window as any).createJamesBot;
  // eslint-disable-next-line no-new-func
  new Function(WIDGET_SRC).call(window);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const tick = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const size = (sel: string) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing ' + sel);
  return getComputedStyle(el).fontSize;
};

beforeEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

const HOSTILE = `.editor-content input, .editor-content select, .editor-content button {
  font-size: 32px; letter-spacing: 3px; text-transform: uppercase;
}
.editor-content input::placeholder { font-size: 32px; }`;

describe('BUG-046 — per-control sizes win over the defensive layer', () => {
  it('CONSTRAINT 1: the !important layer does not swallow the per-control sizes', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    // If `font: inherit !important` at (0,1,1) beat these, every control
    // would read 15px — .jb-root's size — instead of its own.
    expect(size('.jb-input'), 'composer lost its size to the layer').toBe('16px');
    expect(size('.jb-new'), 'new-chat button lost its size').toBe('12.5px');
    expect(size('.jb-chat-open'), 'rail row lost its size').toBe('12.5px');
    expect(size('.jb-side-toggle')).toBe('14px');
  });

  it('CONSTRAINT 1: same holds for the GATE input', async () => {
    mount();
    await tick();
    expect(size('.jb-gate-input')).toBe('16px');
    expect(size('.jb-gate-btn')).toBe('14px');
  });
});

describe('BUG-046 — the block beats the hostile container', () => {
  it('gate input and its placeholder resist a (0,1,1) host rule', async () => {
    mount(HOSTILE);
    await tick();
    expect(size('.jb-gate-input'), 'the host rule still wins — the fix is insufficient').toBe('16px');
    const cs = getComputedStyle(document.querySelector('.jb-gate-input')!);
    expect(cs.letterSpacing, 'host letter-spacing reached in').toBe('normal');
    expect(cs.textTransform, 'host text-transform reached in').toBe('none');
  });

  it('composer resists', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount(HOSTILE);
    await tick();
    expect(size('.jb-input')).toBe('16px');
  });

  it('CALCULATOR CONTROLS — the <select> and inputs specifically', async () => {
    // The operator's concern: select has its own UA defaults and resists font
    // inheritance in some engines. Rendered via a real form descriptor.
    window.sessionStorage.setItem('james-bot-token', 't');
    mount(HOSTILE);
    await tick();
    const list = document.querySelector('#james-bot .jb-list')!;
    const form = document.createElement('div');
    form.className = 'jb-calc jb-glass';
    form.innerHTML =
      '<input class="jb-control" type="text"><select class="jb-control"><option>a</option></select>';
    list.appendChild(form);
    expect(size('input.jb-control'), 'calculator text field lost to the host').toBe('16px');
    expect(size('select.jb-control'), 'calculator SELECT lost to the host').toBe('16px');
  });

  it('buttons across the widget resist', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount(HOSTILE);
    await tick();
    expect(size('.jb-new')).toBe('12.5px');
    expect(size('.jb-chat-open')).toBe('12.5px');
    expect(size('.jb-side-toggle')).toBe('14px');
  });

  it('CONTROL: without the widget, the hostile rule really does win 32px', async () => {
    // Proves the hostile fixture is hostile — otherwise every assertion above
    // passes against a host rule that never applied.
    const st = document.createElement('style');
    st.textContent = HOSTILE;
    document.head.appendChild(st);
    const host = document.createElement('div');
    host.className = 'editor-content rich-text-viewer';
    const bare = document.createElement('input');
    bare.className = 'jb-input'; // same class, no widget stylesheet
    host.appendChild(bare);
    document.body.appendChild(host);
    expect(getComputedStyle(bare).fontSize, 'the fixture is not hostile').toBe('32px');
  });
});
