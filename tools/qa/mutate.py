"""
Mutation driver for Phase 2 Slice 1.

Each entry reintroduces ONE original defect into widget/widget.js, runs the
Slice 1 suite, and requires it to go red.

STANDING RULE (INSPECTOR instance-eight): a collection failure reports as
"Test Files N failed / Tests no tests", and a driver that only reads the failed
count mistakes "nothing ran" for "tests failed" — every mutation would look
caught. So each run must ALSO report a non-zero PASSED count. A mutation that
breaks parsing is reported as INVALID, not as a catch.

STANDING RULE (FINDING-036): NOT CAUGHT is a QUESTION, not a verdict. A
mutation defeated by a working defence and a mutation the tests missed report
identically — the build genuinely changed both times, so the inert guard
cannot discriminate them; only reading the code path can. Every NOT CAUGHT
takes one of three dispositions before it is reported onward:
    a) genuine coverage gap        -> write the test        (BUG-033 was this)
    b) defeated by a live defence  -> mutate PAST the defence, re-score
                                      (a skeleton injected inside
                                      prependHistory was removed by
                                      loadHistory's unconditional teardown
                                      before any assertion ran — the fourth
                                      teardown path working, not a gap)
    c) unpinned by construction    -> record why, write nothing (the
                                      belt-and-braces teardown itself: the
                                      primaries make its deletion invisible,
                                      exactly as its comment predicts)
The driver prints this menu on every MISSED so the reader chooses rather than
defaulting to (a). It matters in both directions: filing a (b) as a gap yields
a vacuous test; filing an (a) as defended yields BUG-033.
"""
import datetime
import io, json, os, re, subprocess, sys

# Unbuffered progress: a background run's output file must show the current
# mutation while it runs, not an empty file until exit.
sys.stdout.reconfigure(line_buffering=True)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mutation_lock import acquire as acquire_mutation_lock, release as release_mutation_lock

RIG_ID = os.environ.get('QA_RIG', 'MASON')
DRIVER_VERSION = 'mutate.py/lock-1'

TARGET = 'widget/widget.js'

# --- Durable results (operational ruling after FINDING-036) -----------------
# Background execution is the DEFAULT; foreground is the exception (the run
# outgrew the 10-minute foreground window at 32 mutations and Phase 3 only
# grows the set). Every run appends JSON-lines to a timestamped file under
# tools/qa/results/ AFTER EACH MUTATION — crash-durable, so a killed run
# leaves a file that is VISIBLY partial: rows without a trailing `summary`
# line. A partial file must never be read as a pass. `latest.json` points at
# the newest run file. The directory is gitignored: results are per-rig
# evidence, not repo history.
RESULTS_DIR = os.path.join('tools', 'qa', 'results')


def _now():
    return datetime.datetime.now().isoformat(timespec='seconds')


class ResultLog:
    def __init__(self):
        os.makedirs(RESULTS_DIR, exist_ok=True)
        stamp = _now().replace(':', '-')
        self.path = os.path.join(RESULTS_DIR, 'run-%s.jsonl' % stamp)
        head = subprocess.run('git rev-parse HEAD', shell=True, capture_output=True,
                              text=True).stdout.strip()
        dirty = subprocess.run('git status --porcelain', shell=True, capture_output=True,
                               text=True).stdout.strip()
        self.write({'row': 'header', 'started': _now(), 'git_head': head,
                    'git_dirty': bool(dirty), 'target': TARGET, 'suite': SUITE})
        with io.open(os.path.join(RESULTS_DIR, 'latest.json'), 'w', encoding='utf-8') as f:
            json.dump({'path': self.path}, f)

    def write(self, obj):
        with io.open(self.path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj) + '\n')
            f.flush()
            os.fsync(f.fileno())
SUITE = ('tests/phase2Loading.widget.test.ts tests/phase2Touch.widget.test.ts '
         'tests/phase2RowIdentity.widget.test.ts tests/phase2Layout.widget.test.ts '
         'tests/phase3Widget.test.ts '
         'tests/multiChat.widget.test.ts tests/widget.test.ts')

