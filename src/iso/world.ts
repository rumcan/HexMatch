// ─────────────────────────────────────────────────────────────────────────
// E6 — harvesters, catchment, connection flood-fill and road/rail scoring.
// Replaces the hex vertex-adjacency model. This is the mechanic that makes
// the map matter: a harvester only feeds your quarry if a contiguous road or
// rail link (respecting both facing bits) runs from it to your main Factory.
// ─────────────────────────────────────────────────────────────────────────

import {
  Cargo, CARGO_KEYS, CargoInfo, Transport, TRANSPORT, tileIndex, inBounds,
  DIR as DIRDELTA, INDUSTRIES, TERRAIN,
} from "./config";
import { IsoMap, Industry } from "./grid";
import { TransportNet, DIR_BITS } from "./transport";

function cargoOf(ind: Industry): Cargo {
  return INDUSTRIES[ind.type].cargo;
}

export interface Factory { tx: number; ty: number; }
export interface Harvester { id: number; tx: number; ty: number; }

export interface ConnectionState {
  road: boolean;
  rail: boolean;
}

export class IsoWorld {
  map: IsoMap;
  net: TransportNet;
  factories = new Map<number, Factory>();      // player → factory
  harvesters: Harvester[] = [];                // all players'
  harvesterOwner: number[] = [];               // harvester id → player
  resources: Record<Cargo, number>[] = [];
  vp: number[] = [];
  // harvester id → currently-awarded connection state (for award/revoke diffs)
  connState = new Map<number, ConnectionState>();
  // telemetry for the UI / tests
  onConnectionChange?: (info: {
    harvester: Harvester; player: number; kind: Transport; connected: boolean;
  }) => void;

  constructor(map: IsoMap, players = 1) {
    this.map = map;
    this.net = new TransportNet(map);
    for (let i = 0; i < players; i++) this.addPlayer();
  }

  addPlayer(): number {
    const i = this.resources.length;
    const res = {} as Record<Cargo, number>;
    CARGO_KEYS.forEach((c) => (res[c] = 0));
    this.resources.push(res);
    this.vp.push(0);
    return i;
  }

  placeFactory(player: number, tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    if (this.map.terrain[tileIndex(tx, ty)] === TERRAIN.WATER) return false;
    if (this.map.occup[tileIndex(tx, ty)] !== -1) return false;
    this.factories.set(player, { tx, ty });
    return true;
  }

  /**
   * Place a harvester on a tile whose 4×4 catchment overlaps an industry.
   * It does NOT need to touch transport yet — the setup flow places the
   * harvester before the road is laid (E8); connection is recomputed whenever
   * a road/rail later reaches a tile adjacent to it (flood-fill starts from
   * the harvester's four neighbours). The tile must be free of transport and
   * industry footprint.
   */
  placeHarvester(player: number, tx: number, ty: number): Harvester | null {
    if (!inBounds(tx, ty)) return null;
    if (this.net.has("road", tx, ty) || this.net.has("rail", tx, ty)) return null;
    if (this.map.occup[tileIndex(tx, ty)] !== -1) return null;
    // catchment (4×4) must overlap at least one industry
    if (this.catchmentIndustries(tx, ty).length === 0) return null;
    const id = this.harvesters.length;
    const h: Harvester = { id, tx, ty };
    this.harvesters.push(h);
    this.harvesterOwner.push(player);
    this.checkConnections();
    return h;
  }

  /** Industries whose footprint overlaps the 4×4 catchment centred on (tx,ty). */
  catchmentIndustries(tx: number, ty: number): Industry[] {
    const out: Industry[] = [];
    const seen = new Set<number>();
    for (let y = ty - 1; y <= ty + 2; y++) {
      for (let x = tx - 1; x <= tx + 2; x++) {
        if (!inBounds(x, y)) continue;
        const ind = this.map.industries[this.map.occup[tileIndex(x, y)]];
        if (ind && !seen.has(ind.id)) { seen.add(ind.id); out.push(ind); }
      }
    }
    return out;
  }

