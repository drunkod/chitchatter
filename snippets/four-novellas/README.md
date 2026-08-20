# Four Novellas — one app, one P2P engine, four duets

Adds Masquerade, Signal/Static, and Ink & Echo alongside Two Lanterns, plus
a novella chooser before character selection. Everything runs on the
existing chitchatter machinery: the same public-room pairing, the same
`VisualNovelSession` P2P state sync, the same chat underneath. A novella is
now just **a registry entry + a story.json** — no new protocol, no new
transport, no per-novella components.

## The flow

1. Root URL → `NovellaGateway` step 1: four cards (Two Lanterns, Masquerade,
   Signal/Static, Ink & Echo), each with a CSS sigil and tagline.
2. Step 2: that novella's characters (Keeper/Sailor, four masks, two
   callsigns, Ink/Echo). One tap stores the selection (sessionStorage,
   per-tab, anonymous).
3. Navigate to `/public/<novellaId>-stage-<10min-bucket>` — per-novella
   stage rooms, so Masquerade strangers meet Masquerade strangers.
4. Story auto-starts when a partner arrives (role[0] leads; later roles
   wait a staggered grace period — no start races, and same-role pairs
   still get a story).
5. Turn gating per novella (see below). Chat below the panel is the back
   channel, fully P2P as always.

## Turn rules (the personality of each duet)

| Novella       | Rule                                                           | Feel                                        |
| ------------- | -------------------------------------------------------------- | ------------------------------------------- |
| Two Lanterns  | `alternate` — turn cycles by story revision                    | The lantern passes back and forth           |
| Signal/Static | `alternate`                                                    | Transmissions alternate: you key, they key  |
| Masquerade    | `free` — no gating                                             | The ball is chaos; masks act when they dare |
| Ink & Echo    | `act-tone` — choice beats are Ink's, continue beats are Echo's | One writes what happens, one lets it land   |

`act-tone` is implementable with zero engine changes: a beat either has
choices (an act — Ink's) or only Continue (a landing — Echo's). The
Unfinished Page story is written so those alternate naturally.

## Files

| Snippet                | Target                                                       | Status                                                                                              |
| ---------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `duets.ts`             | `src/config/duets.ts` (new)                                  | Registry, selection, pairing, turn rules, stagger. **Replaces `duet.ts`** — `isDuetMode` moves here |
| `NovellaGateway.tsx`   | `src/pages/NovellaGateway/NovellaGateway.tsx` (new)          | Two-step chooser, all four novellas from the registry                                               |
| `DuetNovelRoom.tsx`    | `src/components/VisualNovelRoom/DuetNovelRoom.tsx` (replace) | Generalized: registry-driven copy + turn rule                                                       |
| `stories/*/story.json` | `src/stories/*/story.json` (new ×3)                          | Minimal plots: 1 choice, 2 endings each, same schema as harbour-lights                              |
| `catalog.changes.md`   | `src/stories/catalog.ts`                                     | Register the three stories                                                                          |

## Wire-up beyond the table

1. `src/Bootstrap.tsx`: import `NovellaGateway` instead of `CharacterSelect`
   and render it on the ROOT route (keep the `isDuetMode` gate — now
   imported from `config/duets`):

   ```tsx
   element={isDuetMode ? <NovellaGateway /> : <Home userId={userId} />}
   ```

2. Update the `isDuetMode` / `getDuetSelection` imports in `Room.tsx` from
   `config/duet` → `config/duets`, then delete `src/config/duet.ts` and
   `src/pages/CharacterSelect/` (superseded; keep them if you want the
   animated harbour as Two Lanterns' step-2 screen later).

3. E2E: nothing to do — `isDuetMode` keeps the same `VITE_IS_E2E_TEST`
   guard, so the suite still runs classic Home + VisualNovelRoom, and
   `getBundledStories()[0]` is still harbour-lights.

## Design notes & honest limitations

- **Late joiners follow the room, not their selection.** If a third visitor
  lands in an active room, the running story's id wins (state sync already
  carries `storyId`), so a Masquerade room never flips to Ink & Echo.
- **Masquerade with 4 masks:** any two masks can pair; `free` turns mean no
  deadlock is possible. With `alternate` and >2 roles the cycle generalizes
  (`revision % roles.length`), which is why masks use `free` instead — two
  random masks would rarely own adjacent slots in a 4-cycle.
- **Ink & Echo same-role pair (two Inks):** continue beats would lock for
  both. The stagger means one of them started the story and can restart;
  the real fix remains role-announcement over the wire (documented in
  `two-lanterns-fixes/README.md`) — it applies to all four novellas at once.
- **Demo:** `snippets/demo-playbook/demo-duet.mjs` still covers Two
  Lanterns end-to-end. To smoke the others, change the two
  `getByRole('button', { name: 'Choose the …' })` clicks to
  `Choose Masquerade` → `Choose The Fox`, etc., and swap the expected
  opening line for that story's first dialogue text.
