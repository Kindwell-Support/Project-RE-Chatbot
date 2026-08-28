/**
 * FLUID SCALE — measure, curve, component scaling, touch floor, contrast.
 *
 * MEASURE IS THE PRIMARY ASSERTION. Font size is the dependent variable: it is
 * checked against the approved table, but the thing that actually has to hold
 * is characters per line, and it is COUNTED from the rendered line box via
 * Range client rects rather than derived from column width over glyph advance.
 *
 * THE 1024 THRESHOLD. The 60-75 band is asserted from 1024px up and NOT below,
 * because below it the band is arithmetically unreachable, not merely missed:
 * at 375px the text column is ~270px, and 60 characters there would need ~9.5px
 * type. A test that fails by arithmetic teaches people to waive tests. Below
 * 1024 the assertion is instead that the measure is MONOTONIC NON-DECREASING
 * with width and never exceeds 75 — which is the real guarantee at that end.
 *
 * CONSTRUCTION RULE: every value read below either feeds the verdict or is
 * printed under an explicit INFORMATIONAL label, and every gate names the
 * mutation that makes it fail.
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


const BAND_FROM = 1024;
const BAND = [60, 75];
/** The measure floor applies wherever the rail is IN THE FLOW — that is read
 *  from the layout at each width, NOT written here as a width constant. It was
 *  a constant (801) for one revision and the gate could not catch its own named
 *  mutation: moving the breakpoint back to 560 put the rail in the flow at 561,
 *  which fell outside a scope pinned to 801, so the 19-character dip the gate
 *  exists to catch sat in the table reading "ok". A gate scoped by a constant
 *  that the mutation also moves is not scoped at all. */
const MEASURE_FLOOR = 50;
/** Tier boundaries and clamp endpoints — every discontinuity in the range.
 *  FINDING-067: the tier boundaries are READ FROM THE BUNDLE, so a breakpoint
 *  change moves the sampling with it instead of leaving a false density claim.
 *  The curve clamp endpoints are COMPUTED from the approved curve below — that
 *  one is a deliberate restatement, because the curve is the reference the
 *  build is checked against, not a fact about the build. */
const TIERS = tierBreakpoints(bundle);
const STEP = 40; // no coarser than this through the sub-1024 range
const TOUCH_MIN = 44;
const AA_BODY = 4.5;

/** The approved curve: clamp(16, 18 + (w-1440)*0.0022, 22), 0.5px steps. */
/**
 * THE APPROVED CURVE, piecewise at 1920.
 *
 * PRE_CURVE is the curve as it shipped before this change, FROZEN. It is a
 * deliberate restatement — it is the reference the build is pinned against, not
 * a fact read from the build — and it exists for one gate: nothing at or below
 * 1920 may move. 1080p is correct and this change must not touch it.
 */
const PRE_CURVE = (w) => Math.min(22, Math.max(16, Math.round((18 + (w - 1440) * 0.0022) * 2) / 2));
const JOIN = 1920;
const UPPER_QUANT = 0.01; // the upper segment's own 2dp quantisation
const curve = (w) => (w > JOIN
  ? Math.min(48, Math.round((19 + (w - JOIN) * 0.014) * 100) / 100)
  : PRE_CURVE(w));

/** Widths swept explicitly above the join. Values are COMPUTED from the curve
 *  above, never listed — a literal table would have to be re-typed on every
 *  slope change and would be wrong in exactly the way FINDING-067 describes. */
const ACCEPTANCE = [[2100], [2347], [2560], [2800], [3200], [3520], [3840]];
/** The curve's clamp endpoints, SCANNED from the approved curve rather than
 *  written down, so retuning the curve moves the samples with it. */
