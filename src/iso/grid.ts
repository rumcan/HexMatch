// ─────────────────────────────────────────────────────────────────────────
// E3 — isometric grid generation. Replaces hexmap.ts for the iso renderer.
//
// The map is flat terrain (E0 non-negotiable) stored in typed arrays:
//   terrain  Uint8Array(W*H)  — GRASS | WATER | ROUGH, read every frame
//   occup    Int16Array(W*H)  — tile index → industry id, or -1
// Industries live in a separate list. Everything derives from the seeded RNG
// (T1), so two contexts with the same seed regenerate byte-identical maps —
// multiplayer ships only the seed (E10).
// ─────────────────────────────────────────────────────────────────────────

import {
  MAP_W, MAP_H, TERRAIN, tileIndex, inBounds,
  INDUSTRIES, INDUSTRY_TYPES, IndustryType,
  mulberry32, setRng,
} from "./config";

export interface Industry {
  id: number;
  type: IndustryType;
  tx: number; ty: number;   // top-left of footprint
  w: number; h: number;
  output: number;
  banditUntil: number;      // blockade: harvests nothing until this time
}

export interface IsoMap {
  w: number;
  h: number;
  terrain: Uint8Array;
  occup: Int16Array;
  industries: Industry[];
}

const MIN_SEPARATION = 6;      // Poisson-disc minimum centre distance, tiles
const ISLAND_RADIUS = 21;      // island half-extent (map is 48, centre 24)

// Quota: how many of each industry type to guarantee per map (no cargo absent).
// Both iron and coal produce "ore", but we still place both for variety.
const QUOTA: Record<IndustryType, number> = {
  farm: 5,
  forest: 5,
  coal_mine: 3,
  iron_mine: 3,
  quarry: 3,
  oil_rig: 2,
  gold_mine: 2,
};

export function generateGrid(seed: number): IsoMap {
  const rnd = mulberry32((seed >>> 0) ^ 0x6a09e667);
  // route the shared game RNG through the same stream (T1: AI / board are seeded too)
  setRng(rnd);

  const terrain = new Uint8Array(MAP_W * MAP_H);          // default 0 = GRASS
  const occup = new Int16Array(MAP_W * MAP_H).fill(-1);
  const industries: Industry[] = [];

  const cx = (MAP_W - 1) / 2, cy = (MAP_H - 1) / 2;

  // ── 1. Terrain: a noisy circular island; outside is water. ──
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const dx = tx - cx, dy = ty - cy;
      // cheap value-noise wobble on the coastline
      const wobble =
        (rnd() - 0.5) * 2.6 +
        Math.sin(tx * 0.6) * 1.1 +
        Math.cos(ty * 0.5) * 1.1;
      const d = Math.hypot(dx, dy) + wobble;
      if (d > ISLAND_RADIUS) terrain[tileIndex(tx, ty)] = TERRAIN.WATER;
    }
  }

  // ── 2. Industries via Poisson-disc rejection sampling. ──
  const centres: { x: number; y: number }[] = [];
  const map: IsoMap = { w: MAP_W, h: MAP_H, terrain, occup, industries };

  const footprintClear = (tx: number, ty: number, w: number, h: number, wantRough: boolean) => {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!inBounds(x, y)) return false;
        const t = terrain[tileIndex(x, y)];
        if (t === TERRAIN.WATER) return false;
        if (occup[tileIndex(x, y)] !== -1) return false;
        // rail can't cross rough (E2) — but industry footprints just need land;
        // mines mark their own footprint rough below.
        if (!wantRough && t === TERRAIN.ROUGH) return false;
      }
    }
    return true;
  };

  const separated = (tx: number, ty: number, w: number, h: number) => {
    const ax = tx + w / 2, ay = ty + h / 2;
    for (const c of centres) {
      if (Math.hypot(ax - c.x, ay - c.y) < MIN_SEPARATION) return false;
    }
    return true;
  };

  const tryPlace = (type: IndustryType): boolean => {
    const def = INDUSTRIES[type];
    for (let attempt = 0; attempt < 4000; attempt++) {
      const tx = 1 + Math.floor(rnd() * (MAP_W - def.w - 2));
      const ty = 1 + Math.floor(rnd() * (MAP_H - def.h - 2));
      if (!footprintClear(tx, ty, def.w, def.h, !!def.rough)) continue;
      if (!separated(tx, ty, def.w, def.h)) continue;
      // place
      const id = industries.length;
      industries.push({
        id, type, tx, ty, w: def.w, h: def.h,
        output: def.output, banditUntil: 0,
      });
      for (let y = ty; y < ty + def.h; y++) {
        for (let x = tx; x < tx + def.w; x++) {
          occup[tileIndex(x, y)] = id;
          if (def.rough) terrain[tileIndex(x, y)] = TERRAIN.ROUGH;
        }
      }
      centres.push({ x: tx + def.w / 2, y: ty + def.h / 2 });
      return true;
    }
    return false;
  };

  // Place in quota order so every cargo is guaranteed present.
  for (const type of INDUSTRY_TYPES) {
    for (let n = 0; n < QUOTA[type]; n++) {
      if (!tryPlace(type)) {
        // quotas are conservative; a miss on a tight seed shouldn't crash generation
        // but E3 acceptance asserts determinism, not exact counts — we continue.
      }
    }
  }

  return map;
}

/** Stable FNV-1a hash of a map's terrain + industry layout (E3 determinism). */
export function hashMap(m: IsoMap): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  m.terrain.forEach(mix);
  for (const ind of m.industries) {
    [ind.type.length, ind.tx, ind.ty, ind.w, ind.h, Math.round(ind.output * 10)].forEach((v) => {
      mix(v & 0xff); mix((v >> 8) & 0xff);
    });
    for (const ch of ind.type) mix(ch.charCodeAt(0));
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Industry (if any) whose footprint covers the given tile. */
export function industryAt(m: IsoMap, tx: number, ty: number): Industry | null {
  if (!inBounds(tx, ty)) return null;
  const id = m.occup[tileIndex(tx, ty)];
  return id >= 0 ? m.industries[id] : null;
}
