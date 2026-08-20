# Two Lanterns — Integration Complete

## Files Applied

### Source Files (in `src/`)

✅ `src/config/duet.ts` — Roles, pairing, turn logic
✅ `src/pages/CharacterSelect/CharacterSelect.tsx` — Animated harbour landing
✅ `src/components/VisualNovelRoom/DuetNovelRoom.tsx` — Duet-aware novella panel

### Reference Copies (in `snippets/two-lanterns/`)

✅ `snippets/two-lanterns/duet.ts`
✅ `snippets/two-lanterns/CharacterSelect.tsx`
✅ `snippets/two-lanterns/DuetNovelRoom.tsx`
✅ `snippets/two-lanterns/README.md`
✅ `snippets/two-lanterns/CONCEPTS.md`

## Integration Edits

### Edit 1: Bootstrap.tsx

**Line 29:** Added import

```tsx
import { CharacterSelect } from 'pages/CharacterSelect/CharacterSelect'
```

**Line 259:** Updated root route

```tsx
// was: element={<Home userId={userId} />}
element={<CharacterSelect />}
```

### Edit 2: Room.tsx

**Line 9:** Updated import

```tsx
// was: import { VisualNovelRoom } from 'components/VisualNovelRoom'
import { DuetNovelRoom } from 'components/VisualNovelRoom/DuetNovelRoom'
```

**Line 115:** Updated render

```tsx
// was: <VisualNovelRoom peerRoom={peerRoom} />
<DuetNovelRoom peerRoom={peerRoom} />
```

## How It Works

**Landing:** Users arrive at CharacterSelect, tap the Keeper (lighthouse) or Sailor (boat lantern).

**Pairing:** Everyone in the same 10-minute window lands in the same stage room (`two-lanterns-stage-<bucket>`).

**Auto-start:** Story begins only when both players are present.

**Turn-taking:** Keeper acts on even revisions, Sailor on odd. Buttons disabled when it's not your turn.

**Graceful fallback:** If someone opens a room URL directly (no character chosen), `role === null` and normal single-player behavior applies.

## Next Steps (Optional)

See README.md for second-pass ideas:

- Role-flavored chat (Keeper in lamp-gold, Sailor in ember-orange)
- Foghorn sound when partner arrives
- Shareable links (`?role=keeper`) to summon a specific role
- Per-role choice tags in story data for asymmetric play
