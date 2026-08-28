/**
 * INPUT PADDING — the half jsdom cannot answer.
 *
 * jsdom resolves the cascade but does no LAYOUT, so it cannot say whether the
 * composer's text ever ends up under the send button, or how much typing room
 * survives once the padding grows. Both are geometry, and geometry needs a
 * real engine. FINDING-047's harness split, applied to this change.
 *
 * What this measures, in real Chrome, at several widths including narrow:
 *   1. The composer input and the send button never OVERLAP. They are flex
 *      siblings (.jb-send is flex:0 0 auto, never absolutely positioned), so
 *      the expectation is that they cannot — this measures it rather than
 *      trusting the reading.
 *   2. How much usable text width survives at each width, and how many
 *      characters fit, before vs after the padding change.
 *   3. That the first glyph clears the 10px border radius, which is the
 *      defect being fixed.
 *
 * GUARD: refuses to report if the composer or send button measures zero —
 * a 0px box compares as "no overlap" and would produce a PASS that means
 * nothing. That vacuous shape has bitten this project once already.
 *
 * Usage: node tools/qa/input_padding_chrome_check.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');
const WIDTHS = [900, 640, 480, 380, 320, 280];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setContent(
  '<!doctype html><html><body style="margin:0">' +
    '<div id="frame" style="width:900px">' +
      '<div id="james-bot" style="height:640px"></div></div></body></html>',
  { waitUntil: 'domcontentloaded' },
);
await page.addScriptTag({ content: bundle });
await page.evaluate(() =>
  window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }),
);
await new Promise((r) => setTimeout(r, 700));

const result = await page.evaluate(async (widths) => {
  // The width classes come from a ResizeObserver, whose callback is ASYNC.
  // A first version of this instrument set the width and measured in the same
  // synchronous turn, so the classes never applied and every row reported
  // "(full)" — a DESKTOP layout wearing a narrow width's label, which made
  // 280px look catastrophic. Settle across two animation frames per width.
  const settle = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // The widget GATES without a token; .jb-gated hides the composer entirely.
  // setContent gives an opaque origin so sessionStorage is denied, so drop the
  // class to reproduce the AUTHED layout, which is all this measures.
  const root = document.querySelector('.jb-root');
  root.classList.remove('jb-gated');
  // SIZE THE ANCESTOR, NOT THE MOUNT. The widget now OWNS the mount's inline
  // width (it overwrites style.width to 100% on every recompute, so a fixed
  // width left in the GHL snippet is not a ceiling). Driving this sweep by
  // writing #james-bot's own style therefore fought the widget and the mount
  // never narrowed — the width-class guard below caught it rather than
  // reporting a desktop layout at every width. An ancestor is also what
  // actually constrains us in production.
  const host = document.querySelector('#frame');
  const input = document.querySelector('.jb-input');
  const send = document.querySelector('.jb-send');
  if (!input || !send) return { INVALID: 'composer or send button not in the DOM' };

  const rows = [];
  for (const w of widths) {
    host.style.width = w + 'px';
    await settle();
    const ir = input.getBoundingClientRect();
    const sr = send.getBoundingClientRect();
    if (!ir.width || !sr.width) {
      return { INVALID: 'at ' + w + 'px: input ' + ir.width + ', send ' + sr.width };
    }
    const cs = getComputedStyle(input);
    const padL = parseFloat(cs.paddingLeft);
    const padR = parseFloat(cs.paddingRight);
    const radius = parseFloat(cs.borderTopLeftRadius);
    // How many characters of a realistic sentence fit before the input
    // scrolls, measured by binary search on the live element.
    const ALPHA = 'What is the ARV on 1420 North Main Street Tacoma WA and the rehab budget';
    const prev = input.value;
    let lo = 0;
    let hi = 300;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      input.value = ALPHA.repeat(5).slice(0, mid);
      if (input.scrollWidth <= input.clientWidth) lo = mid;
      else hi = mid - 1;
    }
    input.value = prev;

    rows.push({
      width: w,
      widthClass:
        ['jb-w-mid', 'jb-w-narrow', 'jb-w-tight'].filter((c) => root.classList.contains(c))[0] ??
        '(full)',
      inputBox: Math.round(ir.width),
      padL,
      padR,
      radius,
      textArea: Math.round(ir.width - padL - padR),
      chars: lo,
      // Flex siblings: the input's right edge must not cross the button's left.
      overlapPx: Math.max(0, Math.round(ir.right - sr.left)),
      firstGlyphClearsRadius: padL >= radius,
    });
  }
  // GUARD against the failure this instrument already had once: if the
  // narrowest width still reports "(full)", the ResizeObserver never ran and
  // every narrow row is a desktop layout mislabelled. Refuse to report.
  const narrowest = rows[rows.length - 1];
  if (narrowest.widthClass === '(full)') {
    return {
      INVALID:
        'at ' + narrowest.width + 'px the root still has NO width class — the ' +
        'ResizeObserver did not fire, so the narrow rows are not narrow layouts',
    };
  }
  return { rows };
}, WIDTHS);

if (result.INVALID) {
  console.log('MEASUREMENT INVALID:', result.INVALID);
  await browser.close();
  process.exit(1);
}

console.log('width  class        input   padL/padR  text   chars  overlap  glyph>radius');
console.log('-'.repeat(76));
let bad = 0;
for (const r of result.rows) {
  if (r.overlapPx > 0 || !r.firstGlyphClearsRadius) bad += 1;
  console.log(
    String(r.width).padStart(4) +
      '   ' +
      r.widthClass.padEnd(12) +
      String(r.inputBox).padStart(5) +
      'px  ' +
      (r.padL + '/' + r.padR).padStart(7) +
      '  ' +
      String(r.textArea).padStart(4) +
      'px  ' +
      String(r.chars).padStart(4) +
      '   ' +
      String(r.overlapPx).padStart(5) +
      'px  ' +
      (r.firstGlyphClearsRadius ? 'yes' : 'NO'),
  );
}
console.log('');
console.log('radius is ' + result.rows[0].radius + 'px; padding must exceed it for the first');
console.log('glyph to sit inside the curve rather than under it.');
console.log('');
console.log('OVERLAP WITH SEND BUTTON: ' + (bad === 0 ? 'NONE at any width' : bad + ' FAILING ROW(S)'));
console.log('VERDICT: ' + (bad === 0 ? 'PASS' : 'FAIL'));
await browser.close();
process.exit(bad === 0 ? 0 : 1);
