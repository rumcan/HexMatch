# Testing multiplayer locally (two windows — incognito included)

How to get two players into one Hexmatch room before deploying to RUN.world,
what each environment does about identity, and the gaps to expect while testing.

---

## 1. What runs where

`npm run dev` starts two things:

| Process | Where | What it is |
|---|---|---|
| Vite | `http://localhost:5173/hexmatch/` | the game (base path `/hexmatch/`) |
| RUN room sidecar | port `9001` | started by `rundotMultiplayerPlugin()`, runs `src/rooms/HexmatchRoom.ts` from `rundot/realtime.config.json` |

`vite.config.ts` has **no** `rundotGamePlaygroundPlugin()`, so the SDK runs its
mock host and realtime talks to that local sidecar. Two consequences that matter
for testing:

- **No Google sign-in, no RUN account, no `pk_` key.** Local two-player play is
  login-free. (A *published* game on run.world is different — see §5.)
- **Identities are fake and per-tab.** The SDK's dev delegate mints
  `dev-tab-XXXX` / `Dev Player XXXX` and keeps it in `sessionStorage` under
  `__rundot_fake_tab_profile__`.

That second point is the whole answer to "can I use an incognito window?":
**yes, and it is the cleanest way to be two people on one machine.** A new tab,
a new window or an incognito window starts with empty `sessionStorage`, so it
mints a *different* fake profile. Two clients → two distinct player ids → one
room. Nothing to configure.

---

## 2. Two windows on one machine

```bash
npm run dev
```

1. **Window A** → `http://localhost:5173/hexmatch/` → **Host a game** → note the
   six-character code.
2. **Window B** (incognito works, so does a second tab) → same URL →
   **Join with a code** → type the code → **Join game**.
3. The host's lobby seats the rival and enables **Start game**; the guest's
   lobby enables **Play** as soon as the room's welcome arrives with the seed.

Both sides must be on the same *seed* — the room mints it in `onCreate` and the
welcome carries it, so nobody ships a map over the wire.

---

## 3. Verifying the relay without a browser

`tools/two-client-check.mjs` speaks the sidecar protocol directly (one ticket
per profile, `auth` over `/ws`, then the hexmatch messages) and asserts the
relay's three jobs: one seed for both sides, guest intents routed to the host
only, guest-forged state dropped.

```bash
npm run dev                        # sidecar on 9001
node tools/two-client-check.mjs    # --room-server http://host:port to override
```

It is the fastest way to tell "my room code is wrong" apart from "the relay is
broken", and it works in a sandbox with no browser at all.

---

## 4. Testing through a tunnel or a sandbox preview

The sidecar origin is injected into the page as `http://localhost:9001`. If the
browser is **not** on the dev machine — Arena's live preview, ngrok, a forwarded
codespace port, a phone on the LAN — then "localhost" is the *viewer's* machine,
which has no sidecar, and every room call fails.

Point the page at a public origin that forwards to 9001:

```bash
RUNDOT_DEV_ROOM_URL="https://<tunnel-host>" npm run dev
```

`devRoomServerOrigin()` in `vite.config.ts` rewrites the injected origin. It is
`apply: "serve"` only — a published build always talks to RUN.world's hosted
room server — and it does nothing at all when the variable is unset. An `https`
origin becomes `wss://…/ws` automatically; the SDK derives the socket URL by
swapping the scheme.

---

## 5. On run.world (published) and with the playground plugin

Deployed builds use RUN's hosted room server, and there the rules change:

- **Multiplayer requires a signed-in player.** `createRoom`, `joinRoomByCode`
  and `matchmakeRoom` reject anonymous users with `AccessDeniedError`; the start
  screen turns that into the login sheet plus a one-click **Play vs AI** escape
  (`src/net/transport.ts` → `isAccessDenied` / `promptLogin`). Two real players
  therefore means two real RUN accounts — incognito alone is not enough.
