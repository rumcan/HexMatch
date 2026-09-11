# MP — Multiplayer on RUN.world (host / join / matchmake)

Implementation spec for an AI agent. Target branch: `arena/01a08aba-hexmatch`.

The game currently boots straight into a single-player match against the AI
rival (`startIsoGame` → `src/iso/game.ts:203`). This spec adds a start screen
offering **Host**, **Join by code**, **Quick match** and **Play vs AI**, and
wires real two-player games over RUN.world's realtime rooms.

Read this whole document before writing code. Sections 1 and 2 contain
constraints that invalidate the obvious implementation.

---

## 1. Hard constraints

These are platform facts, verified against the RUN.world docs. Do not design
around them; design *within* them.

### 1.1 The existing relay cannot be used

`server/server.js` (329 lines, ws relay, deployed to `wss://hexmatch.fly.dev`)
is **unreachable from a published game**. RUN sandboxes games in an iframe with
a host allowlist:

> "Arbitrary external hosts are not reachable, and that includes your own
> backend or API server: calls to a server you host from inside the game are
> blocked by the platform sandbox."

Do not attempt to connect to it, proxy to it, or make it configurable. Leave
`server/` on disk untouched — it still serves local/self-hosted play and is a
useful protocol reference — but nothing in `src/` may reference it.
`.env.production`'s `VITE_ROOM_SERVER` becomes dead for RUN builds.

### 1.2 Multiplayer requires a signed-in user

`createRoom`, `joinRoomByCode`, `joinOrCreateRoom`, `matchmakeRoom` and
`getUserRooms` all reject anonymous users with `AccessDeniedError`
(`code === 'ACCESS_DENIED'`).

**Consequence, and the most important UX rule in this spec:** most people who
open the game from the explore page will not be signed in. *Play vs AI must
remain fully playable with zero auth and must be the lowest-friction option on
the start screen.* Multiplayer buttons trigger a login prompt only when pressed.
Never gate the whole game behind login.

### 1.3 A full snapshot is 6.75× over the frame cap

This kills the naive port of `src/iso/snapshot.ts`'s intended 6 Hz model:

| Quantity | Value |
|---|---|
| Map | 144 × 144 = 20,736 tiles |
| One track layer, base64 | 27,648 chars |
| Four layers (`dirt`, `road`, `owner`, `upgraded`) | **108 KiB** |
| At 6 Hz | **648 KiB/s** |
| RUN frame cap | **16 KiB** |

So: **a full `Snapshot` may be sent on join and on resync only — never on a
timer.** Steady state must be per-action deltas. See section 5.

### 1.4 Multiplayer is BETA

Expect API drift. Isolate every RUN call behind `src/net/transport.ts` so a
breaking change is a one-file fix.

---

## 2. Architecture

RUN is server-authoritative: game logic lives in a `GameRoom` subclass running
on their infrastructure. Hexmatch's existing design is *host-authoritative* —
"the browser that creates the room owns the truth… guests do not simulate"
(deleted `src/game/net.ts`).

**Decision: keep host authority; use the `GameRoom` as a thin validating relay.**

Rationale: the alternative — porting the economy tick, vehicle movement, AI
rival and market into a server-side `GameRoom` — is a rewrite of most of
`src/iso/`. The relay model reuses `snapshot.ts` as-is and is the documented
`onGameMessage` → `broadcast` pattern. Revisit only if cheating becomes a real
concern; this is a jam entry.

```
Host browser                RUN GameRoom (server)         Guest browser
────────────                ─────────────────────         ─────────────
runs full sim               mints seed in onCreate         renders only
  │                         assigns host = first joiner      │
  ├── delta ───────────────►  validate sender ──broadcast──►  applies delta
  │                                                           │
  ◄── intent ──────────────  forward to host only ◄───────────┤
  │                         (sendTo hostId)
  └── full snapshot ───────►  on join / resync ─────────────► applySnapshot
```

The `GameRoom` owns exactly three things: the map seed, the host identity, and
message routing. It never simulates.

---

## 3. Files

### New

| Path | Purpose |
|---|---|
| `rundot/realtime.config.json` | Room type registration |
| `src/rooms/HexmatchRoom.ts` | `GameRoom` subclass (relay) |
| `src/net/protocol.ts` | Shared message union — imported by both sides |
| `src/net/transport.ts` | Wraps `RundotGameAPI.realtime.*`; the only file that imports the SDK |
| `src/net/session.ts` | Role, slot, roster, connection state |
| `src/net/delta.ts` | Track-delta encode/decode (section 5) |
| `src/ui/StartScreen.tsx` | Host / Join / Quick match / AI |
| `tests/unit/net-protocol.test.ts` | Protocol version refusal |
| `tests/unit/net-delta.test.ts` | Delta correctness vs full snapshot |