MUTATIONS = [
    (
        'M1 the original defect: no loading state, empty copy painted before /chats is asked',
        """        if (chatsState === 'error') sideList.appendChild(chatsErrorNotice());

        for (var i = 0; i < rows.length; i++) sideList.appendChild(chatRow(rows[i]));

        if (chatsState === 'loading') {""",
        """        if (chatsState === 'error') sideList.appendChild(chatsErrorNotice());

        if (!rows.length) {
          var pre = el('div', 'jb-side-empty');
          pre.textContent = 'No chats yet.';
          sideList.appendChild(pre);
          return;
        }
        for (var i = 0; i < rows.length; i++) sideList.appendChild(chatRow(rows[i]));

        if (chatsState === 'loading') {""",
    ),
    (
        'M2 skeleton is NOT torn down when the member sends (S1.2 MUST)',
        """      function markStarted() {
        started = true;
        clearHistorySkeleton();
      }""",
        """      function markStarted() {
        started = true;
      }""",
    ),
    (
        'M3 /history failure is silent again',
        """          .catch(function () {
            if (stale(op)) return;
            clearHistorySkeleton();
            showHistoryError();
          })""",
        """          .catch(function () {
            if (stale(op)) return;
            clearHistorySkeleton();
          })""",
    ),
    (
        'M4 the transcript skeleton never renders at all (vacuity trap)',
        """        historySkeleton = wrap;
        list.appendChild(wrap);""",
        """        historySkeleton = null;""",
    ),
    (
        'M5 a failed /chats falls back to the empty copy instead of an error',
        """            chatsState = 'error';
            // No list: still give the member somewhere to type. Nothing is""",
        """            chatsState = 'ready';
            // No list: still give the member somewhere to type. Nothing is""",
    ),
    (
        'M6 a non-ok /history resolves to null again, sharing the empty path',
        """            // A non-ok response now THROWS rather than resolving to null. It
            // used to share the "nothing to paint" path with an empty
            // transcript, which is how a 503 came to look identical to a chat
            // with no messages in it.
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();""",
        """            return res.ok ? res.json() : null;""",
    ),
    (
        'M7 S2.1 reverted: row actions stay hover-only, unreachable on touch',
        """    '@media (hover: none),(pointer: coarse){.jb-chat-act{opacity:1;}}',""",
        """    '@media (hover: none),(pointer: coarse){.jb-chat-act{opacity:0.999;}}',""",
    ),
    (
        'M8 delete archives on the FIRST tap (the two-step defeated)',
        """            renamingId = null; // one open question at a time
            confirmingId = chat.id;
            renderSidebar();""",
        """            deleteChat(chat.id);""",
    ),
    (
        'M9 Cancel does not cancel - it deletes',
        """          no.textContent = 'Cancel';
          no.addEventListener('click', function () {
            confirmingId = null;
            renderSidebar();
          });""",
        """          no.textContent = 'Cancel';
          no.addEventListener('click', function () {
            confirmingId = null;
            deleteChat(chat.id);
          });""",
    ),
    (
        'M10 an open confirmation survives a chat switch (P2 reset list)',
        """        // 9a. Any open delete confirmation (S2.2). Same reasoning as the
        //     rename, with more at stake: a half-taken DESTRUCTIVE question
        //     must not survive into another chat, where the row it refers to
        //     may not even be on screen any more.
        confirmingId = null;""",
        """        // (mutation: confirmingId deliberately not reset)""",
    ),
    (
        'M11 two confirmations can be open at once',
        """            renamingId = null; // one open question at a time
            confirmingId = chat.id;""",
        """            renamingId = null;
            confirmingId = confirmingId || chat.id;""",
    ),
    (
        'M12 BUG-024 reintroduced: delete fallback deferred to the .then again',
        """        if (wasActive) {
          if (chats.length) switchToChat(chats[0].id);
          else startPlaceholder();
        } else {
          renderSidebar();
        }
        var op = beginOp();
        chatsApi('/chats/' + encodeURIComponent(id), { method: 'DELETE' })
          .catch(function () {
            /* the row is already gone from the rail; a failed archive re-appears on reload */
          })
          .then(function () {
            endOp(op);
          });""",
        """        renderSidebar();
        var op = beginOp();
        chatsApi('/chats/' + encodeURIComponent(id), { method: 'DELETE' })
          .catch(function () {
            /* the row is already gone from the rail; a failed archive re-appears on reload */
          })
          .then(function () {
            endOp(op);
            if (!wasActive || stale(op)) return;
            if (chats.length) {
              switchToChat(chats[0].id);
              return;
            }
            startPlaceholder();
          });""",
    ),
    (
        'M13 FINDING-027 reverted: late history discarded instead of prepended',
        """              if (issuedBeforeStarted) prependHistory(data.messages);
              return;""",
        """              return;""",
    ),
    (
        'M14 R3-c gate removed: post-send fetches prepend too',
        """        var issuedBeforeStarted = !started;""",
        """        var issuedBeforeStarted = true;""",
    ),
    (
        'M15 the duplication defence disabled: the snapshot prepends verbatim',
        # RE-POINTED for BUG-031: the original anchor was the suffix-trim
        # loop, which the prefix rule replaced. Same defect, new site: with
        # the scan disabled no cut point is ever found, so the whole snapshot
        # prepends verbatim, live turns included - the original race
        # duplication, reintroduced at the replacement mechanism.
        """        var cutAt = messages.length; // no live turns found: prepend everything
        if (liveTurns.length) {""",
        """        var cutAt = messages.length; // no live turns found: prepend everything
        if (false) {""",
    ),
    (
        'M16 welcome suppression inert: removeWelcome clears the ref but not the node',
        """      function removeWelcome() {
        if (!welcomeRow) return;
        var row = welcomeRow;
        welcomeRow = null;
        if (row.parentNode) row.parentNode.removeChild(row);
      }""",
        """      function removeWelcome() {
        if (!welcomeRow) return;
        welcomeRow = null;
      }""",
    ),
    (
        'M17 the title refetch POLLS: the timer rearms itself forever',
        """        titleRefetchTimer = window.setTimeout(function () {
          titleRefetchTimer = null;""",
        """        titleRefetchTimer = window.setTimeout(function fire() {
          titleRefetchTimer = window.setTimeout(fire, 4000);""",
    ),
    (
        'M18 R3-d bump stamp removed: a just-answered chat keeps its stale age',
        """          chat.last_message_at = new Date().toISOString();
          chats.unshift(chat);""",
        """          chats.unshift(chat);""",
    ),
    (
        # RE-POINTED with the corrected ruling: LAST is now correct and FIRST
        # is the defect - a live text that also appears earlier as genuine
        # history makes the first occurrence the genuine pair, the prefix
        # empty, and every real turn is discarded (the separating case).
        'M19 BUG-031 regression: FIRST occurrence wins again, eating genuine history',
        """            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {
              cutAt = i; // LAST qualifying occurrence wins — keep scanning
            }""",
        """            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {
              cutAt = i;
              break;
            }""",
    ),
    (
        'M20 the full-coverage/tail qualifier dropped: any partial match cuts',
        """            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {""",
        """            if (m > 0) {""",
    ),
    (
        'M21 the narrow threshold broken: overlay tier unreachable at 560',
        """        root.classList.toggle('jb-w-narrow', w <= 560);""",
        """        root.classList.toggle('jb-w-narrow', w <= 200);""",
    ),
    (
        'M22 the zero-width guard removed: a hidden widget collapses to tight',
        """        if (!w) return; // display:none or not yet laid out — keep last classes""",
        """        """,
    ),
    (
        'M23 the floor removed: the widget squeezes without limit',
        """min-height:420px;min-width:300px;""",
        """min-height:420px;""",
    ),
    (
        'M24 the overlay rule unkeyed: absolute rail leaks into wide layouts',
        """    '.jb-root.jb-w-narrow .jb-side{position:absolute;z-index:3;height:100%;width:216px;flex-basis:216px;',""",
        """    '.jb-root .jb-side-mutated{position:static;}','.jb-side{position:absolute;z-index:3;height:100%;width:216px;flex-basis:216px;',""",
    ),
    (
        # RE-POINTED: the scrim's dedicated handler was DELETED as dead code -
        # the document CAPTURE listener fires before any bubble reaches the
        # scrim, so it could never be the acting mechanism and this driver
        # proved it (the original M25 was MISSED: scrim taps closed via the
        # outside-click path with the handler inert). The live defect is the
        # outside-click listener treating scrim taps as inside the drawer.
        'M25 scrim taps treated as inside the drawer: the backdrop goes dead',
        """        if (side.contains(event.target) || sideToggle.contains(event.target)) return;""",
        """        if (side.contains(event.target) || sideToggle.contains(event.target) || event.target === scrim) return;""",
    ),
    (
        'M26 Escape no longer closes the drawer',
        """      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        closeDrawer();
      });""",
        """      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
      });""",
    ),
    (
        'M27 the drawer survives a chat switch (reset entry removed)',
        """        drawerOpen = false;
        applyDrawer();
        // 9a. Any open delete confirmation (S2.2). Same reasoning as the""",
        """        // 9a. Any open delete confirmation (S2.2). Same reasoning as the""",
    ),
    (
        'M28 the focus rule ignores the pointer: coarse devices get the keyboard',
        """        var coarse =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(hover: none), (pointer: coarse)').matches;
        if (!coarse) input.focus();""",
        """        input.focus();""",
    ),
    (
        'M29 outside clicks pass through: the document listener is gone',
        """      document.addEventListener('click', onDocumentClick, true);""",
        """      void onDocumentClick;""",
    ),
    (
        'M30 the welcome removal unkeyed from the result: fires on any snapshot arrival',
        """        var keep = messages.slice(0, cutAt);
        if (!keep.length) return;
        removeWelcome();""",
        """        var keep = messages.slice(0, cutAt);
        removeWelcome();
        if (!keep.length) return;""",
    ),
    (
        'M31 qualifier ARM A removed: only extends-to-end cuts',
        """            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {""",
        """            if (m > 0 && i + m === messages.length) {""",
    ),
    (
        'M32 qualifier ARM B removed: only full coverage cuts (BUG-033)',
        """            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {""",
        """            if (m > 0 && m === liveTurns.length) {""",
    ),
    (
        'M33 S4 gate bypassed: no token boots straight into chat',
        """      clearRetiredKeys();
      authToken = sessionGet(TOKEN_KEY);
      if (authToken) {
        startAuthedSession();
      } else {
        showGate('initial');
      }""",
        """      clearRetiredKeys();
      authToken = sessionGet(TOKEN_KEY);
      startAuthedSession();""",
    ),
    (
        'M34 S4 token leaks into localStorage',
        """                lastAuthEmail = email;
                authToken = result.body.token;
                sessionSet(TOKEN_KEY, authToken);""",
        """                lastAuthEmail = email;
                authToken = result.body.token;
                storageSet(TOKEN_KEY, authToken);""",
    ),
    (
        'M35 S4 authExpired keeps the dead token',
        """        authToken = null;
        sessionRemove(TOKEN_KEY);
        resetChatState();""",
        """        authToken = null;
        resetChatState();""",
    ),
    (
        'M36 S4 lookup_failed loses its retry affordance',
        """          if (kind === 'lookup_failed') {
            var retry = el('button', 'jb-gate-retry', { type: 'button' });
            retry.textContent = 'Try again';
            retry.addEventListener('click', submit);
            status.appendChild(retry);
          }""",
        """          if (false) {
            var retry = el('button', 'jb-gate-retry', { type: 'button' });
            retry.textContent = 'Try again';
            retry.addEventListener('click', submit);
            status.appendChild(retry);
          }""",
    ),
    (
        'M37 S4 the unsent message is lost across re-auth',
        """        if (pendingResendText) {
          input.value = pendingResendText;
          pendingResendText = '';
          form.classList.add('jb-armed');
        }""",
        """        pendingResendText = '';""",
    ),
]

