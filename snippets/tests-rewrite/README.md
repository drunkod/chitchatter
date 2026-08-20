# Tests rewritten against the current codebase

## The root cause of every two-peer failure

`src/components/Room/Room.tsx` (~line 91):

```ts
...(import.meta.env.VITE_IS_E2E_TEST && {
  rtcConfig: { iceServers: [] },   // ← HOST-CANDIDATE-ONLY ICE
}),
```

With that flag set, peers pair instantly over loopback. `start-e2e.mjs`
sets it — **that is the actual reason the classic Playwright suite connects
headless, on any machine.** `demo-server.mjs` deliberately did not set it,
so the demos fetched a TURN config, showed "Relay server is unavailable",
and ICE never completed.

So the earlier verdicts were wrong in a specific way worth recording:

| Earlier theory                        | Verdict                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| Headed browser / no X display needed  | ✗ Playwright Chromium does WebRTC fine headless — the classic suite proves it every run |
| Two isolated contexts can't pair here | ✗ They can, with host-only ICE                                                          |
| Relay/TURN server must be fixed       | ✗ Opposite: remove ICE servers entirely for local runs                                  |
| Tracker announce timing               | Partly — a small announce window still helps                                            |
| Outdated gateway selectors            | ✓ Real, and fixed here                                                                  |

## Files

| Snippet             | Target                                     | Change                                                                                                   |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `demo-server.mjs`   | `snippets/demo-playbook/demo-server.mjs`   | sets `VITE_IS_E2E_TEST=true` (host-only ICE); exports `isHeaded`; headless by default                    |
| `minimalMode.ts`    | `src/config/minimalMode.ts`                | explicit `VITE_MINIMAL_MODE=true` wins under E2E (required, since the demo server now sets the E2E flag) |
| `demo-novellas.mjs` | `snippets/demo-playbook/demo-novellas.mjs` | rewritten for the two-step gateway; announce window; both-side peer wait; all four novellas              |
| `demo-minimal.mjs`  | `snippets/demo-playbook/demo-minimal.mjs`  | headless by default (`HEADED=1` to watch)                                                                |
| `demo-classic.mjs`  | `snippets/demo-playbook/demo-classic.mjs`  | same                                                                                                     |

Also required (already written earlier, unchanged):
`snippets/duet-e2e/duets.flag.changes.md` — explicit `VITE_DUET_MODE=true`
must win under E2E, for the same reason as `minimalMode.ts`.

**Delete `snippets/demo-playbook/demo-duet.mjs`** — it targets the removed
one-step gateway and is fully superseded by `demo-novellas.mjs`.

## Apply

```bash
cp snippets/tests-rewrite/minimalMode.ts        src/config/minimalMode.ts
cp snippets/tests-rewrite/demo-server.mjs       snippets/demo-playbook/demo-server.mjs
cp snippets/tests-rewrite/demo-novellas.mjs     snippets/demo-playbook/demo-novellas.mjs
cp snippets/tests-rewrite/demo-minimal.mjs      snippets/demo-playbook/demo-minimal.mjs
cp snippets/tests-rewrite/demo-classic.mjs      snippets/demo-playbook/demo-classic.mjs
rm snippets/demo-playbook/demo-duet.mjs
```

## Full matrix

```bash
npm run check:types && npm run lint
npm test -- --run
npx playwright test e2e/tests/visual-novel.test.ts:23 --project=chromium --workers=1
npx playwright test e2e/tests/connectivity-control.test.ts --project=chromium --workers=1
npx playwright test --config=playwright.duet.config.ts --workers=1
node snippets/demo-playbook/demo-minimal.mjs
node snippets/demo-playbook/demo-classic.mjs
node snippets/demo-playbook/demo-novellas.mjs
```

Start with the single-novella smoke — fastest signal that ICE now pairs:

```bash
node snippets/demo-playbook/demo-novellas.mjs two-lanterns
```

Expect `[peer] The Keeper: partner connected`, the same for The Sailor,
then `[story] auto-started on both sides`. If those peer lines appear, the
ICE fix worked and everything downstream is app logic.

## Note on the duet Playwright suite

`playwright.duet.config.ts` already runs through `start-e2e.mjs`, so it
always had host-only ICE — its failures were the harness bugs fixed in
`snippets/duet-e2e/` rev 6 (single-side peer wait, unrepeated probe,
false-positive listitem locator). Re-run it after the demos go green.
