# Duet E2E suite — full tests + playbook for all four novellas

## The blocker this solves

`scripts/start-e2e.mjs` always injects `VITE_IS_E2E_TEST=true`, and duet
mode disables itself under that flag — so no Playwright test could ever
reach the gateway. Fix: `duets.flag.changes.md` makes an EXPLICIT
`VITE_DUET_MODE=true` win even under E2E; `playwright.duet.config.ts`
sets exactly that for its own webServer. Defaults are unchanged
(production duet-on, classic E2E duet-off).

## Files

| Snippet                     | Target                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `duets.flag.changes.md`     | one edit in `src/config/duets.ts` + one `testIgnore` line in `playwright.config.ts` |
| `playwright.duet.config.ts` | repo root (new)                                                                     |
| `duet-novellas.test.ts`     | `e2e/duet/duet-novellas.test.ts` (new dir)                                          |
| `run-all.sh`                | anywhere; run from repo root                                                        |

## What the duet suite covers (6 tests)

- 4× per-novella: gateway two-step → same stage room → auto-start on both
  sides → Continue beat → branch choice → both endings synced. Covers all
  three turn rules (alternate ×2, free, act-tone).
- Turn gating (Two Lanterns): after a handoff, chips read Your/Their move
  and the inactive side's buttons are disabled.
- Partner departure (Two Lanterns): controller leaves → pause banner →
  survivor claims control → story continues.

## The full matrix, one command each

```bash
npm run check:types && npm run lint
npm test -- --run
npx playwright test e2e/tests/visual-novel.test.ts:23 --project=chromium --workers=1
npx playwright test --config=playwright.duet.config.ts --workers=1
node snippets/demo-playbook/demo-minimal.mjs
node snippets/demo-playbook/demo-novellas.mjs
```

Or everything in order: `bash snippets/duet-e2e/run-all.sh`

## Notes

- `--workers=1` matters for the duet suite: all tests share the 10-minute
  stage-room namespace; parallel workers would land in each other's rooms.
  A leftover risk remains WITHIN a run if two tests of the same novella
  execute in the same bucket — only the two-lanterns tests overlap, and
  they run sequentially, so earlier rooms are empty (peers disconnected)
  by the time the next test joins; the auto-start guard tolerates that.
- The known baseline flake (`visual-novel.test.ts` test 2, late-join
  refresh) is pre-existing and intentionally not in this matrix.
- Keep `demo-novellas.mjs` (headed, human-watchable) even with the duet
  suite green — it is the demo, the suite is the regression net.

## Rev 2 — fix for the "Searching for peers…" failures

The first run failed with both contexts in the SAME bucket, so bucket
mismatch wasn't the cause — but the test skipped two things the passing
classic suite always does. The revised `duet-novellas.test.ts`:

1. Waits for player A's room to be FULLY ready (chat input visible →
   PeerRoom mounted and announcing) before player B starts joining.
2. Player B still picks a role via the gateway, but then joins player A's
   EXACT URL (joinExistingRoom pattern) — bucket rollover can never split
   a pair again.
3. Proves P2P connectivity via bidirectional chat (classic 45s/25s
   budgets) BEFORE any auto-start assertion — separating "P2P broken"
   from "novella logic broken" in the failure report.
4. Forwards browser console errors into test output.

### If proveConnectivity still fails

Then the problem is P2P infrastructure under the duet server, not novella
logic. Compare directly against the known-good classic stack:

```bash
# control (passes): same stack, classic mode
npx playwright test e2e/tests/visual-novel.test.ts:23 --project=chromium --workers=1
# duet suite with traces for the failing connection
npx playwright test --config=playwright.duet.config.ts --workers=1 --trace on
npx playwright show-trace test-results/**/trace.zip
```

In the trace, check the WebSocket to ws://localhost:8000 (tracker) on both
pages — if only one page opens it, the tracker connection is the lead; if
both announce but no data channel forms, it's ICE (look for console errors
now forwarded into the report).

## Rev 3 — single-join for player B + diagnostic isolation

Rev 2 still failed proveConnectivity (same room, message sent, never
received). Note rev 1 failed identically WITHOUT any reload, so reload
churn alone can't explain it — but rev 3 removes it anyway and adds the
tooling to find the real layer:

- Player B's role is injected via `context.addInitScript` (sessionStorage)
  and B joins player A's URL in ONE navigation. Single PeerRoom lifecycle.
- Every tracker WebSocket open/close/error on both pages is logged.
- A `diagnostic` test runs FIRST: plain chat in a plain room (no gateway,
  no novella, no stage naming) under the duet server.

### Reading the next run

| Diagnostic | Novella tests | Meaning                                                                                                                                                                                   |
| ---------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL       | FAIL          | P2P broken under the duet server for everyone. Novella code innocent. Since classic passes on the same stack, diff the two runs' ws logs — likely tracker announce or ICE under this env. |
| PASS       | FAIL          | Something in the gateway path or stage-room naming. The ws logs of a failing novella test vs the diagnostic will show where they diverge.                                                 |
| PASS       | PASS          | Rev 2's double-join was the culprit; done.                                                                                                                                                |