# ---------------------------------------------------------------------------
# SERVER-TARGET MUTATIONS (Phase 3 limits): a second lane with per-target
# pristine/sidecar and per-suite baselines. The esbuild INERT check does not
# apply — these targets are not bundled — so the row records
# inert_check: 'n/a' rather than pretending a guarantee that was not run.
# ---------------------------------------------------------------------------
SERVER_MUTATIONS = [
    {
        'name': 'M38 the limiter never blocks',
        'target': 'src/server/rateLimit.ts',
        'suite': 'tests/phase3Limits.test.ts',
        'old': """      if (win.count >= max) return false;""",
        'new': """      if (win.count >= max) return true;""",
    },
    {
        'name': 'M39 /auth per-IP limiter unplugged',
        'target': 'src/server/app.ts',
        'suite': 'tests/phase3Limits.test.ts',
        'old': """    if (!authIpLimiter.allow(request.ip)) return rateLimited(reply);""",
        'new': """    void authIpLimiter;""",
    },
    {
        'name': 'M40 /chat member limit silently keyed by IP — the leaked-token case reopens',
        'target': 'src/server/app.ts',
        'suite': 'tests/phase3Limits.test.ts',
        'old': """    if (!chatMemberLimiter.allow(limiterOwner ?? `ip:${request.ip}`)) return rateLimited(reply);""",
        'new': """    if (!chatMemberLimiter.allow(`ip:${request.ip}`)) return rateLimited(reply);""",
    },
    {
        'name': 'M41 the message cap unplugged',
        'target': 'src/server/app.ts',
        'suite': 'tests/phase3Limits.test.ts',
        'old': """    if (typeof message === 'string' && message.length > config.maxMessageChars) {""",
        'new': """    if (false && typeof message === 'string' && message.length > config.maxMessageChars) {""",
    },
    {
        'name': 'M42 the member budget ignores the member window',
        'target': 'src/features/comps/service.ts',
        'suite': 'tests/phase3Limits.test.ts',
        'old': """      if (rec.used >= memberCap) return false;
      if (!globalBudget.tryConsume(now)) return false;""",
        'new': """      if (!globalBudget.tryConsume(now)) return false;""",
    },
]


