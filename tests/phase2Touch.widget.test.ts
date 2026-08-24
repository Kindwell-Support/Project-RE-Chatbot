/**
 * Phase 2, Slice 2 — TOUCH.
 *
 * T-P2.3 (rename and delete reachable under a coarse pointer) and the in-widget
 * delete confirmation that replaced window.confirm, plus R-4's deliberate pin
 * of the second .jb-main button.
 *
 * THE DEFECT: .jb-chat-act was opacity:0, revealed only on :hover or
 * :focus-within. On a phone there is no hover, and a tap on the row SWITCHES
 * chat rather than focusing it — so rename and delete were not merely awkward,
 * they were unreachable. Fixing that made a destructive control permanently
 * visible one tap from the row you tap to switch, which is why the two-step
 * lands in the same slice: the media query alone would have made the widget
 * worse.
 *
 * The touch cases assert against the PARSED STYLESHEET, not the source text. A
 * grep for 'pointer: coarse' would pass against a rule that set the wrong
 * property, on the wrong selector, or that was never injected at all.
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

const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeServer(opts: {
  chats?: Array<{ id: string; title: string | null }>;
  historyStatus?: number;
  history?: Record<string, Array<{ role: string; content: string }>>;
} = {}) {
  const chats = (opts.chats ?? []).map((c) => ({ ...c }));
  const calls: Array<{ method: string; url: string }> = [];
  const fetchMock = vi.fn((url: string, init?: any) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const u = String(url);
    calls.push({ method, url: u });
    if (u.includes('/history')) {
      const status = opts.historyStatus ?? 200;
      const id = decodeURIComponent(u.split('session_id=')[1] ?? '');
      if (status !== 200) return Promise.resolve(json(status, { error: 'nope' }));
      return Promise.resolve(json(200, { messages: opts.history?.[id] ?? [] }));
    }
    if (u.endsWith('/chats') && method === 'GET') {
      return Promise.resolve(
        json(200, chats.map((c) => ({ ...c, created_at: 'x', last_message_at: 'x' }))),
      );
    }
    if (u.includes('/chats/') && method === 'DELETE') {
      const i = chats.findIndex((c) => c.id === u.split('/chats/')[1]);
      if (i !== -1) chats.splice(i, 1);
      return Promise.resolve({ ok: true, status: 204, json: async () => null });
    }
    if (u.endsWith('/chat') && method === 'POST') {
      return Promise.resolve(json(200, { output: 'ok' }));
    }
    return Promise.resolve(json(404, {}));
  });
  return { fetchMock, chats, calls };
}

const tick = async (times = 6) => {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function boot(fetchMock: any) {
  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as any).createJamesBot({ apiUrl: 'https://api.example.com', target: '#james-bot' });
}

// --- stylesheet inspection ------------------------------------------------
//
// Reads the sheet the widget actually INJECTED and resolves what a given
// selector's declaration would be, first among top-level rules and then among
// rules guarded by a coarse-pointer media query. That is the cascade the fix
// depends on, so it is what gets measured.

const COARSE = /hover:\s*none|pointer:\s*coarse/;

function sheetRules(): CSSRule[] {
  const style = document.getElementById('james-bot-styles') as HTMLStyleElement | null;
  if (!style || !style.sheet) throw new Error('the widget stylesheet was never injected');
  return Array.from(style.sheet.cssRules);
}

function declFor(selector: string, prop: string, opts: { coarse: boolean }): string | null {
  let value: string | null = null;
  const visit = (rules: CSSRule[]) => {
    for (const rule of rules) {
      const media = rule as CSSMediaRule;
      if (media.cssRules && media.conditionText !== undefined) {
        if (COARSE.test(String(media.conditionText))) {
          if (opts.coarse) visit(Array.from(media.cssRules));
        }
        continue;
      }
      const style = rule as CSSStyleRule;
      if (!style.selectorText) continue;
      const hit = style.selectorText
        .split(',')
        .map((s) => s.trim())
        .includes(selector);
      if (!hit) continue;
      const got = style.style.getPropertyValue(prop);
      if (got) value = got.trim(); // later rules win, as in the cascade
    }
  };
  visit(sheetRules());
  return value;
}

/**
 * BUG-026: the media queries whose BODY contains a rule for `selector`.
 *
 * This is the quantifier fix. The condition assertion used to run
 * `.some(both-terms)` across EVERY coarse media query in the sheet — which
 * measures the population, not the rule. With two coarse queries in the sheet
 * (the .jb-chat-act reveal and the confirm-button padding), weakening ONLY the
 * reveal's query to `(hover: none)` stayed green because the OTHER query still
 * satisfied the .some(). Proven by INSPECTOR's paired mutation. Wrong-subject
 * instance nine: an assertion quantified over a POPULATION when the claim is
 * about a SPECIFIC MEMBER.
 *
 * Resolving the query THROUGH the rule it contains makes the subject the rule.
 */