### Modified

| Path | Change |
|---|---|
| `src/App.tsx` | Render `StartScreen` first; start the game only on its resolution |
| `src/iso/game.ts` | `startIsoGame(root, opts)` — accept seed, role, transport |
| `vite.config.ts` | Add `rundotMultiplayerPlugin()` |
| `package.json` | Add `@series-inc/rundot-game-sdk` |

### Reference only — do not import

`src/game/lobby.ts` and `src/game/net.ts` were deleted in commit `36413cf`
(E11, when the hex/three.js path went). They are a complete working
host/join implementation against the old relay and renderer.

```bash
git show 36413cf^:src/game/lobby.ts > /tmp/ref-lobby.ts
git show 36413cf^:src/game/net.ts   > /tmp/ref-net.ts
```

`lobby.ts` already implements the exact three-state modal this spec asks for
(`choose` → `host` → `join`) and resolves to one of
`{mode:"solo"|"host"|"guest", seed}`. Reuse its **structure and CSS class
names** — `.lobby`, `.lobby-field`, `.lobby-actions`, `.lobby-error`,
`.room-code` all still exist in `src/game/styles.css:1317-1340`. Port the
shape, not the transport.

---

## 4. Protocol

`src/net/protocol.ts`. A discriminated union on `type`, per RUN's requirement.

```ts
import type { Snapshot } from "../iso/snapshot";

/** Bump with SNAPSHOT_VERSION. Mixed-version rooms must refuse, not desync. */
export const PROTOCOL_VERSION = 1;

export type Slot = 0 | 1;

/** server → everyone, on join */
export interface WelcomeMsg {
  type: "welcome";
  seed: number;
  hostId: string;
  protocolVersion: number;
  roster: { id: string; username: string; slot: Slot }[];
}

/** host → server → all guests. Full state; join and resync only. */
export interface SnapshotMsg { type: "snapshot"; snap: Snapshot }

/** host → server → all guests. Steady state. See section 5. */
export interface DeltaMsg {
  type: "delta";
  t: number;
  seq: number;
  tiles?: { i: number; dirt: number; road: number; owner: number; upgraded: number }[];
  harvesters?: Snapshot["harvesters"];
  factories?: Snapshot["factories"];
  players?: Snapshot["players"];
  setupPhase?: boolean;
  won?: boolean;
}

/** guest → server → host only. Guests never mutate locally. */
export interface IntentMsg {
  type: "intent";
  action: "build" | "demolish" | "harvest" | "trade" | "skill";
  payload: unknown;
}

/** guest → server → host. Sent when a guest detects a seq gap. */
export interface ResyncMsg { type: "resync" }

/** server → one client, on refused join or host loss */
export interface RejectMsg { type: "reject"; reason: string }

export type HexProtocol =
  | WelcomeMsg | SnapshotMsg | DeltaMsg | IntentMsg | ResyncMsg | RejectMsg;
```

**Rules**

- Guests never mutate game state directly. Every guest action is an `IntentMsg`.
  The host runs it through the *same* `construction.ts` / `economy.ts` paths as
  single-player, so rules cannot drift. `src/iso/construction.ts:17` already
  documents this intent: "the cost rule IS the multiplayer validation."
- The host applies its own actions locally and immediately — no round trip.
- `seq` increments per delta. A guest seeing a gap sends `ResyncMsg`; the host
  replies with a full `SnapshotMsg`.

---

## 5. The delta format (MP-04) — the hard part

Section 1.3 rules out shipping track layers on a timer. But the game only
changes a handful of tiles per action: a road segment, a depot, a plant.

`src/net/delta.ts`:

```ts
/** Diff two track layer sets; return changed tile indices only. */
export function diffTrack(prev: Track, next: Track): DeltaMsg["tiles"];
/** Apply changed tiles onto a local Track in place. */
export function applyTrackDelta(track: Track, tiles: DeltaMsg["tiles"]): void;
```

Implementation notes:

- The host keeps a shadow copy of the last-published `Track` and diffs against
  it each publish tick. Do **not** scan all 20,736 tiles at 6 Hz — instead have
  `construction.ts` push mutated tile indices onto a dirty set, and drain that
  set on publish. The full scan is the correctness oracle used in tests, not in
  the loop.
- Cap a delta at ~200 tiles. Beyond that, send a full `SnapshotMsg` instead — it
  is cheaper than a huge delta and simpler than chunking. Guard with an
  assertion that a serialized `DeltaMsg` never exceeds 16 KiB.
- `harvesters`, `factories` and `players` are small lists; send them whole in
  each delta. Only the four track layers need diffing.

**Acceptance:** for any sequence of actions, applying the full snapshot then N
deltas must produce a `Track` byte-identical to the host's. Prove this in
`tests/unit/net-delta.test.ts` with a randomised action sequence.

