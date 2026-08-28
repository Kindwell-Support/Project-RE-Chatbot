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
  window.sessionStorage.clear();
  // Phase 3 S4 (announced re-point, uniform across widget suites): the
  // widget now gates on a session token before ANY chat UI. Seeding one
  // keeps each suite's original subject - chat behaviour - unchanged;
  // the gate's own behaviour is pinned in phase3Widget.test.ts.
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
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
    // Token now: calc(base * 0.5556) is exactly 10px at base 18, so the tier
    // still decrams by the same amount at the anchor and scales from there.
    expect(declOf('.jb-root.jb-w-mid .jb-form', 'padding')).toBe(
      'calc(var(--jb-font-base) * 0.5556)',
    );
    // Touch target: 40px at base 18, floored at the 44px minimum.
    expect(declOf('.jb-root.jb-w-mid .jb-send', 'width')).toBe(
      'max(44px, calc(var(--jb-font-base) * 2.2222))',
    );
    // And narrows the rail, which is where the conversation's width goes.
    // Now a token: the rail holds type, so its width rides --jb-font-base like
    // the padding does. calc(base * 11.5) is exactly 184px at base 16, so the
    // tier still narrows by the same amount it always did at the old base.
    expect(declOf('.jb-root.jb-w-mid .jb-side', 'width')).toBe('var(--jb-rail-w-mid)');
  });

  it('S4.1: the floor — min-width 300px on the root itself', () => {
    boot();
    expect(declOf('.jb-root', 'min-width'), 'the widget will squeeze below the floor').toBe(
      '300px',
    );
  });

  it('the consolidated 520/360 tweaks landed in narrow/tight', () => {
    boot();
    // Now a token: the narrow-mode header is one step down from --jb-font-xl.
    expect(declOf('.jb-root.jb-w-narrow .jb-head', 'font-size')).toBe('var(--jb-font-lg)');
    // The send button is a TOUCH TARGET: calc(base * 2.3333) is 42px at base
    // 18, but it is floored at the 44px accessibility minimum so a small
    // base cannot shrink it below a usable tap area.
    expect(declOf('.jb-root.jb-w-tight .jb-send', 'width')).toBe(
      'max(44px, calc(var(--jb-font-base) * 2.3333))',
    );
  });
});

// ---------------------------------------------------------------------------
// S4.2 — the drawer. Booted at a narrow width via the same stubbed observer.
// ---------------------------------------------------------------------------

function bootWithChats(chats: Array<{ id: string; title: string | null }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: any) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (String(u).includes('/history')) return json(200, { messages: [] });
      if (String(u).endsWith('/chats') && method === 'GET') {
        return json(200, chats.map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' })));
      }
      if (String(u).endsWith('/chat')) return json(200, { output: 'ok' });
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

const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const toggle = () => document.querySelector<HTMLButtonElement>('#james-bot .jb-side-toggle')!;
const scrim = () => document.querySelector<HTMLElement>('#james-bot .jb-scrim')!;
const side = () => document.querySelector<HTMLElement>('#james-bot .jb-side')!;
const drawerOpen = () => root().classList.contains('jb-drawer-open');

async function bootNarrowWithTwoChats() {
  bootWithChats([
    { id: CHAT_A, title: 'Chat A' },
    { id: CHAT_B, title: 'Chat B' },
  ]);
  await tick();
  setWidth(500);
}

describe('T-P2.5 — the overlay rail dismisses on scrim tap, outside click, and Escape', () => {
  it('opens via the header toggle, closed by default on entering narrow', async () => {
    await bootNarrowWithTwoChats();

    expect(drawerOpen(), 'the drawer opened itself on entering narrow').toBe(false);
    expect(side().getAttribute('aria-hidden')).toBe('true');

    toggle().click();

    expect(drawerOpen()).toBe(true);
    expect(side().getAttribute('aria-hidden')).toBe('false');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('scrim tap closes', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();
    expect(drawerOpen(), 'precondition').toBe(true);

    scrim().click();

    expect(drawerOpen(), 'the scrim did nothing').toBe(false);
  });

  it('a click OUTSIDE the drawer closes it — including outside the widget', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();
    expect(drawerOpen(), 'precondition').toBe(true);

    // The host page, not the widget: the capture listener on document.
    document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(drawerOpen(), 'a host-page click left the drawer standing').toBe(false);
  });

  it('a click INSIDE the drawer does NOT close it', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();

    side().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    expect(drawerOpen(), 'clicking the drawer itself dismissed it').toBe(true);
  });

  it('Escape closes', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();

    root().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(drawerOpen(), 'Escape did nothing').toBe(false);
  });

  it("Escape that CANCELS A RENAME does not also yank the drawer away", async () => {
    // The rename input preventDefaults its Escape; the drawer handler defers
    // to defaultPrevented. One keypress, one cancellation.
    await bootNarrowWithTwoChats();
    toggle().click();
    document
      .querySelector<HTMLButtonElement>('#james-bot [aria-label="Rename chat"]')!
      .click();
    await tick();
    const field = document.querySelector<HTMLInputElement>('#james-bot .jb-chat-rename-input')!;
    expect(field, 'precondition: a rename is open').not.toBeNull();

    field.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await tick();

    expect(
      document.querySelector('#james-bot .jb-chat-rename-input'),
      'the rename did not cancel',
    ).toBeNull();
    expect(drawerOpen(), 'one Escape closed two things').toBe(true);
  });

  it('leaving the narrow tier drops the drawer class; re-entering starts closed', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();
    expect(drawerOpen(), 'precondition').toBe(true);

    setWidth(800);
    expect(drawerOpen(), 'the drawer class survived into the wide layout').toBe(false);

    setWidth(500);
    expect(drawerOpen(), 're-entering narrow reopened a drawer nobody asked for').toBe(false);
  });

  it('the toggle at narrow does NOT write the collapse preference', async () => {
    // Drawer state is transient; a reload must open on the conversation. The
    // persisted key belongs to the wide-layout collapse alone.
    await bootNarrowWithTwoChats();
    window.localStorage.removeItem('james-bot-sidebar-collapsed');

    toggle().click();
    toggle().click();

    expect(
      window.localStorage.getItem('james-bot-sidebar-collapsed'),
      'the drawer persisted itself',
    ).toBeNull();
  });
});

