"""
Cross-rig mutation lock — ONE lock, BOTH drivers, or it is not a lock.

Two mutation drivers share this working tree and both mutate the same target
file. The shared-tree rule ("confirm the other rig has no uncommitted work
before starting") is a point-in-time check: it says nothing about the other
agent STARTING mid-cycle. That happened — INSPECTOR sampled widget.js after a
restore and the suite before the next mutation, and briefly measured
opacity:0.999 against a .toBe('1') assertion: a phantom coverage gap on a rule
already corrected twice. The lock closes the whole window: it is held from
before the first write UNTIL AFTER THE FINAL RESTORE, because the gap
INSPECTOR fell into was between a restore and the next mutation.

Usage (both drivers, identically):

    from mutation_lock import acquire, release
    acquire(rig='MASON', target=TARGET, driver_version=VERSION)
    try:
        ...whole cycle, including every restore...
    finally:
        release()   # clean exits only; a killed run leaves the lock for
                    # stale-reclaim, which restores the sidecar FIRST

Refusal is informative: the blocked agent is told WHO holds the lock and since
WHEN, so it knows who to wait for. Stale locks are reclaimable only when the
holder's PID looks GONE **and** the lock is older than STALE_AFTER_MINUTES
(BUG-044 — both, not either: a live holder misreported as dead was reclaimed
once and its measurement corrupted). Reclaiming runs the previous holder's
sidecar restore first and says so loudly. Silent reclamation would
reintroduce exactly the corruption the lock exists to prevent.
"""
import datetime
import io
import json
import os
import sys

LOCK_PATH = os.path.join('tools', 'qa', '.mutation-lock')
# A full 32-mutation cycle runs ~20 minutes today; threshold is stated at
# triple that so a slow cycle is never reclaimed out from under a live holder.
STALE_AFTER_MINUTES = 60


def _now():
    return datetime.datetime.now()


def _pid_alive(pid):
    try:
        os.kill(int(pid), 0)
    except PermissionError:
        return True  # exists, owned elsewhere
    except OSError:
        return False
    return True


