/**
 * FRAME SETTLE — the geometry is not final at mount (FINDING-068).
 *
 * GHL's Custom JS applies .ajm-lesson after the widget mounts, hiding the
 * comments container and Mark As Complete. Those sit BELOW the widget, so what
 * changes is spaceBelow() — 324px on the repro — while mountTop does not move
 * at all. The height computed at mount is short by that much and nothing
 * re-runs, because the ResizeObserver watches the ROOT, whose height we set
 * ourselves, so its box never changes on its own.
 *
 * THIS LIVES IN CHROME, NOT JSDOM. Every value here is a rect, and jsdom has no
 * layout engine — getBoundingClientRect() returns zeros, so spaceBelow() always
 * returns 0 and the entire defect is invisible there. The blind spot is
 * documented in tests/viewportFrame.test.ts.
 *
 * CONSTRUCTION RULES. Every value below either feeds the verdict or is printed
 * under an explicit INFORMATIONAL label; each gate names the mutation that makes
 * it fail; the delay range samples its own discontinuity (the settle deadline)
 * at either side; and no gate is scoped by a constant its own mutation moves.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle = readFileSync('public/widget.js', 'utf8');
const source = readFileSync('widget/widget.js', 'utf8');

/**
 * The settle bounds are READ FROM THE BUILD, not restated (FINDING-067). They
 * come from the SOURCE rather than the minified bundle because minified
 * identifier chains change shape with the bundler, and tests/bundleFreshness
 * already pins source to bundle — so the source is the honest place to read a
 * constant whose name the minifier erases.
 */
function constant(name) {
  const m = source.match(new RegExp('var ' + name + ' = (\\d+);'));
  if (!m) {
    console.log('VERDICT: INVALID — could not read ' + name + ' from widget/widget.js.');
    console.log('  The sampling and the termination ceiling are both derived from it, so');
    console.log('  no claim can be made without it. Check the declaration shape.');
    process.exit(1);
  }
  return Number(m[1]);
}
const SETTLE_MAX_MS = constant('SETTLE_MAX_MS');
const STABLE_FRAMES = constant('SETTLE_STABLE_FRAMES');

/**
 * SAMPLING. The delay at which GHL's class lands is a range whose one
 * discontinuity is the settle deadline, so it is sampled either side of it.
 *
 * A NOTE ON WHAT THIS RANGE ACTUALLY PROVES. The first version of this comment
 * claimed the rows below the deadline were repaired by the rAF loop and the rows
 * above by the ancestor observer. Mutation testing disproved it: removing the
 * ancestor observation fails EVERY row, including 60ms. The loop exits after
 * SETTLE_STABLE_FRAMES stable frames — about 64ms — so it is long finished
 * before a class that lands at 250ms. Every row here is the observer's work.
 * The loop is gated separately, on a fixed-height-ancestor fixture where no
 * ancestor box changes and the observer cannot fire at all.
 */
const DELAYS = [0, 60, 250, SETTLE_MAX_MS - 200, SETTLE_MAX_MS + 200, SETTLE_MAX_MS * 2];

const HTML = `<!doctype html><html><head><style>
  body { margin:0; }
  .ajm-lesson .comments-container, .ajm-lesson .mark-complete { display:none; }
</style></head><body>
  <div class="wrap">
    <div class="lesson-head" style="height:120px;background:#eee">lesson header</div>
    <div id="james-bot" style="width:100%"></div>
    <div class="comments-container" style="height:260px;background:#ffd">comments</div>
    <div class="mark-complete" style="height:64px;background:#fdd">Mark As Complete</div>
  </div>
</body></html>`;

// The widget's own spaceBelow(), so "what the height SHOULD be" is computed the
// way applyFrame computes it rather than assumed.
const PROBE = `(function () {
  var el = document.getElementById('james-bot');
  function spaceBelow(e) {
    var bottom = e.getBoundingClientRect().bottom, total = 0, node = e;
    while (node && node.parentElement && node !== document.body) {
      var sib = node.nextElementSibling;
      while (sib) {
        var r = sib.getBoundingClientRect();
        if (r.height > 0 && r.top >= bottom - 1) total += r.height;
        sib = sib.nextElementSibling;
      }
      node = node.parentElement;
    }
    return total;
  }
  var top = el.getBoundingClientRect().top;
  return {
    mountTop: Math.round(top),
    spaceBelow: Math.round(spaceBelow(el)),
    want: Math.max(420, Math.round(window.innerHeight - top - 16 - spaceBelow(el))),
    got: Math.round(el.getBoundingClientRect().height),
    rafs: window.__raf || 0,
  };
})()`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
let bad = 0;
let gates = 0;
let examined = 0;

