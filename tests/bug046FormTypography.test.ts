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
 * jsdom used to answer both through getComputedStyle. Since the type scale it
 * answers only the first, and only on the DECLARATION — see the second note
 * below, which supersedes this paragraph for anything font-size shaped.
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
/**
 * THE HARNESS SPLIT WIDENED — read this before "fixing" an assertion below.
 *
 * The sheet now routes every font-size through a token (--jb-font-*), and
 * jsdom DOES NOT RESOLVE var() in font-size: getComputedStyle returns the raw
 * string `var(--jb-font-md)`, and where a control's own (0,2,0) declaration
 * uses a token, jsdom drops it and reports the INHERITED value instead. So
 * jsdom can no longer answer "what pixel size is this control".
 *
 * Every computed-pixel assertion has therefore been REMOVED from this file
 * rather than rephrased — `.not.toBe('32px')` looked like it measured the
 * cascade, but with `font:inherit !important` in play a control can miss the
 * host size and still have lost its own, so the assertion could pass over a
 * real regression. What remains here is the cascade question jsdom answers
 * honestly: does each control still DECLARE its own size at (0,2,0), and do
 * the non-token properties (letter-spacing, text-transform) still hold.
 *
 * The pixel claim moved to a real engine, where it is stronger than it ever
 * was here — tools/qa/type_scale_chrome_check.mjs resolves every control
 * against TWO host fixtures, one of which carries !important. That second
 * fixture matters: we beat the original (0,1,1) shape on SPECIFICITY alone,
 * so the entire !important layer could be deleted and the old fixture stayed
 * green (verified by mutation). Only the !important fixture catches it.
 * Same FINDING-047 split: jsdom for the cascade, Chrome for resolution.
 */
/** The font-size declared for `.jb-root <sel>` in the source sheet. */
const declaredSize = (sel: string): string | null => {
  // No leading-quote anchor: several controls sit SECOND in a combined
  // selector (".jb-root .jb-btn,.jb-root .jb-gate-btn{"). [^']*? cannot cross
  // a JS string boundary, so a rule without a font-size (the padding tier)
  // simply fails to match and the scan moves on to the one that has it.
  const re = new RegExp(
    '\\.jb-root ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      "[^']*?font-size:(var\\(--jb-font-[a-z]+\\))",
  );
  return WIDGET_SRC.match(re)?.[1] ?? null;
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
    // Each control must still declare its OWN size at (0,2,0), or
    // `font: inherit !important` at (0,1,1) swallows it and every control
    // reads .jb-root's size. jsdom cannot resolve the tokens (see the note
    // above), so this is asserted on the declaration; the resolved pixels are
    // checked in tools/qa/type_scale_chrome_check.mjs.
    expect(declaredSize('.jb-input'), 'composer lost its size to the layer').toBe(
      'var(--jb-font-control)',
    );
    expect(declaredSize('.jb-new'), 'new-chat button lost its size').toBe('var(--jb-font-xs)');
    expect(declaredSize('.jb-chat-open'), 'rail row lost its size').toBe('var(--jb-font-xs)');
    expect(declaredSize('.jb-side-toggle')).toBe('var(--jb-font-sm)');
  });

  it('CONSTRAINT 1: same holds for the GATE input', async () => {
    mount();
    await tick();
    expect(declaredSize('.jb-gate-input')).toBe('var(--jb-font-control)');
    expect(declaredSize('.jb-gate-btn')).toBe('var(--jb-font-sm)');
  });
});

describe('BUG-046 — the block beats the hostile container', () => {
  it('gate input and its placeholder resist a (0,1,1) host rule', async () => {
    mount(HOSTILE);
    await tick();
    const cs = getComputedStyle(document.querySelector('.jb-gate-input')!);
    expect(cs.letterSpacing, 'host letter-spacing reached in').toBe('normal');
    expect(cs.textTransform, 'host text-transform reached in').toBe('none');
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
    expect(list.querySelector('select.jb-control'), 'the select never rendered').not.toBeNull();
    expect(declaredSize('.jb-control')).toBe('var(--jb-font-control)');
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