## Rev 4 — peer-list connectivity + a control experiment

The rev 3 diagnostic failed in a PLAIN room (no gateway, no novella), which
rules the novella code out — but it does not implicate the duet server
either. Two facts from the repo contradict the "relay unavailable" theory:

- The classic `playwright.config.ts` runs the SAME `start-e2e.mjs`, so the
  relay banner appears there too — it is a red herring, not a duet-only
  condition.
- Classic test 1 also uses two isolated `browser.newContext()` calls and
  passes, so two-context WebRTC works in this environment.

What actually differed was the METHOD: the classic suite proves
connectivity via the PEER LIST; rev 2/3 used chat delivery, a strictly
later and slower signal.

### Changes

- `duet-novellas.test.ts` (rev 4): `proveConnectivity` now waits for the
  partner in the peer list on both sides (60s, the classic signal) before
  asserting chat delivery (60s/45s) as a secondary check.
- `connectivity-control.test.ts` → `e2e/tests/` — the same plain-room
  scenario under the CLASSIC config, asserting BOTH signals with logging.

### Run the control first — it is the decisive experiment

```bash
npx playwright test e2e/tests/connectivity-control.test.ts --project=chromium --workers=1
```

| Control result               | Meaning                                                               | Next step                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Both signals pass            | Environment + classic server are fine; chat was the wrong/slow signal | Run the duet suite with rev 4 — expect green                                                                                                           |
| Peer list passes, chat fails | The connection forms; chat proof was wrong                            | Rev 4 already fixes this; drop chat assertions if still slow                                                                                           |
| Both fail                    | Two-context WebRTC can't work here at all                             | The duet suite can't be fixed by test changes — run duet coverage through `demo-novellas.mjs` (headed, known to connect) and keep e2e for classic only |

Then:

```bash
npx playwright test --config=playwright.duet.config.ts --workers=1
```

## Rev 5 — valid peer locator + announce window (see ARCHITECTURE.md)

The control run was decisive, and it exonerated the app twice over: the
`[control] PEER LIST: connected` line was a FALSE POSITIVE (PeerList always
renders a self ListItem), and the true state on B was "Searching for
peers…" — i.e. no peer ever registered. Both are harness problems:

**A. Valid locator.** `src/components/Shell/PeerList.tsx` renders
"Searching for peers..." exactly when `peerList.length === 0`. Its ABSENCE
is the only signal that cannot match the local user. Rev 5 waits on that
(90s) on BOTH sides, then checks chat as a secondary assertion.

**B. Announce window.** The passing classic helper `joinExistingRoom` does
`goto('/')` → read username → `goto(roomUrl)`. That middle step is several
seconds during which the FIRST peer completes its tracker announce. Our
tests joined B immediately after A's shell rendered. Rev 5 adds an explicit
4s `ANNOUNCE_WINDOW_MS` dwell before B joins (both in `startPair` and in
the diagnostic).

Both files updated: `duet-novellas.test.ts` (rev 5) and
`connectivity-control.test.ts`.

### Run order

```bash
# 1. control under the classic config — must go green first
npx playwright test e2e/tests/connectivity-control.test.ts --project=chromium --workers=1
# 2. then the duet suite
npx playwright test --config=playwright.duet.config.ts --workers=1
```

If the control still fails at the "Searching for peers..." assertion after
90s + the announce window, then two isolated contexts genuinely cannot pair
in this environment. That is an infrastructure limit, not a novella bug —
fall back to `node snippets/demo-playbook/demo-novellas.mjs` (headed, known
to connect) for duet coverage and keep Playwright for the classic suite.

## Rev 6 — the "infrastructure limit" verdict was premature

The rev-5 control reported: A's peer indicator cleared, B's did not, chat
undelivered → read as an environment limit. It was a HARNESS BUG in the
control itself:

```
wait for A's "Searching for peers…" to hide   ← A ONLY
send chat A→B                                  ← B may still be connecting
```

Chitchatter delivers a message only to peers connected AT SEND TIME. A
probe sent during B's connection setup is dropped permanently — B never
displays it, even after connecting. That is precisely the observed
asymmetry. The passing classic suite always waits for peer visibility on
BOTH sides (`waitForPeerConnected` twice) BEFORE
`waitForBidirectionalPeerTraffic`.

### Fixes

- `connectivity-control.test.ts` (rev 2): waits for a partner on BOTH
  sides, then probes; probe is RE-SENT on an interval (10s attempts, 60s
  budget) so a late-opening data channel still delivers. Timeout 300s.
- `duet-novellas.test.ts` (rev 6): same resend-retry (`deliverMessage`)
  in `proveConnectivity`. It already waited on both sides.

### Re-run

```bash
npx playwright test e2e/tests/connectivity-control.test.ts --project=chromium --workers=1
npx playwright test --config=playwright.duet.config.ts --workers=1
```

Only if the control STILL fails — with `[control] PEER a` and `[control]
PEER b` both logged and every resend attempt dropped — is the environment
genuinely at fault. At that point stop iterating on the harness: keep
Playwright for the classic suite and cover duets with
`node snippets/demo-playbook/demo-novellas.mjs`.