def build_artifact():
    """The minified bundle of the CURRENT widget source, as esbuild emits it.

    Adopted from INSPECTOR's sixth instrument error: a mutation that lands
    inside a // comment changes the FILE but not the BUILD — the bundles are
    byte-identical, the suite rightly stays green, and a driver that scores
    that NOT CAUGHT is issuing a false negative against a working assertion.
    That is how a correct fix gets "corrected". An inert mutation proves
    nothing; it is a driver-authoring error and is reported as its own verdict.
    """
    p = subprocess.run('npx esbuild %s --bundle --minify --format=iife' % TARGET,
                       capture_output=True, text=True, shell=True,
                       encoding='utf-8', errors='replace')
    if p.returncode != 0:
        return None  # does not build — the mutation is broken, not inert
    return p.stdout


def run(suite=SUITE):
    p = subprocess.run('npx vitest run ' + suite,
                       capture_output=True, text=True, shell=True,
                       encoding='utf-8', errors='replace')
    out = (p.stdout or '') + (p.stderr or '')
    m = re.search(r'Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed', out)
    if not m:
        if re.search(r'Tests\s+no tests', out) or 'PARSE_ERROR' in out:
            return None, None
        return None, None
    return int(m.group(1) or 0), int(m.group(2))


# The pristine source is read ONCE, before anything is written, and every
# restore writes THAT — never a re-read of a file a crashed run may have left
# mutated. An earlier version re-backed-up the target on each start and
# silently promoted a stuck mutation into its own baseline.
# A KILLED run cannot restore (finally does not survive SIGKILL — it has
# happened: an interrupted driver left M12 on disk and the suite red). The
# pristine source is persisted to a sidecar before any mutation; a leftover
# sidecar on startup means the last run died dirty, and it is restored FIRST.
# THE LOCK COVERS THE WHOLE CYCLE — acquired before ANY write (the sidecar
# recovery below is itself a write to the target) and released after the final
# restore. The window INSPECTOR fell into was between a restore and the next
# mutation; holding across restores is the point.
acquire_mutation_lock(rig=RIG_ID, target=TARGET, driver_version=DRIVER_VERSION)

