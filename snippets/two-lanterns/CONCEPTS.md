# Four concepts for a minimal duet-novella starter

The shared skeleton for all four: land on the site → pick a character in one
tap → get paired with an anonymous stranger who picked the complementary
character → play the novella together, with a thin chat as the back channel.
No accounts, no lobby screens, no settings. One tap to identity, one breath
to story.

## 1. Two Lanterns ← (chosen, built in this folder)

A dark harbour at night fills the screen. Two lights: the lighthouse lamp and
a lantern swinging on a fishing boat. You tap the one that calls to you —
**Keeper** or **Sailor**. The pairing is thematic: a Keeper is only complete
with a Sailor. The story (your existing _Harbour Lights_) becomes a true duet:
the "lantern" (the turn) passes back and forth between the two of you, so the
story physically cannot move without the stranger. Chat is labeled "voices
across the water."

Why it wins: it reuses the bundled story and engine as-is; the duet mechanic
is pure UI (turn parity), so the whole concept lands in ~3 new files.

## 2. Masquerade

A candlelit ballroom. Four masks on a velvet table: Fox, Owl, Cat, Raven.
Your mask is your identity — the narrator addresses you by it, and certain
branches only open for certain masks (the Fox can lie, the Owl can notice,
the Cat can slip away, the Raven can remember). Your partner is only ever
their mask. Replay value comes from pair chemistry: Fox+Owl reads completely
differently than Cat+Raven. Needs light story metadata (per-choice
`requiresMask` tags).

## 3. Signal / Static

Two strangers on a dead radio frequency, 3 a.m. You pick a callsign card
(e.g. "COLD RIVER", "LAST ORCHARD"). The UI becomes a radio tuner: story
lines arrive as transmissions that crackle in through static, choices are
keyed in like morse (hold-to-send button). Chat messages render as
transmissions with your callsign. Strongest atmosphere, most custom CSS work
(static shader, type-in effect), story engine unchanged.

## 4. Ink & Echo

Asymmetric roles at a shared typewriter. **Ink** picks what happens (the
actions). **Echo** picks how it lands (mood/consequence of each act). Text
types out letter by letter on paper; choices appear as pencil notes in the
margin. Neither player can tell the story alone — Ink without Echo is a plot
summary, Echo without Ink is a feeling with nothing to attach to. Needs
choices annotated as `act` vs `tone`, and stories written in act/tone pairs.

---

## How anonymous pairing works here (no server)

Chitchatter is pure P2P, so "match me with a stranger" is done with
**time-bucketed stage rooms**: everyone who chooses a character within the
same 10-minute window is routed to the same deterministic public room name
(`two-lanterns-stage-<bucket>`). Early visitors wait on a "watching the
water…" screen until a peer arrives. It's not perfect 1:1 matchmaking (three
people can land in one bucket), but it is zero-infrastructure and feels
instant when there's any traffic. The bucket also rolls over, so stale rooms
evaporate on their own.
