# Two Lanterns — minimal duet-novella starter

One tap chooses your light. A stranger takes the other. The story cannot
move without both of you.

The flow: land on a dark harbour scene → tap the lighthouse (**Keeper**) or
the boat lantern (**Sailor**) → drop into a time-bucketed public room where
another anonymous visitor lands too → the novella auto-starts once both
lights are present → choices alternate between you (the "lantern" passes on
each story revision) → chat underneath is the back channel.

See `CONCEPTS.md` for this idea plus the three alternates (Masquerade,
Signal/Static, Ink & Echo).

## Files

| Snippet               | Target                                                   | What it is                                                                                             |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `duet.ts`             | `src/config/duet.ts` (new)                               | Roles, sessionStorage, stage-room pairing, turn parity                                                 |
| `CharacterSelect.tsx` | `src/pages/CharacterSelect/CharacterSelect.tsx` (new)    | Animated harbour landing page (beam sweep, boat bob, flickering lamps — pure CSS keyframes, no assets) |
| `DuetNovelRoom.tsx`   | `src/components/VisualNovelRoom/DuetNovelRoom.tsx` (new) | Duet-aware novella panel: waits for a partner, auto-starts, enforces turn-taking                       |

## Wire-up (2 one-line edits)

1. **Root route → character select.** Wherever the router maps `routes.ROOT`
   to `<Home userId={...} />`, render `<CharacterSelect />` instead:

   ```tsx
   import { CharacterSelect } from 'pages/CharacterSelect/CharacterSelect'
   // ...
   // was: <Home userId={userId} />
   ;<CharacterSelect />
   ```

2. **Room → duet panel.** In `src/components/Room/Room.tsx`:

   ```tsx
   // was: import { VisualNovelRoom } from 'components/VisualNovelRoom'
   import { DuetNovelRoom } from 'components/VisualNovelRoom/DuetNovelRoom'
   // was: <VisualNovelRoom peerRoom={peerRoom} />
   ;<DuetNovelRoom peerRoom={peerRoom} />
   ```

   Combine with `snippets/fixes/` (minimal shell, no app bar) for the full
   distraction-free experience.

## Design decisions

**Turn-taking is UI-only.** `isRoleTurn(role, revision)` — Keeper acts on
even revisions, Sailor on odd. No story-data or protocol changes; the engine
and session are untouched. If your partner vanishes mid-story, the existing
pause/claim-control flow takes over ("Carry both lanterns").

**Pairing is time-bucketed, serverless.** `getStageRoomName()` maps every
visitor in a 10-minute window to the same public room. First arrival sees
"Watching the water for the other light…" and the story only auto-starts
when `peerList.length > 0`. Trade-off: a third visitor in the same bucket
joins as an extra participant rather than getting a fresh pair. Good enough
for a starter; true 1:1 matching would need a tiny presence server.

**Graceful degradation.** Someone opening a room URL directly (no character
chosen) gets `role === null`: no turn gating, original behavior.

**Why it feels quick, fun, engaging.** Zero forms — the first interaction is
tapping a picture. The wait state is diegetic (you're a light watching for
another light, not a user in a queue). And the alternating lantern gives the
stranger's presence weight: every other beat of the story is _theirs_.

## Ideas for a second pass

Role-flavored chat (Keeper messages on the left in lamp-gold, Sailor in
ember-orange, labeled only by role), a foghorn sound when the partner
arrives, bucket + `?role=` in the URL so a Keeper link can be shared to
summon a Sailor, and per-role choice tags in the story data (`speaker:
'Keeper'` lines only advanceable by the Keeper) once you outgrow parity
turns.