describe('T-P2.6 — the drawer joins resetChatState', () => {
  it('picking a chat from the open drawer closes it (the reset does it)', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();
    expect(drawerOpen(), 'precondition').toBe(true);

    document
      .querySelector<HTMLElement>(`#james-bot .jb-chat-row[data-chat-id="${CHAT_B}"]`)!
      .querySelector<HTMLButtonElement>('.jb-chat-open')!
      .click();
    await tick();

    expect(drawerOpen(), 'the drawer covered the chat the member just picked').toBe(false);
  });

  it('"+ New chat" closes it the same way', async () => {
    await bootNarrowWithTwoChats();
    toggle().click();

    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();

    expect(drawerOpen()).toBe(false);
  });

  it('the scroll lock is DERIVED: same class carries drawer, scrim and lock', async () => {
    // Per-rule (BUG-026 discipline): the lock rule is keyed on the drawer
    // class, and the scrim's visibility on drawer AND narrow — so neither can
    // exist without the state that justifies it.
    await bootNarrowWithTwoChats();
    expect(declOf('.jb-root.jb-drawer-open .jb-list', 'overflow')).toBe('hidden');
    expect(declOf('.jb-root.jb-w-narrow.jb-drawer-open .jb-scrim', 'display')).toBe('block');
    // And the scrim is inert outside the drawer state.
    expect(declOf('.jb-scrim', 'display')).toBe('none');
  });
});

describe('Q4 — pointer-aware focus, one rule for both switch paths', () => {
  function stubPointer(coarse: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: /hover:\s*none|pointer:\s*coarse/.test(q) ? coarse : false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  }

  it('fine pointer: switching AND new-chat both refocus the composer', async () => {
    stubPointer(false);
    await bootNarrowWithTwoChats();
    (document.activeElement as HTMLElement | null)?.blur?.();

    document
      .querySelector<HTMLElement>(`#james-bot .jb-chat-row[data-chat-id="${CHAT_B}"]`)!
      .querySelector<HTMLButtonElement>('.jb-chat-open')!
      .click();
    await tick();
    expect(document.activeElement?.className).toContain('jb-input');

    (document.activeElement as HTMLElement).blur();
    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();
    expect(document.activeElement?.className).toContain('jb-input');
  });

  it('coarse pointer: NEITHER path refocuses — no keyboard over the pane', async () => {
    stubPointer(true);
    await bootNarrowWithTwoChats();
    (document.activeElement as HTMLElement | null)?.blur?.();

    document
      .querySelector<HTMLElement>(`#james-bot .jb-chat-row[data-chat-id="${CHAT_B}"]`)!
      .querySelector<HTMLButtonElement>('.jb-chat-open')!
      .click();
    await tick();
    expect(
      document.activeElement?.className ?? '',
      'switching popped the keyboard over the conversation',
    ).not.toContain('jb-input');

    document.querySelector<HTMLButtonElement>('#james-bot .jb-new')!.click();
    await tick();
    expect(document.activeElement?.className ?? '', 'new-chat popped the keyboard').not.toContain(
      'jb-input',
    );
  });
});