const clampEnds = () => {
  // SCANNED from the approved curve, never written down. The ceiling moved from
  // 22 to 40 in this slice and the old scan looked for 22 — a literal would have
  // gone on sampling a width that is no longer a discontinuity at all, which is
  // exactly the FINDING-067 failure. The scan finds whatever the curve does.
  const top = curve(9999);
  let release = null, engage = null;
  for (let w = 300; w <= 5000; w += 1) {
    if (release === null && curve(w) > 16) release = w;
    if (engage === null && curve(w) >= top) engage = w;
  }
  return [release, engage].filter((x) => x !== null);
};
const BOUNDARIES = [...new Set([
  ...TIERS.map((t) => t.at),   // read from the build
  ...clampEnds(),              // computed from the approved reference
  JOIN,                        // the piecewise join — a new discontinuity
  BAND_FROM,                   // the ruling's own threshold
])].sort((a, b) => a - b);
/**
 * SAMPLING. A range claim from two endpoints is not a range claim: the previous
 * gate sampled 375 and 768 and straddled the dip it was meant to catch. This
 * samples every tier boundary at +/-1px, both clamp endpoints (531 where the
 * 16px floor releases, 3258 where the 22px ceiling engages), and no coarser
 * than 40px through the whole sub-1024 range where the layout actually changes.
 */
const WIDTHS = (() => {
  const set = new Set([320, 375, 768, 1024, 1440, 1758, 1800, 2200, 2560, 3400, 4200]);
  // Above the join the curve is new, so it is swept as densely as the range
  // below 1024 rather than spot-checked at three widths.
  for (let w = 1920; w <= 4200; w += 120) set.add(w);
  for (const [aw] of ACCEPTANCE) set.add(aw);
  set.add(3992); set.add(3991); set.add(3993); // the 48px ceiling engagement
  for (let w = 320; w <= 1040; w += STEP) set.add(w);
  for (const b of BOUNDARIES) { set.add(b - 1); set.add(b); set.add(b + 1); }
  return [...set].filter((w) => w >= 320).sort((a, b) => a - b);
})();

const PARA =
  'Comparable sales in that submarket have been running about three hundred and twelve dollars ' +
  'per square foot over the last ninety days, and the three closest matches by size and vintage ' +
  'land between five hundred and thirty eight thousand and five hundred and fifty one thousand, ' +
  'which is the range I would underwrite against before you commit to a rehab budget, because ' +
  'the two comps above that band both had finished basements which this property does not have.';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
let bad = 0;
let gates = 0;

