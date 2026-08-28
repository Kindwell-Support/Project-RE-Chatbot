/**
 * VIEWPORT FILL — the widget owns its own box.
 *
 * THE HARNESS SPLIT, again. jsdom has NO LAYOUT: getBoundingClientRect returns
 * zeros. What it CAN answer is the arithmetic and the wiring — does the mount
 * receive a computed inline height, is a fixed one overridden, does a resize
 * recompute, does a remount recompute, does the floor hold. Because every rect
 * is zero here, `top` and `spaceBelow` are both 0, so the expected height is
 * simply innerHeight - gutter (floored).
 *
 * What jsdom CANNOT answer — centring beyond the max width, horizontal
 * overflow, the drawer's position:absolute, whether the hamburger MOVES
 * anything — is measured in real Chrome by
 * tools/qa/viewport_frame_chrome_check.mjs, which is part of `npm run
 * qa:chrome`. Do not "strengthen" the assertions below into layout claims;
 * they would pass against zeros.
 *
 * ────────────────────────────────────────────────────────────────────────
 * STRUCTURAL BLIND SPOT — READ BEFORE ADDING A TEST HERE.
 *
 * This is not a quirk of this file. jsdom implements no layout engine at all:
 * getBoundingClientRect returns zeros for every element, always. Any assertion
 * about POSITION or SIZE therefore passes here whether the behaviour exists or
 * not, and passes IDENTICALLY when the behaviour is deleted.
 *
 * Worked example, from this slice: spaceBelow() subtracts the height of
 * anything below the mount so the widget never covers it. Removing that
 * subtraction entirely changes nothing in jsdom — every rect is zero, so the
 * subtraction is always zero — and all ten tests in this file stay green. The
 * Chrome instrument catches it immediately (mount 984 instead of 684, the
 * content below pushed off screen, the page gaining a scrollbar).
 *
 * So: a geometric behaviour tested only here is UNTESTED. If what you are
 * about to assert involves a rect, a scroll position, an overflow, an
 * intersection or a computed length that depends on layout, it belongs in the
 * Chrome instrument. What belongs HERE is arithmetic and wiring — did the
 * listener fire, was the value written, did the remount recompute.
 * ────────────────────────────────────────────────────────────────────────
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

const GUTTER = 16;
const FLOOR = 420;

function loadWidget(): void {
  delete (window as any).createJamesBot;
  // eslint-disable-next-line no-new-func
  new Function(WIDGET_SRC).call(window);
}

const json = (s: number, b: unknown) => ({ ok: s < 300, status: s, json: async () => b });

function mount(inlineStyle = 'width:100%;height:700px') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      if (String(u).includes('/history')) return json(200, { messages: [] });
      if (String(u).endsWith('/chats')) return json(200, []);
      return json(404, {});
    }),
  );
  document.body.innerHTML = '<div id="james-bot" style="' + inlineStyle + '"></div>';
  loadWidget();
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const target = () => document.getElementById('james-bot') as HTMLElement;
const tick = async (n = 6) => {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function setViewportHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, writable: true, configurable: true });
}

/** The height applyFrame should compute in jsdom, where every rect is zero. */
const expected = (vh: number) => Math.max(FLOOR, vh - GUTTER) + 'px';

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  setViewportHeight(768);
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('viewport fill — the mount is sized by the widget', () => {
  it('a TALL viewport fills to the gutter', async () => {
    setViewportHeight(1100);
    mount();
    await tick();
    expect(target().style.height, 'the mount was not sized at all').not.toBe('');
    expect(target().style.height).toBe(expected(1100));
  });

  it('a SHORT viewport holds the floor rather than collapsing to a sliver', async () => {
    setViewportHeight(300);
    mount();
    await tick();
    // DEAD GUARD: 300 - 16 = 284 is genuinely below the floor, so this case
    // exercises the floor rather than merely agreeing with the arithmetic.
    expect(300 - GUTTER, 'this viewport does not reach the floor').toBeLessThan(FLOOR);
    expect(target().style.height).toBe(FLOOR + 'px');
  });

  it('a fixed inline height on the mount is OVERRIDDEN, not respected', async () => {
    setViewportHeight(1100);
    mount('width:100%;height:700px');
    await tick();
    expect(target().style.height, 'the GHL fixed height acted as a ceiling').not.toBe('700px');
    expect(target().style.height).toBe(expected(1100));
  });

  it('a fixed inline WIDTH is overridden the same way', async () => {
    mount('width:640px;height:700px');
    await tick();
    expect(target().style.width, 'a fixed inline width survived').toBe('100%');
  });

  it('resize recomputes in BOTH directions with no drift', async () => {
    setViewportHeight(1100);
    mount();
    await tick();
    const tall = target().style.height;
    expect(tall, 'nothing was set — the comparison below would be vacuous').toBe(expected(1100));

    setViewportHeight(520);
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    expect(target().style.height, 'shrinking did not recompute').toBe(expected(520));

    setViewportHeight(1100);
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    expect(target().style.height, 'growing back drifted').toBe(tall);
  });

  it('orientationchange recomputes too', async () => {
    setViewportHeight(1100);
    mount();
    await tick();
    setViewportHeight(700);
    window.dispatchEvent(new window.Event('orientationchange'));
    await tick();
    expect(target().style.height).toBe(expected(700));
  });

  it('a remount after a lesson swap recomputes, not stuck at the pre-swap value', async () => {
    setViewportHeight(1100);
    mount();
    await tick();
    const before = target().style.height;
    expect(before, 'precondition: the first mount sized the box').toBe(expected(1100));

    // GHL replaces the lesson body wholesale; the MutationObserver re-mounts.
    setViewportHeight(700);
    document.body.innerHTML = '<div id="james-bot" style="width:100%;height:700px"></div>';
    await tick(12);

    expect(target().getAttribute('data-mounted'), 'the widget did not re-mount').toBe('true');
    expect(target().style.height, 'the height was stuck at the pre-swap value').toBe(expected(700));
  });

  it('the recompute is ONE path — width and height move on the same event', async () => {
    setViewportHeight(1100);
    mount('width:640px;height:700px');
    await tick();
    expect(target().style.height).toBe(expected(1100));
    expect(target().style.width).toBe('100%');
  });

  it('SOURCE: the root no longer caps its own width', () => {
    // --jb-max-w is REMOVED. Capping the root held line length by starving the
    // widget; the measure now lives on the text column instead, in
    // font-relative units. The behavioural proof is in
    // tools/qa/fluid_scale_chrome_check.mjs — this only pins that the cap has
    // not crept back.
    expect(WIDGET_SRC).not.toMatch(/--jb-max-w:\s*calc/);
    expect(WIDGET_SRC, 'the measure token is gone').toMatch(
      /--jb-measure:calc\(var\(--jb-font-base\) \* 36\)/,
    );
  });

  it('SOURCE: no bare 100vh anywhere — mobile reports it against the wrong bar state', () => {
    expect(WIDGET_SRC).not.toMatch(/height:\s*100vh/);
    expect(WIDGET_SRC, 'the height is no longer measured from innerHeight').toContain(
      'window.innerHeight',
    );
  });
});
