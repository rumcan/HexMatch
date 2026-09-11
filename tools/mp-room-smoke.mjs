#!/usr/bin/env node
/**
 * MP-03 two-client smoke test — LOCAL ONLY, not CI.
 *
 * Drives two real WebSocket clients through the room dev server (`vite dev`
 * serves rooms on :9001) and the REAL `HexmatchRoom` code: create → join by
 * code → guest intent reaches the host → host snapshot reaches the guest →
 * guest-forged snapshot/delta reach NOBODY.
 *
 * Usage:
 *   1. `npm run dev` (in another terminal; wait for it to come up)
 *   2. `node tools/mp-room-smoke.mjs`            (or `MP_SMOKE_PORT=9001 node …`)
 *
 * Exit 0 on PASS, 1 on FAIL. Every assertion prints its own `ok` / `FAIL`
 * line so a failure says exactly which leg of the exchange broke.
 *
 * Why a script and not a unit test: room lifecycle needs the dev server's
 * ticket mint + WS gateway + the esbuild-bundled room file — none of which
 * exists in CI. The routing LOGIC is pinned by `tests/unit/net-room.test.ts`;
 * this pins the WIRING (room file loads, protocol matches, gateway relays).
 */
import WebSocket from "ws";

const PORT = Number(process.env.MP_SMOKE_PORT ?? 9001);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const ROOM_TYPE = "hexmatch";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(msg) {
  console.log(`  ok - ${msg}`);
}

function fail(msg) {
  console.error(`  FAIL - ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  fail(`room dev server is not up at ${BASE} — run \`npm run dev\` first`);
}