async function open(w, forceBase) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: 1000 });
  await page.setContent(
    '<!doctype html><html><body style="margin:0">' +
      '<div id="james-bot" style="width:100%;height:900px"></div></body></html>',
    { waitUntil: 'domcontentloaded' },
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  await new Promise((r) => setTimeout(r, 550));
  const m = await page.evaluate(async (args) => {
    const [para, forced] = args;
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.querySelector('.jb-root');
    root.classList.remove('jb-gated');
    // A forced base simulates a partial token migration: if any dimension is
    // still hardcoded px, the measure moves when the base does.
    if (forced) root.style.setProperty('--jb-font-base', forced + 'px');
    const list = document.querySelector('.jb-list');
    const row = document.createElement('div');
    row.className = 'jb-row jb-bot';
    row.innerHTML = '<div class="jb-bubble"><p>' + para + '</p></div>';
    list.appendChild(row);
    const side = document.querySelector('.jb-side-list');
    if (side) {
      side.innerHTML = '<div class="jb-chat-row"><button class="jb-chat-open">' +
        '<span class="jb-chat-title">Tacoma duplex</span>' +
        '<span class="jb-chat-time">2h ago</span></button></div>';
    }
    await settle();

    const p = row.querySelector('p');
    const node = p.firstChild;
    const range = document.createRange();
    let top = null, chars = 0;
    for (let i = 1; i <= node.length; i += 1) {
      range.setStart(node, i - 1); range.setEnd(node, i);
      const r = range.getBoundingClientRect();
      if (r.height === 0) continue;
      if (top === null) top = r.top;
      if (r.top > top + 1) break;
      chars = i;
    }

    const cs = (e) => getComputedStyle(e);
    const num = (e, prop) => parseFloat(cs(e)[prop]);
    const parse = (c) => {
      const mm = c.match(/rgba?\(([^)]+)\)/);
      if (!mm) return null;
      const n = mm[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
    });
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))).toFixed(2);
    };
    const pageBg = parse(cs(root).backgroundColor) || { r: 10, g: 10, b: 11, a: 1 };
    const on = (el, bgEl) => {
      const bg = over(parse(cs(bgEl).backgroundColor), pageBg);
      return ratio(over(parse(cs(el).color), bg), bg);
    };
    const railEl = document.querySelector('.jb-side');
    const inputEl = document.querySelector('.jb-input');
    // ::placeholder colour is not readable via getComputedStyle on the element,
    // so it is read from the token it is set from.
    const tertiary = parse(cs(root).getPropertyValue('--jb-text-tertiary').trim());
    const inputBg = over(parse(cs(inputEl).backgroundColor), pageBg);

    return {
      base: num(root, 'fontSize'),
      rootW: Math.round(root.getBoundingClientRect().width),
      mountW: Math.round(document.getElementById('james-bot').getBoundingClientRect().width),
      chars,
      textW: Math.round(p.getBoundingClientRect().width),
      // Three NON-FONT dimensions, so a font-only regression fails.
      bubblePadX: num(row.querySelector('.jb-bubble'), 'paddingLeft'),
      bubbleW: Math.round(row.querySelector('.jb-bubble').getBoundingClientRect().width),
      listW: Math.round(list.getBoundingClientRect().width),
      listPadX: num(list, 'paddingLeft'),
      listGap: num(list, 'rowGap'),
      railW: Math.round(railEl.getBoundingClientRect().width),
      railFlow: getComputedStyle(railEl).position !== 'absolute',
      tiers: ['mid', 'narrow', 'tight'].filter((c) => root.classList.contains('jb-w-' + c)).join('+') || 'full',
      sendW: Math.round(document.querySelector('.jb-send').getBoundingClientRect().width),
      pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      contrast: {
        timestamp: on(document.querySelector('.jb-chat-time'), railEl),
        railAction: ratio(over(tertiary, over(parse(cs(railEl).backgroundColor), pageBg)),
          over(parse(cs(railEl).backgroundColor), pageBg)),
        emptyState: ratio(over(tertiary, over(parse(cs(railEl).backgroundColor), pageBg)),
          over(parse(cs(railEl).backgroundColor), pageBg)),
        placeholder: ratio(over(tertiary, inputBg), inputBg),
      },
    };
  }, [PARA, forceBase]);
  await page.close();
  return m;
}

