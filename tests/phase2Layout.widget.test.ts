/**
 * Phase 2, Slice 4 substrate — CONTAINER-KEYED breakpoints and the floor.
 *
 * THE FINDING THAT CHANGED THE BRIEF: every old breakpoint was a viewport
 * @media query, but the widget lives in a GHL lesson COLUMN. A 500px column in
 * a 1400px viewport fires no viewport query — the rail stayed inline at 216px
 * and the conversation got ~284px, exactly the cramming the 560px query
 * existed to prevent — and /demo renders full-width, so the class was
 * invisible on the review surface. Width classes now come from the root's own
 * measured width.
 *
 * jsdom cannot lay out, so these tests drive the mechanism the way the browser
 * does: a stubbed ResizeObserver captures the widget's callback, clientWidth
 * is defined per case, and the callback is invoked. The CSS side is asserted
 * PER RULE (the BUG-026 discipline — resolve the rule, then its selector),
 * never by sheet-wide search.
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

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Captures the widget's ResizeObserver callback so tests can fire it. */
let observed: { callback: (() => void) | null; targets: Element[] } = {
  callback: null,
  targets: [],
};

class FakeResizeObserver {
  constructor(cb: () => void) {
    observed.callback = cb;
  }
  observe(el: Element) {
    observed.targets.push(el);
  }
  disconnect() {}
}

function boot() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      if (String(u).includes('/history')) return json(200, { messages: [] });
      if (String(u).endsWith('/chats')) return json(200, []);
      return json(404, {});
    }),
  );
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

const root = () => document.querySelector<HTMLElement>('#james-bot .jb-root')!;

function setWidth(w: number) {
  Object.defineProperty(root(), 'clientWidth', { value: w, configurable: true });
  observed.callback!();
}

const widthClasses = () =>
  ['jb-w-mid', 'jb-w-narrow', 'jb-w-tight'].filter((c) => root().classList.contains(c));

// --- per-rule stylesheet resolution (BUG-026 discipline) -------------------

function sheetRules(): CSSRule[] {
  const style = document.getElementById('james-bot-styles') as HTMLStyleElement | null;
  if (!style || !style.sheet) throw new Error('the widget stylesheet was never injected');
  return Array.from(style.sheet.cssRules);
}

/** The style rules whose selector list contains `selector` exactly. */
function rulesFor(selector: string): CSSStyleRule[] {
  return sheetRules()
    .filter((r): r is CSSStyleRule => !!(r as CSSStyleRule).selectorText)
    .filter((r) =>
      r.selectorText
        .split(',')
        .map((s) => s.trim())
        .includes(selector),
    );
}

