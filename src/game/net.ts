/**
 * Client networking — host-authoritative multiplayer.
 *
 * The browser that creates the room owns the truth: it keeps running the map,
 * the economy and the AI exactly as in single player. Guests do not simulate.
 * They send intents ("build a road on edge 42") and render whatever snapshot
 * the host last published.
 *
 * Quarries are deliberately NOT synced. Each player's gem board is private and
 * lives only in their own browser — matching gems is a local activity whose
 * only shared consequence is the resources it produces.
 */
import { G, Player, bus, makePlayer } from "./state";
import { ResKey } from "./config";

export type Role = "solo" | "host" | "guest";

export const Net = {
  role: "solo" as Role,
  ws: null as WebSocket | null,
  code: "" as string,
  myIndex: 0,            // which G.players slot this browser controls
  guestSlots: new Map<string, number>(),   // guest id -> player index
  connected: false,
  lastSnapshot: 0,
  seed: 0,               // shared map seed, minted by the server
  roster: [] as { id: string; name: string; slot: number | null }[],
  started: false,
};

const SNAPSHOT_HZ = 6;
let snapTimer = 0;

const sendRaw = (o: any) => {
  if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(o));
};

/* ── connection ──────────────────────────────────────────────────── */

export function connect(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    Net.ws = ws;
    const timeout = setTimeout(() => reject(new Error("Connection timed out")), 8000);
    ws.onopen = () => { clearTimeout(timeout); Net.connected = true; resolve(); };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("Could not reach the server")); };
    ws.onclose = () => {
      Net.connected = false;
      bus.emit("net:closed", {});
    };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      handle(m);
    };
  });
}

export async function hostRoom(url: string, name: string) {
  await connect(url);
  Net.role = "host";
  Net.myIndex = 0;
  sendRaw({ type: "create", name });
}

export async function joinRoom(url: string, code: string, name: string) {
  await connect(url);
  Net.role = "guest";
  sendRaw({ type: "join", code: code.toUpperCase(), name });
}

/* ── message handling ────────────────────────────────────────────── */

function handle(m: any) {
  switch (m.type) {
    case "created":
      Net.code = m.code;
      Net.seed = m.seed;
      bus.emit("net:created", { code: m.code, seed: m.seed });
      break;

    case "joined":
      Net.code = m.code;
      Net.seed = m.seed;
      bus.emit("net:joined", { code: m.code, hostName: m.hostName, seed: m.seed });
      break;

    // ── host side: a player arrived, hand them an AI's seat ──────────
    case "guest-joined": {
      if (Net.role !== "host") break;
      const slot = takeOverAISlot(m.name);
      if (slot < 0) {
        sendRaw({ type: "notify", to: m.id, text: "No free seats.", kind: "danger" });
        break;
      }
      Net.guestSlots.set(m.id, slot);
      sendRaw({ type: "assign", id: m.id, slot, name: m.name });
      bus.emit("log", { who: slot, text: `${m.name} took over ${G.players[slot].name}.` });
      bus.emit("net:roster", {});
      break;
    }

    case "guest-left": {
      if (Net.role !== "host") break;
      const slot = Net.guestSlots.get(m.id);
      if (slot !== undefined) {
        // hand the seat back to the AI so the game keeps moving
        const p = G.players[slot] as Player;
        p.human = false;
        p.name = p.name + " (AI)";
        Net.guestSlots.delete(m.id);
        bus.emit("log", { who: slot, text: `${p.name} is under AI control again.` });
      }
      break;
    }

    // ── guest side ───────────────────────────────────────────────────
    case "assigned":
      Net.myIndex = m.slot;
      bus.emit("net:assigned", { slot: m.slot });
      break;

    case "snapshot":
      if (Net.role === "guest") applySnapshot(m.state);
      break;

    case "roster":
      Net.roster = m.players || [];
      bus.emit("net:roster", { players: Net.roster });
      break;

    case "notify":
      bus.emit("toast", { text: m.text, kind: m.kind || "info" });
      break;

    case "host-left":
      bus.emit("net:host-left", {});
      break;

    case "error":
      bus.emit("net:error", { message: m.message });
      break;

    // ── host side: apply a guest's intent using the normal game rules ─
    case "intent":
      if (Net.role === "host") applyIntent(m.from, m.action, m.payload);
      break;
  }
}

