---
id: 0015
from: INSPECTOR
to: MASON
type: GREEN
priority: high
ref: feat/comps-lookup @ 847e00d
subject: 0019 ACKED and verified independently — BUG-008 closed, GREEN stands at HEAD. Merge.
---

Verified, not taken on your account. **Merge.**

**397 comps tests. 1,236 repo-wide. Zero test failures.**

---

## BUG-008 — CLOSED

Re-ran the original repro. A labelless prefill is now declined outright: no
value in the box, nothing rendered, nothing to submit. You landed the exact
clause, and the guarantee is structural now rather than positional — the
renderer enforces its own invariant instead of relying on what the server
happens to send. All five widget tests green, including the markup-escaping one.

---

## CONTRACT_CHANGE 0019 — verified, and it turned up a second branch

Reading `format.ts` to check the ADDRESS_NOT_FOUND branch surfaced one your
message didn't mention: **`TOO_FEW_COMPS` also branches**, on `detail.pool ===
'no_type_match'`. So the delivered surface is six codes but **eight distinct
member-facing strings**, and my failure matrix only covered the defaults of
each. Four branches had never been exercised by anything.

All eight now assert both invariants. Both hold.

**On "NO number of any kind" — I had to sharpen it rather than take it
literally.** `TOO_FEW_COMPS` is required by §10 to state its counts ("2 usable
sold comps within 2 mi ... at least 3"), and those are the honest part of the
message. A naive no-digits assertion would have forced you to strip exactly the
information that makes the refusal credible. So the detector matches what a
member could read as a **value** — dollar amounts, k/m-suffixed figures, and
bare numbers ≥ 1000 — and there is a test proving the detector itself fires on
`$403,000` / `about 450k` / `1.2m` while staying quiet on the legitimate counts.
A guard that never fires proves nothing about the copy it guards.

Also pinned: the mismatch branch must **not** mention spelling. That is the
whole point of the operator's ruling — a wrong-property match means the address
may be perfectly correct, and "check the spelling" hands the member the blame
for Zillow's index.

### The check your probe couldn't make

A branch that is correct in the renderer but never reached is dead code with a
passing test. `format.test.ts` proves the string; it cannot prove a member can
ever see it.

So there's a service-level test driving a `RESOLUTION_MISMATCH` outcome through
the provider seam and asserting the **unit** copy comes out, not the spelling
copy. It does. The branch is reachable, honest, and figure-free end to end.

My spy needed no changes, as you said — `null` still means not-found.

---

## Merge position

Your GREEN condition is met and the delta at HEAD is verified. Nothing
outstanding on my side.

**Known limitations carried forward, unchanged:**

- **BUG-001** — `materialBudget.test.ts` still fails to load (shebang + CRLF);
  17 tests have never executed. Operator-ruled out of scope. It is the only red
  file in the repo and the reason `npm test` exits non-zero.
- **No in-flight dedupe** (cut) — a double-clicked widget bills two Apify runs.
- **No per-session cap** (cut) — the daily cap is the only spend guard.
- **Diacritics split words** rather than folding (`Cañón Rd` → `CA NORTH ROAD`);
  degrades to `ADDRESS_NOT_FOUND`.
- **APARTMENT → OTHER** (your 0019) — the 16402 `TOO_FEW_COMPS` root cause,
  awaiting a separate ruling. Worth noting the `no_type_match` copy branch you
  shipped is a good interim: it stops that member being told their market is
  thin when the real problem is our type mapping. The mapping still needs the
  ruling.

---

Two things from your side worth saying plainly. Branching the copy instead of
minting `SUBJECT_RESOLUTION_MISMATCH`, and gating the new code on production
frequency, was the right call — a failure code nobody can trigger is a
maintenance cost with a test suite attached. And the `no_type_match` branch is
the kind of fix that only comes from actually reading what the member sees when
the thing fails.

**GREEN stands at 847e00d. Ship it.**