async function boot(vh) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: vh || 900 });
  await page.setContent(HTML, { waitUntil: 'domcontentloaded' });
  // The frame counter is installed AS A SCRIPT TAG, immediately before the
  // bundle. evaluateOnNewDocument does not run for setContent — it hooks
  // navigations — so the first version of this counted zero frames, which made
  // every termination gate below vacuously true: `0 === 0` is quiescent and
  // `0 <= ceiling` is bounded no matter what the widget does. The rafsInstalled
  // gate exists so that failure can never be silent again.
  await page.addScriptTag({
    content: 'window.__raf = 0; (function () { var orig = window.requestAnimationFrame;' +
      'window.requestAnimationFrame = function (fn) { window.__raf += 1; return orig.call(window, fn); }; })();',
  });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() =>
    window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
console.log('FRAME SETTLE — late layout change repaired, bounded');
console.log('settle bounds read from source: ' + STABLE_FRAMES + ' stable frames, ' +
  SETTLE_MAX_MS + 'ms deadline');
console.log('');
console.log('  GATE: a layout change after mount must be picked up, at every delay.');
console.log('  Fails on: dropping the ancestor-chain observation. Every row here is');
console.log('  repaired by that observer — proven by mutation, not assumed. An earlier');
console.log('  version of this table claimed the rows under the deadline were repaired');
console.log('  by the settle LOOP; they are not. The loop exits after ' + STABLE_FRAMES +
  ' stable frames,');
console.log('  about 64ms, so it is finished long before a class that lands at 250ms.');
console.log('  The loop has its own gate below, on a fixture where it is the only');
console.log('  mechanism that can help.');
console.log('');
console.log('  delay     before  after   want    verdict');
console.log('  ' + '-'.repeat(46));

for (const ms of DELAYS) {
  const page = await boot(900);
  await wait(60);
  const before = await page.evaluate(PROBE);
  await page.evaluate((delay) => {
    setTimeout(() => { document.querySelector('.wrap').classList.add('ajm-lesson'); }, delay);
  }, ms);
  await wait(ms + 900);
  const after = await page.evaluate(PROBE);
  await page.close();
  examined += 1;

  // GATE 1: the height ends at the value applyFrame would compute now.
  const correct = after.got === after.want;
  // GATE 2: and it is NOT the pre-collapse value — otherwise a fixture where
  // nothing ever moved would pass this row without testing anything.
  const moved = after.got !== before.got;
  gates += 2;
  if (!correct || !moved) bad += 1;
  console.log('  ' + (ms + 'ms').padEnd(10) +
    String(before.got).padEnd(8) + String(after.got).padEnd(8) +
    String(after.want).padEnd(8) +
    (correct ? (moved ? 'ok' : 'VACUOUS — height never moved') : 'WRONG HEIGHT'));
}

// ---------------------------------------------------------------------------
// TERMINATION. The bound that matters is that the loop STOPS: a page a member
// leaves open must not be requesting frames forever.
console.log('');
console.log('  GATE: the settle loop terminates.');
console.log('  Fails on: removing either exit from settleStep (the stable-frame count');
console.log('  or the deadline), which turns it into an unbounded rAF loop.');
{
  const page = await boot(900);
  await wait(60);
  await page.evaluate(() => { document.querySelector('.wrap').classList.add('ajm-lesson'); });
  // Well past the deadline, so a terminating loop is certainly finished.
  await wait(SETTLE_MAX_MS + 800);
  const settled = await page.evaluate(PROBE);
  await wait(1200);
  const quiet = await page.evaluate(PROBE);
  await page.close();

  // GATE 3a: THE COUNTER MUST HAVE COUNTED. A zero here means the patch never
  // installed, and every assertion below it is comparing 0 to 0 — passing
  // without testing anything. This is the positive-assertion rule applied to
  // the instrument's own apparatus rather than to the subject.
  const rafsInstalled = settled.rafs > 0;
  // GATE 3: no further frames requested during a quiet window after the deadline.
  const quiescent = quiet.rafs === settled.rafs;
  // GATE 4: and the total is bounded by what the window can hold — one frame
  // per ~16ms of settle window, doubled for slack, plus the fonts.ready settle.
  // DERIVED from SETTLE_MAX_MS, so shortening the window tightens the ceiling
  // with it rather than leaving a ceiling nothing can reach.
  const ceiling = Math.ceil((SETTLE_MAX_MS / 16) * 2) + 20;
  const bounded = settled.rafs <= ceiling;
  gates += 3;
  if (!rafsInstalled || !quiescent || !bounded) bad += 1;
  console.log('    frames requested by the deadline: ' + settled.rafs + ' (ceiling ' + ceiling + ') ' +
    (!rafsInstalled ? 'COUNTER NOT INSTALLED — the termination gates would be vacuous'
      : bounded ? 'ok' : 'OVER CEILING'));
  console.log('    frames requested in the 1.2s after: ' + (quiet.rafs - settled.rafs) + ' ' +
    (quiescent ? 'ok — the loop stopped' : 'STILL RUNNING'));
}