# Server-target sidecars recover the same way the widget's does.
for _m in SERVER_MUTATIONS:
    _sc = _m['target'] + '.pristine'
    if os.path.exists(_sc):
        print('RECOVERY: leftover %s found — restoring first' % _sc)
        io.open(_m['target'], 'w', encoding='utf-8', newline='').write(
            io.open(_sc, encoding='utf-8').read())
        os.remove(_sc)

SIDECAR = TARGET + '.pristine'
if os.path.exists(SIDECAR):
    print('RECOVERY: leftover %s found — restoring the pristine source first' % SIDECAR)
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(
        io.open(SIDECAR, encoding='utf-8').read())
src = io.open(TARGET, encoding='utf-8').read()
assert "var pre = el('div', 'jb-side-empty');" not in src, 'target is already mutated'
io.open(SIDECAR, 'w', encoding='utf-8', newline='').write(src)


def restore():
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(src)
    # INSPECTOR's tree_clean() equivalent, adopted deliberately: a restore that
    # does not leave the target byte-equal to the pristine source means a
    # SECOND WRITER is active. Abort loudly — every measurement after this
    # point would be non-deterministic, and a driver that keeps scoring under
    # a second writer reports phantom gaps and phantom passes alike.
    actual = io.open(TARGET, encoding='utf-8').read()
    if actual != src:
        print('ABORT: restore did not stick — a second writer is mutating %s. '
              'All results from this cycle are unreliable.' % TARGET)
        log.write({'row': 'abort', 'reason': 'second_writer_detected', 'at': _now()})
        release_mutation_lock()
        sys.exit(3)


