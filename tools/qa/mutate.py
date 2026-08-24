"""
Mutation driver for Phase 2 Slice 1.

Each entry reintroduces ONE original defect into widget/widget.js, runs the
Slice 1 suite, and requires it to go red.

STANDING RULE (INSPECTOR instance-eight): a collection failure reports as
"Test Files N failed / Tests no tests", and a driver that only reads the failed
count mistakes "nothing ran" for "tests failed" — every mutation would look
caught. So each run must ALSO report a non-zero PASSED count. A mutation that
breaks parsing is reported as INVALID, not as a catch.
"""
import io, re, subprocess, sys

TARGET = 'widget/widget.js'
SUITE = ('tests/phase2Loading.widget.test.ts tests/phase2Touch.widget.test.ts '
         'tests/phase2RowIdentity.widget.test.ts '
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
        'M15 the live-suffix trim removed: the race paints the member message twice',
        """        var cut = 0;
        var max = Math.min(liveTurns.length, messages.length);
        for (var n = max; n >= 1; n--) {
          var matches = true;
          for (var i = 0; i < n; i++) {
            var snap = messages[messages.length - n + i];
            var live = liveTurns[i];
            if (snap.role !== live.role || String(snap.content) !== String(live.content)) {
              matches = false;
              break;
            }
          }
          if (matches) {
            cut = n;
            break;
          }
        }""",
        """        var cut = 0;""",
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
]


def run():
    p = subprocess.run('npx vitest run ' + SUITE,
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
src = io.open(TARGET, encoding='utf-8').read()
assert "var pre = el('div', 'jb-side-empty');" not in src, 'target is already mutated'


def restore():
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(src)


failed, passed = run()
print('BASELINE (unmutated): %s failed / %s passed' % (failed, passed))
assert failed == 0 and passed and passed > 0, 'baseline is not green'
baseline_passed = passed

bad = []
for name, old, new in MUTATIONS:
    if src.count(old) != 1:
        print('  SKIP  %s  (anchor matched %d times)' % (name, src.count(old)))
        bad.append(name)
        continue
    io.open(TARGET, 'w', encoding='utf-8', newline='').write(src.replace(old, new, 1))
    try:
        failed, passed = run()
    finally:
        restore()  # runs even if the driver itself blows up
    if failed is None:
        print('  INVALID %s  -> suite did not COLLECT (parse error). Not a catch.' % name)
        bad.append(name)
    elif passed == 0:
        print('  INVALID %s  -> 0 passed; nothing ran. Not a catch.' % name)
        bad.append(name)
    elif failed == 0:
        print('  MISSED  %s  -> %d passed, 0 failed. The defect is NOT caught.' % (name, passed))
        bad.append(name)
    else:
        print('  caught  %s  -> %d failed / %d passed' % (name, failed, passed))

restore()
print()
print('baseline passed count: %d' % baseline_passed)
print('RESULT: %s' % ('ALL MUTATIONS CAUGHT' if not bad else 'PROBLEMS: ' + '; '.join(bad)))
sys.exit(1 if bad else 0)
