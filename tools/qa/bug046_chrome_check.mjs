/**
 * BUG-046 in REAL Chrome — no server needed, the built bundle injected into a
 * page that reproduces the portal's ACTUAL mechanism:
 *   .membership-preview-remote <control> { font-size: 100% }   (0,1,1)
 * plus an oversized ancestor, because `100%` resolves against the PARENT and
 * that is the half jsdom cannot evaluate (it returns 'medium').
 *
 * Answers three things jsdom could not:
 *   1. does 100%-of-a-large-ancestor actually reproduce the ~2x symptom?
 *   2. does the defensive layer beat it in a real engine?
 *   3. does <select> behave like the others, or resist (its UA defaults are
 *      the operator's specific concern)?
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-size: 14px; font-family: Inter, sans-serif; }
  /* THE PORTAL'S RULE, verbatim shape, captured from the live cascade */
  .membership-preview-remote button, .membership-preview-remote input,
  .membership-preview-remote optgroup, .membership-preview-remote select,
  .membership-preview-remote textarea { font-size: 100%; }
  /* The unexplained oversized ancestor, simulated so the percentage has
     something big to resolve against: hypothesis under test, not known fact */
  .big-ancestor { font-size: 30px; }
</style></head><body>
  <div class="membership-preview-remote big-ancestor">
    <input id="undefended" placeholder="undefended control">
    <div id="james-bot" style="width:100%;height:700px;"></div>
  </div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', String(e).slice(0, 200)));
await page.setContent(PAGE, { waitUntil: 'domcontentloaded' });

// CONTROL FIRST: does the fixture actually reproduce the symptom?
const undefended = await page.evaluate(
  () => getComputedStyle(document.querySelector('#undefended')).fontSize,
);
console.log('CONTROL — undefended input under the portal rule:', undefended);
console.log('   (body is 14px; ~30px here means 100% resolved against the big ancestor');
console.log('    and REPRODUCES the reported ~2x symptom)');
console.log('');

await page.addScriptTag({ content: bundle });
await page.evaluate(() => window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
await new Promise((r) => setTimeout(r, 900));

const out = await page.evaluate(() => {
  const px = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform };
  };
  // Inject calculator-shaped controls: the <select> question needs a real UA.
  const list = document.querySelector('#james-bot .jb-list');
  if (list) {
    const d = document.createElement('div');
    d.id = 'probe';
    d.className = 'jb-calc';
    d.innerHTML =
      '<input class="jb-control" type="text" placeholder="p">' +
      '<select class="jb-control"><option>a</option></select>' +
      '<textarea class="jb-control"></textarea>';
    list.appendChild(d);
  }
  return {
    rootFontSize: px('.jb-root')?.fontSize,
    gateInput: px('.jb-gate-input'),
    gateBtn: px('.jb-gate-btn'),
    calcInput: px('#probe input.jb-control'),
    calcSelect: px('#probe select.jb-control'),
    calcTextarea: px('#probe textarea.jb-control'),
    gatePresent: !!document.querySelector('.jb-gate'),
  };
});
console.log('WITH THE DEFENSIVE LAYER (expected: gate/calc controls 16px, button 14px):');
console.log(JSON.stringify(out, null, 2));
await browser.close();