pristine_artifact = build_artifact()
assert pristine_artifact, 'the pristine source does not build'

log = ResultLog()
print('durable results -> %s' % log.path)

failed, passed = run()
print('BASELINE (unmutated): %s failed / %s passed' % (failed, passed))
log.write({'row': 'baseline', 'failed': failed, 'passed': passed, 'at': _now()})
assert failed == 0 and passed and passed > 0, 'baseline is not green'
baseline_passed = passed

bad = []
for name, old, new in MUTATIONS:
    if src.count(old) != 1:
        print('  SKIP  %s  (anchor matched %d times)' % (name, src.count(old)))
        log.write({'row': 'mutation', 'name': name, 'verdict': 'SKIP_ANCHOR',
                   'anchor_matches': src.count(old), 'at': _now()})
        bad.append(name)
        continue
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(src.replace(old, new, 1))
    try:
        mutated_artifact = build_artifact()
        if mutated_artifact == pristine_artifact:
            print('  SKIPPED: INERT  %s  -> file changed, BUILD identical. '
                  'The mutation never happened; nothing is proven either way.' % name)
            log.write({'row': 'mutation', 'name': name, 'verdict': 'SKIPPED_INERT',
                       'at': _now()})
            bad.append(name + ' (inert)')
            continue
        failed, passed = run()
    finally:
        restore()  # runs even if the driver itself blows up
    if failed is None:
        print('  INVALID %s  -> suite did not COLLECT (parse error). Not a catch.' % name)
        log.write({'row': 'mutation', 'name': name, 'verdict': 'INVALID_NO_COLLECT', 'at': _now()})
        bad.append(name)
    elif passed == 0:
        print('  INVALID %s  -> 0 passed; nothing ran. Not a catch.' % name)
        log.write({'row': 'mutation', 'name': name, 'verdict': 'INVALID_ZERO_PASSED', 'at': _now()})
        bad.append(name)
    elif failed == 0:
        print('  MISSED  %s  -> %d passed, 0 failed.' % (name, passed))
        print('          NOT CAUGHT is a question, not a verdict (FINDING-036).')
        print('          Disposition required before reporting onward:')
        print('            a) genuine coverage gap        -> write the test')
        print('            b) defeated by a live defence  -> mutate PAST the defence, re-score')
        print('            c) unpinned by construction    -> record why, write nothing')
        log.write({'row': 'mutation', 'name': name, 'verdict': 'MISSED_NEEDS_DISPOSITION',
                   'failed': failed, 'passed': passed, 'at': _now()})
        bad.append(name)
    else:
        print('  caught  %s  -> %d failed / %d passed' % (name, failed, passed))
        log.write({'row': 'mutation', 'name': name, 'verdict': 'CAUGHT',
                   'failed': failed, 'passed': passed, 'at': _now()})