// ---------------------------------------------------------------------------
// THE SETTLE LOOP'S OWN GATE. Removing the loop passed every gate above,
// because the ancestor observer repairs all of those rows on its own — a gate
// naming a mutation it cannot catch. This fixture is the case only the loop can
// handle: the ancestor has a FIXED height, so hiding content inside it changes
// no ancestor box at all. Nothing resizes; the mount simply moves up. The root's
// own box is set by us, the ancestors' boxes do not move, and the only thing
// that can notice is a recompute on the next frames.
//
// This is a real shape, not a contrivance: a fixed-height lesson container with
// content that collapses inside it.
console.log('');
console.log('  GATE: a same-frame collapse inside a FIXED-HEIGHT ancestor is caught.');
console.log('  Fails on: removing the rAF loop from settle() (proven — the height');
console.log('  stays at 584 where it should reach 884). NOT on merely swapping the');
console.log('  settle() call at the end of mount for applyFrame(): fonts.ready still');
console.log('  calls settle(), so the loop survives that edit and this gate correctly');
console.log('  keeps passing.');
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setContent(`<!doctype html><html><head><style>
    body { margin:0; }
    .fixed-wrap { height: 800px; }
    .collapsed .above { display:none; }
  </style></head><body>
    <div class="fixed-wrap">
      <div class="above" style="height:300px;background:#dfd">collapses</div>
      <div id="james-bot" style="width:100%"></div>
    </div>
  </body></html>`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({
    content: 'window.__raf = 0; (function () { var orig = window.requestAnimationFrame;' +
      'window.requestAnimationFrame = function (fn) { window.__raf += 1; return orig.call(window, fn); }; })();',
  });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() =>
    window.createJamesBot({ apiUrl: 'https://example.invalid', target: '#james-bot' }));
  const probeFixed = PROBE.replace(".wrap", ".fixed-wrap");
  const before = await page.evaluate(probeFixed);
  // Lands on the very next frames — inside the settle window, which is the only
  // window that exists for a change no observer can see.
  await page.evaluate(() => {
    requestAnimationFrame(() => { document.querySelector('.fixed-wrap').classList.add('collapsed'); });
  });
  await wait(800);
  const after = await page.evaluate(probeFixed);

  // The premise must hold, or the gate proves nothing: no ancestor box may have
  // changed. If one did, the observer could have done the repair and this gate
  // would not be testing the loop at all.
  const ancestorStable = await page.evaluate(() => {
    const w = document.querySelector('.fixed-wrap');
    return Math.round(w.getBoundingClientRect().height) === 800;
  });
  await page.close();

  const correct = after.got === after.want;
  const moved = after.got !== before.got;
  gates += 3;
  if (!correct || !moved || !ancestorStable) bad += 1;
  console.log('    height ' + before.got + ' -> ' + after.got + ' (want ' + after.want + ') ' +
    (correct ? (moved ? 'ok' : 'VACUOUS — height never moved') : 'WRONG HEIGHT'));
  console.log('    ancestor box unchanged at 800px: ' + (ancestorStable ? 'yes — the observer' +
    ' cannot have done this' : 'NO — the premise failed, this gate tests nothing'));
}

// ---------------------------------------------------------------------------
// BASELINE for the stacking gate: what one resize costs with ONE live mount.
// MEASURED, not assumed. The first version of the stacking gate compared against
// the settle-window ceiling (395 frames) — but stacked wiring after four mounts
// costs about four times one mount, roughly 16 frames, which sails under 395.
// The gate named a mutation it could not catch. The bound has to come from what
// a single mount actually costs on this build.
let BASELINE_RESIZE_FRAMES = 0;
{
  const page = await boot(900);
  await wait(SETTLE_MAX_MS + 300); // let the mount settle finish
  const pre = await page.evaluate(PROBE);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await wait(600);
  const post = await page.evaluate(PROBE);
  await page.close();
  BASELINE_RESIZE_FRAMES = post.rafs - pre.rafs;
}

