# Attacking the replacement boot-ordering test

## Why this one gets the hardest look
M7/M8/M9 are the only things pinning "the chat list resolves before any
first-chat decision." That rule IS BUG-020. Deleting the cases that encode a
rule we have already been burned by, and replacing them in the same slice, is
the highest-risk edit in the phase — and the replacement is written by the
author of the deletion.

## What the replacement must be, to be worth anything

### 1. ORDERING, not a call count
A count that happens to match today's boot stops protecting the moment boot
changes — and boot is changing in this very slice. The tell: any assertion of
the form `expect(calls).toHaveLength(n)` or `expect(order).toEqual([...])`
where the array is the literal current sequence.

Acceptable shape — the one MASON already used correctly for the mount-ordering
re-point, so precedent exists:

    expect(order.length, 'no decision was made at all').toBeGreaterThan(0);   // vacuity guard
    expect(order.filter(e => e !== EXPECTED_RELATION), '...').toEqual([]);    // the relation

The subject being measured must be **the relation between two events**, not the
population of one of them.

### 2. Reintroduce BUG-020's shape and prove red
BUG-020's live signature, from Abdullah's browser, zero interaction:

    req-3  GET /history?session_id=<legacy>   first-chat decision
    req-4  GET /chats                         +5ms, returns +618ms
    then   GET /history?session_id=<new uuid> a uuid that did not exist before

The reintroduction is therefore: **a first-chat decision emitted while /chats is
still pending.** Concretely, stall the /chats response and assert that no
ACTIVE_KEY repaint, no placeholder mint and no /history call is issued before it
resolves. If the replacement passes with /chats stalled indefinitely, it does
not pin the rule.

### 3. No unpinned window ACROSS COMMITS
The rule must hold at every commit, not merely at the end state. Check:
  - is the replacement committed BEFORE the deletion of M7/M8/M9, or in the
    same commit? A deletion that lands first leaves a window where the rule is
    unpinned, and that window is exactly when a regression enters unseen.
  - `git log --oneline -p -- <replacement file>` and the deletion commit: verify
    ordering, and that no intermediate commit has neither.

### 4. The surviving racer
Under the drop, legacy adoption is gone, so the racer is the OPTIMISTIC
ACTIVE_KEY REPAINT vs list resolution. The replacement must name that pair
explicitly. If it still speaks in terms of adoption, it is pinning a rule about
code that no longer exists — green, and about nothing.

## The wrong-subject question, asked of this test
Subject: *the relation between the first-chat decision and /chats resolution.*
Can it distinguish the pass case from the SPECIFIC failure (decision emitted
early)? Not "does it go red" — does it go red because the decision came first,
rather than because a count moved.
