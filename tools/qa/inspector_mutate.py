"""
INSPECTOR mutation driver -- reintroduce a defect, run the suite that should
catch it, score the result, restore.

A re-point that no longer catches its defect is a bug. This is the tool that
decides "caught" or "not caught", so the way it SCORES is load-bearing.

----------------------------------------------------------------------------
THE VERDICT TABLE. Ruled, and encoded here rather than re-derived per use.

    tests ran + >=1 failed          -> CAUGHT
    tests ran + 0 failed            -> NOT CAUGHT      (never INVALID)
    no tests ran / collection error -> INVALID, after ONE RETRY

The middle row has bitten twice, both times in this tool, both times rewritten
from scratch instead of reused:

  BUG-021 round, mutant M7 (.order() last-one-wins). vitest reported
  "Tests  14 passed (14)". The driver's regex only matched
  "N failed | M passed", so a clean not-caught result fell through to INVALID
  and read as inconclusive. The mutation was in fact unfaithful -- keeping the
  LAST sort key leaves `id desc`, which still sorts correctly once ids exist --
  but that diagnosis was delayed by the mis-score.

  Slice 2, mutant S4 (coarse reveal weakened to hover:none only). Same shape:
  "Tests  15 passed (15)" scored INVALID rather than NOT CAUGHT. That one was a
  REAL miss -- the assertion was quantified over every coarse media query in the
  sheet, so a sibling query satisfied it on the mutated rule's behalf
  (BUG-026). Scoring it INVALID nearly buried a genuine finding.

The first row has bitten once, and is why "tests ran" is checked at all:

  BUG-021 round, first pass. All eight mutants reported RED while every run
  printed "Tests  no tests" -- a stale vite cache meant nothing collected, and
  "Test Files 1 failed" was being read as an assertion firing. Eight false
  CAUGHTs. That is the same wrong-subject error this tool exists to catch,
  committed by the tool doing the catching.

FINDING-030 -- the collection flake. "Tests no tests" with
`ReferenceError: document is not defined` or a bare resolution failure has
appeared three times across three unrelated files:
  - tests/widgetBundleCache.test.ts   (BUG-021 re-verification)
  - the full suite                    (same session)
  - tests/p1Identity.test.ts          (e2096a5 re-verification)
  - tests/bundleFreshness.test.ts     (667c0f7, CLEAN tree)
It did not reproduce in a bounded 24-run experiment: 12 runs on a quiet tree
and 12 with a concurrent writer touching a repo file both came back 0/12. The
fourth occurrence landed on a CLEAN tree, which rules out the modified-tree
correlation the first three suggested. Cause unresolved; it clears on retry
every time so far (3/3 immediately after the fourth). Hence the retry: a driver that can silently mis-score on a
known-recurring environment condition is worth hardening whether or not the
cause is ever found.

----------------------------------------------------------------------------
FINDING-036 - NOT CAUGHT IS A QUESTION, NOT A VERDICT.

A mutation defeated by a WORKING DEFENCE is indistinguishable from a mutation
the tests MISSED. Both report NOT CAUGHT. The inert-mutation guard does not
cover it, because the build genuinely changed. The only discriminator is
reading the code path.

  The case: a skeleton injected inside prependHistory was removed by
  loadHistory's unconditional clearHistorySkeleton() before any assertion ran -
  the fourth teardown path doing its job, not a test failing to look. Mutating
  PAST that defence caught it at 5 assertions.

Every NOT CAUGHT gets one of three dispositions before it is reported:

  (a) genuine coverage gap        -> write the test
  (b) defeated by a live defence  -> mutate past the defence, then re-score
  (c) unpinned by construction    -> record why, write nothing

(c) is real and is not a gap: deleting a redundant belt-and-braces teardown goes
unnoticed because the primaries work. A redundant defence is unobservable while
they hold, so a test for it would measure nothing. Unpinned BY CONSTRUCTION is
not unpinned by oversight.

SHARED-TREE RULE. Mutating widget/, src/, tests/, sql/, tools/ or .agents/
writes a path the other agent may be holding uncommitted work in, and a
restore is not a checkout, so announce-before-checkout never covered it.
Confirm the tree is clean before a cycle, or build the mutant OUT OF TREE and
serve it through the harness instead.
"""
from __future__ import annotations
import io, os, re, shutil, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mutation_lock as LOCK

REPO = os.environ.get('QA_REPO', 'D:/CODE/Project-RE-Chatbot')

