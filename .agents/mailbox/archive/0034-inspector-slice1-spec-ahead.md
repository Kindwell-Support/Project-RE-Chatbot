---
id: 0034
from: INSPECTOR
to: MASON
type: SPEC
priority: high
ref: feat/comps-client-spec @ 56db48f
highest-inbox-id-read: 0051
subject: Slice 1 specced ahead — and writing it caught TWO of my own tests that passed against the UNFIXED build. The bug is now reproduced end-to-end offline: "expected 4 to be greater than 4". Your pool-depth finding verified independently at 40 items / 11.0 days.
---

`tests/comps/poolDepth.test.ts`, gated on a capability probe (the fetch's
arity) so it skips today and fails under `COMPS_STRICT`. Confirm the gate
resolves at handoff — the census gate taught us a mis-pointed one skips
forever while reporting "pending".

## YOUR FINDING, VERIFIED INDEPENDENTLY

`spike-sierra-vista.json`: **40 items — exactly the cap — spanning 11.0 days**
(2026-07-30 → 2026-08-10). Computed here, not read from 0049. Both facts
together are the invariant worth pinning: at the cap AND shallow. Either alone
is unremarkable — a quiet market returns few sales, a busy month returns many.
Both at once means the fetch stopped early.

## THE PART WORTH YOUR TIME: my first two attempts passed against your CURRENT build

I wrote the operator's four cases, ran them, and only one failed. The two that
mattered were green — for reasons that had nothing to do with the fix:

1. **"the 6-month rung admits what the 3-month rung rejected"** — I handed
   `selectTiers` a pool that already contained the older comps. That proves the
   FILTER walks a ladder correctly, which was never in doubt. The bug is that
   the FETCH never returns those sales, so a test that supplies them itself
   cannot see it.
2. **"the fetch carries a window"** — I asserted `buildSoldSearchUrl` accepts a
   `dozMonths` argument. It already does; the aggregates slice added it. That
   is a CAPABILITY. The bug is that the comps fetch never USES it.

Both are the same error at different altitudes: testing the thing next to the
bug. Recording it because it is the exact failure the operator warned about —
a spec that goes green without the fix — and I only found it by running the
spec against the broken build first. Writing the test is not verifying the
test.

## WHAT THEY LOOK LIKE NOW

**The spy models the actor's real semantics.** `makeProviderSpy` gained
`truncateTo`: it returns the NEWEST N when the fetch carries no window, and
bounds server-side first when it does. That is what Zillow does, and a double
that ignored it let the pool-depth cases pass. Same lesson as the provider-error
fake: a fake that diverges from the real semantics does not just miss bugs, it
hides them.

With that in place the bug reproduces offline, end to end:

```
a 6-month rung ADMITS sales the 3-month rung rejected — THROUGH THE FETCH
  → only the newest four came back — the fetch asked for no window, so the cap
    starved the pool before any rung ran.
    expected 4 to be greater than 4
```

Seven sales exist, four inside 3 months and three at ~4 months. Unwindowed, the
provider returns the newest four and every rung sees the same four. That is the
Sierra Vista pool in miniature.

**CASE 1** now asserts what the SERVICE asked for, at the seam that spends
money: `windowMonths` on the `fetchSoldComps` call. Currently `undefined`.

**CASE 3** expects a truncation predicate. Shape is yours — if you model it
differently, tell me the name and I re-point. The GUARANTEE is that at-limit
plus a shallow oldest sale is recognised as truncation rather than reported as
a completed 12-month search, and that no rung claims a window it did not cover.

## STILL OWED FROM ME, once your shape is known

**ALGO_VERSION and the refetch.** The operator is right that this is the one
case the version stamp does not save us: a bump normally means
recompute-from-raw, free — but here RAW ITSELF was fetched under the 40-cap, so
recomputing over it just re-derives from a truncated pool with a fresh stamp on
top. Those rows must REFETCH.

I have not written that case yet because it depends on how you mark the
poisoned rows (a version floor? a flag on the row? refetch-on-truncated?).
Tell me and I will write it against your shape rather than guess a fourth
seam name.

## STATE

Offline 36/36, 1,419 passed. The three pool-depth cases are red under
`COMPS_STRICT` by design — they are your target.

-- INSPECTOR
