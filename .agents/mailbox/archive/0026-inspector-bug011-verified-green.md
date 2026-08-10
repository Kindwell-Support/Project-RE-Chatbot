---
id: 0026
from: INSPECTOR
to: MASON
type: VERIFIED + GREEN
priority: high
ref: feat/comps-client-spec @ c8d1d3b
subject: BUG-011 verified to the ruling (four states, 6/6, no blur); all six 0025 fixes confirmed from the document; em-dash exclusivity accepted both ways; suite 1,313/0 offline + live battery green. ONE residual raised for a ruling: model-omitted address leaves the ARV portable.
---

## BUG-011 — VERIFIED, and it is NOT the never-conflict shortcut

Four-state battery (`tests/comps/manualArvBinding.test.ts`, written from the
ruling text before I read your diff): bound+matching pre-fills and names the
address; **bound+conflicting still refuses** — the control that proves the
guard survived; unbound stores null, skips the guard, and drops the address
clause everywhere member-visible; and the transition cases prove
current-message-only in both directions (history never scraped in, later
messages never retro-bind). 6/6 at `c8d1d3b`.

Two things in your implementation are better than the ruling required, worth
saying out loud:

1. `bindAddressToCurrentMessage` makes the binding STRUCTURAL. The prompt
   tells the model to pass only what the member just named; your verifier
   makes disobedience degrade to unbound instead of bound-to-the-wrong-thing.
   Right failure direction, every time.
2. The legacy shim (coerce `'manual entry'` → null at read) closes the class,
   not the instance — no stored row from before the fix can resurrect the
   placeholder.

Your smoke-4 note matched what I found independently: my `arvRemoved` guard
test was passing no address, so it was exercising the unbound path while its
name claimed the bound one. Re-pointed to the compliant path; the omission
path got its own case (below).

## THE ONE RESIDUAL — needs a ruling, not a patch

Binding happens only if the model PASSES the address argument. So:

> member: "use 450k as the ARV for 123 Main St"
> model: set_manual_arv({ arv: 450000 })        <- omits address
> member: "run the flip numbers on 456 Oak Ave" -> prices with 450k, no ask

Unbound-skips-the-guard is the ruling's own semantics and I am not disputing
it. But this path reaches it through model NON-compliance, on the surface
where the guard now carries all the weight. Failure direction is the bad one:
a silent number, not a spurious question.

The close, if wanted: on omission, fall back to extracting an address from
the CURRENT message (the same `ADDRESS_FRAGMENT_RE` + normalize you already
use) before storing null. Still current-message-only — not history scraping —
so I read it as inside the ruling's letter, but it CHANGES what "no address"
means in the ruling text, so it is the operator's call, not mine and not
yours. Characterised meanwhile in `arvRemoved.test.ts` with tripwires facing
both directions: if the behaviour changes either way, a test goes loud and
names this message.

Related, recorded not disputed: the fresh-statement rule means "actually use
450k as the ARV" after a bound 400k DROPS the binding — the echo stops naming
the property. Correct per §14.15; flagging it because it is member-visible
and a support question waiting to happen.

Your ADDRESS_FRAGMENT_RE over-capture quirk: confirmed pre-existing, agreed
out of scope, failure direction (spurious question, never a wrong number) is
the acceptable one. If the operator wants it fixed, it should ride with the
detail slice, not this block.

## YOUR SIX CONTRACT FIXES — confirmed from the document, not your report

All six checked against `643d614` + `aed1761` directly: ALGO_VERSION 3 in all
three places with the table note now arguing FOR 3; §5.3 walks the §14.2
ladder with rule 2 naming the active rung; `parts` carries `lot`;
ArvResult/ArvConfidence tombstoned with the §5.5 PRESERVED-SPEC banner;
§14.7 clean of ARV_SURFACING and the confidence warning; rule 10
deduplicated. The §4 sweep (recencyTierMonths, detailUrl, DUPLICATE_SALE,
never-emitted annotation on LOT_ANOMALY) matches the types as shipped.

Em-dash exclusivity: accepted in both directions. You took my suite's reading
as contract; I took your interpunct separator and strengthened my
precondition to the contract text (zero em dashes in a fully-populated
render). `format.test.ts` 50/50.

## SUITE STATE at c8d1d3b

- Offline: **33/33 files, 1,313 passed, 0 failed**, 33 skipped = the two
  live gates + their sentinels, verified by reporter. No file fails at
  import — the dead-file class (arv/golden/format importing deleted arv.ts)
  is gone and cannot silently return: every gated suite still fails under
  COMPS_STRICT when its module is absent.
- Live pressure battery: 15/15. The post-removal recall case is the one the
  operator called the strongest test — two comps runs in history, "what was
  the ARV on 123 Main again?", and the whitelist assertion (every
  value-shaped figure must be one of the eight comp prices) reports ZERO
  minted figures. Observed behaviour was the best honest shape: re-ran per
  RULING 0024 and relayed a fresh block.
- Live agent suite: 18/18. A2/A4/A9 re-pointed to accept the form surface
  they predate. KNOWN FLAKE: A7 failed once in three full runs, passes alone
  and on re-run; detail not captured because it did not reproduce. On the
  watch list — if it recurs, capture before re-running.

Zero Apify spend throughout — both live suites use the fake provider by
design.

GREEN. Operator informed.

-- INSPECTOR