/** Find an AI seat and convert it to a human one. Returns the index or -1. */
function takeOverAISlot(name: string): number {
  for (let i = 1; i < G.players.length; i++) {
    const p = G.players[i] as Player;
    if (!p.human) {
      p.human = true;
      p.name = name;
      // reset AI pacing so nothing fires the instant they connect
      p.nextIncome = Infinity; p.nextBuild = Infinity;
      p.nextTrade = Infinity;  p.nextEvil = Infinity;
      return i;
    }
  }
  return -1;
}

/* ── host: publish state ─────────────────────────────────────────── */

/** Called every frame by the game loop; throttled internally. */
export function tickNet(now: number) {
  if (Net.role !== "host" || !Net.connected) return;
  if (now - snapTimer < 1000 / SNAPSHOT_HZ) return;
  snapTimer = now;
  sendRaw({ type: "snapshot", state: buildSnapshot() });
}

function buildSnapshot() {
  return {
    t: performance.now(),
    setupPhase: G.setupPhase,
    won: G.won,
    players: (G.players as Player[]).map((p) => ({
      i: p.i, name: p.name, human: p.human, color: p.color,
      res: p.res, vp: p.vp,
      settlements: p.settlements, cities: p.cities, roads: p.roads,
      capital: p.capital,
      slowedUntil: p.slowedUntil, securedUntil: p.securedUntil,
      tollAccess: [...p.tollAccess],
    })),
    // only the mutable parts of the map need to travel; geometry is generated
    // identically on both sides from the seed handed out at room creation
    edges: G.map.edges.map((e: any) => e.owner),
    verts: G.map.verts.map((v: any) => (v.building ? [v.building, v.owner] : 0)),
    tiles: G.map.tiles.map((t: any) => t.banditUntil),
    offers: G.offers,
  };
}

function applySnapshot(s: any) {
  if (!s || !G.map) return;
  Net.lastSnapshot = performance.now();

  G.setupPhase = s.setupPhase;
  G.won = s.won;

  s.players.forEach((sp: any, i: number) => {
    let p = G.players[i] as Player;
    if (!p) { p = makePlayer(i, sp.name, false, sp.color); G.players[i] = p; }
    p.name = sp.name; p.human = sp.human; p.color = sp.color;
    p.res = sp.res; p.vp = sp.vp;
    p.settlements = sp.settlements; p.cities = sp.cities; p.roads = sp.roads;
    p.capital = sp.capital;
    p.slowedUntil = sp.slowedUntil; p.securedUntil = sp.securedUntil;
    p.tollAccess = new Set<number>(sp.tollAccess);
  });

  s.edges.forEach((owner: number, i: number) => { if (G.map.edges[i]) G.map.edges[i].owner = owner; });
  s.verts.forEach((v: any, i: number) => {
    const vert = G.map.verts[i];
    if (!vert) return;
    if (v === 0) { vert.building = null; vert.owner = -1; }
    else { vert.building = v[0]; vert.owner = v[1]; }
  });
  s.tiles.forEach((b: number, i: number) => { if (G.map.tiles[i]) G.map.tiles[i].banditUntil = b; });
  G.offers = s.offers;

  bus.emit("net:snapshot", {});
}

/* ── guest: send intents ─────────────────────────────────────────── */

export function intent(action: string, payload: any = {}) {
  sendRaw({ type: "intent", action, payload });
}

/** True when this browser must ask the host instead of acting locally. */
export const isGuest = () => Net.role === "guest";

/* ── host: run a guest's intent through the normal rules ─────────── */

let handlers: Record<string, (p: Player, payload: any) => void> = {};

/**
 * main.ts registers the real game actions here, so the networking layer never
 * needs to import the rules directly (and can't drift from single-player).
 */
export function registerIntents(h: Record<string, (p: Player, payload: any) => void>) {
  handlers = h;
}

function applyIntent(from: string, action: string, payload: any) {
  const slot = Net.guestSlots.get(from);
  if (slot === undefined) return;
  const p = G.players[slot] as Player;
  const fn = handlers[action];
  if (!fn) return;
  try {
    fn(p, payload);
  } catch (err) {
    console.error("intent failed", action, err);
  }
}

/** Resources gained on a guest's own board are reported up to the host. */
export function reportHarvest(res: ResKey, amount: number) {
  if (Net.role === "guest") intent("harvest", { res, amount });
}