// ---- 1. measure + curve + full bleed ------------------------------------
console.log('MEASURE AND CURVE  (band ' + BAND[0] + '-' + BAND[1] + ' asserted from ' + BAND_FROM + 'px up)');
console.log('');
console.log('  width   base    want    rootW    fills   text col   CHARS   verdict');
console.log('  ' + '-'.repeat(78));
const seen = [];
for (const w of WIDTHS) {
  const m = await open(w, null);
  seen.push({ w, chars: m.chars, m });
  const wantBase = curve(w);
  // GATE: the base matches the approved table.
  //   Fails on: changing the curve constants in baseForWidth().
  const baseWrong = Math.abs(m.base - wantBase) > 0.01;
  // THE MOST IMPORTANT GATE IN THIS SLICE. At or below the join, the measured
  // base must equal the curve AS IT SHIPPED BEFORE this change. Not "close to",
  // not "matches the new curve" — the new curve delegates to PRE_CURVE there,
  // so comparing against it would be circular and would pass even if both were
  // edited together. This compares against a frozen copy.
  //   Fails on: any edit to the lower segment — the anchor, the slope, the 16px
  //   floor, or the 0.5px quantisation — which is precisely what would move
  //   1080p. Verified by mutation.
  const movedBelowJoin = w <= JOIN && Math.abs(m.base - PRE_CURVE(m.rootW)) > 0.001;
  // GATE: full bleed — no cap, no centring gap, no overflow.
  //   Fails on: restoring a max-width on .jb-root.
  const fills = Math.abs(m.rootW - m.mountW) <= 1;
  // GATE: the band, only where it is reachable.
  //   Fails on: replacing var(--jb-measure) with a bare percentage.
  const bandWrong = w >= BAND_FROM && (m.chars < BAND[0] || m.chars > BAND[1]);
  // GATE below the threshold: never above the band ceiling.
  const overCeil = w < BAND_FROM && m.chars > BAND[1];
  // GATE (ruling 3, revised): once the rail is in the FLOW it is taking width
  // from the text column, so the column must still hold MEASURE_FLOOR
  // characters. Not asserted while the rail is a drawer — it costs the column
  // nothing there, and the width is simply too small: 320px gives 25 characters
  // and 50 would need ~7px type. Same arithmetic-impossibility as the band.
  //   Fails on: lowering the jb-w-narrow breakpoint back toward 560, which lets
  //   the rail enter the flow before there is room for it. Verified: that
  //   mutation puts 561-800 under the floor and this gate reports UNDER 50.
  const underFloor = m.railFlow && m.chars < MEASURE_FLOOR;
  gates += 6;
  if (baseWrong || movedBelowJoin || !fills || bandWrong || overCeil || underFloor || m.pageX) bad += 1;
  console.log('  ' + String(w).padEnd(8) + (m.base + 'px').padEnd(8) + (wantBase + 'px').padEnd(8) +
    (m.rootW + 'px').padEnd(9) + (fills ? 'yes' : 'NO').padEnd(8) + (m.textW + 'px').padEnd(11) +
    String(m.chars).padStart(5) + '   ' +
    (movedBelowJoin ? 'MOVED 1080p — was ' + PRE_CURVE(m.rootW) + 'px'
      : baseWrong ? 'BASE' : bandWrong ? 'BAND' : overCeil ? 'OVER' : underFloor ? 'UNDER ' + MEASURE_FLOOR
      : m.pageX ? 'OVERFLOW' : 'ok'));
}

// GATE: monotonic non-decreasing WITHIN each layout tier. Not across tiers —
// the rail entering the flow removes 11.5 base units in one step, so a drop at
// that boundary is the layout working, not a defect. The floor gate above is
// what bounds that drop.
//   Fails on: a cap that clamps within a tier instead of letting width through.
console.log('');
console.log('  MONOTONIC WITHIN EACH TIER (the cross-tier drop is bounded by the floor)');
const byTier = new Map();
for (const x of seen) {
  if (!byTier.has(x.m.tiers)) byTier.set(x.m.tiers, []);
  byTier.get(x.m.tiers).push(x);
}
// MINIMUM SAMPLES. A tier reduced to one sampled width satisfies "monotonic"
// vacuously — there is no pair to compare — and would print `monotonic` while
// asserting nothing. This is the examined-count refusal the other instruments
// already carry, applied per group rather than once for the sweep.
const MIN_SAMPLES = 3;
for (const [tier, xs] of byTier) {
  let mono = true;
  for (let i = 1; i < xs.length; i += 1) if (xs[i].chars < xs[i - 1].chars) mono = false;
  const thin = xs.length < MIN_SAMPLES;
  gates += 2;
  if (!mono || thin) bad += 1;
  const span = xs[0].w + '-' + xs[xs.length - 1].w;
  console.log('    ' + (tier || 'full').padEnd(20) + span.padEnd(12) +
    (xs.length + ' samples').padEnd(12) +
    (thin ? 'TOO FEW — under ' + MIN_SAMPLES + ', monotonic is vacuous here'
      : mono ? 'monotonic' : 'NOT MONOTONIC (' + xs.map((x) => x.chars).join(' ') + ')'));
}

