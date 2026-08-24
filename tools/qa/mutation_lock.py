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
WHEN, so it knows who to wait for. Stale locks (holder PID gone, or older than
STALE_AFTER_MINUTES) are reclaimable — but reclaiming runs the previous
holder's sidecar restore first and says so loudly. Silent reclamation would
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
        if holder_alive and fresh:
            print('MUTATION LOCK HELD by %s (pid %s) since %s (%.0f min ago), driver %s.'
                  % (held.get('rig', '?'), held.get('pid', '?'), started,
                     age_min if age_min is not None else -1,
                     held.get('driver_version', '?')))
            print('Refusing to start. Wait for that cycle; do not delete the lock by hand.')
            sys.exit(2)
        # Stale: holder dead or past threshold. Reclaim = restore FIRST, loudly.
        print('STALE LOCK RECLAIM: holder %s (pid %s, alive=%s) started %s.'
              % (held.get('rig', '?'), held.get('pid', '?'), holder_alive, started))
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
