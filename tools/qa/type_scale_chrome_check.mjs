/**
 * Does the tokenised scale still BEAT the hostile host rule in a real engine?
 * jsdom now returns the raw `var(--jb-font-md)` string instead of resolving
 * it, so the BUG-046 jsdom assertions can no longer read pixels. Chrome can.
 * The fixture is the same (0,1,1) descendant shape that caused BUG-046, at
 * 32px -- if any control below reads 32px, the defence has been broken by the
 * tokenisation and this change must not ship.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');
const HOSTILE = `.editor-content input, .editor-content select, .editor-content button,
  .editor-content textarea { font-size: 32px !important; padding: 0 !important;
  background-color: transparent !important; }`;

const EXPECT = {
  '.jb-input': '16px', '.jb-gate-input': '16px',
  '.jb-btn': '14px', '.jb-gate-btn': '14px',
  '.jb-new': '12px', '.jb-chat-open': '12px', '.jb-chat-act': '12px',
  '.jb-side-toggle': '14px', '.jb-side-retry': '12px',
  '.jb-chat-confirm-yes': '12px', '.jb-chat-confirm-no': '12px',
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
await page.setContent(
  '<!doctype html><html><head><style>' + HOSTILE + '</style></head>' +
  '<body style="margin:0"><div class="editor-content rich-text-viewer">' +
  '<div id="james-bot" style="width:820px;height:700px"></div></div></body></html>',
  { waitUntil: 'domcontentloaded' },
);
await page.addScriptTag({ content: bundle });
await page.evaluate(() => window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
await new Promise((r) => setTimeout(r, 700));

const out = await page.evaluate((expect) => {
  const root = document.querySelector('.jb-root');
  root.classList.remove('jb-gated');
  const side = document.querySelector('.jb-side-list');
  if (side) {
    side.innerHTML =
      '<div class="jb-chat-row"><button class="jb-chat-open"><span class="jb-chat-title">t</span>' +
      '<span class="jb-chat-time">1h</span></button><button class="jb-chat-act">e</button></div>' +
      '<div class="jb-chat-row"><div class="jb-chat-confirm"><span class="jb-chat-confirm-q">Delete?</span>' +
      '<button class="jb-chat-confirm-yes">Delete</button>' +
      '<button class="jb-chat-confirm-no">Cancel</button></div></div>' +
      '<button class="jb-side-retry">Retry</button>';
  }
  // The gate input only exists while gated; measure it before dropping, so
  // re-add a probe copy under the same ancestry.
  const probe = document.createElement('input');
  probe.className = 'jb-gate-input';
  root.appendChild(probe);
  const b = document.createElement('button');
  b.className = 'jb-gate-btn';
  root.appendChild(b);
  const b2 = document.createElement('button');
  b2.className = 'jb-btn';
  root.appendChild(b2);

  const rows = [];
  for (const [sel, want] of Object.entries(expect)) {
    const el = document.querySelector(sel);
    if (!el) { rows.push({ sel, got: 'MISSING', want, ok: false }); continue; }
    const got = getComputedStyle(el).fontSize;
    rows.push({ sel, got, want, ok: got === want });
  }
  return {
    rootFont: getComputedStyle(root).fontSize,
    // Proof the hostile sheet is actually live: a bare control must read 32px.
    bareControl: (() => {
      const i = document.createElement('input');
      document.querySelector('.editor-content').appendChild(i);
      return getComputedStyle(i).fontSize;
    })(),
    rows,
  };
}, EXPECT);

console.log('root font-size: ' + out.rootFont);
console.log('CONTROL (hostile sheet live?): bare input reads ' + out.bareControl + '  ' +
  (out.bareControl === '32px' ? '(sheet IS live — the test below is meaningful)'
    : '(SHEET NOT APPLYING — every PASS below would be vacuous)'));
console.log('');
let bad = 0;
for (const r of out.rows) {
  if (!r.ok) bad += 1;
  console.log('  ' + r.sel.padEnd(24) + r.got.padStart(7) + '   want ' + r.want.padEnd(6) + (r.ok ? 'ok' : 'FAIL'));
}
console.log('');
const vacuous = out.bareControl !== '32px';
console.log('VERDICT: ' + (vacuous ? 'INVALID — hostile sheet not applying' : bad === 0 ? 'DEFENCE HOLDS with tokens' : bad + ' control(s) lost to the host'));
await browser.close();
process.exit(vacuous || bad ? 1 : 0);
