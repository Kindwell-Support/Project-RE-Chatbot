/**
 * TYPE SCALE — the pixel truth, in a real engine.
 *
 * jsdom cannot resolve var() in font-size: getComputedStyle hands back the raw
 * string, and where a control's own (0,2,0) rule uses a token jsdom drops it
 * and reports the inherited value instead. Every claim about what a control
 * ACTUALLY MEASURES therefore lives here and nowhere else.
 *
 * THREE THINGS ARE PROVEN, each with its own control:
 *
 *  A. The scale resolves. Every control reads the size its TOKEN implies, at
 *     whatever --jb-font-base the sheet currently declares — the expected
 *     values are derived from the resolved base, not written down per base.
 *
 *  B. The defensive layer is load-bearing — TWO fixtures, not one. The first
 *     is the (0,1,1) shape BUG-046 was captured from, which we beat on
 *     SPECIFICITY ALONE: (0,2,0) > (0,1,1). Against that fixture the entire
 *     !important layer could be deleted and nothing would go red, which is
 *     why the second fixture exists — the same selector carrying !important.
 *     An author !important beats a non-important declaration at ANY
 *     specificity, so only our own !important survives it. If the real GHL
 *     sheet uses !important, fixture two is the case BUG-046 exists for.
 *
 *  C. The knob's iOS trapdoor is closed. --jb-font-base is a knob someone
 *     will turn DOWN; below 16px a focused input makes mobile Safari zoom the
 *     whole host page. --jb-font-control:max(16px,…) pins the floor. Proven
 *     by driving the knob to 14px and checking the input holds at 16 while
 *     body text genuinely follows down to 14 (or the "floor" would just be a
 *     dead knob).
 *
 * POSITIVE-ASSERTION RULE: a sweep over an empty set passes vacuously, so the
 * examined count is asserted non-zero and an empty EXPECT is a loud failure.
 *
 * Usage: node tools/qa/type_scale_chrome_check.mjs   (or: npm run qa:chrome)
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');
const HOST_PX = '32px';

/**
 * Selector -> the TOKEN it should resolve from. Deliberately NOT pixel
 * literals: an earlier version of this file listed the base-16 values, which
 * pinned the check to one base rather than to the scale. Turning the knob to
 * 18px turned all eighteen rows red at once — loudly, not silently, so it
 * never certified a stale build — but a gate that must be hand-edited every
 * time the knob moves is a gate that will eventually be edited to match
 * whatever the code now does. The expected size is derived from the
 * --jb-font-base actually resolved in the page, so the check tracks the knob.
 */
const EXPECT = {
  // Text entry — floored at 16px by --jb-font-control.
  '.jb-input': 'control',
  '.jb-gate-input': 'control',
  '.jb-control': 'control',
  '.jb-btn': 'sm',
  '.jb-gate-btn': 'sm',
  '.jb-side-toggle': 'sm',
  '.jb-retry': 'sm',
  '.jb-gate-retry': 'sm',
  '.jb-btn-link': 'sm',
  '.jb-calc-error': 'sm',
  '.jb-new': 'xs',
  '.jb-chat-open': 'xs',
  '.jb-chat-act': 'xs',
  '.jb-side-retry': 'xs',
  '.jb-chat-confirm-yes': 'xs',
  '.jb-chat-confirm-no': 'xs',
  '.jb-chat-rename-input': 'xs',
  // Body text — the thing the whole pass is about.
  '.jb-bubble': 'md',
};

/** The scale, as declared on .jb-root. Kept here so a drift between this and
 *  the sheet shows up as a failure rather than being absorbed. */
const RATIO = { xs: 0.75, sm: 0.875, md: 1, lg: 1.125, xl: 1.25 };

/**
 * PADDING SURVIVES TOO. Four times now the host reset has taken a property we
 * only declared at the base tier: font-size (BUG-046), input padding, the
 * delete button's background, and the rail row padding — where the title ended
 * up flush against the pill inside GHL while /demo looked fine. These assert
 * the frame, not just the type: selector -> the custom property its horizontal
 * padding must resolve to, non-zero.
 */
const PAD_EXPECT = {
  '.jb-chat-open': 'rail',
  '.jb-new': 'rail',
  '.jb-chat-act': 'railSm',
  '.jb-input': null,
  '.jb-gate-input': null,
};
/** Rail inset ratios, mirroring the sheet. NOT read back via
 *  getPropertyValue: a custom property returns its RAW token
 *  ("calc(18px * 0.625)"), which parseFloat turns into NaN — an earlier
 *  version compared against that and failed three correct values. */
const PAD_RATIO = { rail: 0.625, railSm: 0.3125 };

const FIXTURES = [
  {
    name: 'host (0,1,1), no !important',
    note: 'we beat this on SPECIFICITY alone — see fixture 2',
    css: `.editor-content input, .editor-content select, .editor-content button,
          .editor-content textarea { font-size: ${HOST_PX}; padding: 0; }`,
  },
  {
    name: 'host (0,1,1) WITH !important',
    note: 'only our own !important survives this',
    css: `.editor-content input, .editor-content select, .editor-content button,
          .editor-content textarea { font-size: ${HOST_PX} !important; padding: 0 !important; }`,
  },
];

