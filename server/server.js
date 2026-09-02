/**
 * Hexmatch room server — a thin relay, Jackbox style.
 *
 * It does NOT simulate the game. The browser that created the room is the
 * authority: it runs the map, the economy and the AI, and publishes snapshots.
 * This process only does three things:
 *   1. mint short room codes and track who is in each room
 *   2. forward guest intents  → host
 *   3. forward host snapshots → guests
 *
 * Hardening (tickets #15/#16/#17):
 *   - bounded message payloads (maxPayload), per-socket rate limiting
 *   - room caps (total rooms, guests per room, rooms per IP)
 *   - origin check for browser sockets
 *   - joins into closed (host-gone) rooms are rejected with a clear error
 *   - a host token lets a reloading host reattach to its room ("rehost")
 *   - intents are only forwarded for a guest's assigned slot
 *
 * Run:  node server.js         (defaults to port 8787)
 *       PORT=9000 node server.js
 */
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { networkInterfaces } from "os";
import { randomBytes } from "crypto";

const PORT = process.env.PORT ? +process.env.PORT : 8787;
const MAX_PLAYERS = 4;               // host + 3 guests
export const MAX_GUESTS = MAX_PLAYERS - 1;
const ROOM_TTL_MS = 1000 * 60 * 60;  // rooms die an hour after the host leaves
const MAX_ROOMS = 2000;              // total live rooms
const MAX_ROOMS_PER_IP = 12;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 20;                 // messages per socket per window