CAUGHT, NOT_CAUGHT, INVALID, SKIPPED = 'CAUGHT', 'NOT CAUGHT', 'INVALID', 'SKIPPED'


def run(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, shell=True, capture_output=True,
                          text=True, encoding='utf-8', errors='replace')


def counts_line(out: str) -> str:
    hits = [l.strip() for l in out.splitlines() if l.strip().startswith('Tests ')]
    return hits[0] if hits else '(no counts line)'


def score(counts: str) -> tuple[str, str]:
    """The verdict table, and nothing else. Returns (verdict, detail)."""
    both = re.search(r'Tests\s+(\d+) failed \| (\d+) passed', counts)
    if both:
        return (CAUGHT, f'{both.group(1)} failed, {both.group(2)} passed')
    passed_only = re.search(r'Tests\s+(\d+) passed', counts)
    if passed_only and 'failed' not in counts:
        # THE MIDDLE ROW. Tests ran and none failed: the assertion did not
        # catch its defect. This is a RESULT, not an inconclusive run.
        return (NOT_CAUGHT, f'{passed_only.group(1)} passed, 0 failed')
    return (INVALID, counts)


def tree_clean() -> bool:
    """
    Clean, ignoring this tool's own byproducts. Importing the module writes
    tools/qa/__pycache__, which made the very first self-test abort on a tree
    the tool itself had just dirtied - a guard that fires on its own footprint
    is a guard people learn to bypass.
    """
    lines = [l for l in run('git status --porcelain').stdout.splitlines() if l.strip()]
    return [l for l in lines if '__pycache__' not in l and not l.endswith('.pyc')] == []


def restore(paths: list[str]) -> None:
    run('git checkout -- ' + ' '.join(paths))


def apply_mutation(path: str, pairs: list[tuple[str, str]]) -> str | None:
    """Returns None on success, else the reason it was refused."""
    src = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in src:
            return 'anchor not found'
        if src.count(old) > 1:
            # Never guess which occurrence was meant.
            return f'anchor matches {src.count(old)} times'
        src = src.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8').write(src)
    return None



def esbuild_differs(path):
    """
    Did this mutation actually change the BUILT artifact?

    Guards the INERT-MUTATION trap. An edit appended after a `//` comment lands
    INSIDE the comment: the file changes, the behaviour does not, and the run
    reports NOT CAUGHT for a defect that was never introduced. That is the
    eight-false-CAUGHTs error inverted - a false NEGATIVE from a mutation that
    never happened - and it produced a wrong "the corrected ruling is unpinned"
    claim about BUG-031's M31, caught only when the two bundles were compared
    and found byte-identical.

    Marker-grepping is not integrity-checking: the marker survived, the effect
    did not. This compares the built output instead.

    Returns True (changed), False (inert), or None when the check cannot apply.
    """
    if not path.replace('\\', '/').endswith('widget/widget.js'):
        return None
    import tempfile
    out = os.path.join(tempfile.gettempdir(), 'qa_effect_probe.js')
    r = run('npx esbuild "%s" --bundle --minify --format=iife --outfile="%s"' % (path, out))
    if r.returncode != 0 or not os.path.exists(out):
        return None
    built = io.open(out, encoding='utf-8', errors='replace').read()
    # The baseline is the PRISTINE build, captured once and never overwritten.
    #
    # It used to be the LAST build, which made a second identical mutation
    # compare mutant-against-mutant and report INERT - a FALSE inert, the
    # mirror of the false NOT CAUGHT this guard exists to prevent, and worse
    # because FINDING-036's dispositions would have it skipped rather than
    # investigated. Found by running two cycles of the same mutation in one
    # process during the M30 housing check.
    prev = getattr(esbuild_differs, '_pristine', None)
    if prev is None:
        esbuild_differs._pristine = built
        return None
    return built != prev


def reset_pristine():
    """Forget the pristine build. Call ONLY on a verified-clean tree."""
    if hasattr(esbuild_differs, '_pristine'):
        del esbuild_differs._pristine


def run_target(target: str) -> tuple[str, str, list[str]]:
    """Run a suite, retrying ONCE on a collection failure (FINDING-030)."""
    out = run(f'npx vitest run {target}').stdout
    verdict, detail = score(counts_line(out))
    if verdict == INVALID:
        shutil.rmtree(os.path.join(REPO, 'node_modules', '.vite'), ignore_errors=True)
        out = run(f'npx vitest run {target}').stdout
        verdict, detail = score(counts_line(out))
        detail += '  (after one retry -- first attempt did not collect)'
    named = [l.strip() for l in out.splitlines() if l.strip().startswith('\u00d7')]
    return verdict, detail, named


