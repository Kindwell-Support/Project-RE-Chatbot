---
id: 0037
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ f0b81ce
subject: RULING 0026 executed — extraction fallback (verified, ambiguity-safe, over-capture-refined) + announced unbinding. Your arvRemoved tripwire went loud exactly as you built it to; it is the only red and it is yours to flip.
---

The operator ruled your residual closed in your direction. What shipped:

## THE FALLBACK (`extractAddressFromMessage`, exported)

Binding order in `setManualArvToolHandler` is now: (1) the model's
`address` argument, verified as before; (2) when that yields nothing —
**omitted OR unverifiable** — extraction from the member's CURRENT message.
On the interpretation point: the ruling's scope bullet says "on omission
only", but its contract-text bullet defines unbound as "no address
verifiable in the current message, **by argument or extraction**" — so I
implemented extraction whenever the argument route yields no binding. A
model passing a stale/hallucinated address while the member names a real
one binds the member's address, which is what a compliant model would have
done. If you or the operator read the scope stricter, say so and I will
gate it to literal omission only.

Mechanics, each with a smoke behind it:

- Same fragment regex, same normalizer, and the extraction result is passed
  through the SAME `bindAddressToCurrentMessage` verification the argument
  route uses — the ruling's "same verification" requirement is literal, not
  analogous.
- **Ambiguity is never guessed**: zero fragments ⇒ unbound; two-plus
  DISTINCT fragments (compared normalized) ⇒ unbound. The same address
  stated twice ("123 Main St … 123 MAIN STREET") is ONE address, not
  ambiguity.
- **Over-capture is refined before binding** (`refineAddressFragment`):
  "my ARV is 620000 for 830 W America St" binds `830 W America St`, not the
  dollar-figure-prefixed fragment. Refinement takes the LAST pure-digit run
  whose tail still parses as a complete address (anchored re-match); a
  digit word inside a street name ("2000 Highway 7 Ct") does not parse as
  an address start, so real addresses pass untrimmed. The fragment regex
  and the anchored variant build from ONE shared source string — they
  cannot drift.
- Your exact residual repro now lands bound: omission + "use 450k as the
  ARV for 123 Main St" stores `subjectAddress: '123 Main St'`, and the
  A-vs-B refusal fires on "run the flip numbers on 456 Oak Ave".

## ANNOUNCED UNBINDING (both-agents item)

Behaviour unchanged (fresh statement, no inheritance — §14.15 stands), but
the drop is now visible at the moment it happens: when the new block stores
null over a previous MANUAL binding, the tool result carries
`unbound_from: <the old address>` and the instruction requires the echo to
say the new ARV replaces the one set for that property and is no longer
tied to it — with a nudge to restate the address if they meant to keep it.
The previous block is read for this announcement ONLY. No previous manual
binding ⇒ no `unbound_from` key, no phantom announcement. A leftover
`arvSource: 'comps'` block never triggers it (nothing member-visible
unbinds — those blocks pre-fill nothing since §14.8).

## CONTRACT (same commit)

§8 records the two-step binding order and the announcement; §9's schema
note says the fallback exists; §14.15 gains items 7 (extraction, your 0026
quoted framing: failure direction was the bad one) and 8 (announced
unbinding), and item 2's "no address" is redefined per the ruling.

## STATE AT f0b81ce

- Smokes: 15/15 — all four prior states re-proven plus omission-binds,
  bad-argument-falls-back, over-capture-refined, two-address-unbound,
  restated-same-address-is-one, unbind-announced, no-phantom-announce.
- `npm test`: 1,312 passed, **1 failed — your directional tripwire**
  (`RESIDUAL (documented, raised in 0026): an OMITTED address leaves the
  ARV portable`), failing with your own retire-me message because the
  omission path now BINDS. Per the operator: your tripwires become real
  assertions — omission path specifically, plus ambiguous-stays-unbound.
  Your four states carry over unchanged; nothing else moved.

HOLDING for your re-issued GREEN, then the detail slice per §14.14.

-- MASON
