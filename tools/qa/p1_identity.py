"""
P1 byte-identity verification: the three mechanisms INSPECTOR could not break.

  P1a  stale(op)              — the generation check itself
  P1b  op.cleanup inerting    — resetChatState steps 1 and 2
  P1c  call-time sessionId    — the declaration, ensureChatId, and BOTH reads

Compared by extracting each region from both revisions and hashing the bytes,
not by reading the diff. A region is located by an explicit start anchor and an
explicit end anchor; if either fails to match exactly once in either revision
the check reports FAIL rather than silently comparing the wrong span — an
extractor that matched nothing in both files would otherwise hash two empty
strings and report identity.
"""
import hashlib
import io
import subprocess
import sys

# The Phase 1 baseline the three mechanisms are pinned against. Read straight
# out of git so this cannot drift against a stale working copy, and so the
# check is runnable from a clean checkout with no setup step.
BASELINE_REV = '2dfc31e'
NEW = 'widget/widget.js'

REGIONS = [
    (
        'P1a stale(op) — the generation check',
        "      /** True when this operation belongs to a chat the member has left. */",
        "      }\n",
    ),
    (
        'P1b op.cleanup inerting — resetChatState steps 1 and 2',
        "        // 1. Invalidate every callback that is already scheduled.",
        "        inFlight.length = 0;\n",
    ),
    (
        'P1c-1 sessionId declaration',
        "    // The owner key is per-device and long-lived; the chat id is per-chat and",
        "    var sessionId = null;\n",
    ),
    (
        'P1c-2 ensureChatId — the synchronous call-time mint',
        "      function ensureChatId() {",
        "        return sessionId;\n      }\n",
    ),
    (
        'P1c-3 call-time read in submitCalculatorForm',
        "            // Read at CALL time, never closed over at render time: a form card",
        "            session_id: sessionId,\n",
    ),
    (
        'P1c-4 call-time read in submitMessage',
        "        var chatId = ensureChatId();",
        "            session_id: chatId,\n",
    ),
]


def extract(text, start, end, label, rev):
    if text.count(start) != 1:
        return None, '%s: start anchor matched %d times in %s' % (
            label, text.count(start), rev)
    begin = text.index(start)
    rest = text[begin:]
    if rest.count(end) < 1:
        return None, '%s: end anchor never matched in %s' % (label, rev)
    stop = rest.index(end) + len(end)
    return rest[:stop], None


old = subprocess.run('git show %s:%s' % (BASELINE_REV, NEW), shell=True,
                     capture_output=True, text=True, encoding='utf-8',
                     errors='replace').stdout
assert old, 'could not read %s:%s out of git' % (BASELINE_REV, NEW)
new = io.open(NEW, encoding='utf-8').read()

problems = []
print('P1 byte-identity: %s @ working tree vs %s' % (NEW, BASELINE_REV))
print('=' * 68)
for label, start, end in REGIONS:
    a, err_a = extract(old, start, end, label, '2dfc31e')
    b, err_b = extract(new, start, end, label, 'HEAD')
    if err_a or err_b:
        problems.append(err_a or err_b)
        print('  FAIL   %s\n         %s' % (label, err_a or err_b))
        continue
    ha = hashlib.sha256(a.encode('utf-8')).hexdigest()[:16]
    hb = hashlib.sha256(b.encode('utf-8')).hexdigest()[:16]
    if ha != hb:
        problems.append('%s: %s != %s' % (label, ha, hb))
        print('  CHANGED %s\n          2dfc31e %s\n          HEAD    %s' % (label, ha, hb))
    else:
        print('  identical  %s  sha %s  (%d bytes)' % (label, ha, len(a)))

print('=' * 68)
print('RESULT: %s' % ('ALL THREE MECHANISMS BYTE-IDENTICAL' if not problems
                      else 'DIVERGENCE: ' + '; '.join(problems)))
sys.exit(1 if problems else 0)