if (Object.keys(EXPECT).length === 0) {
  console.log('MEASUREMENT INVALID: EXPECT is empty — a sweep over an empty set');
  console.log('passes vacuously and certifies nothing. Refusing to report.');
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

async function run(fixtureCss) {
  const page = await browser.newPage();
  await page.setContent(
    '<!doctype html><html><head><style>' + fixtureCss + '</style></head>' +
      '<body style="margin:0"><div class="editor-content rich-text-viewer">' +
      '<div id="james-bot" style="width:860px;height:700px"></div></div></body></html>',
    { waitUntil: 'domcontentloaded' },
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() =>
    window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }),
  );
  await new Promise((r) => setTimeout(r, 700));

  const out = await page.evaluate((expect, ratio, padExpect, padRatio) => {
    const root = document.querySelector('.jb-root');
    root.classList.remove('jb-gated');
    const list = document.querySelector('.jb-list');
    // Seed the surfaces that only exist in particular states, under the same
    // ancestry so the cascade they see is the real one.
    const bubble = document.createElement('div');
    bubble.className = 'jb-row jb-bot';
    bubble.innerHTML = '<div class="jb-bubble">Body text at the base size.</div>';
    list.appendChild(bubble);
    const calc = document.createElement('div');
    calc.className = 'jb-calc jb-glass';
    calc.innerHTML =
      '<input class="jb-control" type="text"><div class="jb-calc-error">err</div>' +
      '<button class="jb-btn">Run</button><a class="jb-btn-link" href="#">Open</a>' +
      '<button class="jb-retry">Retry</button>';
    list.appendChild(calc);
    const gate = document.createElement('div');
    gate.className = 'jb-gate jb-glass';
    gate.innerHTML =
      '<input class="jb-gate-input" type="email"><button class="jb-gate-btn">Go</button>' +
      '<button class="jb-gate-retry">Retry</button>';
    root.appendChild(gate);
    const side = document.querySelector('.jb-side-list');
    if (side) {
      side.innerHTML =
        '<div class="jb-chat-row"><button class="jb-chat-open">' +
        '<span class="jb-chat-title">Tacoma duplex comps</span>' +
        '<span class="jb-chat-time">2h ago</span></button>' +
        '<button class="jb-chat-act">e</button></div>' +
        '<div class="jb-chat-row"><input class="jb-chat-rename-input" value="x"></div>' +
        '<div class="jb-chat-row"><div class="jb-chat-confirm">' +
        '<span class="jb-chat-confirm-q">Delete?</span>' +
        '<button class="jb-chat-confirm-yes">Delete</button>' +
        '<button class="jb-chat-confirm-no">Cancel</button></div></div>' +
        '<button class="jb-side-retry">Retry</button>';
    }

    // Derive the expected sizes from the base ACTUALLY RESOLVED in the page,
    // so the check follows the knob instead of pinning one value of it.
    const baseRaw = getComputedStyle(root).getPropertyValue('--jb-font-base').trim();
    const base = parseFloat(baseRaw);
    if (!base || Number.isNaN(base)) {
      return { INVALID: '--jb-font-base did not resolve (got "' + baseRaw + '")' };
    }
    const scale = {
      xs: base * ratio.xs, sm: base * ratio.sm, md: base * ratio.md,
      lg: base * ratio.lg, xl: base * ratio.xl,
      control: Math.max(16, base * ratio.md),
    };

    const rows = [];
    for (const [sel, token] of Object.entries(expect)) {
      const el = document.querySelector(sel);
      const want = scale[token];
      if (!el) { rows.push({ sel, token, got: 'MISSING', want, ok: false }); continue; }
      const gotPx = parseFloat(getComputedStyle(el).fontSize);
      rows.push({
        sel, token, got: getComputedStyle(el).fontSize, want,
        ok: Math.abs(gotPx - want) < 0.01,
      });
    }

    // CONTROL: a bare control under the same host sheet must take the host's
    // size. If it does not, the fixture is inert and every row above is
    // meaningless.
    const bare = document.createElement('input');
    document.querySelector('.editor-content').appendChild(bare);
    const bareSize = getComputedStyle(bare).fontSize;
    const barePad = getComputedStyle(bare).paddingLeft;

    const padRows = [];
    for (const [sel, prop] of Object.entries(padExpect)) {
      const el = document.querySelector(sel);
      if (!el) { padRows.push({ sel, got: 'MISSING', want: null, ok: false }); continue; }
      const got = parseFloat(getComputedStyle(el).paddingLeft);
      const want = prop ? base * padRatio[prop] : null;
      padRows.push({
        sel, got, want,
        ok: got > 0.01 && (want === null || Math.abs(got - want) < 0.01),
      });
    }

    // C — the knob's floor. Drive base DOWN and check both halves.
    root.style.setProperty('--jb-font-base', '14px');
    const knob = {
      input: getComputedStyle(document.querySelector('.jb-input')).fontSize,
      gateInput: getComputedStyle(document.querySelector('.jb-gate-input')).fontSize,
      control: getComputedStyle(document.querySelector('.jb-control')).fontSize,
      bubble: getComputedStyle(document.querySelector('.jb-bubble')).fontSize,
    };
    root.style.removeProperty('--jb-font-base');

    // FINDING-7 — rail hierarchy must survive on WEIGHT, not alpha.
    const title = document.querySelector('.jb-chat-title');
    const time = document.querySelector('.jb-chat-time');
    const rowEl = title ? title.closest('.jb-chat-row') : null;
    if (rowEl) rowEl.classList.add('jb-chat-pending');
    const hierarchy = title && time
      ? {
        titleWeight: getComputedStyle(title).fontWeight,
        timeWeight: getComputedStyle(time).fontWeight,
        titleColor: getComputedStyle(title).color,
        timeColor: getComputedStyle(time).color,
      }
      : null;
    if (rowEl) rowEl.classList.remove('jb-chat-pending');

    return { rows, padRows, bareSize, barePad, knob, hierarchy, base, scale };
  }, EXPECT, RATIO, PAD_EXPECT, PAD_RATIO);

  await page.close();
  return out;
}