// Ambiguous characters removed so codes are easy to read out loud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Origins allowed to open browser sockets. Empty string = same-origin / file /
// non-browser clients (health checks, tests). Override with ALLOWED_ORIGINS.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function createRoomServer() {
  const rooms = new Map();
  const roomsPerIp = new Map();
  const httpServer = createServer((req, res) => {
    // tiny health endpoint so you can confirm the server is reachable
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    res.writeHead(404).end();
  });

  function makeCode() {
    let code;
    do {
      code = Array.from({ length: 4 }, () =>
        ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
    } while (rooms.has(code));
    return code;
  }

  const send = (ws, type, data = {}) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  };

  function roster(room) {
    return [...room.guests.values()].map((g) => ({ id: g.id, name: g.name, slot: g.slot }));
  }

  function broadcast(room, type, data, exceptId = null) {
    for (const g of room.guests.values()) {
      if (g.id !== exceptId) send(g.ws, type, data);
    }
  }

  function clientIp(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
    return req.socket?.remoteAddress || "?";
  }

  function originOk(req) {
    if (!ALLOWED_ORIGINS.length) return true;
    const o = req.headers.origin;
    if (!o) return true;  // non-browser clients (Node tests, curl) carry no origin
    return ALLOWED_ORIGINS.some((a) => o === a || o.endsWith("." + a) || o.startsWith(a + ":"));
  }

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_PAYLOAD_BYTES,
    verifyClient: (info, cb) => {
      if (!originOk(info.req)) {
        cb(false, 403, "origin not allowed");
        return;
      }
      cb(true);
    },
  });

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    const ip = clientIp(req);

    // ── per-socket token-bucket rate limit ──
    let bucket = RATE_MAX;
    let windowStart = Date.now();
    const rateOk = () => {
      const now = Date.now();
      if (now - windowStart >= RATE_WINDOW_MS) { windowStart = now; bucket = RATE_MAX; }
      if (bucket <= 0) return false;
      bucket--;
      return true;
    };

    let myRoom = null;      // room code
    let myId = null;        // guest id, or "host"
    let isHost = false;

    ws.on("message", (raw) => {
      if (!rateOk()) {
        send(ws, "error", { reason: "rate-limited", message: "Slow down a moment." });
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

      switch (msg.type) {
        // ── host opens a room ─────────────────────────────────────────
        case "create": {
          if (rooms.size >= MAX_ROOMS) {
            return send(ws, "error", { reason: "server-full", message: "Server is full — try again shortly." });
          }
          const ipCount = roomsPerIp.get(ip) || 0;
          if (ipCount >= MAX_ROOMS_PER_IP) {
            return send(ws, "error", { reason: "too-many-rooms", message: "Too many rooms from this network." });
          }
          const code = makeCode();
          // the map seed is minted here and handed to every guest, so all
          // browsers generate identical geometry without shipping the map
          const seed = (Math.random() * 0x7fffffff) | 0;
          // host token lets a reloading host reattach ("rehost", ticket #16)
          const token = randomBytes(12).toString("hex");
          rooms.set(code, {
            code,
            hostWs: ws,
            hostName: String(msg.name || "Host").slice(0, 16),
            hostToken: token,
            seed,
            guests: new Map(),
            seq: 1,
            createdAt: Date.now(),
            closedAt: null,
            ip,
          });
          roomsPerIp.set(ip, ipCount + 1);
          myRoom = code; isHost = true; myId = "host";
          send(ws, "created", { code, max: MAX_PLAYERS, seed, token });
          break;
        }

        // ── reloading host reattaches to its room (ticket #16) ────────
        case "rehost": {
          const code = String(msg.code || "").toUpperCase().trim();
          const room = rooms.get(code);
          if (!room || !room.closedAt || room.hostToken !== msg.token) {
            return send(ws, "error", { reason: "no-rehost", message: "That room can't be reclaimed." });
          }
          room.hostWs = ws;
          room.closedAt = null;
          room.hostName = String(msg.name || room.hostName).slice(0, 16);
          myRoom = code; isHost = true; myId = "host";
          send(ws, "created", { code, max: MAX_PLAYERS, seed: room.seed, token: room.hostToken, rehosted: true });
          // tell remaining guests the host is back
          broadcast(room, "host-back", {});
          send(ws, "roster", { players: roster(room) });
          break;
        }

        // ── guest joins by code ───────────────────────────────────────
        case "join": {
          const code = String(msg.code || "").toUpperCase().trim();
          const room = rooms.get(code);
          if (!room) return send(ws, "error", { reason: "no-room", message: "No room with that code." });
          // ticket #16: the host has left — joining would strand the guest in
          // a dead lobby (relays to a dead socket silently no-op).
          if (room.closedAt || (room.hostWs && room.hostWs.readyState !== 1)) {
            return send(ws, "error", { reason: "host-gone", message: "The host has left that room." });
          }
          // ticket #17: explicit guest capacity (MAX_GUESTS = MAX_PLAYERS - 1)
          if (room.guests.size >= MAX_GUESTS) {
            return send(ws, "error", { reason: "full", message: "That room is full." });
          }
          myRoom = code;
          myId = "g" + room.seq++;
          const guest = {
            id: myId, ws, ip,
            name: String(msg.name || "Player").slice(0, 16),
            slot: null,
          };
          room.guests.set(myId, guest);

          // the host decides which AI slot this player takes over
          send(room.hostWs, "guest-joined", { id: myId, name: guest.name });
          send(ws, "joined", { code, id: myId, hostName: room.hostName, seed: room.seed });
          broadcast(room, "roster", { players: roster(room) });
          send(room.hostWs, "roster", { players: roster(room) });
          break;
        }

        // ── host publishes authoritative state ────────────────────────
        case "snapshot": {
          const room = rooms.get(myRoom);
          if (!room || !isHost || room.closedAt) return;
          if (!msg.state || typeof msg.state !== "object") return;
          broadcast(room, "snapshot", { state: msg.state });
          break;
        }

        // ── host confirms which slot a guest controls ─────────────────
        case "assign": {
          const room = rooms.get(myRoom);
          if (!room || !isHost) return;
          const g = room.guests.get(msg.id);
          if (g) {
            g.slot = Number.isInteger(msg.slot) ? msg.slot : null;
            send(g.ws, "assigned", { slot: g.slot, name: msg.name });
            broadcast(room, "roster", { players: roster(room) });
          }
          break;
        }

        // ── guest sends an intent to the host ─────────────────────────
        case "intent": {
          const room = rooms.get(myRoom);
          if (!room || isHost) return;
          const g = room.guests.get(myId);
          if (!g) return;
          // ticket #15: a guest may only act once the host has assigned them a
          // slot — the server marks it here so a spoofed `from` can't be used.
          if (g.slot === null) return;
          if (typeof msg.action !== "string" || msg.action.length > 40) return;
          send(room.hostWs, "intent", { from: myId, slot: g.slot, action: msg.action, payload: msg.payload });
          break;
        }

        // ── host → one guest (toasts, rejections) ─────────────────────
        case "notify": {
          const room = rooms.get(myRoom);
          if (!room || !isHost) return;
          const g = room.guests.get(msg.to);
          if (g) send(g.ws, "notify", { text: String(msg.text || "").slice(0, 200), kind: String(msg.kind || "info").slice(0, 16) });
          break;
        }

        case "ping": send(ws, "pong"); break;
      }
    });

    ws.on("close", () => {
      const room = rooms.get(myRoom);
      if (!room) return;
      if (isHost) {
        // host left: tell everyone, then hold the room briefly in case of
        // reload — the host token lets them reattach via "rehost".
        broadcast(room, "host-left", {});
        room.closedAt = Date.now();
        // drop the dead reference; rehost replaces it
        room.hostWs = null;
      } else {
        room.guests.delete(myId);
        if (room.hostWs && room.hostWs.readyState === 1) {
          send(room.hostWs, "guest-left", { id: myId });
        }
        broadcast(room, "roster", { players: roster(room) });
      }
    });
  });

  // keepalive: drop sockets that stop answering
  const aliveTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  aliveTimer.unref?.();

  // sweep dead rooms
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const expired = room.closedAt && now - room.closedAt > ROOM_TTL_MS;
      // also reap rooms whose host never connected / vanished long ago
      if (expired) {
        const ipCount = roomsPerIp.get(room.ip) || 0;
        if (ipCount <= 1) roomsPerIp.delete(room.ip);
        else roomsPerIp.set(room.ip, ipCount - 1);
        rooms.delete(code);
      }
    }
  }, 60000);
  sweepTimer.unref?.();

  return { httpServer, wss, rooms, listen: (...a) => httpServer.listen(...a) };
}

// Run directly (node server.js) — tests import createRoomServer() instead.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createRoomServer();
  server.httpServer.listen(PORT, () => {
    const nets = networkInterfaces();
    const lan = Object.values(nets).flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n.address);
    console.log(`\nHexmatch room server listening on port ${PORT}`);
    console.log(`  this machine : ws://localhost:${PORT}`);
    lan.forEach((ip) => console.log(`  on your LAN  : ws://${ip}:${PORT}`));
    console.log(`\nGuests need the LAN address (or your public IP + a forwarded port).\n`);
  });
}
