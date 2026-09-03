import { PLOT, TILES, TileKey, ResKey, mulberry32 } from "./config";
import { Player } from "./state";

// ── Data model (a generic build graph over an organic island) ──
export interface Tile {
  i: number; x: number; y: number;
  type: TileKey; verts: number[]; edges: number[]; area: number;
  banditUntil: number;
}
export interface Vertex {
  i: number; x: number; y: number; tiles: number[]; edges: number[];
  building: null | "capital" | "settlement" | "city"; owner: number;
  buildable: boolean;
}
export interface Edge {
  i: number; a: number; b: number; x: number; y: number; owner: number;
  tiles: number[]; rail: boolean; wob: Pt[];   // organic intermediate points a→b
}
export interface HexMap {
  tiles: Tile[]; verts: Vertex[]; edges: Edge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export type Pt = [number, number];

// ── geometry helpers ──
function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(a) / 2;
}
function polyCentroid(p: Pt[]): Pt {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const cr = p[i][0] * p[j][1] - p[j][0] * p[i][1];
    cx += (p[i][0] + p[j][0]) * cr; cy += (p[i][1] + p[j][1]) * cr; a += cr;
  }
  if (Math.abs(a) < 1e-6) return [p[0][0], p[0][1]];
  a *= 3;
  return [cx / a, cy / a];
}
// Sutherland–Hodgman clip to half-plane { P : (P-mid)·n <= 0 }
function clipHalf(poly: Pt[], mx: number, my: number, nx: number, ny: number): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p[0] - mx) * nx + (p[1] - my) * ny;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = side(a), db = side(b);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
function pointInConvex(poly: Pt[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
  }
  return true;
}

const RES_TYPES: TileKey[] = ["forest", "hills", "pasture", "field", "mountain", "goldmine"];
const RES_WEIGHT: Record<string, number> = {
  forest: 22, pasture: 22, field: 20, hills: 18, mountain: 14, goldmine: 4,
};

/**
 * Build the island. Pass a seed to get a reproducible map — multiplayer relies
 * on this: the host mints a seed, hands it to every guest at join time, and all
 * browsers generate byte-identical geometry without any of it crossing the wire.
 */
