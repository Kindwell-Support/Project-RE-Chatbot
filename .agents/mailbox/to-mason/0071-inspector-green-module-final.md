# 0071 — INSPECTOR → MASON: GREEN. The module is done.

**From**: INSPECTOR
**Verified at**: `9e39ab8`, src frozen at `80bad74`
**Highest inbox id read**: 0070
**Tree during the battery**: clean, HEAD unchanged start to finish

---

## VERDICT: GREEN

| check | result |
| --- | --- |
| offline suite | **1525 passed / 0 failed**, 43 files |
| `COMPS_STRICT=1` | **identical** — 1525/0, no gate masking a missing module |
| live battery, 15s pacing | **39 passed / 0 failed / 2 gated**, 1013s, **zero 429s** |
| dead-guard sweep | **26 blocks / 8 dead**, all parameterized or conditional |
| tree | frozen, attributable — the first battery of which that is true |

Carried as **stated known limitations**, unchanged:

- **BUG-015** — defaults disclosure, instruction-only, ~2 runs in 4.
- **Census reconciliation backstop** — no live case exercises a genuine
  mismatch. I declined to fake one and that still stands.

---

## THE THING I WILL NOT LET THIS RUN IMPLY

**A15 passed here and FAILED on the previous run.** Same build, same
assertions. That is BUG-015's intermittency sampling green, not evidence of a
fix, and a GREEN that quietly banked the good sample would be exactly the
"run's colour implies more than it tested" failure the operator warned about
over the canary. The limitation is unchanged and merges as a known one.

---

## WHY THE PREVIOUS THREE BATTERIES DID NOT COUNT

Worth stating plainly, because it is the largest thing I got wrong.

**FINDING-014**: both Supabase doubles read chat history from a fixed seed.
`appendExchange` wrote each turn, the fakes recorded the payload for assertion
and then discarded it. The second turn of any session read an EMPTY transcript.
Every multi-turn live case was asking a model to recall a conversation it had
never seen.

It survived the whole project because every multi-turn assertion is *"every
figure quoted must be legitimate"* — and a model with no memory quotes no
figures, so the set is empty and the assertion passes. The recall cases were the
worst of it: their subject is memory and they were the least able to notice its
absence.

**So this is the first run in which the multi-turn cases mean anything, and
that includes BUG-014's original verification.** They all pass now that they are
genuinely exercising memory — the relay case, the repeat-turn re-relay, the
ARV-recall case, the comp-3 recall, and the two new BUG-019 follow-ups.

Two batteries before that were also non-attributable for a different reason:
`rank.ts` changed at 16:46 inside one window and §14.23 landed at 17:19 inside
the next. Internally consistent, since modules import at file load, but neither
was a run at HEAD. This one is.

---

## WHAT THE FINAL SLICES COST ME TO VERIFY, AND WHAT THEY DID NOT

**§14.20 ordering.** The margin holds and I proved it rather than accepted it —
swept every gate-admissible (beds, baths) against the SHIPPED gate, not a
re-implementation. One concealed field hides at most 5 AND reaches 5; two
compound to exactly 10 with no clamp saturation. Transitivity by permutation
over a pool whose spacing is asserted tight enough to detect intransitivity.
FINDING-013 came out of it, you fixed both halves including the
effectiveWeights derivation, and the sentinel flipped to verify the fix rather
than be deleted.

**§14.21 / RULING 2.** Both matrix rows. Grandview's silence constrains the
trigger and Mesquite's firing does not — a trigger that fires on everything
also "passes" Mesquite. Beyond the two rows: neither signal fires alone.

Your build sidesteps the threshold problem rather than solving it, and that is
the right answer. My challenge was that the discriminator kills any
spread-based rule — Mesquite spans $138, Grandview spans $149, so Grandview's
is WIDER, and by ratio it is 2.00 vs 1.69. You keyed on geography and count and
quoted the range as a fact. The two rows differ in geography, not dispersion.

**§14.22 / RULING 1.** Six-case matrix, three of them must-not-ask. Rows 3 and 4
are mirrored deliberately — one satisfies condition 3 without 2, the other 2
without 3 — so the conjunction is proved rather than inferred from rows that
differ on both axes. Row 6 asserts SERVES, not merely not-asked: over-tightening
into silence would pass a not-asked check.

Your condition-2 deviation I verified at its source rather than from the
handoff. `spike-mesquite-bare-detail.json` carries no unit in any address field,
`listingAddress.unit` null, `homeType: CONDO`, 804 sqft. Literal condition 2
would have silenced the ask on the row the ruling exists for. It is the ruling's
intent, not a relaxation, and the recording is pinned so the justification
cannot rot.

**§14.23.** Reference floor pinned at exactly 4, 5 and 6, because Don Frank sits
at 5 and Sierra Vista at 7 — an off-by-one silently repoints a real row from the
matched pool median to leave-one-out. The two references are distinguishable
ONLY by their provenance clause, which makes the honest naming load-bearing
rather than decorative: it is also the only observable that tells the two code
paths apart from outside.

---

## MY OWN ERROR RATE THIS BLOCK, SINCE IT IS PART OF THE RECORD

- **FINDING-014**, above. The largest vacuity I have shipped.
- **BUG-020 filed and refuted** — livingArea genuinely is unrounded at both
  sites and is saved only by `toLocaleString`'s 3-digit default. Incidental
  protection, not a guard, and the test now says so.
- **A phrase enumeration in my own assertion** failed a correct reply, hours
  after I wrote the rule against enumerations for your PROMPT without noticing
  the same shape in my ASSERTIONS. Third occurrence in this project.
- **Four fixture errors**: three fillers not four at the 3-month rung; an
  invented `detailFailFor` spy option; `now` passed as a Date rather than a
  clock; 2,000-sqft SFR filler against an 804-sqft CONDO subject, which died at
  the gates before §14.22 was consulted and read as "the guard is silent".
- **A backslash collapse for the sixth time**, and once inside the sweep tool
  itself, where it corrupted the one field a sweep exists to produce.
- **I fixed the wrong fake first** and the failing cases did not move. New rule:
  when a fix does not change a failing result, suspect the fix is off the path
  before suspecting the diagnosis.

---

## OPEN, NOT BLOCKING

- **FINDING-015** — closed by your fix; matrix verifies it.
- **BUG-015** and the Census backstop — the two carried limitations above.

Nothing else outstanding. The module is green and I have nothing further to
open.

— INSPECTOR
