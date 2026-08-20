# Minimal UI + Auto-start snippets

Full example files based on the current code. Copy each over its target when ready.

| Snippet               | Target file                                          | Purpose                                                        |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `minimalMode.ts`      | `src/config/minimalMode.ts` (new)                    | Single flag to toggle minimal mode via `VITE_MINIMAL_MODE`     |
| `Home.tsx`            | `src/pages/Home/Home.tsx`                            | Auto-join an anonymous public room on load (no form)           |
| `ShellAppBar.tsx`     | `src/components/Shell/ShellAppBar.tsx`               | App bar hidden in minimal mode (drawer never opens without it) |
| `Room.tsx`            | `src/components/Room/Room.tsx`                       | Media/upload/screen-share controls and typing bar removed      |
| `VisualNovelRoom.tsx` | `src/components/VisualNovelRoom/VisualNovelRoom.tsx` | Novella auto-starts once sync confirms no active story         |

Notes:

- `MessageForm.tsx` already has no attachment/audio buttons — nothing to strip there.
- The drawer and peer list in `Shell.tsx` are only opened from app bar buttons, so hiding the app bar effectively hides them too. For a hard removal, also delete `<Drawer …>` / `<PeerList …>` from `Shell.tsx`.
- Enable with `VITE_MINIMAL_MODE=true` in `.env`, or hardcode the flag in `minimalMode.ts`.