// ---------------------------------------------------------------------------
// SPA REMOUNT. A lesson swap replaces the mount element; GHL then re-runs its
// layout, so the settle has to happen again against the new page.
console.log('');
console.log('  GATE: a lesson swap re-settles, and does not stack wiring.');
console.log('  Fails on: removing the teardownFrame() call at the top of mount — the');
console.log('  previous mount listeners survive and every swap adds another copy');
console.log('  (proven: 20 frames for one resize against a baseline of 4). Also on');
console.log('  dropping the ancestor observation. NOT on removing the settle() call at');
console.log('  the end of mount: the re-attached ancestor observers repair the new');
console.log('  lesson anyway, so that edit is invisible here and is not claimed.');
{
  const page = await boot(900);
  await wait(60);
  await page.evaluate(() => { document.querySelector('.wrap').classList.add('ajm-lesson'); });
  await wait(600);
  const firstLesson = await page.evaluate(PROBE);

  // The swap: new mount element, restored comments block, class cleared —
  // exactly what GHL does when a member opens the next lesson.
  await page.evaluate(() => {
    const wrap = document.querySelector('.wrap');
    wrap.classList.remove('ajm-lesson');
    wrap.innerHTML =
      '<div class="lesson-head" style="height:200px;background:#eee">next lesson</div>' +
      '<div id="james-bot" style="width:100%"></div>' +
      '<div class="comments-container" style="height:260px;background:#ffd">comments</div>' +
      '<div class="mark-complete" style="height:64px;background:#fdd">Mark As Complete</div>';
  });
  await wait(300);
  const afterSwap = await page.evaluate(PROBE);
  const rafsBeforeLate = afterSwap.rafs;

  // GHL applies the class again on the new lesson.
  await page.evaluate(() => { document.querySelector('.wrap').classList.add('ajm-lesson'); });
  await wait(700);
  const resettled = await page.evaluate(PROBE);

  // Three more swaps, then one resize. If teardown is missing, each dead mount
  // still holds a resize listener and the frame count multiplies.
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      const wrap = document.querySelector('.wrap');
      wrap.innerHTML =
        '<div class="lesson-head" style="height:150px;background:#eee">lesson</div>' +
        '<div id="james-bot" style="width:100%"></div>';
    });
    await wait(250);
  }
  const preResize = await page.evaluate(PROBE);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await wait(600);
  const postResize = await page.evaluate(PROBE);
  await page.close();

  // GATE 5: the new lesson's geometry is correct after its own late change.
  const reOk = resettled.got === resettled.want;
  // GATE 6: and it is a DIFFERENT height from the first lesson — the header is
  // 200px there and 120px here, so a stale value would be caught rather than
  // matching by luck.
  const notStale = resettled.got !== firstLesson.got;
  // GATE 7: one resize after four mounts costs ONE mount's worth of frames.
  // The ceiling is the MEASURED single-mount baseline plus a small margin, not
  // the settle-window ceiling — four stacked mounts cost ~4x baseline, which is
  // far under the window ceiling and would have passed. Derived from this build,
  // so it cannot drift from what a mount actually costs.
  const resizeCeiling = BASELINE_RESIZE_FRAMES + 2;
  const resizeFrames = postResize.rafs - preResize.rafs;
  // A resize must actually COST frames, or this gate is 0 <= ceiling and stacked
  // wiring would be indistinguishable from working teardown.
  // Both the baseline and the measurement must be non-zero, or the comparison
  // is 0 <= 2 and stacked wiring is indistinguishable from working teardown.
  const resizeDidWork = resizeFrames > 0 && BASELINE_RESIZE_FRAMES > 0;
  const noStacking = resizeFrames <= resizeCeiling;
  gates += 4;
  if (!reOk || !notStale || !resizeDidWork || !noStacking) bad += 1;
  console.log('    first lesson settled at ' + firstLesson.got +
    ', new lesson at ' + resettled.got + ' (want ' + resettled.want + ') ' +
    (reOk ? (notStale ? 'ok' : 'VACUOUS — same height as before the swap') : 'WRONG HEIGHT'));
  console.log('    frames for one resize after 4 mounts: ' + resizeFrames +
    ' (baseline ' + BASELINE_RESIZE_FRAMES + ', ceiling ' + resizeCeiling + ') ' +
    (!resizeDidWork ? 'VACUOUS — the resize requested no frames at all'
      : noStacking ? 'ok' : 'WIRING STACKED'));
  console.log('');
  console.log('  INFORMATIONAL (not gated): the height immediately after the swap was ' +
    afterSwap.got + 'px');
  console.log('    and ' + rafsBeforeLate + ' frames had been requested by then. Printed to make');
  console.log('    the re-settle auditable; the assertion is on the settled value above.');
}

await browser.close();
console.log('');
console.log('SAMPLING DENSITY: the class-arrival delay is sampled either side of the');
console.log('  ' + SETTLE_MAX_MS + 'ms settle deadline (' + DELAYS.map((d) => d.ms).join(', ') +
  'ms), because');
console.log('  a different mechanism repairs each side. The deadline is read from the');
console.log('  source, so shortening it moves the samples with it.');
console.log('delay rows examined: ' + examined);
if (examined === 0) {
  console.log('VERDICT: INVALID — nothing was examined.');
  process.exit(1);
}
console.log('gates evaluated: ' + gates);
console.log(bad === 0 ? 'VERDICT: PASS' : 'VERDICT: ' + bad + ' failure(s)');
process.exit(bad === 0 ? 0 : 1);
