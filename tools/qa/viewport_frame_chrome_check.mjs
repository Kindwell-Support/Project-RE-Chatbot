/**
 * VIEWPORT FRAME — the layout claims jsdom cannot make.
 *
 * jsdom has no layout: getBoundingClientRect returns zeros, so centring,
 * horizontal overflow, the drawer's position:absolute and whether the
 * hamburger MOVES anything are all unanswerable there. They live here.
 *
 * Two traps this instrument exists to avoid, both of which caught the first
 * draft of it:
 *   - the min-height FLOOR (520-16 = 504 never reached the 420 floor)
 *   - the SIDEBAR (the widget was gated, so .jb-side was display:none in every
 *     row and "rail: hidden" said nothing about collapse behaviour)
 * Plus internal scroll / pinned composer re-confirmed after the change.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');

/**
 * FINDING-067 — THE SAMPLING BOUNDARIES ARE READ FROM THE BUILD, NOT RESTATED.
 *
 * They were literals ([400, 800, 900] and 436). Under a breakpoint mutation the
 * sweep went on sampling the OLD boundaries and printed a density claim that was
 * false about the build under test. No gate went inert and other instruments
 * caught the mutation, so it was a stale claim rather than a stale scope — but a
 * printed line that lies about coverage is precisely what rule 5 exists to stop.
 * Rule 5 is about scope; this is its sibling: a CLAIM expressed in terms of the
 * thing under test is as wrong as a scope expressed that way.
 *
 * The tier breakpoints come out of the bundle's own toggle calls, so a
 * breakpoint change moves the sampling with it.
 */
