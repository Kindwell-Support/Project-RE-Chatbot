# A3–A8 browser scenarios — refined, ready to land post-drop

Harness: real buildApp on 3001, fake OpenAI + makeChatsSupabase at the app's own
dependency seam. RESULT-LINE RULE: any line whose truth depends on server
behaviour rather than widget behaviour is flagged **widget-given-fake**.

## A4 — in-flight switch. The highest-probability leak.
Mechanism under test: the generation counter. Three timings, all against a
server that lets us control WHEN the reply lands.

    gate = a deferred promise the fake /chat resolves on command

  A4a  <200ms      send in A; switch to B after 50ms; release gate
  A4b  mid-stream  send in A; release headers, hold body; switch; release body
  A4c  just-before send in A; switch at the last moment before resolution

  ASSERT (all three), on B's pane:
    - B's transcript never contains A's reply text
    - B's transcript never gains a bot bubble it did not ask for
    - no jb-busy class leaks onto B
    - switching BACK to A shows A's reply exactly once (not zero, not twice)
  The "exactly once" half is the one that catches an over-eager reset: a widget
  that drops the reply entirely also passes "never rendered into B".

## A5 — rapid switching
A→B→A→B faster than /history resolves; stall each /history by 300ms and switch
every 80ms. ASSERT: final transcript contains only the final chat's rows; no
duplicate bubbles (count by text); no interleaving (row order matches the
history array for that chat alone).

## A6 — two tabs (multi-page)
  6a same chat, send from both: neither tab renders the other's bubble twice;
     localStorage ACTIVE_KEY ends on a single value; no tab shows a merged
     transcript.
  6b different chats: page1 on A, page2 on B, send in both. ASSERT no crosstalk
     in either direction. NOTE: ACTIVE_KEY is shared across tabs by definition,
     so "last writer wins" on reload is EXPECTED — report as OBSERVATION, not
     a bug, unless a transcript crosses.

## A3 — calculator form
Open calculator in A, half-fill, switch to B without submitting. ASSERT B shows
no form and no retained values. Switch back to A: report persistence either way
as an OBSERVATION — the spec is silent.

## A7 — /history scoping            [widget-given-fake]
GET /history?session_id=B returns zero A rows; then request a soft-deleted
chat's id and report the response verbatim. Both are SERVER assertions.

## A8 — prompt-level leak           [partly widget-given-fake]
Substantive turn in A, then in B ask "what did I just ask you about?".
ASSERT on the CAPTURED messages array for B's turn: zero messages whose content
appears in A's transcript. Never on the answer text — a model that happens to
say "I don't know" would mask a payload that carried A's history.
The capture is server-side, so flag it widget-given-fake; what it proves about
the WIDGET is that it sent B's session_id and not A's.
