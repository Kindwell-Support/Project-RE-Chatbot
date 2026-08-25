/**
 * BUG-046 follow-up: does the fix hold against the REAL host shape —
 * the portal reset AND a ::placeholder rule carrying a font-size?
 *
 * The live measurement (input 15px, placeholder 32px, root 15px) says the
 * placeholder does NOT inherit from the control, so a rule targets it
 * directly. Its exact selector is still being captured, so this tests the
 * fix against SEVERAL plausible shapes at ascending specificity and reports
 * which it survives — rather than assuming one and declaring victory.
 *
 * Baseline = the live bundle (no fix). Candidate = the local built bundle.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SP = 'C:/Users/hadim/AppData/Local/Temp/claude/d--CODE-Project-RE-Chatbot/5690c621-8b4e-47c7-b501-b747b75ba17e/scratchpad';

const LIVE = readFileSync(SP + '/bundle_prefix.js', 'utf8');   // no fix
const FIXED = readFileSync('public/widget.js', 'utf8');        // with fix

// The portal reset, verbatim shape from the captured cascade.
const RESET = `.membership-preview-remote button,.membership-preview-remote input,
.membership-preview-remote optgroup,.membership-preview-remote select,
.membership-preview-remote textarea{font-size:100%}`;

// Plausible ::placeholder rules, ascending specificity. Pseudo-ELEMENTS count
// as elements, so ::placeholder adds to the element column, not the class one.
const PH = {
  'bare ::placeholder                 (0,0,1)': '::placeholder{font-size:32px}',
  'input::placeholder                 (0,0,2)': 'input::placeholder{font-size:32px}',
  '.mpr input::placeholder            (0,1,2)': '.membership-preview-remote input::placeholder{font-size:32px}',
  '.mpr .x input::placeholder         (0,2,2)': '.membership-preview-remote .wrap input::placeholder{font-size:32px}',
  '.mpr input::placeholder !important        ': '.membership-preview-remote input::placeholder{font-size:32px !important}',
};

const page_html = (ph) => `<!doctype html><html><head><meta charset="utf-8"><style>
 body{font-size:14px}
 ${RESET}
 ${ph}
</style></head><body><div class="membership-preview-remote"><div class="wrap">
 <div id="james-bot" style="width:900px;height:640px"></div>
</div></div></body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function measure(bundle, ph) {
  const page = await browser.newPage();
  await page.setContent(page_html(ph), { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() =>
    window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  await new Promise((r) => setTimeout(r, 600));
  const out = await page.evaluate(() => {
    const el = document.querySelector('.jb-gate-input');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const ph = getComputedStyle(el, '::placeholder');
    const root = getComputedStyle(document.querySelector('.jb-root'));
    return {
      root: root.fontSize,
      input: cs.fontSize,
      placeholder: ph.fontSize,
      inputFamily: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
    };
  });
  await page.close();
  return out;
}

console.log('LIVE MEASUREMENT TO REPRODUCE: root 15px | input 15px | placeholder 32px');
console.log('');
console.log('placeholder rule'.padEnd(44) + 'NO FIX (live bundle)'.padEnd(34) + 'WITH FIX (local build)');
console.log('-'.repeat(120));
for (const [label, css] of Object.entries(PH)) {
  const a = await measure(LIVE, css);
  const b = await measure(FIXED, css);
  const fmt = (r) => r ? `root ${r.root} input ${r.input} ph ${r.placeholder}` : 'n/a';
  const ok = b && b.input === '16px' && b.placeholder === '16px' ? '  <= BOTH HOLD' :
             b && b.input === '16px' ? '  <= input holds, PLACEHOLDER LOST' : '  <= INPUT LOST';
  console.log(label.padEnd(44) + fmt(a).padEnd(34) + fmt(b) + ok);
}
await browser.close();