function mediaQueriesContaining(selector: string): CSSMediaRule[] {
  return sheetRules().filter((rule): rule is CSSMediaRule => {
    const media = rule as CSSMediaRule;
    if (!media.cssRules || media.conditionText === undefined) return false;
    return Array.from(media.cssRules).some((inner) => {
      const style = inner as CSSStyleRule;
      if (!style.selectorText) return false;
      return style.selectorText
        .split(',')
        .map((sel) => sel.trim())
        .includes(selector);
    });
  });
}

const railRows = () => Array.from(document.querySelectorAll('#james-bot .jb-chat-row'));
const rowById = (id: string | null) => {
  const found = document.querySelector(`#james-bot .jb-chat-row[data-chat-id="${id}"]`);
  if (!found) throw new Error(`no rail row for ${id}`);
  return found;
};
const mainButtons = () => Array.from(document.querySelectorAll('#james-bot .jb-main button'));

beforeEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  // Phase 3 S4 (announced re-point, uniform across widget suites): the
  // widget now gates on a session token before ANY chat UI. Seeding one
  // keeps each suite's original subject - chat behaviour - unchanged;
  // the gate's own behaviour is pinned in phase3Widget.test.ts.
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
  window.localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('T-P2.3 — rename and delete are reachable under a coarse pointer', () => {
  it('the row actions are hidden by default and REVEALED on a coarse pointer', async () => {
    boot(makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] }).fetchMock);
    await tick();

    // PRECONDITION — the hidden default is the defect being compensated for.
    // If this ever becomes non-zero the override is pointless, and asserting
    // only the override would never tell us.
    expect(declFor('.jb-chat-act', 'opacity', { coarse: false }), 'the fine-pointer default is not hidden')
      .toBe('0');

    expect(
      declFor('.jb-chat-act', 'opacity', { coarse: true }),
      'on touch, rename and delete are still invisible and unreachable',
    ).toBe('1');
  });

  it('THE RULE that reveals .jb-chat-act carries BOTH hover:none and pointer:coarse', async () => {
    // Either term alone leaves a real device class out: a stylus is
    // fine-pointer but hoverless, and some touch laptops report coarse while
    // still hovering. The two terms are alternatives (comma = OR), so the rule
    // fires for either class — and losing one term silently un-fixes S2.1 for
    // that class.
    //
    // Resolved THROUGH the rule (BUG-026), never via a sheet-wide .some():
    // with two coarse queries in the sheet, a population quantifier stays
    // green when only this one is weakened.
    boot(makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] }).fetchMock);
    await tick();

    const queries = mediaQueriesContaining('.jb-chat-act');
    expect(queries.length, 'no media query contains a .jb-chat-act rule at all').toBe(1);
    const condition = String(queries[0].conditionText);
    expect(condition, 'hoverless devices (stylus) lost the reveal').toMatch(/hover:\s*none/);
    expect(condition, 'coarse-but-hovering devices (touch laptops) lost the reveal').toMatch(
      /pointer:\s*coarse/,
    );
    // And the rule inside it is the reveal, not some other .jb-chat-act rule.
    const inner = Array.from(queries[0].cssRules)
      .map((r) => (r as CSSStyleRule))
      .find((r) => r.selectorText?.includes('.jb-chat-act'));
    expect(inner?.style.getPropertyValue('opacity').trim(), 'the rule is not the reveal').toBe('1');
  });

  it('the actions exist in the DOM to be revealed at all', async () => {
    // The cascade assertions above are about VISIBILITY. They would both pass
    // against a rail that rendered no action buttons whatsoever.
    boot(makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] }).fetchMock);
    await tick();

    const row = railRows()[0];
    expect(row.querySelector('[aria-label="Rename chat"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="Delete chat"]')).not.toBeNull();
  });

  it('the confirm controls get a larger tap target on a coarse pointer', async () => {
    // A destructive control at rail density is a mis-tap waiting to happen on
    // the device class that just gained permanent access to it.
    boot(makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] }).fetchMock);
    await tick();

    const fine = declFor('.jb-chat-confirm-yes', 'padding', { coarse: false });
    const coarse = declFor('.jb-chat-confirm-yes', 'padding', { coarse: true });
    expect(fine, 'precondition: there is a fine-pointer default to grow from').not.toBeNull();
    expect(coarse, 'touch gets no larger target than a mouse').not.toBe(fine);

    // Same audit as the reveal (BUG-026's "check the same shape" order):
    // declFor's COARSE regex is an OR, so it would still find this padding
    // under a query weakened to hover:none only. Tie the condition to the
    // rule here too.
    const queries = mediaQueriesContaining('.jb-chat-confirm-yes');
    expect(queries.length, 'no media query contains the confirm tap-target rule').toBe(1);
    const condition = String(queries[0].conditionText);
    expect(condition).toMatch(/hover:\s*none/);
    expect(condition).toMatch(/pointer:\s*coarse/);
  });
});