export function generateMap(seed?: number): HexMap {
  const s0 = (seed ?? (Date.now() & 0x7fffffff)) >>> 0;
  const rnd = mulberry32(s0 ^ 0x9e37);
  const S = PLOT;

  // ── 1. Landmass = union of 3 randomly-fitted hexagons ──
  const hexes: Pt[][] = [];
  const ang0 = rnd() * Math.PI;
  for (let k = 0; k < 3; k++) {
    const R = S * (2.2 + rnd() * 0.8);
    const a = ang0 + (k * 2 * Math.PI) / 3 + (rnd() - 0.5) * 0.7;
    const dist = S * (1.2 + rnd() * 0.7);
    const cx = Math.cos(a) * dist, cy = Math.sin(a) * dist;
    const rot = rnd() * Math.PI;
    const hex: Pt[] = [];
    for (let i = 0; i < 6; i++) {
      const t = rot + (i * Math.PI) / 3;
      hex.push([cx + Math.cos(t) * R, cy + Math.sin(t) * R]);
    }
    hexes.push(hex);
  }
  const inLand = (x: number, y: number) => hexes.some((h) => pointInConvex(h, x, y));

  // union bbox
  let uMinX = Infinity, uMinY = Infinity, uMaxX = -Infinity, uMaxY = -Infinity;
  for (const h of hexes) for (const p of h) {
    uMinX = Math.min(uMinX, p[0]); uMinY = Math.min(uMinY, p[1]);
    uMaxX = Math.max(uMaxX, p[0]); uMaxY = Math.max(uMaxY, p[1]);
  }
  const margin = S * 0.55;
  const bbox = { minX: uMinX - margin, minY: uMinY - margin, maxX: uMaxX + margin, maxY: uMaxY + margin };

  // ── 2. Voronoi seed sites (jittered grid over bbox) ──
  const spacing = S * 0.8;
  const jit = spacing * 0.36;
  const sites: { x: number; y: number }[] = [];
  for (let y = bbox.minY; y <= bbox.maxY; y += spacing)
    for (let x = bbox.minX; x <= bbox.maxX; x += spacing)
      sites.push({ x: x + (rnd() - 0.5) * jit, y: y + (rnd() - 0.5) * jit });

  const cellOf = (si: number): Pt[] => {
    let poly: Pt[] = [
      [bbox.minX, bbox.minY], [bbox.maxX, bbox.minY],
      [bbox.maxX, bbox.maxY], [bbox.minX, bbox.maxY],
    ];
    const s = sites[si];
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === si) continue;
      const o = sites[j];
      const dx = o.x - s.x, dy = o.y - s.y;
      poly = clipHalf(poly, (o.x + s.x) / 2, (o.y + s.y) / 2, dx, dy);
    }
    return poly;
  };

  // ── 3. Lloyd relaxation for pleasant, blobby cells ──
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < sites.length; i++) {
      const poly = cellOf(i);
      if (poly.length >= 3) { const c = polyCentroid(poly); sites[i].x = c[0]; sites[i].y = c[1]; }
    }
  }

  // ── 4. Build the graph from LAND cells only ──
  const verts: Vertex[] = [];
  const edges: Edge[] = [];
  const tiles: Tile[] = [];
  const vmap = new Map<string, number>();
  const emap = new Map<string, number>();
  const vkey = (x: number, y: number) => `${Math.round(x / 7)},${Math.round(y / 7)}`;
  const getVert = (x: number, y: number) => {
    const k = vkey(x, y);
    if (vmap.has(k)) return vmap.get(k)!;
    const id = verts.length;
    verts.push({ i: id, x, y, tiles: [], edges: [], building: null, owner: -1, buildable: false });
    vmap.set(k, id);
    return id;
  };
  const getEdge = (a: number, b: number, tileId: number) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    let id = emap.get(k);
    if (id === undefined) {
      const va = verts[a], vb = verts[b];
      id = edges.length;
      edges.push({ i: id, a, b, x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, owner: -1, tiles: [], rail: false, wob: [] });
      emap.set(k, id);
      if (!va.edges.includes(id)) va.edges.push(id);
      if (!vb.edges.includes(id)) vb.edges.push(id);
    }
    if (!edges[id].tiles.includes(tileId)) edges[id].tiles.push(tileId);
    return id;
  };

  for (let i = 0; i < sites.length; i++) {
    if (!inLand(sites[i].x, sites[i].y)) continue;      // water cell → skip (forms coast)
    const poly = cellOf(i);
    if (poly.length < 3) continue;
    const area = polyArea(poly);
    if (area < 3000) continue;                           // sliver → drop
    const tileId = tiles.length;
    const corners = poly.map((p) => getVert(p[0], p[1]));
    // dedupe consecutive identical corner ids
    const clean: number[] = [];
    for (let c = 0; c < corners.length; c++) if (corners[c] !== clean[clean.length - 1]) clean.push(corners[c]);
    if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3) continue;
    const [cx, cy] = polyCentroid(poly);
    const t: Tile = { i: tileId, x: cx, y: cy, type: "field", verts: clean, edges: [], area, banditUntil: 0 };
    clean.forEach((v) => { if (!verts[v].tiles.includes(tileId)) verts[v].tiles.push(tileId); });
    for (let c = 0; c < clean.length; c++) {
      const e = getEdge(clean[c], clean[(c + 1) % clean.length], tileId);
      if (!t.edges.includes(e)) t.edges.push(e);
    }
    tiles.push(t);
  }

  // ── 5. Resource assignment (every region gets one; small ⇒ desert) ──
  const areas = tiles.map((t) => t.area).sort((a, b) => a - b);
  const AREA_MIN = areas.length ? areas[Math.floor(areas.length * 0.16)] * 0.9 : 12000;
  const bag: TileKey[] = [];
  RES_TYPES.forEach((k) => { for (let i = 0; i < RES_WEIGHT[k]; i++) bag.push(k); });
  for (const t of tiles) {
    if (t.area < AREA_MIN) { t.type = "desert"; continue; }
    t.type = bag[Math.floor(rnd() * bag.length)];
  }
  // guarantee variety: every resource present + at least 1 gold mine
  const bigs = tiles.filter((t) => t.area >= AREA_MIN);
  for (const need of RES_TYPES) {
    if (!bigs.some((t) => t.type === need)) {
      const cand = bigs.find((t) => t.type !== "goldmine");
      if (cand) cand.type = need;
    }
  }

  // ── 6. Flags: interior rails & buildable crossroads ──
  for (const e of edges) e.rail = e.tiles.length === 2;
  // A crossroad is where THREE regions meet (a genuine junction), and it must be
  // an interior node fed by at least two rails so it's reachable/buildable.
  for (const v of verts) {
    const railDeg = v.edges.reduce((s, e) => s + (edges[e].rail ? 1 : 0), 0);
    v.buildable = v.tiles.length >= 3 && railDeg >= 3;
  }

  // ── organic border wobble (shared per-edge so cells never gap) ──
  for (const e of edges) {
    const va = verts[e.a], vb = verts[e.b];
    const seg = 4;
    const dx = vb.x - va.x, dy = vb.y - va.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;         // unit perpendicular
    const amp = Math.min(len * 0.22, PLOT * 0.16);
    const er = mulberry32((e.a * 73856093) ^ (e.b * 19349663) ^ 0x2f6b);
    e.wob = [];
    for (let s = 1; s < seg; s++) {
      const t = s / seg;
      // taper displacement to zero at the shared endpoints
      const taper = Math.sin(t * Math.PI);
      const d = (er() - 0.5) * 2 * amp * taper;
      e.wob.push([va.x + dx * t + px * d, va.y + dy * t + py * d]);
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  tiles.forEach((t) => t.verts.forEach((vi) => {
    const v = verts[vi];
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
  }));

  return { tiles, verts, edges, bounds: { minX, minY, maxX, maxY } };
}

// ── graph queries ──
export function vertNeighbors(map: HexMap, vId: number): number[] {
  const v = map.verts[vId];
  return v.edges.map((e) => (map.edges[e].a === vId ? map.edges[e].b : map.edges[e].a));
}

export function reachable(map: HexMap, p: Player): Set<number> {
  const seen = new Set<number>();
  if (p.capital < 0 || !map.verts[p.capital]) return seen;
  seen.add(p.capital);
  const q = [p.capital];
  while (q.length) {
    const v = q.shift()!;
    for (const eid of map.verts[v].edges) {
      const e = map.edges[eid];
      const usable = e.owner === p.i || (e.owner >= 0 && p.tollAccess.has(e.owner));
      if (!usable) continue;
      const o = e.a === v ? e.b : e.a;
      if (!seen.has(o)) { seen.add(o); q.push(o); }
    }
  }
  return seen;
}

export function canBuildSettlement(map: HexMap, p: Player, vId: number, setup: boolean): boolean {
  const v = map.verts[vId];
  if (!v || v.building || !v.buildable) return false;
  for (const n of vertNeighbors(map, vId)) if (map.verts[n].building) return false;
  if (setup) return true;
  return reachable(map, p).has(vId);
}

export function canBuildRoad(map: HexMap, p: Player, eId: number): boolean {
  const e = map.edges[eId];
  if (!e || e.owner !== -1 || !e.rail) return false;
  const R = reachable(map, p);
  return R.has(e.a) || R.has(e.b);
}

// Toll = pay to USE a rival's EXISTING rail. Valid when the clicked edge is
// owned by a rival, touches your reachable network, and you haven't already
// bought passage from that rival. Returns the rival owner index, else -1.
export function tollRoadOwner(map: HexMap, p: Player, eId: number): number {
  const e = map.edges[eId];
  if (!e || e.owner < 0 || e.owner === p.i) return -1;
  if (p.tollAccess.has(e.owner)) return -1;
  const R = reachable(map, p);
  if (!R.has(e.a) && !R.has(e.b)) return -1;   // must connect to your network
  return e.owner;
}

export function canBuildCity(map: HexMap, p: Player, vId: number): boolean {
  const v = map.verts[vId];
  return v.building === "settlement" && v.owner === p.i;
}

export function playerResources(map: HexMap, p: Player, now: number): Partial<Record<ResKey, number>> {
  const out: Partial<Record<ResKey, number>> = {};
  const add = (vId: number, tier: number) => {
    if (vId < 0 || !map.verts[vId]) return;
    for (const ti of map.verts[vId].tiles) {
      const tile = map.tiles[ti];
      if (!tile || tile.banditUntil > now) continue;
      const res = TILES[tile.type].res;
      if (!res) continue;
      out[res] = Math.max(out[res] ?? 0, tier);
    }
  };
  if (p.capital >= 0) add(p.capital, 1);
  p.settlements.forEach((v) => add(v, 1));
  p.cities.forEach((v) => add(v, 2));
  return out;
}

// ─────────────────────────────────────────────────────────────
// MapView — canvas camera / render / picking
// ─────────────────────────────────────────────────────────────

/** full wobbled outline of a tile in world (map) coords */
export function tileOutline(map: HexMap, t: Tile): Pt[] {
  const out: Pt[] = [];
  const n = t.verts.length;
  for (let i = 0; i < n; i++) {
    const a = t.verts[i], b = t.verts[(i + 1) % n];
    const va = map.verts[a];
    out.push([va.x, va.y]);
    const eid = va.edges.find((e) => {
      const e2 = map.edges[e];
      return (e2.a === a && e2.b === b) || (e2.a === b && e2.b === a);
    });
    if (eid !== undefined) {
      const e2 = map.edges[eid];
      if (e2.a === a) for (const p of e2.wob) out.push(p);
      else for (let k = e2.wob.length - 1; k >= 0; k--) out.push(e2.wob[k]);
    }
  }
  return out;
}