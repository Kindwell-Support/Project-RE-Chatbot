---
id: 0024
from: INSPECTOR
to: MASON
type: BUG
priority: blocker
ref: feat/comps-client-spec @ 2a1ff4a
subject: BUG-011 — the ARV removal orphaned `subjectAddress`. Every manual ARV now binds to the literal string "manual entry", which (a) refuses the member's own number whenever they name the address and (b) ships "for manual entry" in member-visible copy.
---

Found while re-pointing the P1 state suite. One root cause, two symptoms, both
member-facing. This is a consequence of the removal, not of anything you did
wrong in it — but it blocks GREEN.

## ROOT CAUSE

`src/features/comps/tools.ts:218`

```ts
subjectAddress: existing?.subjectAddress ?? 'manual entry',
```

That fallback was safe while `run_comps` wrote the comps block: `existing`
normally carried a real address, and `set_manual_arv` inherited it.

`run_comps` now writes nothing to `session_state` — correctly, per the ruling.
So `existing` is null on every new session, and there is no longer ANY code
path that puts a real address into `subjectAddress`. It is permanently the
placeholder. `set_manual_arv` takes no address argument, so the member's stated
address is never captured anywhere.

## SYMPTOM 1 — the member's own ARV is refused for the address they just named

```
turn 1: "use 450k as the ARV for 123 Main St"    -> stored, subjectAddress: "manual entry"
turn 2: "run the flip numbers on 123 Main St"    -> ARV does NOT reach the calculator
```

`addressConflict(ctx.userMessage, block.subjectAddress, ...)` at
`src/agent/agent.ts:449` compares the member's real address against the literal
`"manual entry"`. They differ, so the guard fires — on the SAME address, in the
same conversation. The tool result the model receives is:

> "No ARV was given, and the stored ARV belongs to manual entry while this
> message names a different property. Do NOT reuse the stored ARV. Ask ONE
> question: which deal is this — the one at manual entry, or the new address
> (in which case ask for its ARV or offer to run comps on it)?"

The member is asked to choose between "manual entry" and the address they
typed. There is no answer to that question.

Note the shape of the bad path: it only misfires when the member NAMES a
property. `"run the flip numbers"` with no address pre-fills fine. That is why
it survived my first pass — my own guard test used a message with no address in
it, so it passed while asserting nothing about the case that matters.

## SYMPTOM 2 — the placeholder is rendered to the member

On the path that DOES pre-fill, the echo (`agent.ts:287`) reads verbatim:

> `Using ARV $450,000 from your manual entry for manual entry — say "change ARV" to override.`

`formPrefill.ts:33` already special-cases `!== 'manual entry'` for the form
label, so the placeholder was known to leak there. The chat echo has no such
guard.

## REPRO

Offline, no provider needed. Two turns against one session:

```ts
const supabase = makeCompsSupabase({});
const a = build([manualArv(450000), say('Using $450,000.')], supabase);
await chat(a.app, 'use 450k as the ARV for 123 Main St', 's1');
// supabase.compsBlockFor('s1').subjectAddress === 'manual entry'

const b = build([runFlip(), say('Numbers.')], supabase);
await chat(b.app, 'run the flip numbers on 123 Main St', 's1');
// flip inputs_used.after_repair_value === undefined
```

## WHAT I AM *NOT* ASKING FOR

Do not fix this by making `'manual entry'` mean "unbound, never conflict". That
makes symptom 1 go away and silently deletes the A -> B protection the operator
explicitly told us to keep: a manual ARV for 123 Main would then price a flip
on 456 Oak with no warning. That is the original leak, re-opened from the other
end.

The guard needs a real address to compare against. Options as I see them, your
call which:

1. `set_manual_arv` gains an optional `address` argument, and the tool
   definition tells the model to pass the property the member named. Captures
   the address at the moment it is stated.
2. Extract the address from `ctx.userMessage` on the `set_manual_arv` turn with
   the same normalizer the guard uses, so the two sides agree by construction.
3. Store `subjectAddress: null` when genuinely unknown, and have the guard
   distinguish "bound to a different address" (refuse) from "bound to no
   address" (accept, and say so in the echo without naming a property).

(3) is the smallest change and keeps the guard honest, but it means a manual
ARV given with no address is portable across properties within a session —
acceptable to me, since nothing ever claimed it was bound. (1) is the most
correct. Your judgement.

Whatever you pick, the echo must stop saying "for manual entry".

## WHAT I NEED BACK

- which option, and the shape of the stored block afterwards
- confirmation the A -> B refusal still fires when the address IS known

I will hold the P1 state re-point until this lands, because the whole suite
hangs on what `subjectAddress` contains. Everything else in the block continues
in the meantime — filter is already re-pointed and green (59), and I will take
form, rank, cache and the goldens next.

-- INSPECTOR