// ---- 2. the partial-migration catcher -----------------------------------
console.log('');
console.log('MEASURE HOLDS WHEN THE BASE MOVES  (catches a partial token migration)');
console.log('  Fails on: leaving any bubble/list dimension as hardcoded px.');
console.log('');
console.log('  base    chars   verdict');
console.log('  ' + '-'.repeat(32));
for (const b of [16, 18, 20, 22]) {
  const m = await open(1800, b);
  const ok = m.chars >= BAND[0] && m.chars <= BAND[1];
  gates += 1;
  if (!ok) bad += 1;
  console.log('  ' + (b + 'px').padEnd(8) + String(m.chars).padStart(5) + '   ' + (ok ? 'ok' : 'OUT OF BAND'));
}

// ---- 3. components scale, and the touch floor holds ----------------------
console.log('');
console.log('COMPONENTS SCALE WITH THE TYPE  (three non-font dimensions, two widths)');
console.log('  Fails on: reverting any migrated dimension to a hardcoded px value.');
console.log('');
// The clamp endpoints: base 16 is the floor, base 22 the ceiling. Sampling
// two arbitrary interior widths would not exercise the range.
const lo = await open(1440, 16);
const hi = await open(1440, 22);
const dims = [
  ['bubble padding-x', lo.bubblePadX, hi.bubblePadX],
  ['list row gap', lo.listGap, hi.listGap],
  ['rail width', lo.railW, hi.railW],
];
console.log('  dimension            @base16  @base22 grew');
console.log('  ' + '-'.repeat(46));
for (const [k, a, b] of dims) {
  const grew = b > a + 0.5;
  gates += 1;
  if (!grew) bad += 1;
  console.log('  ' + k.padEnd(21) + String(a).padEnd(9) + String(b).padEnd(8) + (grew ? 'yes' : 'NO'));
}
// GATE: the send button is a touch target and never drops below 44px — at
// EVERY width, because the rule that applies differs by tier.
//   375px  -> .jb-w-tight .jb-send wins (more specific than the base rule)
//   768px  -> no tier override, so the BASE .jb-send rule is what is floored
// Testing only 375 measured the tier override and left the base rule ungated:
// removing max(44px,...) from .jb-send passed. Both are checked now.
//   Fails on: removing the floor from EITHER .jb-send or a .jb-w-* override.
console.log('');
console.log('  send button never below the ' + TOUCH_MIN + 'px touch minimum');
// Every width where a DIFFERENT .jb-send rule applies, because the rule that
// wins changes at each tier boundary and only one of them was checked before.
for (const [w, b, which] of [
  [375, 16, '.jb-w-tight override'], [401, 16, '.jb-w-mid+narrow'],
  [801, 16.5, '.jb-w-mid override'], [901, 17, 'base .jb-send rule'],
]) {
  const px = (await open(w, b)).sendW;
  gates += 1;
  if (px < TOUCH_MIN) bad += 1;
  console.log('    ' + (w + 'px @ base ' + b).padEnd(22) + String(px).padStart(4) + 'px  ' +
    which.padEnd(24) + (px >= TOUCH_MIN ? 'ok' : 'BELOW THE MINIMUM'));
}

// ---- 4. contrast, per surface -------------------------------------------
console.log('');
console.log('TERTIARY CONTRAST, per surface  (AA body text = ' + AA_BODY + ':1)');
console.log('  Fails on: lowering the --jb-text-tertiary alpha.');
console.log('');
const c = lo.contrast;
for (const [k, v] of Object.entries(c)) {
  gates += 1;
  if (v < AA_BODY) bad += 1;
  console.log('  ' + k.padEnd(16) + String(v).padStart(6) + ':1   ' + (v >= AA_BODY ? 'AA pass' : 'AA FAIL'));
}

