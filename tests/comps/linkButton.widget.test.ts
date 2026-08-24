/**
 * §14.18 — THE LINK BUTTON, and the http(s) gate that guards it.
 *
 * A line consisting only of a link renders as a BUTTON. That is presentational
 * and general — no comps coupling — but it raises the stakes on a gate that
 * already existed for anchors, and the contract says so explicitly: **a button
 * is a more inviting target than an anchor.**
 *
 * The threat model is specific, not theoretical. The model AUTHORS the markup
 * it relays: `format.ts` emits `[View property](https://…)`, the model re-types
 * the block, and whatever it types is what the widget parses. A model that
 * emits `[View property](javascript:…)` — through error, or because a member
 * pasted it into the conversation and the model echoed it back — must produce
 * inert text. Not a dead anchor. Not an empty button. Text.
 *
 * The three shapes are tested INDEPENDENTLY because they take different code
 * paths: the button branch matches a whole line, the anchor branch matches
 * inline, and the reject path is the ABSENCE of both. A single combined case
 * would let one path's success mask another's failure.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WIDGET_SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../widget/widget.js'),
  'utf-8',
);

/** Render one assistant reply through the real widget and return its DOM. */
async function render(markdown: string): Promise<HTMLElement> {
  const fetchMock = vi.fn((url: string) => {
    if (String(url).includes('/history')) return new Promise(() => {});
    return Promise.resolve({
      ok: true, status: 200, json: async () => ({ output: markdown }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  // Phase 3 S4 (announced re-point): seed the session token so this suite's
  // subject (link rendering) is unchanged; the gate is pinned elsewhere.
  window.sessionStorage.setItem('james-bot-token', 'jsdom-suite-token');
  delete (window as never as Record<string, unknown>).createJamesBot;
  new Function(WIDGET_SRC).call(window);

  const host = document.createElement('div');
  host.id = 'james-bot';
  document.body.appendChild(host);
  (window as never as { createJamesBot: (o: unknown) => void }).createJamesBot({
    apiUrl: 'https://api.example.com', target: '#james-bot',
  });

  const input = document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;
  input.value = 'run comps';
  document.querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 10));

  // The bot's rendered markdown lives in the LAST bot bubble.
  const bubbles = document.querySelectorAll<HTMLElement>('#james-bot .jb-bot .jb-bubble');
  const last = bubbles[bubbles.length - 1];
  if (!last) throw new Error('no bot bubble rendered — the harness never got a reply');
  return last;
}

const buttons = (el: HTMLElement) => el.querySelectorAll('.jb-btn-link');
const anchors = (el: HTMLElement) => el.querySelectorAll('a');

describe('the link button and its http(s) gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  // =========================================================================
  describe('SHAPE 1 — a line that is ONLY a link becomes a button', () => {
    it('the markdown form renders a button carrying the href and the label', async () => {
      const el = await render('Here are the comps.\n\n[View property](https://zillow.com/homedetails/1_zpid)');

      const btn = buttons(el);
      expect(btn, 'a link-only line did not become a button').toHaveLength(1);
      expect(btn[0].getAttribute('href')).toBe('https://zillow.com/homedetails/1_zpid');
      expect(btn[0].textContent, 'the button lost its label').toBe('View property');
      // Opening a listing must not navigate the host page away from the chat.
      expect(btn[0].getAttribute('target'), 'the button opens in place').toBe('_blank');
      expect(btn[0].getAttribute('rel') ?? '', 'no noopener on a _blank target')
        .toContain('noopener');
    });

    it('a bare http(s) URL alone on a line also becomes a button', async () => {
      const el = await render('https://zillow.com/homedetails/2_zpid');
      expect(buttons(el), 'a bare URL line did not become a button').toHaveLength(1);
    });
  });

  // =========================================================================
  describe('SHAPE 2 — an INLINE link stays an anchor', () => {
    it('a link with text around it is not promoted to a button', async () => {
      // The distinction is the whole rule: "a line containing only a link".
      // A promotion rule that fires on any line containing a link would turn
      // a sentence into a control and swallow the sentence.
      const el = await render('See [View property](https://zillow.com/homedetails/3_zpid) for details.');

      expect(buttons(el), 'an inline link was promoted to a button').toHaveLength(0);
      const a = anchors(el);
      expect(a, 'the inline link did not render as an anchor at all').toHaveLength(1);
      expect(a[0].getAttribute('href')).toBe('https://zillow.com/homedetails/3_zpid');
      // ...and the surrounding sentence survived.
      expect(el.textContent ?? '', 'the sentence around the link was lost')
        .toContain('for details');
    });
  });

  // =========================================================================
  describe('SHAPE 3 — javascript: stays INERT LITERAL TEXT', () => {
    it('a javascript: URL alone on a line is neither button nor anchor', async () => {
      // The one with teeth. The model authors this markup, so the gate is what
      // stands between a model-authored scheme and a control the member is
      // invited to press.
      const el = await render('[View property](javascript:window.__pwned=1)');

      expect(buttons(el), 'a javascript: URL rendered as a BUTTON').toHaveLength(0);
      expect(anchors(el), 'a javascript: URL rendered as an anchor').toHaveLength(0);
      expect(
        (window as never as Record<string, unknown>).__pwned,
        'the javascript: payload executed',
      ).toBeUndefined();
      // Inert LITERAL text — visible, harmless, and obviously wrong to a reader.
      expect(el.textContent ?? '', 'the rejected link vanished instead of staying literal')
        .toContain('javascript:');
    });

    it('the same rejection applies INLINE, not just on its own line', async () => {
      const el = await render('See [this](javascript:alert(1)) now.');
      expect(anchors(el), 'an inline javascript: link became an anchor').toHaveLength(0);
      expect(buttons(el)).toHaveLength(0);
      expect(el.textContent ?? '').toContain('now.');
    });

    it.each([
      ['data:', '[x](data:text/html;base64,PHN2Zz4=)'],
      ['vbscript:', '[x](vbscript:msgbox(1))'],
      ['protocol-relative', '[x](//evil.example.com/p)'],
      ['uppercased scheme', '[x](JaVaScRiPt:alert(1))'],
    ])('%s is refused too — the gate is an ALLOW-list, not a javascript: blocklist', async (_n, md) => {
      // The distinction that matters: a blocklist of known-bad schemes is a
      // list someone has to keep complete. An http(s) allow-list is complete
      // by construction, and these four are how you tell which one shipped.
      const el = await render(md);
      expect(buttons(el), 'rendered as a button').toHaveLength(0);
      expect(anchors(el), 'rendered as an anchor').toHaveLength(0);
    });
  });

  // =========================================================================
  describe('the §14.9 fallback is TEXT, never an empty control', () => {
    it('"link unavailable" renders as words, with no button and no anchor', async () => {
      // A comp with no zpid. The member must see that the link is missing —
      // an empty or dead control is worse than the words, because it invites
      // a press that does nothing.
      const el = await render(
        '**1. 830 W AMERICA ST**\nSold $360,000 · Jul 17, 2026 · 0.05 mi away\nlink unavailable',
      );

      expect(el.textContent ?? '', 'the fallback text is missing').toContain('link unavailable');
      expect(buttons(el), 'the fallback rendered as a button').toHaveLength(0);
      expect(anchors(el), 'the fallback rendered as an anchor').toHaveLength(0);
    });
  });
});
