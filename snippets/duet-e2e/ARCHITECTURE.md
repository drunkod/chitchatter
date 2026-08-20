# Architecture analysis — why the duet suite can't see the connection

## The stack (unchanged by any novella work)

```
NovellaGateway ──sessionStorage──> Room ──> useRoom ──> PeerRoom (trystero)
     (UI)          role+novella      (UI)                    │
                                                      ┌──────┴───────┐
                                              ws://127.0.0.1:8000   WebRTC
                                              (tracker: discovery)  (data channel)
                                                                     │
                        VisualNovelSession ◄── PeerRoomVisualNovelTransport
                        (story state sync)      (rides the SAME data channel as chat)
```

Key consequence: **chat and story sync share one transport.** If chat can't
cross, story sync can't either — and vice versa. So no novella-layer bug can
produce "Searching for peers…". That is a discovery/ICE-level condition, and
it sits entirely below anything this project added.

## Where each observation actually belongs

| Observation                               | Layer                   | Verdict                                                        |
| ----------------------------------------- | ----------------------- | -------------------------------------------------------------- |
| Both tracker sockets OPEN, no CLOSE/ERROR | discovery transport     | healthy                                                        |
| "Relay server is unavailable" banner      | ICE config              | RED HERRING — classic runs the same `start-e2e.mjs` and passes |
| "Searching for peers…" on B               | `peerList.length === 0` | the real failure: no peer ever registered                      |
| `getByRole('listitem').first()` passed    | test locator            | FALSE POSITIVE (confirmed below)                               |
| Chat not delivered                        | data channel            | consequence, not cause                                         |

### The false positive, confirmed in source

`src/components/Shell/PeerList.tsx` always renders a self `ListItem`, and
line 77/92 render "Searching for peers..." exactly when `peerList.length
=== 0`. So `.getByRole('listitem').first()` matches self and proves
nothing. **The one signal that cannot match self is the ABSENCE of
"Searching for peers...".** That is what rev 5 waits on.

## Why classic connects and our tests don't

`joinExistingRoom` (used by the passing classic test) does:

```
page.goto('/')  →  getCurrentUserId() [waits for text]  →  page.goto(roomUrl)
```

That middle step is several seconds of dwell — during which player A, who
is already in the room, completes tracker announces. Our tests did
`waitForRoomReady(a)` then immediately navigated B. A had mounted PeerRoom
but not necessarily announced. The trystero/tracker announce cycle is not
instant, and both peers must be registered in the same swarm before either
sees the other.

This is the same class as the known-flaky classic test 2 (late-join after
refresh) — a re-announce timing problem, not a code defect.

## Conclusion

Nothing in the four-novellas work is implicated. The duet suite failed for
two test-harness reasons: (1) an invalid connectivity locator, and (2) no
announce window before the second peer joins. Both are fixed in rev 5.