function tierBreakpoints(src) {
  const out = [];
  const re = /classList\.toggle\(["'](jb-w-[a-z]+)["'],\s*\w+\s*<=\s*(\d+)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ tier: m[1], at: Number(m[2]) });
  // POSITIVE-ASSERTION RULE: a parse that found nothing must refuse, not sample
  // an empty set and call it dense.
  if (out.length < 3) {
    console.log('VERDICT: INVALID — parsed ' + out.length + ' tier breakpoints from the');
    console.log('  bundle, expected at least 3. The sampling cannot be derived, so no');
    console.log('  density claim can be made. Check the toggle call shape in widget.js.');
    process.exit(1);
  }
  return out;
}

const MOUNT = '<div id="james-bot" style="width:100%;height:700px"></div>';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function boot(vw, vh) {
  const page = await browser.newPage();
  await page.setViewport({ width: vw, height: vh });
  await page.setContent('<!doctype html><html><body style="margin:0">' + MOUNT + '</body></html>',
    { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  await new Promise((r) => setTimeout(r, 500));
  // UNGATE: the rail only exists in an authed session, and a gated probe
  // reports "hidden" for reasons that have nothing to do with layout.
  await page.evaluate(async () => {
    const root = document.querySelector('.jb-root');
    root.classList.remove('jb-gated');
    const list = document.querySelector('.jb-side-list');
    if (list) {
      list.innerHTML = ['Tacoma duplex comps', 'BRRRR on Hilltop', 'Land deal']
        .map((t) => '<div class="jb-chat-row"><button class="jb-chat-open">' +
          '<span class="jb-chat-title">' + t + '</span></button></div>').join('');
    }
    const tx = document.querySelector('.jb-list');
    for (let i = 0; i < 40; i += 1) {
      const r = document.createElement('div');
      r.className = 'jb-row jb-bot';
      r.innerHTML = '<div class="jb-bubble">Message ' + i + ' with enough text to make the transcript overflow its box.</div>';
      tx.appendChild(r);
    }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  });
  return page;
}


const read = () => ({
  mountH: Math.round(document.getElementById('james-bot').getBoundingClientRect().height),
  tiers: ['mid', 'narrow', 'tight'].filter((c) => document.querySelector('.jb-root').classList.contains('jb-w-' + c)).join('+') || 'full',
  railPos: (() => { const r = document.querySelector('.jb-side'); const cs = getComputedStyle(r);
    return cs.display === 'none' ? 'display:none' : cs.position; })(),
  railOnScreen: (() => { const r = document.querySelector('.jb-side').getBoundingClientRect();
    return r.right > 1 && r.width > 0; })(),
  rootW: Math.round(document.querySelector('.jb-root').getBoundingClientRect().width),
  mountW: Math.round(document.getElementById('james-bot').getBoundingClientRect().width),
  hamburgerVisible: (() => { const t = document.querySelector('.jb-side-toggle');
    if (!t) return false; const cs = getComputedStyle(t); const r = t.getBoundingClientRect();
    return cs.display !== 'none' && r.width > 0; })(),
  listScrolls: (() => { const l = document.querySelector('.jb-list'); return l.scrollHeight > l.clientHeight + 1; })(),
  composerPinned: (() => {
    const f = document.querySelector('.jb-form').getBoundingClientRect();
    const m = document.getElementById('james-bot').getBoundingClientRect();
    return f.bottom <= m.bottom + 1 && f.top >= m.top;
  })(),
  pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  pageY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
});

console.log('viewport      mount   rootW  cap?   floor?   tiers             rail          onScreen  listScroll  pinned  pageX');
console.log('-'.repeat(122));
let bad = 0;
let examined = 0;
// FINDING-065 — SAMPLING DENSITY. The rail gate is a claim across the whole
// width range and the height gate a claim across the whole height range, and
// neither sampled its own discontinuities: the tier boundaries (400/800/900,
// where railWrong flips) were STRADDLED by 375/520/900, and the FRAME_MIN_H
// clamp endpoint (avail == 420 at vh == 436) sat between the 380 and 520 rows.
// A boundary that is straddled is a boundary that is not tested — an off-by-one
// in a breakpoint moves the rail for a 1px band that no row ever visits.
//
// WIDTHS: every tier boundary at +/-1px, plus a wide row above the old cap.
// HEIGHTS: the clamp endpoint at +/-1px, plus rows either side of it.
const TIERS = tierBreakpoints(bundle);
const W_BOUNDARIES = TIERS.map((t) => t.at).sort((a, b) => a - b);
// The height clamp is DERIVED FROM TWO PROBES rather than parsed: the minified
// identifiers for FRAME_MIN_H and FRAME_GUTTER change between builds, and the
// literal 420 also appears as .jb-root's min-height, so a text match could
// bind to the wrong one. Measuring cannot mistake them.
//   tall  -> unclamped, so gutter   = vh - mountH
//   short -> clamped,   so minH     = mountH
//   clamp endpoint = minH + gutter
const probeTall = await boot(1280, 1100);
const mTall = await probeTall.evaluate(read);
await probeTall.close();
const probeShort = await boot(1280, 300);
const mShort = await probeShort.evaluate(read);
await probeShort.close();
const GUTTER = 1100 - mTall.mountH;
const MIN_H = mShort.mountH;
const H_CLAMP = MIN_H + GUTTER;
// The probes must actually bracket the clamp, or the derivation is meaningless.
if (!(mTall.mountH > MIN_H) || !(mShort.mountH === MIN_H) || !(GUTTER >= 0)) {
  console.log('VERDICT: INVALID — the clamp probes did not bracket the clamp ' +
    '(tall ' + mTall.mountH + ', short ' + mShort.mountH + '). No density claim made.');
  process.exit(1);
}
const CASES = [];
for (const b of W_BOUNDARIES) for (const d of [-1, 0, 1]) CASES.push([b + d, 800]);
for (const d of [-1, 0, 1]) CASES.push([1280, H_CLAMP + d]);
for (const c of [[1600, 1100], [1280, 1100], [1280, 520], [1280, 380], [1280, 300],
  [900, 800], [520, 800], [375, 800], [320, 700]]) CASES.push(c);
const SEEN = new Set();
const SWEEP = CASES.filter((c) => {
  const k = c[0] + 'x' + c[1];
  if (SEEN.has(k)) return false;
  SEEN.add(k); return true;
}).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
for (const [vw, vh] of SWEEP) {
  const page = await boot(vw, vh);
  const m = await page.evaluate(read);
  const expected = Math.max(420, vh - 0 - 16);
  const floored = m.mountH === 420;
  examined += 1;
  // THE RAIL IS GATED, NOT MERELY REPORTED. The sweep printed railPos and
  // railOnScreen without either feeding the verdict, so a regression where
  // the rail stopped collapsing at 375px would have printed 'static / yes'
  // and still passed. Narrow tiers must put it off-canvas; wide tiers must
  // keep it in flow and on screen.
  const narrow = m.tiers.indexOf('narrow') !== -1;
  const railWrong = narrow
    ? (m.railPos !== 'absolute' || m.railOnScreen)
    : (m.railPos !== 'static' || !m.railOnScreen);
  // FULL BLEED. --jb-max-w is removed: the root must take the whole mount at
  // every width, with no centring gap. The measure is held on the text column
  // instead — asserted in fluid_scale_chrome_check.mjs.
  // Fails on: restoring any max-width on .jb-root.
  const widthWrong = Math.abs(m.rootW - m.mountW) > 1;
  if (m.pageX || !m.listScrolls || !m.composerPinned || m.mountH !== expected ||
      railWrong || widthWrong) bad += 1;
  console.log(
    (vw + 'x' + vh).padEnd(14) + (m.mountH + 'px').padEnd(8) +
    (m.rootW + 'px').padEnd(7) + (Math.abs(m.rootW - m.mountW) <= 1 ? ' fills' : 'CAPPED').padEnd(7) +
    (floored ? 'FLOOR' : '  -').padEnd(9) + m.tiers.padEnd(18) +
    m.railPos.padEnd(14) + (m.railOnScreen ? 'yes' : 'no').padEnd(10) +
    (m.listScrolls ? 'yes' : 'NO').padEnd(12) + (m.composerPinned ? 'yes' : 'NO').padEnd(8) +
    (m.pageX ? 'YES' : 'no'));
  await page.close();
}

// CONTENT BELOW THE MOUNT must not be covered. jsdom cannot guard this at all
// (every rect there is zero, so spaceBelow always returns 0 and its removal is
// invisible), which is why it lives here.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.setContent('<!doctype html><html><body style="margin:0">' + MOUNT +
    '<div id="below" style="height:300px;background:#eee">below</div></body></html>',
    { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  await new Promise((r) => setTimeout(r, 500));
  const m = await page.evaluate(() => {
    const mr = document.getElementById('james-bot').getBoundingClientRect();
    const br = document.getElementById('below').getBoundingClientRect();
    return {
      mountH: Math.round(mr.height),
      covered: mr.bottom > br.top + 1,
      belowVisible: br.bottom <= window.innerHeight + 1 && br.height > 0,
      pageY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    };
  });
  const want = 1000 - 16 - 300; // viewport - gutter - the block below
  const ok = m.mountH === want && !m.covered && m.belowVisible && !m.pageY;
  if (!ok) bad += 1;
  console.log('');
  console.log('CONTENT BELOW THE MOUNT: mount ' + m.mountH + 'px (want ' + want + '), covers it: ' +
    m.covered + ', below still on screen: ' + m.belowVisible + ', page scrolls: ' + m.pageY +
    '  ' + (ok ? 'ok' : 'FAIL'));
  await page.close();
}

// FINDING-060 — THE HAMBURGER MUST GATE, NOT NARRATE.
// This block previously computed before/after/drawerOpen, printed MOVES or
// "present but inert", and touched nothing. Neutering the drawer toggle left
// both instruments green with the rail permanently off-canvas on a 375px phone
// and NO ROUTE TO CHAT HISTORY. Note where that sat: inside the block written
// to fix 059. Gating a value is not finished until the gate itself can fail.
// Fails on: no-op'ing the jb-drawer-open classList toggle.
{
  const page = await boot(375, 800);
  const before = await page.evaluate(() => document.querySelector('.jb-side').getBoundingClientRect().right);
  await page.evaluate(() => document.querySelector('.jb-side-toggle').click());
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => document.querySelector('.jb-side').getBoundingClientRect().right);
  const drawerOpen = await page.evaluate(() => document.querySelector('.jb-root').classList.contains('jb-drawer-open'));
  // The rail must actually TRAVEL, and end up on screen. Movement alone is not
  // enough — a 1px jitter is not a usable drawer.
  const moved = Math.round(after) - Math.round(before);
  const opened = drawerOpen && moved > 100 && Math.round(after) > 0;
  if (!opened) bad += 1;
  console.log('');
  console.log('HAMBURGER at 375px: rail right edge ' + Math.round(before) + 'px -> ' + Math.round(after) +
    'px (moved ' + moved + 'px), jb-drawer-open=' + drawerOpen +
    '  ' + (opened ? 'ok — a real, usable collapse' : 'FAIL — present but inert'));
  await page.close();
}
await browser.close();
console.log('');
// POSITIVE-ASSERTION RULE: a sweep that examined nothing reports the same
// 'every row as expected' as a sweep that examined everything.
console.log('INFORMATIONAL (not gated): hamburgerVisible — the control is');
console.log('  rendered at every width, so its presence cannot fail. What it');
console.log('  DOES is gated by the movement check above.');
console.log('SAMPLING DENSITY: tier boundaries ' + W_BOUNDARIES.join('/') + ' and the');
console.log('  height clamp at vh=' + H_CLAMP + ' are each sampled at +/-1px.');
console.log('  These are READ FROM THE BUILD, not restated: breakpoints parsed from the');
console.log('  bundle (' + TIERS.map((t) => t.tier + '<=' + t.at).join(', ') + '), clamp');
console.log('  derived as minH ' + MIN_H + ' + gutter ' + GUTTER + ' from two probes.');
console.log('viewport rows examined: ' + examined);
if (examined === 0) {
  console.log('VERDICT: INVALID — nothing was examined.');
  process.exit(1);
}
console.log('VERDICT: ' + (bad === 0 ? 'every row as expected' : bad + ' row(s) off'));
process.exit(bad === 0 ? 0 : 1);
