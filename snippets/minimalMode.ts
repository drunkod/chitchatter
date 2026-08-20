// Target: src/config/minimalMode.ts (replace)
//
// FIX: an EXPLICIT VITE_MINIMAL_MODE=true now wins even when
// VITE_IS_E2E_TEST is set — mirroring the isDuetMode rule.
//
// Why this is required: the demo/test servers must set VITE_IS_E2E_TEST so
// that Room.tsx uses `iceServers: []` (host-only ICE), which is what makes
// two local peers connect reliably on loopback. Without this change,
// turning on that flag would silently disable minimal mode and break
// demo-minimal.mjs.
//
// Default behavior is unchanged: minimal mode stays off in the classic E2E
// suite (which never sets VITE_MINIMAL_MODE) and off in production unless
// explicitly enabled.

const isE2ETest =
  import.meta.env.VITE_IS_E2E_TEST === 'true' ||
  import.meta.env.VITE_IS_E2E_TEST === '1'

const minimalFlag = import.meta.env.VITE_MINIMAL_MODE

export const isMinimalMode: boolean =
  minimalFlag === 'true' || minimalFlag === '1'
    ? true // explicit opt-in wins, even under E2E
    : !isE2ETest && minimalFlag === 'force'

// Sub-flags in case you want to hide things selectively later:
export const minimalUi = {
  hideAppBar: isMinimalMode,
  hideDrawer: isMinimalMode,
  hidePeerList: isMinimalMode,
  hideMediaControls: isMinimalMode,
  hideTypingStatus: isMinimalMode,
  autoJoinPublicRoom: isMinimalMode,
  autoStartNovella: isMinimalMode,
}