  /**
   * Flood-fill one transport layer starting from pieces adjacent to `from` and
   * report the set of reachable tile indices. A move across an edge requires
   * the bit on BOTH sides, so dangling half-pieces never connect.
   */
  floodNetwork(kind: Transport, from: { tx: number; ty: number }): Set<number> {
    const bits = this.net.layer(kind);
    const start: number[] = [];
    for (const bit of DIR_BITS) {
      const [dx, dy] = DIRDELTA[bit];
      const nx = from.tx + dx, ny = from.ty + dy;
      if (inBounds(nx, ny) && bits[tileIndex(nx, ny)] !== 0) start.push(tileIndex(nx, ny));
    }
    const seen = new Set<number>(start);
    const q = [...start];
    while (q.length) {
      const idx = q.shift()!;
      const tx = idx % this.map.w, ty = Math.floor(idx / this.map.w);
      const mask = bits[idx];
      for (const bit of DIR_BITS) {
        if (!(mask & bit)) continue;
        const [dx, dy] = DIRDELTA[bit];
        const nx = tx + dx, ny = ty + dy;
        if (!inBounds(nx, ny)) continue;
        const nIdx = tileIndex(nx, ny);
        if (seen.has(nIdx)) continue;
        // neighbour must carry the facing bit
        if (!(bits[nIdx] & (oppositeBit(bit)))) continue;
        seen.add(nIdx);
        q.push(nIdx);
      }
    }
    return seen;
  }

  /** Does `from` connect to the factory over `kind`? */
  connectedToFactory(kind: Transport, player: number, from: { tx: number; ty: number }): boolean {
    const f = this.factories.get(player);
    if (!f) return false;
    const net = this.floodNetwork(kind, from);
    // a factory tile isn't itself a road bit; the link is a piece adjacent to it
    for (const bit of DIR_BITS) {
      const [dx, dy] = DIRDELTA[bit];
      const nx = f.tx + dx, ny = f.ty + dy;
      if (inBounds(nx, ny) && net.has(tileIndex(nx, ny))) return true;
    }
    return false;
  }

  /**
   * Recompute every harvester's road/rail connection and award/revoke VP.
   * Runs on every build and demolish (E6), never on a timer.
   */
  checkConnections() {
    for (let hi = 0; hi < this.harvesters.length; hi++) {
      const h = this.harvesters[hi];
      const player = this.harvesterOwner[hi];
      const prev = this.connState.get(h.id) ?? { road: false, rail: false };
      const next: ConnectionState = {
        road: this.connectedToFactory("road", player, h),
        rail: this.connectedToFactory("rail", player, h),
      };
      this.connState.set(h.id, next);

      // VP: rail wins if present (3), else road (1). Adjust the delta and fire
      // events so the UI can animate the counter / toast (E6).
      const vpNow = next.rail ? TRANSPORT.rail.vp : next.road ? TRANSPORT.road.vp : 0;
      const vpPrev = prev.rail ? TRANSPORT.rail.vp : prev.road ? TRANSPORT.road.vp : 0;
      if (vpNow !== vpPrev) {
        this.vp[player] += vpNow - vpPrev;
        if (this.onConnectionChange) {
          const kind: Transport = next.rail ? "rail" : "road";
          this.onConnectionChange({ harvester: h, player, kind, connected: vpNow > 0 });
        }
      }
    }
  }

  /**
   * Harvest from every CONNECTED harvester (E6). Rail takes the 1.6× multiplier
   * and wins over road when both link the harvester. Blockaded industries
   * (banditUntil > now) produce nothing.
   */
  playerResources(player: number, now: number): Partial<Record<Cargo, number>> {
    const out = {} as Partial<Record<Cargo, number>>;
    for (let hi = 0; hi < this.harvesters.length; hi++) {
      if (this.harvesterOwner[hi] !== player) continue;
      const h = this.harvesters[hi];
      const st = this.connState.get(h.id) ?? { road: false, rail: false };
      const mult = st.rail ? TRANSPORT.rail.throughput : st.road ? TRANSPORT.road.throughput : 0;
      if (mult === 0) continue;
      for (const ind of this.catchmentIndustries(h.tx, h.ty)) {
        if (ind.banditUntil > now) continue;
        const cargo = cargoOf(ind);
        const amt = ind.output * mult;
        out[cargo] = (out[cargo] ?? 0) + amt;
      }
    }
    return out;
  }
}

function oppositeBit(bit: number): number {
  // NE<->SW, SE<->NW
  switch (bit) {
    case 1: return 4;   // NE -> SW
    case 2: return 8;   // SE -> NW
    case 4: return 1;   // SW -> NE
    case 8: return 2;   // NW -> SE
    default: return 0;
  }
}

export type { CargoInfo };
