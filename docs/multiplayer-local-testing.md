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

---

## 8. The desktop multiplayer e2e (`npm run test:e2e:mp`)

Everything above is a recipe for a person. The **multiplayer e2e suite** is the
same recipe for CI: two real browser contexts, entered through the front door
(Play → **Host a game** → read the code → the other window's Play → **Join with
a code** → **Start game**), exchanging state through the real room.

```bash
npm run test:e2e:mp
```

What that command starts, and why:

| Piece | What it is |
|---|---|
| `vite dev` on `5173` | the only server that starts the room sidecar and injects `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__` (§6). A previewed build would answer with the offline mock, and two mocked rooms prove nothing about the room lifecycle. |
| the room sidecar on `9001` | running `src/rooms/HexmatchRoom.ts` under `rundot/realtime.e2e.config.json` — the same room as production, with the **suite's own `reconnectTimeout`** (the shipped 60s). The file exists so the grace the departure specs wait on is pinned in the repo instead of inherited silently; `RUNDOT_DEV_ROOMS_CONFIG` selects it (see `vite.config.ts` → `devRoomsConfigPath`). |
| `playwright.multiplayer.config.ts` | the suite's own config: `tests/e2e-mp/`, one worker (two seats share one room), 1440×900 (the offer tray is hidden under 1320px), traces/video on failure. |

The suite never reuses a dev server it did not start (`reuseExistingServer:
false`): one left over from a manual session runs whatever rooms file it was
given, and the disconnect specs would then pass only by luck. A busy port is an
error, not something to paper over.

A note on timing, because it is the one thing that makes this suite different
from the browser suite: **every departure assertion waits out the room's grace**.
The sidecar holds a leaver's seat for `reconnectTimeout` (60s) before the other
seat hears `room:playerLeft` / the host-left `reject`, so *both* outcomes take a
minute of wall clock by design. A dropped link is the other side of the same
coin: a client saturated with software-rasterized art can take tens of seconds
to notice its own socket died, which is why the grace cannot be shortened to a
few seconds without turning the reconnect spec into a coin toss.

Budget accordingly: the whole file is **~35–40 minutes** on a
software-rasterized runner (seven two-seat tests, each booting two clients and
the departure specs then waiting out the grace). `npx playwright test --config
playwright.multiplayer.config.ts tests/e2e-mp/mp-lobby.e2e.spec.ts` — or `-g
"<title>"` — runs a single one while iterating.

What it asserts, all of it read back from the game's own `__iso` hooks:

- **two identities, one room** — both contexts mint different `Dev Player XXXX`
  profiles, both lobbies list both seats by name, and the room's `welcome`
  carries the seed both seats boot on;
- **one island** — identical map (size, industries, towns) on both seats;
- **independent boards** — each seat's opening and its opponent's copy are the
  same bytes on both sides, and a guest's **♻ Reset** re-deals only the guest's
  board;
- **the market** — the host posts an offer, the guest's tray shows it with the
  poster's name, the guest takes it from the tray, and both purses move by
  exactly the trade;
- **simultaneous construction** — both seats click the same legal tile in the
  same instant; the authoritative world settles on **one** depot and both seats
  agree whose it is;
- **both leave directions** — a guest's departure reaches the host through the
  SDK's roster event after the grace ("… left the room — this match is over."),
  and a host's departure refuses the guest with the room's own
  `{ type: "reject", reason: "The host left the game." }` before the same
  ended-match state;
- **the transport boundary** — the guest's room socket is closed underneath the
  SDK; the SDK re-attaches inside the grace (`room:reconnected`), the host sees
  the drop but never a departure, and the returning guest is resynced onto the
  host's newer world.

Failing runs keep the evidence the issue asks for: a Playwright trace and video
of both contexts (`test-results-mp/`), the HTML report
(`playwright-report-mp/`), and both pages' console output and room-wire frames,
attached per test by `tests/e2e-mp/mp-harness.ts`.

### Is the suite actually sensitive? (the acceptance audit)

A suite that cannot fail is not coverage. Two mutations, each cheap to repeat
and each run against the shortest spec (`tests/e2e-mp/mp-lobby.e2e.spec.ts`),
must make the run fail — and do:

| Mutation | What the run does |
|---|---|
| **No room sidecar.** `node tests/e2e-mp/sidecar-blackhole.mjs 9001 &` holds the port before the run with a listener that never answers. | `vite dev` can no longer start its sidecar and exits: `listen EADDRINUSE: address already in use :::9001` → Playwright reports `Process from config.webServer was not able to start. Exit code: 1`, and the suite exits 1 without a page ever loading. This is the state that would otherwise silently degrade into the SDK's offline mock (§6) and let two separately mocked rooms "pass". |
| **Broken SDK join adapter.** `joinRoomByCode` in `src/net/transport.ts` made to `throw new Error("AUDIT: SDK join adapter broken")`. | The guest's **Join game** never seats it and the run dies at the harness's readiness assertion — `host sees two seated players` / `Expected: 2 · Received: 1` (30s poll) — after 43s. No second seat, no lobby, no match, exit 1. |

```bash
# 1) the room service is not there
node tests/e2e-mp/sidecar-blackhole.mjs 9001 & blackhole=$!
npm run test:e2e:mp                     # exit 1 (webServer never came up)
kill "$blackhole"

# 2) the adapter behind Join is broken — revert when you are done
#    src/net/transport.ts: joinRoomByCode → throw new Error("AUDIT: SDK join adapter broken")
npm run test:e2e:mp                     # exit 1 (host never sees a second seat)
git checkout -- src/net/transport.ts
```

Both were run on this branch (2026-09-13) with the command above; the second is
the case the issue names specifically, and it fails at the room boundary the
spec asserts on rather than somewhere incidental. What the suite does *not*
prove — RUN.world's own sign-in and iframe behaviour — is spelled out at the end
of this section.

### Knobs

| Variable | Why you would set it |
|---|---|
| `PW_MP_BOOT_BUDGET` | boots two software-rasterized clients; a shared or CDN-blocked runner needs more than 180s (this is also the per-step budget in the harness). |
| `PW_MP_TIMEOUT` | the whole test's budget, boot included. |
| `PW_CHROMIUM_EXECUTABLE` | no Playwright CDN (sandboxes, air-gapped CI): point it at any local Chromium. |
| `PW_MP_PORT` | run on another port when 5173 is taken. |

CI runs it as the `e2e-multiplayer` job in `.github/workflows/ci.yml`, after
`npx playwright install --with-deps chromium` — the same Chromium the single
player suite uses, with no `RUNDOT_*` variables set.

### What this still does NOT prove — and the hosted smoke gate

The suite runs the **local** sidecar over plain `localhost`. That cannot
represent the hosted platform, so these stay unverified here:

1. **RUN.world authentication.** `createRoom`/`joinRoomByCode` reject anonymous
   users with `AccessDeniedError`, and the start screen turns that into the login
   sheet (§5). Locally there is no sign-in at all.
2. **The hosted iframe.** A published game runs inside a RUN host frame; that is
   where modal sandboxing, focus, pointer capture, audio autoplay and resizing
   differ from a plain page (§ "How to Play" and the confirm sheets exist
   because `window.confirm` is answered `false` there).
3. **Two real accounts / `DUPLICATE_SESSION`.** Two browser profiles with two
   signed-in RUN accounts, and the playground's per-tab identity rules (§5).
4. **The hosted room server's own behaviour**: its reconnect window under real
   network conditions (the suite pins the same 60s grace locally, but a local
   loopback drop and a mobile-class network are not the same test), its
   version/relay checks, and regional latency.

Those are covered by a **hosted smoke gate**, run by hand against a deployed
build (and only there — preview-mode or localhost runs are not evidence for it):

1. Publish (or open the preview URL) and open it in **two signed-in RUN
   accounts** — two browsers/profiles, not two tabs of one (§5).
2. A: **Host a game**, note the code. B: **Join with a code**, type it, join.
3. Assert both lobbies list both names, then **Start game** and **Play**.
4. Assert the two seats boot on the **same seed** (the map's towns and
   industries match) and that each seat's own Factory/Depot appears on the
   other's board.
5. While in `play`, open the ☰ menu → **Leave Room** → confirm on one seat;
   the other must show **"… left the room — this match is over."** Repeat with
   the other seat: the remaining player must see **"The host left the game."**
   (after the hosted 60s grace for a host, ~5s is not expected there).
6. Drop the network for ~10s on one seat (devtools offline for the whole
   browser), restore it, and confirm the seat resyncs rather than ending the
   match. Only then take a screenshot of both seats and the browser console.

Until that is automated, treat issues it could hide (login, iframe sandboxing,
hosted reconnect timing) as **not covered by `npm run test:e2e:mp`**.
