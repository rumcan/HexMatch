// Headless two-client check for the RUN.world room relay (`src/rooms/HexmatchRoom.ts`).
//
// Drives the vite dev sidecar (port 9001 by default) the way two browsers do —
// one ticket per profile, `auth` over `/ws`, then the hexmatch protocol — so the
// relay's three jobs can be verified with no browser at all: mint the seed and
// hand it to both sides, route guest intents to the host ONLY, and drop
// guest-forged state. Useful in a sandbox/CI, and as a smoke test before
// opening two real windows.
//
//   npm run dev                          # starts vite + the sidecar on 9001
//   node tools/two-client-check.mjs      # or: --room-server http://host:9001
//
// Exit code 0 = every check passed.
import { WebSocket } from "ws";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = flag("room-server", "http://localhost:9001").replace(/\/+$/, "");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** The dev sidecar mints a join ticket per profile; this is the SDK's dev delegate. */
async function ticket(profileId, username, req) {
  const resp = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...req, gameId: "dev-game", profileId, username, avatarUrl: null }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`ticket request failed: ${JSON.stringify(json)}`);
  return json.ticketId;
}

function client(name) {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    inbox.push(JSON.parse(raw.toString()));
    for (const wake of waiters.splice(0)) wake();
  });
  ws.on("error", (err) => { throw err; });
  const opened = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return {
    name,
    ws,
    inbox,
    opened,
    /** A game message, framed the way `ServerRoom.send` frames it. */
    game: (msgType, data) => ws.send(JSON.stringify({ type: "message", msgType, data })),
    async waitFor(predicate, label, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = inbox.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`[${name}] timed out waiting for ${label}`);
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
    },
  };
}

const host = client("host");
const guest = client("guest");
await Promise.all([host.opened, guest.opened]);

// Two profiles, exactly like two browser windows: without the playground plugin
// the SDK hands each tab its own `dev-tab-*` fake identity (sessionStorage), and
// an incognito window is simply a tab with fresh storage.
console.log(`\nroom server: ${BASE}\n\n1. host creates a room`);
host.ws.send(JSON.stringify({
  type: "auth",
  protocolVersion: 1,
  ticket: await ticket("dev-tab-aaaa", "Dev Player AAAA", { roomType: "hexmatch", action: "create" }),
  roomType: "hexmatch",
  action: "create",
}));
const created = await host.waitFor((m) => m.type === "room:created" || m.type === "room:joined", "room:joined");
const code = created.roomCode;
check(/^[A-Z0-9]{6}$/.test(code ?? ""), "host got a 6-character room code", code);

console.log("\n2. guest joins by code on a second profile");
guest.ws.send(JSON.stringify({
  type: "auth",
  protocolVersion: 1,
  ticket: await ticket("dev-tab-bbbb", "Dev Player BBBB", { roomType: "", action: "joinByCode", roomCode: code }),
  roomType: "",
  action: "joinByCode",
  roomCode: code,
}));
const joined = await guest.waitFor((m) => m.type === "room:joined" || m.type === "room:created", "room:joined");
check(joined.roomCode === code, "guest landed in the same room", joined.roomCode);
check(joined.playerId !== created.playerId, "the two clients are distinct players", `${created.playerId} / ${joined.playerId}`);

console.log("\n3. both sides are welcomed with one seed and two seats");
const hostWelcome = await host.waitFor((m) => m.msgType === "welcome", "welcome");
const guestWelcome = await guest.waitFor((m) => m.msgType === "welcome", "welcome");
check(hostWelcome.data.seed === guestWelcome.data.seed, "seed matches on both sides", String(hostWelcome.data.seed));
check(hostWelcome.data.protocolVersion === guestWelcome.data.protocolVersion, "protocol version matches", String(guestWelcome.data.protocolVersion));
const seats = guestWelcome.data.roster.map((entry) => `${entry.username}:${entry.slot}`).join(", ");
check(guestWelcome.data.roster.length === 2, "roster seats both players", seats);
check(guestWelcome.data.hostId === created.playerId, "the creator is the host", guestWelcome.data.hostId);

console.log("\n4. guest intent reaches the host");
guest.game("intent", { action: "build-road", payload: { q: 3, r: 4 } });
const intent = await host.waitFor((m) => m.msgType === "intent", "intent");
check(intent.data.action === "build-road", "host received the guest's intent", JSON.stringify(intent.data));

console.log("\n5. guest-forged state is dropped (the relay's one authority check)");
guest.game("snapshot", { snap: { forged: true }, seq: 999 });
guest.game("delta", { seq: 1, transferId: 0, layer: "road", edits: [] });
await new Promise((resolve) => setTimeout(resolve, 500));
const forged = host.inbox.filter((m) => m.msgType === "snapshot" || m.msgType === "delta");
check(forged.length === 0, "no guest state was relayed", `${forged.length} frames`);

console.log("\n6. host state reaches the guest");
host.game("delta", { seq: 1, transferId: 0, layer: "road", edits: [] });
const delta = await guest.waitFor((m) => m.msgType === "delta", "delta");
check(delta.data.seq === 1, "guest received the host's delta", JSON.stringify(delta.data));

console.log("\n7. host disconnect is reported to the guest");
host.ws.close();
const gone = await guest.waitFor(
  (m) => m.type === "room:playerDisconnected" || m.msgType === "reject",
  "playerDisconnected / reject",
  8000,
);
// `allowReconnect: true` + `reconnectTimeout: 60` hold the host's seat for a
// minute before the room calls onPlayerLeave, so the plain-language `reject`
// ("The host left the game.") lands only after that window — MP-08's job is to
// make the guest's UI react to the disconnect immediately instead.
check(
  gone.type === "room:playerDisconnected" || gone.msgType === "reject",
  "guest learned the host went away",
  gone.type === "room:playerDisconnected"
    ? `seat held ${gone.reconnectTimeout}ms for reconnect`
    : JSON.stringify(gone.data),
);

guest.ws.close();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