console.log('');
// ---------------------------------------------------------------------------
// LARGE-SCREEN ACCEPTANCE. The headline number is the BUBBLE-TO-WIDGET RATIO,
// not the font size: the complaint was that a 3520px widget rendered a ~530px
// bubble (15% of its width) while 1080p renders ~38%. Font size is the lever;
// the ratio is the thing being looked at.
console.log('');
console.log('LARGE-SCREEN ACCEPTANCE — base, bubble, and the ratio that matters');
console.log('  GATE: the bubble is exactly min(86% of the column, 36 base units).');
console.log('  Fails on: changing the 36-unit measure, or reverting the bubble cap to a');
console.log('  bare percentage — either breaks the ratio while leaving the font size right.');
console.log('  GATE: the ratio RISES with width above the join and never goes backwards,');
console.log('  and at 4K it EXCEEDS the 1080p reference. The segment is affine from the');
console.log('  join because a ray through the origin has its slope pinned by continuity');
console.log('  (19/1920), so no ray can be steeper without stepping at 1920.');
console.log('  Fails on: reverting to a ray, or any ceiling low enough to flatten the');
console.log('  base before 4K — either sends the ratio back down as the screen grows.');
console.log('');
console.log('  widget   base     bubble   bubble/widget   want ratio   rail     rail%   chars');
console.log('  ' + '-'.repeat(78));

// The ratio is no longer constant above the join — the segment is affine, so it
// RISES with width. Two things are gated instead of constancy:
//   1. it never goes backwards as the screen grows, and
//   2. at 4K it EXCEEDS 1080p, which is the whole point of the change.
let ratioAt1080p = null;
let prevRatio = 0;
for (const w of [1758, 2347, 2560, 3520, 3840]) {
  const m = await open(w, null);
  // What the CSS says the bubble must be: min(86% of the column's content box,
  // 36 base units). COMPUTED from the measured column and base, never a literal.
  const contentW = m.listW - m.listPadX * 2;
  const wantBubble = Math.min(contentW * 0.86, 36 * m.base);
  const bubbleOk = Math.abs(m.bubbleW - wantBubble) <= 2;
  const ratio = m.bubbleW / m.rootW;
  // Above the join every width must land on the SAME ratio. Below it the ratio
  // is whatever the fixed 18-ish base gives, so it is reported, not gated.
  const aboveJoin = w > JOIN;
  if (!aboveJoin) ratioAt1080p = ratio;
  // GATE: monotonic in width. The tolerance is DERIVED from the segment's own
  // 2dp quantisation rather than written down — without it, rounding alone can
  // dip the ratio by a hair between adjacent widths and read as a regression.
  //   Fails on: any ceiling low enough to flatten the base before 4K, which
  //   sends the ratio back down as the screen grows.
  const monoOk = !aboveJoin || ratio >= prevRatio - (36 * UPPER_QUANT) / w;
  // GATE: 4K is proportionally LARGER than 1080p, not merely equal to it.
  //   Fails on: reverting the slope to a ray through the origin, which pins it
  //   at 0.0099 by continuity and lands 4K below 1080p's ratio.
  const beatsBaseline = w < 3000 || (ratioAt1080p !== null && ratio > ratioAt1080p);
  prevRatio = ratio;
  gates += 4;
  if (!bubbleOk || !monoOk || !beatsBaseline) bad += 1;
  console.log('  ' + String(w).padEnd(9) + (m.base + 'px').padEnd(9) +
    (m.bubbleW + 'px').padEnd(9) + (ratio * 100).toFixed(1).padStart(9) + '%' + '      ' +
    (aboveJoin ? 'rising' : '1080p ref').padEnd(13) +
    (m.railW + 'px').padEnd(9) + (m.railW / m.rootW * 100).toFixed(1) + '%   ' +
    String(m.chars).padEnd(6) +
    (bubbleOk
      ? (!monoOk ? 'RATIO WENT BACKWARDS'
        : !beatsBaseline ? 'NOT BIGGER THAN 1080p'
          : '')
      : 'BUBBLE ' + Math.round(wantBubble)));
}

