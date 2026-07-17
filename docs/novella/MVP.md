# Novella MVP cutline — build this, defer the rest

> **Status: the plan is done. Stop revising; start implementing.** This document freezes the MVP scope against the Revision 13 docs. Everything below "Non-goals" is explicitly out of scope for the first shipped version, no matter what a future review finds in it — those findings are filed against post-MVP work, not blockers.

## Why the revision loop must end

Thirteen revisions produced zero code, zero tests, zero CI runs — every single review since Revision 4 has ended with "M1 remains implementable." That has been true for nine revisions. Meanwhile the protocol grew from ~13 actions to 26, and the review→fix cycle stopped converging around Revision 6 for a structural reason, not a quality reason:

1. **FLP is not negotiable.** The threat model admits crashes and unbounded delays. Under that model, agreement + guaranteed termination is impossible; every "fix" can only move the counterexample, and a capable reviewer will always find where it moved. Revisions 7–13 are that theorem playing out: timers → coordinators → epochs → transition chains → incarnation IDs — each layer correct-er, none final.
2. **The guarantees grew past the product.** Revisions 7–13 P1s live almost entirely in the durability/consensus layer: persistent epoch chains, supersession proofs, election transcripts, cross-tab Web Locks, reset incarnations. None of them are about *reading a visual novel with friends*. They are about building a persistent replicated log — a different, much harder product.
3. **The host app disagrees with the requirement.** Chitchatter is deliberately ephemeral: rooms are transient, chat history vanishes, nothing persists server-side or client-side by default. A novella feature whose safety depends on durable `RoomMeta`, multi-tab locking, and reload-surviving epoch high-water marks is fighting the platform's core design instead of inheriting it. The correct MVP move is to **inherit ephemerality**: when everyone leaves, the story is gone — exactly like the chat next to it.

## Architecture verdict (what 13 reviews validated vs. what they exposed)

**Right, and stable across every review — keep exactly as planned:**

| Decision | Evidence |
| --- | --- |
| Reuse the existing `PeerRoom`/Trystero room, one `VISUAL_NOVEL` action, semantic types inside the envelope | Verified against the real codebase (action-name limit, keyed hooks, `getPeers`, `getSelfId`); never challenged in any review |
| Pure deterministic engine, declarative JSON stories, no eval/HTML | Unchallenged since Revision 1; replay-verification made it load-bearing |
| Validate → normalize → authorize → semantically check before any mutation | Every review *strengthened* this; none questioned it |
| Controller as single sequencer with `revision + 1` events and snapshot recovery | The core sync model was never the problem |
| Group-room-only provider mount; `VisualNovelTransport` interface; transport-limit-enforcing engine | Directly verified fixes, stable since Revisions 4–6 |

**Wrong for this product — cut from MVP:**

| Decision | Why it spiraled |
| --- | --- |
| Persistent checkpoints → `RoomMeta` → epoch chains → transition certificates | Persistence is what turned a session protocol into a consensus protocol. Every reload/multi-tab/incarnation P1 since Revision 7 traces back to it. Chitchatter itself persists nothing comparable. |
| Controller election with advertisements/transcripts | Correct elections need agreement; agreement needs what FLP forbids. The MVP story pause (below) needs none of it. |
| Termination ack rounds, retained end certificates, supersession proof pages | All exist to make "ended" durable across parties that may never overlap again — an anti-goal in an ephemeral room. |
| Session epochs, incarnation IDs, cross-tab Web Locks, generation fencing | Machinery for problems the MVP defines away. |

The base architecture was right. The mistake was accepting "must converge under arbitrary partition, crash, reload, and multi-tab concurrency" as a requirement for a cooperative toy in an ephemeral chat room. Requirements are choices; choose smaller.

## MVP scope

One synchronized story per group room, alive exactly as long as its session is alive.

**In:** bundled story catalog; pure engine (05, with transport-limit enforcement); structural + semantic validators (03/04, minus RoomMeta/transition/proof machinery); one transport action with the envelope, identity check, duplicate set, and revision rules; controller sequencing with engine replay on replicas; targeted snapshot recovery (`requestActionId`-echoed) for late join, gaps, and refresh-as-new-peer; request timeout; `SESSION_STARTED`/`SESSION_ENDED`/`RESTARTED` as plain controller events; group-room-only React integration with `RoomVideoDisplay` intact; local assets/audio (14).

**MVP failure story — three rules, no protocol:**

1. **Desync or gap →** request a snapshot from the controller. Controller's state *is* the truth. No replay verification failure loops: mismatch → snapshot.
2. **Controller disconnects →** story pauses: "The storyteller left." Lowest connected peer ID sees a "Continue the story" button; clicking it claims control and broadcasts a full snapshot from its own replica. Honest-peer model: replicas accept the claim if the old controller is absent from their transport view. Two simultaneous claims: accept the lower peer ID, ignore the other — worst case someone clicks twice. No advertisements, no transcripts, no rounds.
3. **You refresh or the race breaks something →** you rejoin as a new peer and get a snapshot; if the room emptied meanwhile, the story is gone, like the chat. Anyone starts fresh. Simultaneous starts: accept the lower `(controllerPeerId, sessionId)`, discard the other — with no persistence there is no resurrection problem, so the Revision 5–13 arbitration machinery is unnecessary.

**Non-goals (documented in-app as "the story lives with the room"):** persistence of any kind (checkpoints, RoomMeta, epochs, incarnations), elections beyond claim-by-click, termination certificates/acks, supersession proofs, multi-tab coordination, canonical JSON digests (RFC 8785, SHA-256 floors — nothing in the MVP compares states across parties anymore), Byzantine anything.

## Build order (aim: 2–3 weeks of evenings, not 13 more reviews)

1. **Day 0 — CI first.** Wire `npm test -- --run`, `check:types`, `lint`, `build` into a GitHub workflow on the `novella` branch. Thirteen reviews noted zero status checks; that gap has cost more than any protocol bug, because docs were the only artifact that could be reviewed.
2. **Week 1 — M1 (unchanged from the docs):** models, validators (trimmed), engine, example story, local-only lobby/stage behind a dev flag. The engine/validator test matrices from doc 16 apply nearly as-is.
3. **Week 2 — M2 (trimmed):** transport action, controller sequencing, snapshot recovery, start/end/restart events, request timeout, the three failure rules, `TestTransport` mesh (the link-layer version is worth keeping — it tests the three rules cheaply).
4. **Week 3 — polish + E2E:** two-context Playwright test (start, branch, controller-leave-and-claim, late join), regression checks (DM rooms, video display, chat), README.
5. **Ship behind the flag. Play it with a friend.** Real usage will surface the two or three failure modes that actually matter — fix those, not the ones a review can imagine.

**Post-MVP, only if real usage demands it, in order of likely value:** local checkpoint for solo-refresh continuity (accepting its known limits) → nicer controller handoff (`CONTROL_PASSED`) → and only then, if the feature has users who care, the durability layer — for which Revisions 7–13 are a genuinely thorough design archive, not wasted work.

## Exit criteria

Two browsers share both branches of Harbour Lights; a participant's choice round-trips through the controller; a late joiner catches up by snapshot; killing the controller shows the claim button and the story continues after one click; refresh rejoins cleanly; chat/voice/video/DM regress clean; all four commands green **in CI on the PR**.
