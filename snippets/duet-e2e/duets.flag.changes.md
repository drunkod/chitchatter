# Target: src/config/duets.ts — one edit (required for the duet E2E suite)

Problem: `scripts/start-e2e.mjs` always injects `VITE_IS_E2E_TEST=true`,
and the current flag logic turns duet mode OFF whenever that is set — so no
Playwright suite can ever exercise the gateway/duet flow.

Fix: an EXPLICIT `VITE_DUET_MODE=true` now wins, even under E2E. The
default behavior is unchanged (duet on in production, off in the classic
E2E suite, off with `VITE_DUET_MODE=false`).

```ts
// Before:
export const isDuetMode: boolean =
  !isE2ETest && import.meta.env.VITE_DUET_MODE !== 'false'

// After:
const duetFlag = import.meta.env.VITE_DUET_MODE

export const isDuetMode: boolean =
  duetFlag === 'true' || duetFlag === '1'
    ? true // explicit opt-in wins, even in E2E (used by playwright.duet.config.ts)
    : !isE2ETest && duetFlag !== 'false'
```

# Target: playwright.config.ts — one edit

Keep the classic suite from picking up the duet tests (they need the duet
server). Add to the `defineConfig({ ... })` object:

```ts
testIgnore: '**/duet/**',
```