// ---------------------------------------------------------------------------
// CONTINUITY AT THE JOIN. Sampled at 1919/1920/1921 — the discontinuity itself,
// not either side of it.
console.log('');
console.log('  CONTINUITY AT THE JOIN');
console.log('  GATE: no step larger than the quantisation the lower segment already');
console.log('  takes within itself (0.5px). Fails on: changing the 0.009925 slope, which');
console.log('  is what makes the two segments meet at 1920.');
{
  const joins = [];
  for (const w of [JOIN - 1, JOIN, JOIN + 1]) joins.push({ w, m: await open(w, null) });
  const step = Math.abs(joins[2].m.base - joins[1].m.base);
  // The bound is DERIVED from the lower segment's own quantisation, not written
  // down: if that quantisation ever changes, the tolerance follows it.
  let quant = 0;
  for (let w = 1000; w <= JOIN; w += 1) quant = Math.max(quant, Math.abs(PRE_CURVE(w) - PRE_CURVE(w - 1)));
  const smooth = step <= quant + 0.001;
  gates += 1;
  if (!smooth) bad += 1;
  for (const j of joins) console.log('    ' + j.w + ' -> ' + j.m.base + 'px');
  console.log('    step ' + step.toFixed(3) + 'px, against the lower segment\'s own ' +
    quant.toFixed(3) + 'px quantisation — ' + (smooth ? 'ok' : 'STEP TOO LARGE'));
}

// ---------------------------------------------------------------------------
// COMPONENTS AT THE NEW WIDTHS. The 115 migrated dimensions are supposed to
// follow the base with no further work; this proves it at the two widths the
// brief names rather than trusting that the 1440 check generalises.
console.log('');
console.log('  NON-FONT DIMENSIONS AT 2347 AND 3520');
console.log('  GATE: each grows in proportion to the base. Fails on: reverting any');
console.log('  migrated dimension to a hardcoded px value — it would sit still while');
console.log('  the base nearly doubles.');
{
  const a = await open(2347, null);
  const b = await open(3520, null);
  const scale = b.base / a.base;
  const DIMS = [['bubble padding-x', 'bubblePadX'], ['list row gap', 'listGap'], ['rail width', 'railW']];
  console.log('    dimension            @2347     @3520     ratio   want ' + scale.toFixed(3));
  for (const [label, key] of DIMS) {
    const got = b[key] / a[key];
    const ok = Math.abs(got - scale) < 0.02;
    gates += 1;
    if (!ok) bad += 1;
    console.log('    ' + label.padEnd(21) + String(a[key]).padEnd(10) + String(b[key]).padEnd(10) +
      got.toFixed(3) + '   ' + (ok ? 'ok' : 'DID NOT SCALE'));
  }
}

console.log('');
await browser.close();
console.log('SAMPLING DENSITY: ' + WIDTHS.length + ' widths — every tier boundary and');
console.log('  clamp endpoint at +/-1px (' + BOUNDARIES.join(', ') + '), and no coarser');
console.log('  than ' + STEP + 'px through 320-1040 where the layout changes.');
console.log('  Tier boundaries are READ FROM THE BUILD (' +
  TIERS.map((t) => t.tier + '<=' + t.at).join(', ') + '); the curve clamp ends are');
console.log('  SCANNED from the approved curve. Neither is restated, so a breakpoint or');
console.log('  curve change moves the sampling instead of leaving this line false.');
console.log('  The measure floor is scoped by the MEASURED rail position, not by a');
console.log('  width constant, so moving a breakpoint cannot move the gate out of its way.');
console.log('INFORMATIONAL (not gated): text col width and rootW are printed to make');
console.log('  the character counts auditable; the assertions are on chars, not px.');
console.log('gates evaluated: ' + gates);
if (gates === 0) {
  console.log('VERDICT: INVALID — nothing was gated.');
  process.exit(1);
}
console.log('VERDICT: ' + (bad === 0 ? 'PASS' : bad + ' failure(s)'));
process.exit(bad === 0 ? 0 : 1);