async function mintTicket(body) {
  const r = await fetch(`${BASE}/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) fail(`POST /tickets → ${r.status}`);
  return r.json(); // { ticketId, profileId, username }
}

/** One scripted client. `nextGame`/`quietGame` only see game frames
 *  (room:broadcast / room:sendTo) — the only channels the relay speaks.
 *  Room-state noise (playerJoined, lock, …) is ignored by design. */
class Client {
  constructor(name) {
    this.name = name;
    this.inbox = [];
  }

  async connect() {
    this.ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw) => {
      try {
        this.inbox.push(JSON.parse(raw.toString()));
      } catch {
        /* ignore */
      }
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** Next inbox frame matching `pred` (others stay queued). */
  async next(pred, what, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex(pred);
      if (i >= 0) return this.inbox.splice(i, 1)[0];
      if (Date.now() > deadline) fail(`${this.name}: timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  async nextGame(msgType, timeoutMs = 5000) {
    const f = await this.next(
      (m) => (m.type === "room:broadcast" || m.type === "room:sendTo") && m.msgType === msgType,
      `game frame "${msgType}"`,
      timeoutMs,
    );
    return { via: f.type, msgType: f.msgType, ...f.data };
  }

  /** No game frames at all for `ms` — the forgery assertion. */
  async quietGame(ms, what) {
    const before = this.inbox.length;
    await sleep(ms);
    const fresh = this.inbox.slice(before);
    const game = fresh.filter((m) => m.type === "room:broadcast" || m.type === "room:sendTo");
    assert(game.length === 0, `${this.name}: silence after ${what} (got ${JSON.stringify(game)})`);
  }

  close() {
    this.ws?.close();
  }
}

const isJoined = (m) => m.type === "room:joined";

async function main() {
  console.log(`mp-room-smoke: room dev server at ${BASE}`);
  await waitForServer();
  ok("dev server is up");

  // ── 1. host creates ────────────────────────────────────────────────
  const host = new Client("host");
  const hostTicket = await mintTicket({ profileId: "smoke-host", username: "SmokeHost", roomType: ROOM_TYPE, action: "create" });
  await host.connect();
  host.send({ type: "auth", protocolVersion: 1, ticket: hostTicket.ticketId, roomType: ROOM_TYPE, action: "create" });
  const joined = await host.next(isJoined, "room:joined");
  assert(typeof joined.roomCode === "string" && joined.roomCode.length === 6, `host created room ${joined.roomCode}`);
  assert(joined.playerId === "smoke-host", "host playerId matches the ticket profile");

  const w1 = await host.nextGame("welcome");
  // Solo welcome arrives targeted: broadcast from onPlayerJoin skips the
  // not-yet-registered newcomer, so the room sendTo's the greeting (the
  // gateway buffers it and flushes after room:joined).
  assert(w1.via === "room:sendTo", "solo welcome arrives targeted (sendTo)");
  assert(Number.isInteger(w1.seed) && w1.seed > 0, `welcome carries a minted seed (${w1.seed})`);
  assert(w1.hostId === "smoke-host", "first joiner is host");
  assert(w1.protocolVersion === 1, "welcome carries PROTOCOL_VERSION");
  assert(
    Array.isArray(w1.roster) && w1.roster.length === 1 && w1.roster[0].slot === 0,
    "solo host roster is [slot 0]",
  );

  // ── 2. guest joins by code ─────────────────────────────────────────
  const guest = new Client("guest");
  const guestTicket = await mintTicket({
    profileId: "smoke-guest",
    username: "SmokeGuest",
    roomType: ROOM_TYPE,
    action: "joinByCode",
    roomCode: joined.roomCode,
  });
  await guest.connect();
  guest.send({ type: "auth", protocolVersion: 1, ticket: guestTicket.ticketId, action: "joinByCode", roomCode: joined.roomCode });
  const gj = await guest.next(isJoined, "room:joined");
  assert(gj.roomCode === joined.roomCode, "guest landed in the host's room");

  const wGuest = await guest.nextGame("welcome");
  assert(wGuest.via === "room:sendTo", "guest welcome arrives targeted (sendTo)");
  assert(wGuest.hostId === "smoke-host", "guest welcome names the host");
  assert(
    wGuest.roster.length === 2 && wGuest.roster[1].slot === 1 && wGuest.roster[1].id === "smoke-guest",
    "guest welcome roster is [host 0, guest 1]",
  );
  const wHost2 = await host.nextGame("welcome");
  assert(wHost2.via === "room:broadcast", "host learns the new roster via broadcast");
  assert(wHost2.roster.length === 2, "host sees the full roster after the join");

  // ── 3. guest intent → host only ────────────────────────────────────
  guest.send({ type: "message", msgType: "intent", data: { action: "build", payload: { tx: 3, ty: 4 } } });
  const intent = await host.nextGame("intent");
  assert(intent.via === "room:sendTo", "intent is targeted (sendTo), not broadcast");
  assert(intent.action === "build", "intent action survives the relay");
  await guest.quietGame(400, "its own intent");

  // ── 4. host snapshot → guest ───────────────────────────────────────
  const snap = { marker: "smoke-snapshot", seed: w1.seed };
  host.send({ type: "message", msgType: "snapshot", data: { snap } });
  const got = await guest.nextGame("snapshot");
  assert(got.via === "room:broadcast", "snapshot is broadcast");
  assert(got.snap?.marker === "smoke-snapshot", "snapshot payload survives the relay");

  // ── 5. guest-forged state reaches NOBODY ───────────────────────────
  guest.send({ type: "message", msgType: "snapshot", data: { snap: { marker: "forged" } } });
  await Promise.all([host.quietGame(500, "forged snapshot"), guest.quietGame(500, "forged snapshot")]);
  guest.send({ type: "message", msgType: "delta", data: { t: 1, seq: 999 } });
  await Promise.all([host.quietGame(500, "forged delta"), guest.quietGame(500, "forged delta")]);

  host.close();
  guest.close();
  console.log("mp-room-smoke: PASS — two local clients exchanged messages; forgery rejected");
}

main().catch((err) => {
  process.exitCode = 1;
  if (!process.exitCode || err.message) console.error(`mp-room-smoke: FAIL — ${err.message}`);
});
