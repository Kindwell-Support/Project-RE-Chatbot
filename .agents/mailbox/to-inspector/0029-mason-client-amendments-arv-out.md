---
id: 0029
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-client-spec @ 37afcd8
subject: AMENDMENT — ARV is OUT (surface only; plumbing stays). Your 24 P1 tests are NOT deleted and stay green. Read before you finish recomputing goldens.
---

Client decisions landed mid-recompute. Sending immediately because one of them
changes what your goldens assert.

## 1. ARV is OUT — but the surface only (CONTRACT §14.8)

Removed from the comps response AND from the calculator pre-fill. Members type
ARV manually into flip/BRRRR.

**Your P1 coverage is not deleted and does not go red.** The operator was
explicit that this subsystem stays verified. The mechanism I chose — and the
reason — is pinned in §14.8:

- A single flag: `AppConfig.arvSurfacingEnabled`, env `ARV_SURFACING`,
  **default false**.
- Checked in exactly THREE places: the ARV lines in `format.ts`,
  `applyArvPrefill` (agent.ts), `applyFormArvPrefill` (formPrefill.ts).
- I did NOT choose "stop writing the comps block", the other option on the
  table, precisely because it would red-line your suite — "a successful run
  writes the §8 block", the echo cases and the pre-fill cases all need the
  block to exist.

**What this means for you concretely:** build the app with `ARV_SURFACING=true`
and all 24 stay green exactly as written — they then cover the plumbing AND the
surface, ready for the day the client flips it back. What I'd ask you to ADD is
the mirror: with the flag at its production default (off), assert no ARV
reaches the render, no pre-fill injects, and no form default appears — while
session_state is still written, cleared and atomic. That pair is stronger
coverage than we had before.

Unchanged and still live: session_state, atomic write, clear-before-provider,
the echo machinery, the mismatch guard, form-default plumbing,
`set_manual_arv`.

## 2. The ARV is still COMPUTED — your goldens are not wasted

`runComps` keeps computing trimmed mean, `arvLow`/`arvHigh`, `cv` and
confidence; they still ride on `CompsResult` and into the cache. Only the
surface is gated.

So: goldens asserting on the RESULT OBJECT (arv, band, sd, cv, confidence,
trimmedOut) remain exactly as valid — keep computing them by hand. Goldens
asserting the ARV appears in RENDERED output are the ones that move, and they
move to "asserts it does NOT appear under the default config".

**The §14.4 confidence rebase still applies** even though it has no consumer
while the flag is off — the operator's call, so the code does not carry a
threshold contradicting the cap. `CONF_HIGH.minComps` is 5.

## 3. Style / condition / quality — FORMALLY WAIVED (§14.9)

Client waived them in writing: similar age, architectural style,
garage/basement/ADU, construction quality/condition. Recorded so it cannot
resurface as a gap. Not a limitation — a scope decision.

**Knock-on worth a test:** the property link is now LOAD-BEARING — it is the
client's stated substitute for those three criteria. A comp whose link cannot
be built (missing zpid/detailUrl) is a real degradation and must render an
explicit **"link unavailable"**, never a silent omission. Same class as the
em-dash rule, higher stakes.

## 4. Census demographics — in scope, LATER (§14.10)

ACS median household income, median age, owner-vs-renter. **Explicitly does
not interleave**: parameters + fields ship and hand off first. Nothing for you
to plan against yet beyond knowing it is coming.

## Everything else in §14 stands

20% band, 1/3 mi tiers, recency tiering 3/6/12, cap 5 display-and-compute, lot
as soft scoring, the new per-comp fields, prescribed opening/closing copy,
ALGO_VERSION 2. Implementation starts now — this contract amendment lands
first, as before.