function declOf(selector: string, prop: string): string | null {
  let value: string | null = null;
  for (const rule of rulesFor(selector)) {
    const got = rule.style.getPropertyValue(prop);
    if (got) value = got.trim();
  }
  return value;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
  observed = { callback: null, targets: [] };
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S4.1 — width classes from the CONTAINER, not the viewport', () => {
  it('the widget observes its OWN root', () => {
    boot();
    expect(observed.callback, 'no ResizeObserver was installed').not.toBeNull();
    expect(observed.targets, 'the observer watches something other than the root').toContain(
      root(),
    );
  });

  it('threshold sweep: 800 none, 700 mid, 560 mid+narrow, 400 all', () => {
    boot();
    setWidth(800);
    expect(widthClasses()).toEqual([]);
    setWidth(700);
    expect(widthClasses()).toEqual(['jb-w-mid']);
    setWidth(560);
    expect(widthClasses()).toEqual(['jb-w-mid', 'jb-w-narrow']);
    setWidth(400);
    expect(widthClasses()).toEqual(['jb-w-mid', 'jb-w-narrow', 'jb-w-tight']);
  });

  it('boundaries are inclusive at the tier and exclusive one pixel above', () => {
    boot();
    setWidth(701);
    expect(widthClasses()).toEqual([]);
    setWidth(561);
    expect(widthClasses()).toEqual(['jb-w-mid']);
    setWidth(401);
    expect(widthClasses()).toEqual(['jb-w-mid', 'jb-w-narrow']);
  });

  it('widening back up REMOVES classes — the toggle is not one-way', () => {
    boot();
    setWidth(400);
    expect(widthClasses()).toHaveLength(3);
    setWidth(800);
    expect(widthClasses(), 'the widget stayed narrow after the column widened').toEqual([]);
  });

  it('a zero measurement keeps the LAST classes — display:none must not reshape the widget', () => {
    // A hidden ancestor measures 0. Applying tiers for 0 would put a wide
    // widget into tight mode every time the host hides and reshows it.
    boot();
    setWidth(560);
    expect(widthClasses()).toEqual(['jb-w-mid', 'jb-w-narrow']);
    setWidth(0);
    expect(widthClasses(), 'a hidden widget lost its measured tier').toEqual([
      'jb-w-mid',
      'jb-w-narrow',
    ]);
  });

  it('FALLBACK: without ResizeObserver, window resize drives the same classes', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        if (String(u).includes('/history')) return json(200, { messages: [] });
        if (String(u).endsWith('/chats')) return json(200, []);
        return json(404, {});
      }),
    );
    vi.stubGlobal('ResizeObserver', undefined);
    loadWidget();
    const div = document.createElement('div');
    div.id = 'james-bot';
    document.body.appendChild(div);
    (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });

    Object.defineProperty(root(), 'clientWidth', { value: 420, configurable: true });
    window.dispatchEvent(new window.Event('resize'));

    expect(widthClasses()).toEqual(['jb-w-mid', 'jb-w-narrow']);
  });
});

describe('S4.1 — the tier CSS is keyed to the classes, per rule', () => {
  it('the overlay rail rule lives under .jb-root.jb-w-narrow .jb-side', () => {
    boot();
    // The rule, not the population: resolve the selector that positions the
    // rail absolutely and require it to be the narrow-keyed one.
    expect(declOf('.jb-root.jb-w-narrow .jb-side', 'position')).toBe('absolute');
    // And the UNKEYED rail is NOT absolute — the overlay must not leak into
    // wide layouts.
    expect(declOf('.jb-side', 'position')).not.toBe('absolute');
  });

  it('NO width @media queries remain — the tiers moved wholesale, not partially', () => {
    // A leftover viewport tier would mean two systems deciding layout, and
    // the drift between them is invisible on full-width /demo. Coarse-pointer
    // queries are exempt: pointer is a device property, not a width.
    boot();
    const widthMedia = sheetRules()
      .map((r) => String((r as CSSMediaRule).conditionText ?? ''))
      .filter((c) => /max-width|min-width/.test(c));
    expect(widthMedia, `width media queries survived the migration: ${widthMedia}`).toEqual([]);
  });

  it('S4.3: the mid tier decrams the composer', () => {
    boot();
    expect(declOf('.jb-root.jb-w-mid .jb-form', 'padding')).toBe('10px');
    expect(declOf('.jb-root.jb-w-mid .jb-send', 'width')).toBe('40px');
    // And narrows the rail, which is where the conversation's width goes.
    expect(declOf('.jb-root.jb-w-mid .jb-side', 'width')).toBe('184px');
  });

  it('S4.1: the floor — min-width 300px on the root itself', () => {
    boot();
    expect(declOf('.jb-root', 'min-width'), 'the widget will squeeze below the floor').toBe(
      '300px',
    );
  });

  it('the consolidated 520/360 tweaks landed in narrow/tight', () => {
    boot();
    expect(declOf('.jb-root.jb-w-narrow .jb-head', 'font-size')).toBe('18px');
    expect(declOf('.jb-root.jb-w-tight .jb-send', 'width')).toBe('42px');
  });
});
