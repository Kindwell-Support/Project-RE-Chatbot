/**
 * The comps line in the welcome, and the input horizontal padding.
 *
 * TWO CONTRACTS, kept apart on purpose:
 *
 * 1. THE OPENING MESSAGE IS TEST-PINNED. Existing suites require "I'm James",
 *    the flip/BRRRR/land calculator mentions and the education-and-estimates
 *    disclaimer. Those live in tests/widget.test.ts and are not restated here
 *    as the primary guard — this file pins what the ADDITION could plausibly
 *    break: that every pinned fragment survived, that the disclaimer is still
 *    the CLOSING line, and that the welcome is still one bubble rather than
 *    having sprouted a second.
 *
 * 2. PADDING HAS A DEFENSIVE TIER NOW. Before this change the BUG-046 block
 *    re-asserted font-size only. The host rule was captured as
 *    `{font-size:100%}` — but that capture was chasing font-size, and the
 *    normalize resets it belongs to conventionally zero PADDING in the same
 *    declaration. That could NOT be confirmed: the rule ships in a member-only
 *    bundle, absent from both public portal stylesheets. So padding is
 *    asserted at (0,2,0)!important, where it holds whether or not the host
 *    resets it, and the jsdom cascade below is what proves it holds.
 *
 * jsdom proves the CASCADE. It cannot do LAYOUT, so "the text never slides
 * under the send button at narrow widths" is not answerable here — that is
 * measured in real Chrome by tools/qa/input_padding_chrome_check.mjs.
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
const bubbleText = () =>
  Array.from(document.querySelectorAll('#james-bot .jb-bubble')).map((b) => b.textContent ?? '');
const pad = (sel: string) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('missing ' + sel);
  const cs = getComputedStyle(el);
  return { left: cs.paddingLeft, right: cs.paddingRight, top: cs.paddingTop };
};

beforeEach(() => {
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('welcome copy — the comps line lands without disturbing the pinned contract', () => {
  it('states the comps capability, and names the address requirement the tool actually has', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    const text = bubbleText().join('\n');
    // run_comps requires a full street address including city and state. Copy
    // promising less would produce failed lookups a member cannot diagnose.
    expect(text.toLowerCase()).toContain('comparable sales');
    expect(text).toContain('ARV');
    expect(text.toLowerCase()).toContain('full street address');
  });

  it('every PINNED fragment survived the addition', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    const text = bubbleText().join('\n');
    expect(text, 'the greeting anchor').toContain("I'm James");
    expect(text.toLowerCase(), 'flip mention').toContain('flip');
    expect(text.toLowerCase(), 'BRRRR mention').toContain('brrrr');
    expect(text.toLowerCase(), 'land mention').toContain('land');
    expect(text, 'the disclaimer').toMatch(
      /education and estimates only, not financial or investment advice/,
    );
  });

  it('the disclaimer is still the CLOSING line — the comps line did not displace it', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    const text = (bubbleText()[0] ?? '').trim();
    expect(text.length, 'nothing rendered — the assertion below would be vacuous').toBeGreaterThan(
      0,
    );
    expect(
      text.endsWith('Always verify your own numbers before acting on a deal.'),
      'the disclaimer must land LAST, after any capability copy',
    ).toBe(true);
  });

  it('SOURCE-LEVEL: the disclaimer is the last non-empty entry of OPENING_MESSAGE', () => {
    const start = WIDGET_SRC.indexOf('var OPENING_MESSAGE = [');
    expect(start, 'OPENING_MESSAGE not found').toBeGreaterThan(-1);
    const end = WIDGET_SRC.indexOf('].join(', start);
    const entries = WIDGET_SRC.slice(start, end)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith("'") || l.startsWith('"'))
      .filter((l) => l !== "'',");
    expect(entries.length, 'no entries parsed — the assertion below would be vacuous').toBeGreaterThan(2);
    expect(entries[entries.length - 1]).toContain('education and estimates only');
  });

  it('still ONE bubble — the addition did not split the welcome', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    expect(bubbleText()).toHaveLength(1);
  });

  it('the addition did not reintroduce a numbered menu', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    expect(bubbleText().join('\n')).not.toMatch(/^\s*1\.\s/m);
  });
});

describe('input padding — matched, and defended at (0,2,0)', () => {
  it('the composer carries the new horizontal padding', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount();
    await tick();
    const composer = pad('.jb-input');
    expect(composer.left).toBe('18px');
    expect(composer.right).toBe('18px');
  });

  it('the GATE input padding rides the knob, declared', () => {
    // The gate controls moved onto --jb-ctl-pad-*, which resolves to exactly
    // the old 11px/18px at base 16 and scales from there. jsdom returns '0'
    // for calc(var(...)), so this is asserted on the DECLARATION; the resolved
    // pixels are checked in tools/qa/type_scale_chrome_check.mjs.
    expect(WIDGET_SRC).toMatch(
      /'\.jb-gate-input\{[^']*padding:var\(--jb-ctl-pad-y\) var\(--jb-ctl-pad-x\);/,
    );
    expect(WIDGET_SRC).toMatch(
      /'\.jb-root \.jb-gate-input\{padding:var\(--jb-ctl-pad-y\) var\(--jb-ctl-pad-x\) !important;\}'/,
    );
  });

  it('DEFENCE: a host rule zeroing padding at (0,1,1) does NOT win', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    // The shape of the reset that caused BUG-046, carrying the property this
    // change is about. Without the (0,2,0) tier the padding would read 0px
    // here and the fix would be invisible in the portal.
    mount(`.editor-content input, .editor-content select, .editor-content textarea {
      padding: 0;
    }`);
    await tick();
    expect(pad('.jb-input').left, 'host reset beat the composer padding').toBe('18px');
  });

  it('DEFENCE: same for the gate input', async () => {
    // The gate input's padding is a token now, which jsdom cannot resolve, so
    // the DEFENDED-ness is asserted on the declaration: the tier must carry an
    // !important padding for this control or the host reset takes it. The
    // resolved value under a hostile sheet is measured in Chrome.
    expect(WIDGET_SRC, 'the gate input lost its tier padding').toMatch(
      /'\.jb-root \.jb-gate-input\{padding:[^']*!important;\}'/,
    );
  });

  it('DEFENCE holds even when the host rule is itself !important', async () => {
    window.sessionStorage.setItem('james-bot-token', 't');
    mount('.editor-content input { padding: 0 !important; }');
    await tick();
    // Both sides !important, so SPECIFICITY decides: (0,2,0) over (0,1,1).
    expect(pad('.jb-input').left).toBe('18px');
  });

  it('CONTROL: without the defensive tier the host reset WOULD win', async () => {
    // Guards the test above from passing for the wrong reason. A bare control
    // input, same hostile sheet, no .jb-root ancestry: it must lose. If this
    // ever reads 18px the harness is not measuring the cascade at all.
    window.sessionStorage.setItem('james-bot-token', 't');
    mount('.editor-content input { padding: 0; }');
    await tick();
    const bare = document.createElement('input');
    bare.style.padding = '';
    document.querySelector('.editor-content')!.appendChild(bare);
    expect(getComputedStyle(bare).paddingLeft, 'the hostile sheet is not being applied').toBe('0px');
  });

  it('NO DIVERGENCE: the base rule and the defensive tier declare the same value', () => {
    const base = WIDGET_SRC.match(/'\.jb-input\{[^']*padding:(\d+px \d+px);/);
    const guard = WIDGET_SRC.match(/'\.jb-root \.jb-input\{padding:(\d+px \d+px) !important;\}'/);
    expect(base, 'base .jb-input padding not found').not.toBeNull();
    expect(guard, 'defensive .jb-input padding not found').not.toBeNull();
    expect(
      guard![1],
      'the two tiers DRIFTED — the portal would get one value and /demo the other',
    ).toBe(base![1]);

    // Token pair now, not px — but the guard is the same question: do the two
    // tiers declare the SAME thing, or would the portal get one value and
    // /demo the other.
    const gBase = WIDGET_SRC.match(/'\.jb-gate-input\{[^']*padding:(var\([^)]*\) var\([^)]*\));/);
    const gGuard = WIDGET_SRC.match(
      /'\.jb-root \.jb-gate-input\{padding:(var\([^)]*\) var\([^)]*\)) !important;\}'/,
    );
    expect(gBase, 'base .jb-gate-input padding not found').not.toBeNull();
    expect(gGuard, 'defensive .jb-gate-input padding not found').not.toBeNull();
    expect(gGuard![1], 'gate tiers DRIFTED').toBe(gBase![1]);
  });

  it('composer and gate still resolve to the SAME horizontal padding at base 16', () => {
    // They no longer MATCH IN SOURCE — the composer is still the 12px/18px
    // literal while the gate rides --jb-ctl-pad-*, which is
    // calc(base * 1.125) = exactly 18px at base 16. So the two agree at the
    // old base and diverge as the knob turns, which is deliberate: the gate
    // was moved onto the knob and the composer has not been yet. Pinning the
    // ARITHMETIC keeps that honest — if the ratio is ever retuned, this fails
    // and someone has to decide about the composer too.
    const h = (re: RegExp) => WIDGET_SRC.match(re)?.[1];
    const composer = h(/'\.jb-input\{[^']*padding:\d+px (\d+)px;/);
    const ratio = h(/--jb-ctl-pad-x:calc\(var\(--jb-font-base\) \* ([\d.]+)\)/);
    expect(composer, 'composer horizontal not parsed').toBeTruthy();
    expect(ratio, 'the ctl padding ratio not parsed').toBeTruthy();
    expect(Number(ratio) * 16, 'gate and composer disagree at base 16').toBe(Number(composer));
  });
});