- **Play vs AI stays login-free by design** (`docs/HexMatch-tickets.md` §1.2).

If you later add `rundotGamePlaygroundPlugin()` to test against the real backend,
identity comes from a Google/`pk_` session and a `localStorage` cross-tab
coordinator assigns `player1`, `player2`, … **per tab in one window**. A separate
browser, browser profile, incognito window or automation context has its own
`localStorage`, claims slot 0, and lands on the *same* uid as your first client —
the room server then rejects the second connection with `DUPLICATE_SESSION`
(WebSocket close `4001`). Pin the identity in the URL instead:

```
http://localhost:5173/hexmatch/?rundotPlayer=player2
```

Note that plugin refuses a non-loopback bind while `RUNDOT_PLAYGROUND_KEY` is
set, so headless playground login and §4's tunnel URL cannot be combined.
Details: `node_modules/@series-inc/rundot-game-sdk/docs/rundot-developer-platform/playground.md`
→ "Test multiple players".

---

## 6. Troubleshooting

### "No room server behind this page" / "The room never introduced itself"

Both mean the same thing: **nothing is simulating the room.** The SDK's offline
mock still *resolves* `createRoom` and `joinRoomByCode` — it invents a random
six-character code, and for a join it ignores the code you typed and mocks a
second room — so both lobbies look alive ("Connected", a copyable code) and then
wait for a `welcome` nobody will ever send. `transport.ts` detects that state
(`isOfflineMockRealtime()`) and refuses at the door with the fix named, rather
than letting the lobby sit for 10 s and time out.

The mock is used whenever `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__` is missing,
and `rundotMultiplayerPlugin` injects that **only on `vite serve`**. Usual
causes, most likely first:

| Cause | How to check |
|---|---|
| The page is a **build**, not the dev server — `npm run preview`, `dist/index.html`, a statically served copy, a deployed link | Console: `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__` must print `http://localhost:9001`. `undefined` means build → use `npm run dev`. |
| Dev server is right, but the **origin** is not localhost (LAN IP, tunnel, sandbox preview) | The injected sidecar origin is `localhost`, so only a browser on the dev machine can reach it — see §4 for `RUNDOT_DEV_ROOM_URL`. |
| The sidecar **never started** — port 9001 was already taken, so the plugin died with `EADDRINUSE` while Vite kept serving | Vite's terminal must not show `EADDRINUSE … port: 9001`. `node tools/two-client-check.mjs` fails immediately if it is down; kill the stale process and restart. |
| The **room type is not registered** or the room bundle failed to build | Different symptom: the client gets `ROOM_NOT_FOUND` ("Room type … not found in rooms.config.json") and the start screen shows that text, not a timeout. Check `rundot/realtime.config.json` points at `src/rooms/HexmatchRoom.ts` and that Vite logged no esbuild error. |

Console signature of the mock, if you want certainty:
`[RUN] Multiplayer running in offline mock mode — rooms will not connect.`

---

## 7. Known gaps to expect while testing

- **Closing the host window is not instant for the guest.** `allowReconnect: true`
  and `reconnectTimeout: 60` make the sidecar hold the host's seat for a minute
  before the room's `onPlayerLeave` fires, so the plain-language
  `{ type: "reject", reason: "The host left the game." }` arrives only after that
  window. The start screen now surfaces a reject that lands while you are still
  in the lobby, and a lobby that never receives its welcome times out after 10 s
  instead of leaving **Play** disabled forever — but making the in-game guest
  react to `room:playerDisconnected` immediately is MP-08's job.
- **`server/` is not part of this path.** The old `ws` relay (`wss://hexmatch.fly.dev`)
  is unreachable from a published RUN game — the platform sandbox blocks
  arbitrary external hosts (`docs/HexMatch-tickets.md` §1.1) — so nothing in
  `src/` may reference it. It stays on disk as a self-hosted option and a
  protocol reference; its four-character codes are a different room system and
  are rejected by `isValidRoomCode`.