describe('S2.2 — the in-widget delete confirmation', () => {
  it('step one opens a confirmation and archives NOTHING', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(server.calls.filter((c) => c.method === 'DELETE'), 'one tap archived a chat').toHaveLength(
      0,
    );
    expect(rowById(CHAT_A).querySelector('[aria-label="Confirm delete chat"]')).not.toBeNull();
    expect(rowById(CHAT_A).querySelector('[aria-label="Cancel delete chat"]')).not.toBeNull();
  });

  it('no native dialog is used, on either step', async () => {
    // The ruling: a native dialog inside a GHL SPA embed reads as the page
    // breaking, and a browser that suppresses it would make delete a silently
    // dead control.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    rowById(CHAT_A).querySelector<HTMLButtonElement>('[aria-label="Confirm delete chat"]')!.click();
    await tick();

    expect(confirmSpy).not.toHaveBeenCalled();
    // Precondition: the delete really did complete, so the absence above is
    // not just a flow that never ran.
    expect(server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('Escape backs out, leaving the chat intact', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();
    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    rowById(CHAT_A)
      .querySelector('.jb-chat-confirm')!
      .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect(rowById(CHAT_A).querySelector('[aria-label="Confirm delete chat"]')).toBeNull();
    expect(server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(rowById(CHAT_A).querySelector('.jb-chat-open')?.textContent).toBe('Chat A');
  });

  it('focus lands on the confirming action, so a keyboard can finish or escape', async () => {
    const server = makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }] });
    boot(server.fetchMock);
    await tick();

    railRows()[0].querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Confirm delete chat');
  });

  it('only ONE confirmation can be open at a time', async () => {
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }],
    });
    boot(server.fetchMock);
    await tick();

    rowById(CHAT_A).querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();
    rowById(CHAT_B).querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(
      document.querySelectorAll('#james-bot [aria-label="Confirm delete chat"]').length,
      'a destructive question was left open on a row the member is no longer looking at',
    ).toBe(1);
    expect(rowById(CHAT_B).querySelector('[aria-label="Confirm delete chat"]')).not.toBeNull();
  });

  it('opening a rename on ANOTHER row closes an open confirmation', async () => {
    // The confirmation REPLACES its row, the same way the rename input does,
    // so the two can never collide on one row — there is no rename button left
    // to press. Where the exclusion actually matters is across rows: a
    // destructive question left open on row A while the member is renaming row
    // B is a question they are no longer looking at.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }],
    });
    boot(server.fetchMock);
    await tick();

    rowById(CHAT_A).querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();
    expect(
      rowById(CHAT_A).querySelector('[aria-label="Confirm delete chat"]'),
      'precondition: a confirmation is open on chat A',
    ).not.toBeNull();

    rowById(CHAT_B).querySelector<HTMLButtonElement>('[aria-label="Rename chat"]')!.click();
    await tick();

    expect(
      document.querySelectorAll('#james-bot [aria-label="Confirm delete chat"]').length,
      'a destructive question stayed open while the member renamed elsewhere',
    ).toBe(0);
    expect(rowById(CHAT_B).querySelector('.jb-chat-rename-input')).not.toBeNull();
  });

  it('a confirmation replaces its row, so that row cannot be opened until it resolves', async () => {
    // Stated rather than discovered. It is the same trade the rename input
    // already makes, and Cancel and Escape are both one activation away.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }],
    });
    boot(server.fetchMock);
    await tick();

    rowById(CHAT_B).querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();

    expect(rowById(CHAT_B).querySelector('.jb-chat-open')).toBeNull();
    expect(rowById(CHAT_B).querySelector('[aria-label="Rename chat"]')).toBeNull();
    expect(rowById(CHAT_B).querySelector('[aria-label="Cancel delete chat"]')).not.toBeNull();
  });

  it('T-P2.6 (partial): a chat switch clears an open confirmation', async () => {
    // confirmingId is enumerated in resetChatState per P2. A half-taken
    // DESTRUCTIVE question surviving a switch would sit on a row the member
    // may no longer be able to see.
    const server = makeServer({
      chats: [{ id: CHAT_A, title: 'Chat A' }, { id: CHAT_B, title: 'Chat B' }],
    });
    boot(server.fetchMock);
    await tick();

    // The confirmation opens on the ACTIVE row (chat A), and the switch is
    // driven from the other row — a confirming row has no open button, by
    // design, so the switch could not come from the same row.
    rowById(CHAT_A).querySelector<HTMLButtonElement>('[aria-label="Delete chat"]')!.click();
    await tick();
    expect(
      rowById(CHAT_A).querySelector('[aria-label="Confirm delete chat"]'),
      'precondition: a confirmation is open on chat A',
    ).not.toBeNull();

    rowById(CHAT_B).querySelector<HTMLButtonElement>('.jb-chat-open')!.click();
    await tick();

    expect(
      document.querySelectorAll('#james-bot [aria-label="Confirm delete chat"]').length,
      'the confirmation survived a chat switch',
    ).toBe(0);
  });
});