def _read_lock():
    try:
        with io.open(LOCK_PATH, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def acquire(rig, target, driver_version):
    held = _read_lock()
    if held:
        started = held.get('started', '?')
        age_min = None
        try:
            age_min = (_now() - datetime.datetime.fromisoformat(started)).total_seconds() / 60
        except ValueError:
            pass
        holder_alive = _pid_alive(held.get('pid', -1))
        fresh = age_min is not None and age_min < STALE_AFTER_MINUTES
        # BUG-044: reclaim requires BOTH conditions, not either. This used to
        # refuse only when (alive AND fresh), so a holder MISREPORTED as dead
        # inside its freshness window was reclaimed and its running
        # measurement corrupted — which happened: "HELD by MASON (pid 5572,
        # alive=False)" was read off a LIVE run, reclaimed, and the tree
        # restored out from under it (M25 came back a false MISSED).
        #
        # _pid_alive works in the scratch case and its misreport is
        # UNEXPLAINED. Rather than chase it, the liveness check is demoted to
        # ADVISORY: a lock is reclaimable only when the holder looks dead AND
        # the lock has aged past STALE_AFTER_MINUTES. A check we cannot
        # explain must not be load-bearing on a destructive path; the clock
        # is the thing we can trust.
        if holder_alive or fresh:
            print('MUTATION LOCK HELD by %s (pid %s) since %s (%.0f min ago), driver %s.'
                  % (held.get('rig', '?'), held.get('pid', '?'), started,
                     age_min if age_min is not None else -1,
                     held.get('driver_version', '?')))
            print('Refusing to start. Wait for that cycle; do not delete the lock by hand.')
            print('(BUG-044: refusal now needs only ONE of alive/fresh — a holder '
                  'misreported as dead inside its window is still protected.)')
            sys.exit(2)
        # Stale: holder looks dead AND the lock has aged out (BUG-044 — both
        # required). Reclaim = restore FIRST, loudly.
        print('STALE LOCK RECLAIM: holder %s (pid %s, alive=%s) started %s, age %s min '
              '(dead AND older than %s min — both required since BUG-044).'
              % (held.get('rig', '?'), held.get('pid', '?'), holder_alive, started,
                 'unknown' if age_min is None else int(age_min), STALE_AFTER_MINUTES))
        stale_target = held.get('target', target)
        sidecar = stale_target + '.pristine'
        if os.path.exists(sidecar):
            with io.open(sidecar, encoding='utf-8') as f:
                pristine = f.read()
            with io.open(stale_target, 'w', encoding='utf-8', newline='') as f:
                f.write(pristine)
            os.remove(sidecar)
            print('RECLAIM RESTORED %s from its sidecar before proceeding.' % stale_target)
        else:
            print('RECLAIM found no sidecar for %s — previous run died before '
                  'mutating, or restored before dying.' % stale_target)
        os.remove(LOCK_PATH)

    with io.open(LOCK_PATH, 'w', encoding='utf-8') as f:
        json.dump({
            'rig': rig,
            'pid': os.getpid(),
            'target': target,
            'started': _now().isoformat(timespec='seconds'),
            'driver_version': driver_version,
        }, f, indent=2)
        f.flush()
        os.fsync(f.fileno())


def release():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


# --- READ-SIDE PROTECTION (L-1, L-2) ---------------------------------------
# The lock protects WRITERS from each other; these protect READERS. Both
# incidents to date shared one shape: a stable-looking sample is not a
# quiescent tree. INSPECTOR's corrupted run was read-only — fifteen seconds of
# apparent stability was a gap between a holder's mutations, not quiescence
# (its bracket capture: BEFORE deea23e7, AFTER d41d8cd9 — the md5 of an empty
# diff; the file was restored mid-run). Neither the sidecar nor the
# restore-verification catches that, because both are write-side.


def status():
    """L-1: report the lock WITHOUT acquiring. A reader — a plain suite run,
    a browser pass, any measurement — checks this and declines to start,
    rather than discovering corruption afterwards."""
    held = _read_lock()
    if not held:
        return {'held': False}
    return {
        'held': True,
        'rig': held.get('rig'),
        'pid': held.get('pid'),
        'pid_alive': _pid_alive(held.get('pid', -1)),
        'target': held.get('target'),
        'started': held.get('started'),
        'driver_version': held.get('driver_version'),
    }


def tree_state_hash(paths):
    """L-2: the measurement bracket. Hash `git diff` over the stated paths;
    capture BEFORE a measurement and AFTER it, and if they differ the
    measurement ran on a moving tree — DISCARD it, do not report it. Stays
    useful after the lock exists: a reader can still sample inside the window
    between a holder's mutations, where everything looks stable and is not."""
    import hashlib
    import subprocess
    diff = subprocess.run('git diff -- ' + ' '.join(paths), shell=True,
                          capture_output=True, text=True,
                          encoding='utf-8', errors='replace').stdout
    return hashlib.md5(diff.encode('utf-8')).hexdigest()


if __name__ == '__main__':
    # CLI so shell-side readers gate without writing Python:
    #   python tools/qa/mutation_lock.py status        exit 0 free / 2 held
    #   python tools/qa/mutation_lock.py hash <paths>  print the bracket hash
    if len(sys.argv) >= 2 and sys.argv[1] == 'status':
        st = status()
        if not st['held']:
            print('mutation lock: FREE')
            sys.exit(0)
        print('mutation lock: HELD by %(rig)s (pid %(pid)s, alive=%(pid_alive)s) '
              'since %(started)s, target %(target)s, driver %(driver_version)s' % st)
        sys.exit(2)
    if len(sys.argv) >= 3 and sys.argv[1] == 'hash':
        print(tree_state_hash(sys.argv[2:]))
        sys.exit(0)
    print('usage: mutation_lock.py status | hash <paths...>')
    sys.exit(64)
