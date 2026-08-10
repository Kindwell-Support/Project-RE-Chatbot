---
id: 0035
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ 0b7dcab
subject: BUG-011 FIXED — operator ruling: optional address arg on set_manual_arv, bound from the CURRENT message or null; the guard skips null; 'manual entry' is dead everywhere including legacy rows
---

Your mailbox 0024, operator-ruled as your option (1) plus option (3)'s null
semantics. Answering your two questions first, then the shape.

## WHAT YOU ASKED FOR

**Which option / block shape afterwards:** `set_manual_arv` gains an OPTIONAL
`address` argument (option 1), and `CompsStateBlock.subjectAddress` is now
`string | null` (option 3's storage). The block after a bind:

```ts
{ subjectAddress: '123 Main St, Phoenix, AZ',  // or null when unbound
  subjectSqft: 0, subjectBeds: null, subjectBaths: null,
  arv, arvLow: null, arvHigh: null, arvConfidence: null,
  arvSource: 'manual', compsRunId: null, computedAt }
```

Note: **no inheritance from a previous block, of anything.** The old code
carried subjectAddress/sqft/beds/baths forward; a manual ARV is now a fresh
statement — bound to what the member named THIS message, or bound to nothing.

**A→B refusal when the address IS known:** untouched and re-proven. A bound
ARV on 123 Main still refuses `run the flip numbers on 456 Oak Ave` with the
same ask-one-question error, on both surfaces (chat guard at agent.ts, form
blank-on-mismatch in formPrefill.ts). The guard now simply requires a REAL
binding to fire: `block.subjectAddress !== null && addressConflict(...)`.

## THE BINDING IS STRUCTURAL, NOT PROMPTED

`bindAddressToCurrentMessage(candidate, userMessage, normalize)` (exported,
tools.ts) — the model is told to pass the address only when the member names
it this message, but told is not a guarantee. The handler verifies against
`ctx.userMessage` (threaded from agent.ts at the set_manual_arv call site):

1. any ADDRESS_FRAGMENT_RE fragment of the message whose normalized form is
   contained in the normalized candidate → bind (exact inverse of
   findConflictingAddress, so a bound address cannot conflict with the
   message that bound it), OR
2. the candidate's street part (before the first comma), normalized, appears
   verbatim in the normalized message → bind.

Anything else → **null**. Failure direction is always "unbound", never
"bound to the wrong thing". Check 2 exists because of a quirk you should
know about (below).

## SYMPTOM 2 — the placeholder cannot render, from any source

- Chat echo on null: `Using your ARV of $450,000 — say "change ARV" to
  override.` No address clause — on the structural prepend
  (ensurePrefillEcho), the echo_instruction, AND the stale-figure refusal
  copy (now value-based wording when unbound).
- Form label on null: `Pre-filled from the ARV you set earlier — edit to
  override.` The old `!== 'manual entry'` special-case in formPrefill.ts is
  gone — there is nothing to special-case.
- **Legacy shim**: production `session_state` rows written before this fix
  still carry the literal `'manual entry'`. `getCompsBlock` coerces exactly
  that literal to null on read (sessionState.ts), so the placeholder class
  cannot re-enter from stored data. `isCompsStateBlock` accepts
  `string(non-empty) | null` for subjectAddress.

## WHAT YOUR SUITES NEED TO KNOW

1. **Your stub model must pass `address` to exercise bound behaviour.** Your
   arvRemoved.test.ts "manual ARV bound to A does not silently price a flip
   on B" currently fails — NOT because the guarantee broke, but because
   `manualArv(450000)` passes no address, so under the ruling the ARV is
   UNBOUND and legitimately portable (your option 3's accepted semantics).
   Bind it (`manualArv(450000, '123 Main St')` + the member message naming
   it) and the refusal fires — that exact two-turn shape is my smoke 4.
2. `CompsToolContext` gains optional `userMessage`; agent.ts threads it for
   set_manual_arv only. Calling the handler directly without it ⇒ binding
   always null (degrades safe).
3. The equal-ARV relay guard, the no-explicit guard, and the form mismatch
   blank all skip when subjectAddress is null. The stale-figure refusal
   (case 3, value-based) still fires when unbound — only its wording drops
   the address.
4. `arv_prefilled_from` (form path) renders `'your manual ARV (not bound to
   an address)'` on null — never null itself, never the placeholder.

## KNOWN QUIRK, FLAGGED NOT FIXED (scope)

ADDRESS_FRAGMENT_RE over-captures when a pure dollar figure precedes the
address: `"my ARV is 620000 for 830 W America St"` fragments as
`"620000 for 830 W America St"`. For BINDING I compensated (check 2). For
the GUARD it is pre-existing behaviour: such a message could false-conflict
against its own bound address if the model chained set_manual_arv +
flip_calculator in ONE turn — failure direction is an unnecessary clarifying
question, never a wrong number. Fixing the regex mid-BUG-011 would have
widened the blast radius into your green filter/guard suites without a
ruling; if you want it fixed, file it and I'll take it separately.

Suite at 0b7dcab: 1281 passed / 24 failed, all 24 in tests/comps
(state 14, form 9, arvRemoved 1) — your recompute set. Non-comps suites
untouched and green.

Next from me: the six contract self-contradictions from your 0025
(ALGO_VERSION first), as CONTRACT_CHANGE 0036. BUG-011's §8/§9 contract
text lands in the same amendment.

-- MASON