describe('R-4 — the second .jb-main button is pinned deliberately', () => {
  it('the opening screen has exactly ONE: Send', async () => {
    // Restates the existing tripwire here so the pair below reads as one
    // claim. The original lives in tests/widget.test.ts and is unchanged.
    boot(makeServer({ chats: [] }).fetchMock);
    await tick();

    expect(mainButtons()).toHaveLength(1);
    expect(mainButtons()[0].textContent).toContain('Send');
  });

  it('a /history FAILURE adds exactly one more: the transcript Retry', async () => {
    // The tripwire in widget.test.ts uses a never-resolving fetch, so it never
    // reaches this state and the second button would otherwise be discovered
    // by a future slice tripping it and assuming the tripwire was wrong. It is
    // not: two is correct HERE and one is correct THERE, and both are pinned.
    boot(
      makeServer({ chats: [{ id: CHAT_A, title: 'Chat A' }], historyStatus: 503 }).fetchMock,
    );
    await tick();

    const labels = mainButtons().map((b) => (b.textContent ?? '').trim());
    expect(labels, 'the conversation pane grew a control nobody pinned').toHaveLength(2);
    expect(labels.some((l) => l.includes('Send'))).toBe(true);
    expect(labels.some((l) => l === 'Retry')).toBe(true);
  });

  it('and drops back to one once the retry succeeds', async () => {
    // The count is a function of STATE, not a new permanent fixture.
    let failing = true;
    const fetchMock = vi.fn((url: string, init?: any) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const u = String(url);
      if (u.includes('/history')) {
        if (failing) return Promise.resolve(json(503, { error: 'nope' }));
        return Promise.resolve(json(200, { messages: [{ role: 'user', content: 'old' }] }));
      }
      if (u.endsWith('/chats') && method === 'GET') {
        return Promise.resolve(
          json(200, [{ id: CHAT_A, title: 'Chat A', created_at: 'x', last_message_at: 'x' }]),
        );
      }
      return Promise.resolve(json(404, {}));
    });
    boot(fetchMock);
    await tick();
    expect(mainButtons(), 'precondition: the failure state really was reached').toHaveLength(2);

    failing = false;
    document.querySelector<HTMLButtonElement>('#james-bot .jb-retry')!.click();
    await tick();

    expect(mainButtons(), 'the retry control outlived the failure').toHaveLength(1);
  });
});