---

## 6. Room config and the server class

`rundot/realtime.config.json`:

```json
{
  "rooms": [
    {
      "type": "hexmatch",
      "file": "src/rooms/HexmatchRoom.ts",
      "export": "default",
      "config": {
        "maxPlayers": 2,
        "idleTimeout": 300,
        "allowReconnect": true,
        "reconnectTimeout": 60,
        "metadata": { "mode": "versus" }
      }
    }
  ]
}
```

`maxPlayers: 2` matches the current two-player model (`players[0]` = you,
`players[1]` = rival, `src/iso/game.ts:237`). `reconnectTimeout: 60` is generous
because a dropped host strands the guest — mirroring the `rehost` case
(ticket #16) already solved in `server/server.js`.

`src/rooms/HexmatchRoom.ts`:

```ts
import { GameRoom, type GameMessage, type Player, type LeaveReason }
  from "@series-inc/rundot-game-sdk/mp-server";
import { PROTOCOL_VERSION, type HexProtocol } from "../net/protocol";

export default class HexmatchRoom extends GameRoom<HexProtocol> {
  private seed = 0;
  private hostId: string | null = null;
  private slots = new Map<string, 0 | 1>();

  onCreate() {
    // The seed is minted here, exactly as server.js did at room creation.
    // Every client regenerates identical geometry via generateMap(seed).
    this.seed = (Math.random() * 0x7fffffff) | 0;
  }

  onPlayerJoin(player: Player) {
    if (this.hostId === null) this.hostId = player.id;
    this.slots.set(player.id, this.slots.size === 0 ? 0 : 1);
    if (this.playerCount >= 2) this.lock();
    this.broadcast(this.welcome());
  }

  onGameMessage(msg: GameMessage<HexProtocol>) {
    const p = msg.payload;
    if (p.type === "intent" || p.type === "resync") {
      if (this.hostId) this.sendTo(this.hostId, p);   // guest → host only
      return;
    }
    if (p.type === "snapshot" || p.type === "delta") {
      if (msg.playerId !== this.hostId) return;       // a guest cannot forge state
      this.broadcast(p);
    }
  }

  onPlayerLeave(player: Player, reason: LeaveReason) {
    this.slots.delete(player.id);
    if (player.id === this.hostId) {
      // No host, no truth. Tell the guest plainly rather than stranding them.
      this.broadcast({ type: "reject", reason: "The host left the game." });
      this.hostId = null;
    }
    this.unlock();
  }

  private welcome(): HexProtocol { /* build WelcomeMsg from this.players */ }
}
```

`msg.playerId !== this.hostId` is the one piece of real authority the relay
keeps, and it is what stops a guest forging state. Do not drop it.

---

## 7. Start screen (MP-06) — the primary deliverable

`src/ui/StartScreen.tsx`. Replaces the current straight-to-game boot.

```
┌───────────────────────────────────┐
│        HEXMATCH INDUSTRIES        │
│                                   │
│   ▸ Play vs AI          (no login)│
│   ▸ Host a game                   │
│   ▸ Join with a code              │
│   ▸ Quick match                   │
└───────────────────────────────────┘
```

**Ordering is deliberate — "Play vs AI" is first and needs no login (§1.2).**

States, mirroring the deleted `lobby.ts`:

- `choose` — the four buttons above.
- `host` — after `createRoom("hexmatch")`. Shows `room.roomCode` **large and
  copyable** (`.room-code` styling exists), a Copy button, and the live roster
  from `onPlayerJoined`. A Start button, enabled once a guest is present.
- `join` — a 6-character code field. Uppercase, trim, `maxLength={6}`. No
  server-address field: unlike the old lobby there is nothing to configure.
- `matchmaking` — spinner with a Cancel that calls `room.leave()`.
- `error` — message plus Back.

Resolution — exactly one of:

```ts
type StartChoice =
  | { mode: "ai" }
  | { mode: "host";  seed: number; room: ServerRoom<HexProtocol> }
  | { mode: "guest"; seed: number; room: ServerRoom<HexProtocol> };
```

`App.tsx` holds this in state and only mounts the game once resolved.

**Auth handling.** Wrap every realtime call:

```ts
try {
  room = await RundotGameAPI.realtime.createRoom<HexProtocol>("hexmatch");
} catch (err) {
  if ((err as { code?: string }).code === "ACCESS_DENIED") {
    // The SDK auto-prompt shows the login sheet and retries. If it still
    // fails, show: "Sign in to play with friends — or play against the AI
    // now." with a button that falls through to { mode: "ai" }.
  }
}
```

That fallback is required, not optional. A jam voter who will not sign in must
still reach a playable game in one click.

---

## 8. Matchmaking (MP-07)

RUN supports it, so include it. Quick match uses `matchmakeRoom`, the
transactional cross-instance pairing call intended for competitive play:

```ts
const room = await RundotGameAPI.realtime.matchmakeRoom<HexProtocol>("hexmatch", {
  criteria: { mode: "versus" },
  createOptions: { maxPlayers: 2 },
});
```

`criteria` matches against room `metadata`, which §6 sets to
`{ "mode": "versus" }`. Use `matchmakeRoom` rather than `joinOrCreateRoom`: the
latter races when two players call it simultaneously, which is precisely the
quick-match case.

Whoever ends up alone in a fresh room becomes host and lands in the `host` state
showing the room code — so a quick match that finds nobody degrades gracefully
into a shareable invite. Offer "Play vs AI instead" after ~30 s unmatched.

---

## 9. Wiring the game (MP-05)

`src/iso/game.ts:203` is currently `startIsoGame(root: HTMLElement)` and
resolves its own seed at line 218:

```ts
const seed = bootSave?.seed ?? resolveMapSeed();
```

Change to:

```ts
export interface IsoGameOptions {
  seed?: number;                 // supplied by the room; overrides resolveMapSeed
  role?: "solo" | "host" | "guest";
  net?: NetSession | null;       // from src/net/session.ts
}
export function startIsoGame(root: HTMLElement, opts: IsoGameOptions = {}) {
  const seed = opts.seed ?? bootSave?.seed ?? resolveMapSeed();
```

Keep the default-argument form so every existing call site and e2e spec that
calls `startIsoGame(root)` keeps working unchanged.

Then:

- **`role === "guest"`** — do not start the AI rival, do not run the economy
  tick, do not run vehicle movement. Render from applied state only. Route every
  player action through `net.intent(...)` instead of mutating.
- **`role === "host"`** — run exactly as today, but drive `players[1]` from
  guest intents instead of `ai.ts`. The AI rival is *disabled* in a hosted game;
  the guest is the rival.
- **`role === "solo"`** — unchanged from today.

The cleanest seam for the guest-action block is `construction.ts`'s existing
cost/refusal path, which already centralises "can this player do this".

---

## 10. Tickets

Do these in order. Each should land green.

| ID | Title | Depends | Done when |
|---|---|---|---|
| MP-01 | SDK install, vite plugin, `realtime.config.json` | — | `vite build` bundles the room; `npm run typecheck` clean |
| MP-02 | `protocol.ts` + `transport.ts` | MP-01 | Protocol unit test passes; no SDK import outside `transport.ts` |
| MP-03 | `HexmatchRoom.ts` relay | MP-02 | Two local dev clients exchange messages; guest-forged snapshot rejected |
| MP-04 | `delta.ts` + dirty-tile tracking | MP-02 | Randomised-sequence test byte-identical; no delta > 16 KiB |
| MP-05 | `startIsoGame` options + guest mode | MP-04 | Guest renders host's map; guest builds via intent |
| MP-06 | `StartScreen.tsx` (host / join / AI) | MP-03 | Full host → code → join → play loop works locally |
| MP-07 | Quick match | MP-06 | Two clients pair with no code exchanged |
| MP-08 | Reconnect + host-left handling | MP-06 | Guest survives a 10 s host reload; host-left shows a clear message |
| MP-09 | e2e: two-browser host/join | MP-06 | Playwright spec drives two contexts through a shared room |

---

## 11. Testing

- **Unit** (`vitest`): protocol round-trip, delta correctness, version refusal.
  These need no network and must run in CI.
- **Local two-client**: `vite serve` runs rooms locally via
  `rundotMultiplayerPlugin` (`devPort: 9001`). Use two browser profiles — each
  needs its own signed-in identity.
- **e2e** (`playwright`): two `browserContext`s. The existing suite boots the
  default route with real rendering and no mocking — keep that. Gate the
  multiplayer spec so it skips cleanly when credentials are absent, so CI does
  not go red on a machine without test accounts.
- **Version refusal**: `SNAPSHOT_VERSION` is 9 and `validateSnapshot` already
  rejects mismatches (`src/iso/snapshot.ts:159`). Add the same check for
  `PROTOCOL_VERSION` in `welcome`. A mixed-version room must show "This game has
  been updated — reload to play together", never desync silently.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Auth friction kills multiplayer reach | **High** | AI path first and login-free (§1.2, §7) |
| Delta exceeds frame cap on a burst | Medium | 200-tile cap → full snapshot fallback (§5) |
| Multiplayer API is BETA and shifts | Medium | All SDK calls behind `transport.ts` |
| Host disconnect strands guest | Medium | MP-08; `reconnectTimeout: 60` |
| Scope overruns the jam deadline | **High** | MP-01→MP-06 is the shippable core. MP-07/08/09 are follow-ups. Ship AI-only if MP-06 is not green in time. |

---