let failures = 0;
let examined = 0;
let knobShown = false;

for (const fx of FIXTURES) {
  const out = await run(fx.css);
  const live = out.bareSize === HOST_PX;
  console.log('');
  console.log('FIXTURE: ' + fx.name);
  console.log('  ' + fx.note);
  console.log('  base resolved from the sheet: ' + out.base + 'px  ->  xs ' + out.scale.xs +
    ' / sm ' + out.scale.sm + ' / md ' + out.scale.md + ' / control ' + out.scale.control);
  console.log('  control — bare input under the same sheet reads ' + out.bareSize +
    (live ? '  (fixture IS live)' : '  (FIXTURE INERT — every row below is vacuous)'));
  if (!live) { failures += 1; continue; }
  console.log('');
  for (const r of out.rows) {
    examined += 1;
    if (!r.ok) failures += 1;
    console.log('    ' + r.sel.padEnd(26) + String(r.got).padStart(9) +
      '   want ' + (r.token + ' ' + r.want + 'px').padEnd(15) + (r.ok ? 'ok' : 'FAIL'));
  }

  console.log('');
  console.log('  PADDING — the frame, not the type (bare control reads ' + out.barePad + ')');
  for (const r of out.padRows) {
    examined += 1;
    if (!r.ok) failures += 1;
    console.log('    ' + r.sel.padEnd(26) + String(r.got).padStart(9) + 'px  ' +
      (r.want === null ? 'want non-zero' : 'want ' + r.want + 'px').padEnd(15) + (r.ok ? 'ok' : 'FAIL'));
  }

  if (!knobShown) {
    knobShown = true;
    const k = out.knob;
    console.log('');
    console.log('  KNOB FLOOR — --jb-font-base driven to 14px:');
    const floorOk = k.input === '16px' && k.gateInput === '16px' && k.control === '16px';
    const knobLive = k.bubble === '14px';
    console.log('    .jb-input      ' + k.input + '   want 16px  ' + (k.input === '16px' ? 'ok' : 'FAIL'));
    console.log('    .jb-gate-input ' + k.gateInput + '   want 16px  ' + (k.gateInput === '16px' ? 'ok' : 'FAIL'));
    console.log('    .jb-control    ' + k.control + '   want 16px  ' + (k.control === '16px' ? 'ok' : 'FAIL'));
    console.log('    .jb-bubble     ' + k.bubble + '   want 14px  ' + (knobLive ? 'ok (knob still moves — the floor is not a dead knob)' : 'FAIL'));
    if (!floorOk || !knobLive) failures += 1;

    const h = out.hierarchy;
    console.log('');
    console.log('  RAIL HIERARCHY on the PENDING row (weight, not alpha):');
    if (!h) {
      console.log('    rail rows not rendered — cannot report'); failures += 1;
    } else {
      const byWeight = Number(h.titleWeight) > Number(h.timeWeight);
      console.log('    title weight ' + h.titleWeight + ' vs time ' + h.timeWeight +
        '   ' + (byWeight ? 'ok — distinct without relying on colour' : 'FAIL — identical weight'));
      console.log('    (colours ' + (h.titleColor === h.timeColor ? 'MATCH, so weight is the only separator'
        : 'differ, weight is belt-and-braces') + ')');
      if (!byWeight) failures += 1;
    }
  }
}

console.log('');
console.log('controls examined: ' + examined + ' across ' + FIXTURES.length + ' fixtures');
if (examined === 0) {
  console.log('VERDICT: INVALID — nothing was examined; a clean sweep over an empty set.');
  await browser.close();
  process.exit(1);
}
console.log('VERDICT: ' + (failures === 0 ? 'PASS' : failures + ' failure(s)'));
await browser.close();
process.exit(failures === 0 ? 0 : 1);
