# Novella demo playbook

Scripted Playwright demos for every novella mode. Each script boots its own
server stack, drives a real (headed) Chromium, saves screenshots to
`demo-output/`, and shuts everything down. Run from the repo root:

```bash
node snippets/demo-playbook/demo-minimal.mjs   # auto-join + auto-start solo
node snippets/demo-playbook/demo-duet.mjs      # Two Lanterns: 2 strangers, turns
node snippets/demo-playbook/demo-classic.mjs   # original flow (what E2E uses)
```

With nix:

```bash
nix-shell -p nodejs_24 --run "node snippets/demo-playbook/demo-minimal.mjs"
```

## Why these don't use scripts/start-e2e.mjs

`scripts/start-e2e.mjs` hardcodes `VITE_IS_E2E_TEST=true` into Vite's env
(its `extraEnvironment` overrides whatever you pass in), and `duet.ts`
intentionally disables duet mode under that flag. A demo spawned through
start-e2e.mjs will always render the CLASSIC UI, and a wait like
`waitForURL(/\/public\/.+/)` after auto-join will just time out. The shared
`demo-server.mjs` here starts the same core services (Vite :3000 + tracker
:8000) with full env control and polls for readiness instead of sleeping 5s.

## What each demo proves

| Demo           | Flags                    | Asserts                                                                                                                                                                                              |
| -------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo-minimal` | `VITE_MINIMAL_MODE=true` | Root URL auto-joins `/public/<uuid>`; story auto-starts; app bar absent; Continue advances the story                                                                                                 |
| `demo-duet`    | `VITE_DUET_MODE=true`    | Character select renders; Keeper & Sailor land in the same stage room; story auto-starts only when both present; turn passes between contexts; partner departure shows pause + "Carry both lanterns" |
| `demo-classic` | all off                  | Home form works; app bar present; "Start story" button present; camera toggle present                                                                                                                |

Screenshots are numbered in flow order (`duet-1-…` → `duet-7-…`) so the
sequence reads as a storyboard.

## Debugging the current E2E failures

Both `visual-novel.test.ts` tests fail right now (camera toggle timeout in
test 1; test 2 at ~50s). Before assuming a regression, establish the
baseline — these tests were failing before the minimal/duet work began
(the pre-existing `test-results` screenshots at the start of the project
came from the same suite):

```bash
# 1. Baseline: do they fail on the clean tree too?
git stash
npx playwright test e2e/tests/visual-novel.test.ts --project=chromium --workers=1
git stash pop

# 2. Current tree, with full artifacts:
npx playwright test e2e/tests/visual-novel.test.ts --project=chromium --workers=1
ls test-results/            # failure screenshots + error-context.md per test
npx playwright show-report  # traces, step timeline

# 3. Watch it happen live:
npx playwright test e2e/tests/visual-novel.test.ts --project=chromium --headed --workers=1
```

If the baseline also fails: the failures are pre-existing (likely
environment: camera permissions in headless Chromium, tracker timing) and
not caused by the flag work. If baseline passes but the current tree fails:
diff the failure screenshot against `classic-3-story-started.png` from
`demo-classic.mjs` — it asserts the exact elements the e2e suite needs
(camera toggle, Start story), so it pinpoints which one went missing.

## Cleanup

Demos kill their servers on exit, but if a run crashes hard check for
orphans: `lsof -i :3000 -i :8000` and kill leftovers. `demo-output/` is
disposable.