restore()
os.remove(SIDECAR)  # a clean exit leaves no sidecar; leftovers mean a dirty death

# --- SERVER-TARGET LANE -----------------------------------------------------
server_pristine = {}
suite_baselines = {}
for m in SERVER_MUTATIONS:
    t, suite, name = m['target'], m['suite'], m['name']
    if t not in server_pristine:
        server_pristine[t] = io.open(t, encoding='utf-8').read()
        io.open(t + '.pristine', 'w', encoding='utf-8', newline='').write(server_pristine[t])
    if suite not in suite_baselines:
        bf, bp = run(suite)
        print('SERVER BASELINE %s: %s failed / %s passed' % (suite, bf, bp))
        log.write({'row': 'server_baseline', 'suite': suite, 'failed': bf, 'passed': bp, 'at': _now()})
        assert bf == 0 and bp and bp > 0, 'server baseline is not green: ' + suite
        suite_baselines[suite] = bp
    src_t = server_pristine[t]
    if src_t.count(m['old']) != 1:
        print('  SKIP  %s  (anchor matched %d times in %s)' % (name, src_t.count(m['old']), t))
        log.write({'row': 'mutation', 'name': name, 'target': t, 'verdict': 'SKIP_ANCHOR', 'at': _now()})
        bad.append(name)
        continue
    io.open(t, 'w', encoding='utf-8', newline='').write(src_t.replace(m['old'], m['new'], 1))
    try:
        failed, passed = run(suite)
    finally:
        io.open(t, 'w', encoding='utf-8', newline='').write(src_t)
        actual_t = io.open(t, encoding='utf-8').read()
        if actual_t != src_t:
            print('ABORT: server-target restore did not stick on %s — second writer.' % t)
            log.write({'row': 'abort', 'reason': 'second_writer_detected', 'target': t, 'at': _now()})
            release_mutation_lock()
            sys.exit(3)
    if failed is None:
        print('  INVALID %s  -> suite did not COLLECT. Not a catch.' % name)
        log.write({'row': 'mutation', 'name': name, 'target': t, 'verdict': 'INVALID_NO_COLLECT', 'inert_check': 'n/a', 'at': _now()})
        bad.append(name)
    elif passed == 0:
        print('  INVALID %s  -> 0 passed; nothing ran. Not a catch.' % name)
        log.write({'row': 'mutation', 'name': name, 'target': t, 'verdict': 'INVALID_ZERO_PASSED', 'inert_check': 'n/a', 'at': _now()})
        bad.append(name)
    elif failed == 0:
        print('  MISSED  %s  -> %d passed, 0 failed.' % (name, passed))
        print('          NOT CAUGHT is a question, not a verdict (FINDING-036).')
        log.write({'row': 'mutation', 'name': name, 'target': t, 'verdict': 'MISSED_NEEDS_DISPOSITION', 'inert_check': 'n/a', 'failed': failed, 'passed': passed, 'at': _now()})
        bad.append(name)
    else:
        print('  caught  %s  -> %d failed / %d passed' % (name, failed, passed))
        log.write({'row': 'mutation', 'name': name, 'target': t, 'verdict': 'CAUGHT', 'inert_check': 'n/a', 'failed': failed, 'passed': passed, 'at': _now()})

for t in server_pristine:
    os.remove(t + '.pristine')

log.write({'row': 'summary', 'complete': True, 'finished': _now(),
           'result': 'ALL_CAUGHT' if not bad else 'PROBLEMS',
           'problems': bad, 'baseline_passed': baseline_passed})
release_mutation_lock()
print()
print('baseline passed count: %d' % baseline_passed)
print('RESULT: %s' % ('ALL MUTATIONS CAUGHT' if not bad else 'PROBLEMS: ' + '; '.join(bad)))
sys.exit(1 if bad else 0)
