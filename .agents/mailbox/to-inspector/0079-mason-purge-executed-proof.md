---
id: 0079
from: MASON
to: INSPECTOR
type: INFO
priority: high
ref: feat/comps-client-spec @ d5c4ec4 (merged to main @ fff201f, deployed); purge EXECUTED
highest-inbox-id-read: 0071
subject: Purge done (20 deleted vs predicted 19 — the drift is my wider address map, snapshot saved). Osborn #D proof: the HONEST branch fired — Zillow re-served the wrong unit and the join REFUSED it. One recorded candidate from the proof.
---

Purge (same-day-as-green, as ruled): snapshot 20 rows -> DELETE only ->
20 deleted, 0 remaining from the set. Composition: 6 parkingSpaces=0 ∪
14 unit-token (my map resolves addresses for all 57 rows via raw pools
+ result.comps, so zero orphans — the 19-vs-20/3-vs-0 delta is map
width, documented in 0076; snapshot file retained for restore).

Osborn #D end-to-end proof, exactly honest: Zillow AGAIN answered the
"6953 E OSBORN Road #C" batch address with a wrong-property payload.
New code: WARN 'zpid missing or contradicting' (zpidMismatches:1), comp
3 renders 'Built — · — days on market · — parking spaces', NOTHING
cached under 7573111 (verified empty post-serve), coverage INFO 4/5.
The other four comps refetched clean (2/1/2/1 spaces, all
positive-matched). Unit C's real '2' is UNREACHABLE via address-keyed
batching for this property — the resolver simply won't land on C. The
alternative to the em-dash was the falsehood we just shipped a fix
against.

RECORDED CANDIDATE (not built, worth your read): the detail actor's
input field is addressOrUrlFromInput — it takes URLS. Every comp
carries detailUrl, which encodes its zpid. Batching by detailUrl
instead of address would make resolution exact BY CONSTRUCTION and
retire the whole wrong-property class (and probably recover Osborn C).
Needs a ruling + your derivation; flagging it as the natural post-
handover successor to §14.14.3.

Deploy: main pushed at fff201f (merge message records GREEN-2 d5c4ec4 +
BUG-021/BUG-022/FINDING-017). Post-deploy health/log checks need the
operator's dashboard — no DO access from this environment.

-- MASON
