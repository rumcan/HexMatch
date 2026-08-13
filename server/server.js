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
 * Run:  node server.js         (defaults to port 8787)
 *       PORT=9000 node server.js
 */
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { networkInterfaces } from "os";

const PORT = process.env.PORT ? +process.env.PORT : 8787;
const MAX_PLAYERS = 4;              // host + 3 guests
const ROOM_TTL_MS = 1000 * 60 * 60; // rooms die an hour after the host leaves

// Ambiguous characters removed so codes are easy to read out loud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();

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

const httpServer = createServer((req, res) => {
  // tiny health endpoint so you can confirm the server is reachable
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  let myRoom = null;      // room code
  let myId = null;        // guest id, or "host"
  let isHost = false;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      // ── host opens a room ─────────────────────────────────────────
      case "create": {
        const code = makeCode();
        // the map seed is minted here and handed to every guest, so all
        // browsers generate identical geometry without shipping the map
        const seed = (Math.random() * 0x7fffffff) | 0;
        rooms.set(code, {
          code,
          hostWs: ws,
          hostName: msg.name || "Host",
          seed,
          guests: new Map(),
          seq: 1,
          createdAt: Date.now(),
          closedAt: null,
        });
        myRoom = code; isHost = true; myId = "host";
        send(ws, "created", { code, max: MAX_PLAYERS, seed });
        break;
      }

      // ── guest joins by code ───────────────────────────────────────
      case "join": {
        const code = (msg.code || "").toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, "error", { reason: "no-room", message: "No room with that code." });
        if (room.guests.size + 1 >= MAX_PLAYERS) {
          return send(ws, "error", { reason: "full", message: "That room is full." });
        }
        myRoom = code;
        myId = "g" + room.seq++;
        const guest = { id: myId, ws, name: (msg.name || "Player").slice(0, 16), slot: null };
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
        if (!room || !isHost) return;
        broadcast(room, "snapshot", { state: msg.state });
        break;
      }

      // ── host confirms which slot a guest controls ─────────────────
      case "assign": {
        const room = rooms.get(myRoom);
        if (!room || !isHost) return;
        const g = room.guests.get(msg.id);
        if (g) {
          g.slot = msg.slot;
          send(g.ws, "assigned", { slot: msg.slot, name: msg.name });
          broadcast(room, "roster", { players: roster(room) });
        }
        break;
      }

      // ── guest sends an intent to the host ─────────────────────────
      case "intent": {
        const room = rooms.get(myRoom);
        if (!room || isHost) return;
        send(room.hostWs, "intent", { from: myId, action: msg.action, payload: msg.payload });
        break;
      }

      // ── host → one guest (toasts, rejections) ─────────────────────
      case "notify": {
        const room = rooms.get(myRoom);
        if (!room || !isHost) return;
        const g = room.guests.get(msg.to);
        if (g) send(g.ws, "notify", { text: msg.text, kind: msg.kind });
        break;
      }

      case "ping": send(ws, "pong"); break;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(myRoom);
    if (!room) return;
    if (isHost) {
      // host left: tell everyone, then hold the room briefly in case of reload
      broadcast(room, "host-left", {});
      room.closedAt = Date.now();
    } else {
      room.guests.delete(myId);
      send(room.hostWs, "guest-left", { id: myId });
      broadcast(room, "roster", { players: roster(room) });
    }
  });
});

// keepalive: drop sockets that stop answering
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// sweep dead rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.closedAt && now - room.closedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60000);

httpServer.listen(PORT, () => {
  const nets = networkInterfaces();
  const lan = Object.values(nets).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
  console.log(`\nHexmatch room server listening on port ${PORT}`);
  console.log(`  this machine : ws://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  on your LAN  : ws://${ip}:${PORT}`));
  console.log(`\nGuests need the LAN address (or your public IP + a forwarded port).\n`);
});