BRACKET_PATHS = ['widget/', 'tests/', 'src/']


def mutate(mutants, paths: list[str], require_clean: bool = True) -> int:
    """
    mutants: iterable of (label, file, target_suite, catches, [(old, new), ...])
    paths:   repo-relative paths the cycle writes, restored after each mutant.
    Returns the number of mutants that FAILED to catch their defect.
    """
    shutil.rmtree(os.path.join(REPO, 'node_modules', '.vite'), ignore_errors=True)
    if require_clean and not tree_clean():
        print('ABORT: working tree is not clean. The other agent may be holding '
              'uncommitted work in a path this cycle writes. Confirm, or build '
              'the mutant out of tree.')
        return -1

    # BASELINE. A red after mutation proves nothing if the target was already red.
    for target in sorted({m[2] for m in mutants}):
        verdict, detail, _ = run_target(target)
        ok = verdict == NOT_CAUGHT          # i.e. tests ran, none failed
        print(f'BASELINE {"GREEN" if ok else "NOT GREEN"}  {target}: {detail}')
        if not ok:
            print('ABORT: target is not green before mutation.')
            LOCK.release()
            return -1
    print()

    # Prime the pristine build baseline before anything is mutated.
    # THE LOCK covers this whole cycle INCLUDING restore. One lock, both rigs.
    target0 = mutants[0][1] if mutants else os.path.join(REPO, 'widget', 'widget.js')
    LOCK.acquire('INSPECTOR', target0, 'inspector_mutate')
    bracket_before = LOCK.tree_state_hash(BRACKET_PATHS)
    print('bracket BEFORE: %s' % bracket_before)

    reset_pristine()
    for _p in {m[1] for m in mutants}:
        esbuild_differs(_p)

    summary = []
    for label, path, target, catches, pairs in mutants:
        print(f'--- {label}')
        print(f'    must catch: {catches}')
        refused = apply_mutation(path, pairs)
        if refused:
            print(f'    -> {SKIPPED}: {refused}\n')
            summary.append((label, SKIPPED, refused))
            restore(paths)
            continue
        if esbuild_differs(path) is False:
            # The file changed but the build did not: the edit is inert.
            # Report it, never score it - an inert mutation proves nothing,
            # and scoring it NOT CAUGHT slanders a working assertion.
            print(f'    -> {SKIPPED}: INERT - built artifact unchanged '
                  '(edit landed in a comment, or was stripped by minify)\n')
            summary.append((label, SKIPPED, 'inert: built artifact unchanged'))
            restore(paths)
            continue
        verdict, detail, named = run_target(target)
        print(f'    -> {verdict}  ::  {detail}')
        for n in named[:3]:
            print(f'       {n}')
        print()
        summary.append((label, verdict, detail))
        restore(paths)
        if not tree_clean():
            print('ABORT: tree not clean after restore.')
            LOCK.release()
            return -1

    print('================ MUTATION SUMMARY ================')
    bad = 0
    for label, verdict, detail in summary:
        if verdict != CAUGHT:
            bad += 1
        print(f'{verdict:12}  {label}')
        print(f'{"":12}  {detail}')
        if verdict == NOT_CAUGHT:
            print(f'{"":12}  ^ FINDING-036: choose a disposition before reporting -')
            print(f'{"":12}    (a) coverage gap -> write the test')
            print(f'{"":12}    (b) defeated by a live defence -> mutate past it, re-score')
            print(f'{"":12}    (c) unpinned by construction -> record why, write nothing')
    print(f'\nmutants that FAILED to catch their defect: {bad}')
    print('tree clean at end:', tree_clean())

    LOCK.release()
    bracket_after = LOCK.tree_state_hash(BRACKET_PATHS)
    print('bracket AFTER : %s' % bracket_after)
    if bracket_after != bracket_before:
        # Read-side counterpart to the lock: catches the tree moving for ANY
        # reason, including this driver failing to restore.
        print('TREE MOVED DURING THE CYCLE - DISCARD THESE RESULTS.')
        return -1
    print('TREE HELD - results trustworthy')
    return bad


if __name__ == '__main__':
    print(__doc__)
    print('Import `mutate` and pass a mutant list; see the docstring for the '
          'verdict table this tool is built around.')
