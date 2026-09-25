// ══════════════════════════════════════════════════════════════════════════
// M1 (#254) — the in-game minimap.
//
// A small canvas over the map's lower-left corner on desktop, behind a fab on
// phones (the HUD in src/game/ui.ts owns that mount and the toggle; this
// module owns everything inside it). It shows the WHOLE island at once:
// terrain, towns, industries — in their holder's colour once claimed — both
// players' roads, rail and platforms, and the camera's viewport rectangle.
// Click or tap → the main view centres there; drag (the rectangle, or from
// anywhere) → the view follows the pointer.
//
// ── three layers, each redrawn only when its own input changes ──────────
//   terrain  once per MAP: one colour per tile, from the ground palette
//            sampled out of assets/ground (#343 — see MINIMAP_PALETTE).
//   network  per `netVersion` / `rail.revision` (game.ts bumps netVersion on
//            every build, demolish, claim and conquest): towns, fields,
//            roads, rail, industries, plants, depots and platforms painted
//            over a copy of the terrain into a 144×144 image — one pixel per
//            tile, O(tiles), well under a millisecond.
//   view     per camera or marker change: the visible canvas is recomposed —
//            that image drawn through ONE affine transform (tile space → the
//            iso diamond, the same projection as `tileToScreen`), then the
//            viewport rectangle, then the markers.
// A pan therefore costs one transformed drawImage of a 144² image plus two
// strokeRects per frame the camera actually moved; a still frame costs a key
// compare. Hidden (the phone default, the Build/Economy sheets) it costs
// nothing at all: the canvas measures 0×0 and `frame` returns at once. The
// canvas itself is only made the first time the plate is laid out (a
// ResizeObserver report, never a per-frame layout read), so a plate that
// never shows — a phone that never opens it, a headless test harness —
// never costs a canvas or a context.
//
// ── spaces ───────────────────────────────────────────────────────────────
// Minimap space is CSS px inside the canvas. World space is camera.ts's 1×
// iso projection. The island's world bounds (`mapWorldBounds`, 2:1) are
// fitted into the canvas: mx = ox + wx·s, my = oy + wy·s. Every spatial rule
// is a pure function below, pinned in tests/unit/iso-minimap.test.ts.
//
// ── markers: the hook #256 hangs sabotage events on ─────────────────────
//   minimap.setMarkers([{ id: "protest:3", tx, ty, color, progress: 0.4,
//                         kind: "protest", label: "Protest — 0:42" }]);
//   minimap.onMarker = (m) => openEventWindow(m);  // a click/tap on one
//   minimap.goTo(m.tx, m.ty);                      // the window's "Go there"
// The list is DATA, not a journal: hand over the live set every frame (or
// whenever it changes) and an event that ended simply is not in it — it is
// gone on the next frame. `progress` drives the countdown ring (1 = just
// begun, 0 = ending). Redraws are gated on a signature with the ring
// quantised to 1/RING_STEPS, so a per-frame `setMarkers` costs one string
// build unless a marker actually moved, changed colour or ticked its ring.
// With `onMarker` unset a press on a marker pans like any other press.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, MAP_W, MAP_H, tileToScreen } from "../game/config";
import { type Camera, centerOnWorld, mapWorldBounds, screenToWorld } from "./camera";
import { GRASS, ROUGH, SAND, WATER, type Grid } from "./grid";
import { FACTORY_FOOTPRINT } from "./config";
import { PUBLIC_OWNER, plantFootprintTiles, type Track } from "./track";
import { depotTiles } from "./depot";
import { industryLocks, isRailDepot, type EconomyState } from "./economy";
import { footprintTiles, type RailState } from "./rail";
import { FIELD_SIZE, FOREST_FOOTPRINT } from "./scenery";

// ── palette ───────────────────────────────────────────────────────────────
/**
 * The minimap's colours.
 *
 * GROUND is sampled from the shipped textures (#343 — the new sea and beach):
 * the linear-light mean of every opaque texel of `assets/ground/grass.png`,
 * `sand.png` and `water.png` (the `medium/` and `low/` tiers agree to the
 * last digit), so the plate reads as the same island the renderer paints —
 * checked against a live frame, which shows #3a4812 grass and #2f5e6e sea.
 * The coast carries the renderer's own shallows tint (`ground.ts`
 * SHALLOW_RGB) on its first ring of sea; ROUGH ground, which the renderer
 * paints as grass under rocky decals, leans toward the rocky decals' mean.
 *
 * THINGS ON THE GROUND follow the How-to-Play tour's mini-map vocabulary
 * (`tutorial.ts` — town, industry, dirt, road over the same ground kinds),
 * lifted a few steps so a feature still reads at one to three pixels a tile.
 * Anything a player owns wears that player's seat colour (`ownerColour`).
 */
export const MINIMAP_PALETTE = {
  grass: "#3c4814",
  sand: "#bea880",
  water: "#2e5c6c",
  shallows: "#97e1d6",
  shallowsMix: 0.24,
  rocky: "#584f2e",
  roughMix: 0.45,
  /** Forest blocks; a lone tree is half-way between this and the grass. */
  forest: "#243209",
  treeMix: 0.5,
  /** A Farm's wheat fields. */
  wheat: "#b99a45",
  town: "#d8c49c",
  industry: "#9c7444",
  /** Dirt nobody owns (a seat's own dirt is a shade of its colour). */
  dirt: "#8a7350",
  /** The highways and the towns' ring roads (`PUBLIC_OWNER`). */
  publicRoad: "#a8a291",
  /** A seat with no colour on record. */
  owner: "#d8d8d8",
  /** #322: what a closed plant or depot fades toward. */
  closed: "#5b5750",
  viewport: "#f2dca6",
  viewportShadow: "rgba(8, 5, 3, 0.7)",
} as const;
/** A palette of the same shape (colours as CSS strings, mixes as 0..1). */
export type MinimapPalette = {
  readonly [K in keyof typeof MINIMAP_PALETTE]: (typeof MINIMAP_PALETTE)[K] extends number ? number : string;
};

/** 0xRRGGBBAA, unsigned. */
export type Rgba = number;

export const rgba = (r: number, g: number, b: number, a = 255): Rgba =>
  (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → Rgba; anything else → null. */
export function parseColour(css: string | null | undefined): Rgba | null {
  if (!css) return null;
  const s = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return rgba(r, g, b);
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return rgba(n >> 16, (n >> 8) & 255, n & 255);
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return rgba(+m[1], +m[2], +m[3]);
  return null;
}

/** Straight blend: t = 0 is `a`, t = 1 is `b` (opaque result). */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  const ch = (c: Rgba, k: number) => (c >>> k) & 255;
  const lerp = (k: number) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * t);
  return rgba(lerp(24), lerp(16), lerp(8));
}

const WHITE = rgba(255, 255, 255);
const BLACK = rgba(0, 0, 0);
const hex = (c: string): Rgba => parseColour(c) ?? rgba(255, 0, 255);

/**
 * The shades one seat colour takes on the plate. Paved road is the colour
 * itself, its Dirt a darker shade; rail runs lighter so a line reads apart
 * from a road beside it; buildings are lighter still and platforms nearly
 * white — the stations along a line.
 */
export interface OwnerShades { road: Rgba; dirt: Rgba; rail: Rgba; site: Rgba; station: Rgba }
export function ownerShades(base: Rgba): OwnerShades {
  return {
    road: base,
    dirt: mixRgba(base, BLACK, 0.35),
    rail: mixRgba(base, WHITE, 0.45),
    site: mixRgba(base, WHITE, 0.2),
    station: mixRgba(base, WHITE, 0.7),
  };
}

// ── pure geometry ─────────────────────────────────────────────────────────
/** Breathing room between the island's tips and the canvas edge, CSS px. */
export const MINIMAP_PAD = 3;

/** CSS-px size of the canvas and the world → minimap fit (`s` > 0 when drawable). */
export interface MinimapLayout { w: number; h: number; s: number; ox: number; oy: number }

/** Fit the whole island (its 2:1 world bounds) into a `w`×`h` canvas, centred. */
export function minimapLayout(w: number, h: number, pad = MINIMAP_PAD): MinimapLayout {
  const b = mapWorldBounds();
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  const s = Math.max(0, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
  return { w, h, s, ox: (w - bw * s) / 2 - b.minX * s, oy: (h - bh * s) / 2 - b.minY * s };
}

export const worldToMinimap = (l: MinimapLayout, wx: number, wy: number): [number, number] =>
  [l.ox + wx * l.s, l.oy + wy * l.s];

export const minimapToWorld = (l: MinimapLayout, mx: number, my: number): [number, number] =>
  [(mx - l.ox) / l.s, (my - l.oy) / l.s];

/**
 * Tile coordinates → minimap point. Like `tileToScreen` this is the TOP vertex
 * of tile (tx,ty); pass `tx + 0.5, ty + 0.5` for a tile's middle.
 */
export function tileToMinimap(l: MinimapLayout, tx: number, ty: number): [number, number] {
  const [wx, wy] = tileToScreen(tx, ty);
  return worldToMinimap(l, wx, wy);
}

/** Minimap point → FRACTIONAL tile coordinates (floor them for the tile). */
export function minimapToTile(l: MinimapLayout, mx: number, my: number): [number, number] {
  const [wx, wy] = minimapToWorld(l, mx, my);
  return [(wx / HW + wy / HH) / 2, (wy / HH - wx / HW) / 2];
}

/**
 * The canvas transform that draws the one-pixel-per-tile image as the iso
 * diamond: image point (u, v) → backing px `bs · tileToMinimap(u, v)`. It is
 * `tileToScreen` (linear) composed with the minimap fit, as the six numbers
 * `setTransform(a, b, c, d, e, f)` takes.
 */
export function tileImageTransform(l: MinimapLayout, bs: number): [number, number, number, number, number, number] {
  const k = l.s * bs;
  return [HW * k, HH * k, -HW * k, HH * k, l.ox * bs, l.oy * bs];
}

export interface MinimapRect { x: number; y: number; w: number; h: number }

/** The main canvas' view, as a rectangle on the minimap. */
export function viewportRect(l: MinimapLayout, cam: Camera): MinimapRect {
  const [x0, y0] = screenToWorld(cam, 0, 0);
  const [x1, y1] = screenToWorld(cam, cam.vw, cam.vh);
  const [x, y] = worldToMinimap(l, x0, y0);
  return { x, y, w: (x1 - x0) * l.s, h: (y1 - y0) * l.s };
}

export const rectContains = (r: MinimapRect, mx: number, my: number, slop = 0): boolean =>
  mx >= r.x - slop && mx <= r.x + r.w + slop && my >= r.y - slop && my <= r.y + r.h + slop;

/** The camera that centres the main view on minimap point (mx, my) — clamped. */
export function cameraAt(cam: Camera, l: MinimapLayout, mx: number, my: number): Camera {
  const [wx, wy] = minimapToWorld(l, mx, my);
  return centerOnWorld(cam, wx, wy);
}

/** "Go there": the camera centred on the MIDDLE of tile (tx,ty) — clamped. */
export function cameraOnTile(cam: Camera, tx: number, ty: number): Camera {
  const [wx, wy] = tileToScreen(tx + 0.5, ty + 0.5);
  return centerOnWorld(cam, wx, wy);
}

// ── markers (#256) ────────────────────────────────────────────────────────
/**
 * One event pinned to the plate. #256's sabotage (a Blockade on an industry,
 * a Protest on a tile) arrives as these; the minimap draws and hit-tests
 * them and hands a clicked one back through `onMarker`.
 */
export interface MinimapMarker {
  /** Stable key (`"blockade:12"`, `"protest:3"`): the same event keeps its id. */
  id: string;
  /** The tile the event sits on; the marker is drawn at the tile's middle. */
  tx: number;
  ty: number;
  /** Dot and ring colour — normally the owner's seat colour. */
  color: string;
  /** Countdown ring: the share of the event's time still to run, 0..1. Omit for a plain dot. */
  progress?: number;
  /** What the event is ("blockade", "protest") — handed back on a click, not drawn. */
  kind?: string;
  /** Human name for the event (e.g. the event window's title). */
  label?: string;
}

/** Ring resolution: a marker's ring redraws at most this many times per event. */
export const RING_STEPS = 48;
/** Hit radius around a marker's middle, CSS px, per pointer kind. */
export const MARKER_HIT_MOUSE = 7;
export const MARKER_HIT_TOUCH = 12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The nearest marker within `radius` CSS px of (mx, my), or null. */
export function markerAt(
  l: MinimapLayout, markers: readonly MinimapMarker[], mx: number, my: number, radius: number,
): MinimapMarker | null {
  let best: MinimapMarker | null = null;
  let bestD = radius * radius;
  for (const m of markers) {
    const [x, y] = tileToMinimap(l, m.tx + 0.5, m.ty + 0.5);
    const d = (x - mx) * (x - mx) + (y - my) * (y - my);
    if (d <= bestD) { bestD = d; best = m; }
  }
  return best;
}

/** Everything about a marker set that changes a pixel — the view gate's key. */
export function markersKey(markers: readonly MinimapMarker[]): string {
  let k = "";
  for (const m of markers) {
    const ring = m.progress === undefined ? "-" : String(Math.round(clamp01(m.progress) * RING_STEPS));
    k += `${m.id}@${m.tx},${m.ty}:${m.color}:${ring}|`;
  }
  return k;
}

// ── pointer rules ─────────────────────────────────────────────────────────
export type MinimapPress =
  | { kind: "marker"; marker: MinimapMarker }
  /** `grab` = pointer minus the view's centre, kept for the drag; `camera`
   *  is the view to commit now (the SAME object when nothing moves). */
  | { kind: "pan"; grab: [number, number]; camera: Camera };

/**
 * What a press at (mx, my) does. A marker under the pointer opens it (when
 * the game listens — pass `markers: null` otherwise). Any other press grabs
 * the view: inside the viewport rectangle the rectangle stays put and keeps
 * its offset to the pointer (dragging it pans without a jump); anywhere else
 * the view jumps to centre on the pointer and the drag carries on from there.
 */
export function pressAt(
  l: MinimapLayout, cam: Camera, mx: number, my: number,
  markers: readonly MinimapMarker[] | null, hitRadius: number,
): MinimapPress {
  if (markers && markers.length > 0) {
    const m = markerAt(l, markers, mx, my, hitRadius);
    if (m) return { kind: "marker", marker: m };
  }
  const r = viewportRect(l, cam);
  if (rectContains(r, mx, my)) {
    return { kind: "pan", grab: [mx - (r.x + r.w / 2), my - (r.y + r.h / 2)], camera: cam };
  }
  return { kind: "pan", grab: [0, 0], camera: cameraAt(cam, l, mx, my) };
}

/** Where a drag holding the view by `grab` puts the camera. */
export const dragTo = (
  l: MinimapLayout, cam: Camera, mx: number, my: number, grab: readonly [number, number],
): Camera => cameraAt(cam, l, mx - grab[0], my - grab[1]);

// ── redraw gating ─────────────────────────────────────────────────────────
/** One frame's inputs, reduced to what each layer depends on. */
export interface MinimapKeys {
  /** Terrain: the map itself (object identity — a new map is a new object). */
  map: object;
  /** Network: `networkKey(netVersion, railRevision)`. */
  net: string;
  /** View: `viewKey(camera, canvas size, markers)`. */
  view: string;
}
export interface MinimapDirty { terrain: boolean; network: boolean; view: boolean }

export const networkKey = (netVersion: number, railRevision: number): string =>
  `${netVersion}|${railRevision}`;

/** `size` is anything that changes when the canvas' box or backing store does. */
export const viewKey = (cam: Camera, size: string, markers: string): string =>
  `${cam.x},${cam.y},${cam.zoom},${cam.vw},${cam.vh}|${size}|${markers}`;

/**
 * The redraw gate. `next` says which layers these keys dirty and records them
 * as drawn: a new map redraws everything, a network change redraws the
 * network and the view, a camera/size/marker change only the view, and the
 * same keys twice redraw nothing.
 */
export function createRedrawGate(): {
  next(k: MinimapKeys): MinimapDirty;
  invalidate(): void;
} {
  let map: object | null = null;
  let net: string | null = null;
  let view: string | null = null;
  return {
    next(k) {
      const terrain = k.map !== map;
      const network = terrain || k.net !== net;
      const v = network || k.view !== view;
      map = k.map; net = k.net; view = k.view;
      return { terrain, network, view: v };
    },
    invalidate() { map = null; net = null; view = null; },
  };
}

// ── the tile image ────────────────────────────────────────────────────────
/** What the terrain layer is painted from — static for the whole game. */
export interface MinimapGround {
  terrain: Uint8Array;
  /** Per tile: non-zero = a single tree (`Scenery.trees`). */
  trees?: Uint8Array | null;
  /** The 4×4 forest blocks, at their footprint origins (`Scenery.forests`). */
  forests?: readonly { tx: number; ty: number }[] | null;
}

/** Per-tile terrain colours: `full` with the woods, `ground` without them. */
export interface MinimapTerrain { ground: Uint32Array; full: Uint32Array }

const inMap = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;

export function terrainColours(g: MinimapGround, pal: MinimapPalette = MINIMAP_PALETTE): MinimapTerrain {
  const n = MAP_W * MAP_H;
  const grass = hex(pal.grass), sand = hex(pal.sand), water = hex(pal.water);
  const shallows = mixRgba(water, hex(pal.shallows), pal.shallowsMix);
  const rough = mixRgba(grass, hex(pal.rocky), pal.roughMix);
  const forest = hex(pal.forest);
  const ground = new Uint32Array(n);
  const t = g.terrain;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const i = ty * MAP_W + tx;
      const k = t[i];
      if (k === WATER) {
        // The first ring of sea off any shore is the lit shallows.
        const coast = (tx > 0 && t[i - 1] !== WATER) || (tx < MAP_W - 1 && t[i + 1] !== WATER)
          || (ty > 0 && t[i - MAP_W] !== WATER) || (ty < MAP_H - 1 && t[i + MAP_W] !== WATER);
        ground[i] = coast ? shallows : water;
      } else if (k === SAND) ground[i] = sand;
      else if (k === ROUGH) ground[i] = rough;
      else ground[i] = grass;   // GRASS, and any kind this palette does not know
    }
  }
  const full = ground.slice();
  const wooded = (i: number) => t[i] === GRASS || t[i] === ROUGH;
  if (g.trees) {
    for (let i = 0; i < n; i++) if (g.trees[i] && wooded(i)) full[i] = mixRgba(ground[i], forest, pal.treeMix);
  }
  for (const f of g.forests ?? []) {
    for (let y = f.ty; y < f.ty + FOREST_FOOTPRINT; y++) {
      for (let x = f.tx; x < f.tx + FOREST_FOOTPRINT; x++) {
        if (inMap(x, y) && wooded(y * MAP_W + x)) full[y * MAP_W + x] = forest;
      }
    }
  }
  return { ground, full };
}

/** One building-sized thing on the plate. */
export interface MinimapSite {
  kind: "industry" | "plant" | "depot" | "platform" | "raildepot";
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** Seat owner id (1, 2 …); 0 = nobody (an industry no Depot holds). */
  owner: number;
  /** #322: closed by a lost fight — drawn faded. */
  closed?: boolean;
}

/** Everything the network layer paints, as plain data (`minimapSceneOf`). */
export interface MinimapScene {
  track: Pick<Track, "dirt" | "road" | "owner">;
  /** The rail layer as the renderer reads it (`railDrawLayer`: lanes folded in). */
  rail?: { tile?: Uint8Array; owner?: Uint8Array } | null;
  towns: readonly { houses: readonly (readonly [number, number])[] }[];
  /** Painted in order — later sites win a shared tile. */
  sites: readonly MinimapSite[];
  /** 2×2 field blocks (`world.fields`, cleared ones already left out). */
  fields?: readonly { tx: number; ty: number; sprite: string }[] | null;
  /** Tiles whose trees the renderer hides under something built (`world.sceneryBlocked`). */
  cleared?: ReadonlySet<number> | null;
}

/**
 * The network layer's colours: `scene` painted over the terrain. Order is
 * the draw order on the ground — fields, towns, roads, rail, then the sites
 * (industries, plants, depots, platforms). Writes into `out` when given.
 */
export function paintNetwork(
  terrain: MinimapTerrain,
  scene: MinimapScene,
  ownerRgb: (ownerId: number) => Rgba,
  pal: MinimapPalette = MINIMAP_PALETTE,
  out: Uint32Array = new Uint32Array(MAP_W * MAP_H),
): Uint32Array {
  out.set(terrain.full);
  if (scene.cleared) for (const i of scene.cleared) if (i >= 0 && i < out.length) out[i] = terrain.ground[i];

  const shades = new Map<number, OwnerShades>();
  const shadeOf = (owner: number): OwnerShades => {
    let s = shades.get(owner);
    if (!s) { s = ownerShades(ownerRgb(owner)); shades.set(owner, s); }
    return s;
  };
  const fill = (tx: number, ty: number, w: number, h: number, c: Rgba) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (inMap(x, y)) out[y * MAP_W + x] = c;
  };

  const wheat = hex(pal.wheat), forest = hex(pal.forest);
  for (const f of scene.fields ?? []) fill(f.tx, f.ty, FIELD_SIZE, FIELD_SIZE, f.sprite === "wheat_field" ? wheat : forest);

  const town = hex(pal.town);
  for (const t of scene.towns) for (const [x, y] of t.houses) if (inMap(x, y)) out[y * MAP_W + x] = town;

  const publicRoad = hex(pal.publicRoad), dirt = hex(pal.dirt);
  const { road: roadMask, dirt: dirtMask, owner: trackOwner } = scene.track;
  for (let i = 0; i < out.length; i++) {
    const road = roadMask[i] !== 0;
    if (!road && dirtMask[i] === 0) continue;
    const o = trackOwner[i];
    const seat = o !== 0 && o !== PUBLIC_OWNER;
    if (road) out[i] = seat ? shadeOf(o).road : publicRoad;
    else out[i] = seat ? shadeOf(o).dirt : dirt;
  }

  const railTile = scene.rail?.tile, railOwner = scene.rail?.owner;
  if (railTile && railOwner) {
    for (let i = 0; i < out.length; i++) {
      if (railTile[i] !== 0) out[i] = railOwner[i] ? shadeOf(railOwner[i]).rail : dirt;
    }
  }

  const industry = hex(pal.industry), closed = hex(pal.closed);
  for (const s of scene.sites) {
    let c: Rgba;
    if (s.kind === "industry") c = s.owner ? shadeOf(s.owner).road : industry;
    else if (s.kind === "platform") c = shadeOf(s.owner).station;
    else c = shadeOf(s.owner).site;
    if (s.closed) c = mixRgba(c, closed, 0.6);
    fill(s.tx, s.ty, s.w, s.h, c);
  }
  return out;
}

/** The live game state the scene is read from (all references, no copies). */
export interface MinimapWorld {
  grid: Pick<Grid, "towns" | "industries" | "factoryFootprint">;
  track: Track;
  /** Harvesters (Depots), factories (plants) and — for claims — the railway. */
  eco: EconomyState;
  /** Rail structures (platforms, train depots). */
  rail: Pick<RailState, "structures">;
  /** `world.rail` — the renderer's rail layer, lanes folded in. */
  drawRail?: { tile?: Uint8Array; owner?: Uint8Array } | null;
  /** `world.fields`. */
  fields?: readonly { tx: number; ty: number; sprite: string }[] | null;
  /** `world.sceneryBlocked`. */
  cleared?: ReadonlySet<number> | null;
}

/**
 * Read the scene off the live game. Run only when the network key moves; the
 * one non-trivial read is `industryLocks` — the same "who holds this
 * industry" the inspector and the economy use (a battle conquest included).
 */
export function minimapSceneOf(w: MinimapWorld): MinimapScene {
  const locks = industryLocks(w.eco);
  const sites: MinimapSite[] = [];
  for (const ind of w.grid.industries) {
    sites.push({ kind: "industry", tx: ind.tx, ty: ind.ty, w: ind.w, h: ind.h, owner: locks.get(ind.id)?.ownerId ?? 0 });
  }
  const box = (tiles: [number, number][]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of tiles) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { tx: x0, ty: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  // F4 (#275): the map's Factory span, so the long shapes footprint boxes
  // correctly on the minimap (legacy maps keep the square box).
  const fp = w.grid.factoryFootprint ?? FACTORY_FOOTPRINT;
  for (const f of w.eco.factories) {
    sites.push({ kind: "plant", ...box(plantFootprintTiles(f.tx, f.ty, f.rot ?? 0, fp)), owner: f.ownerId, closed: !!f.closed });
  }
  // A platform-Depot is drawn as its platform (below), not as a truck lot.
  for (const h of w.eco.harvesters) {
    if (isRailDepot(h)) continue;
    sites.push({ kind: "depot", ...box(depotTiles(h.tx, h.ty)), owner: h.ownerId, closed: !!h.closed });
  }
  for (const s of w.rail.structures) {
    sites.push({ kind: s.kind === "platform" ? "platform" : "raildepot", ...box(footprintTiles(s)), owner: s.ownerId });
  }
  return {
    track: w.track,
    rail: w.drawRail ?? null,
    towns: w.grid.towns,
    sites,
    fields: w.fields ?? null,
    cleared: w.cleared ?? null,
  };
}

/** Per-tile colours → RGBA bytes (an ImageData's `data`). */
export function writeTileImage(colours: Uint32Array, data: Uint8ClampedArray): void {
  for (let i = 0, j = 0; i < colours.length && j + 3 < data.length; i++, j += 4) {
    const c = colours[i];
    data[j] = c >>> 24;
    data[j + 1] = (c >>> 16) & 255;
    data[j + 2] = (c >>> 8) & 255;
    data[j + 3] = c & 255;
  }
}

// ── the controller ────────────────────────────────────────────────────────
export interface MinimapOptions {
  /** The static ground (terrain kinds and woods). Its identity is the terrain key. */
  ground: MinimapGround;
  /** The live camera (read once per frame and per press). */
  camera(): Camera;
  /** THE camera write — game.ts `commitCamera`, so labels and floats follow. */
  commit(next: Camera): void;
  /** The network scene, read only when the network key moves. */
  scene(): MinimapScene;
  /** A seat's colour by owner id; absent/unparseable → the palette's `owner`. */
  ownerColour?(ownerId: number): string | null | undefined;
  palette?: MinimapPalette;
}

export interface MinimapStats {
  /** Redraw counts per layer — how "only when it changes" is checked. */
  terrain: number;
  network: number;
  view: number;
  /** Total milliseconds spent redrawing (frames that drew anything). */
  ms: number;
}

export interface Minimap {
  /**
   * The plate's canvas — null until the plate is first laid out. It is made
   * on the first ResizeObserver report of a real box, so a plate that never
   * shows (a phone that never opens it, a headless harness) never costs a
   * canvas, a context or a frame.
   */
  readonly canvas: HTMLCanvasElement | null;
  /** Once per animation frame, after the HUD paint. Cheap unless something changed. */
  frame(netVersion: number, railRevision: number): void;
  /** Replace the marker set (see the header). */
  setMarkers(list: readonly MinimapMarker[]): void;
  readonly markers: readonly MinimapMarker[];
  /** Set to receive marker clicks/taps; null = a press on a marker just pans. */
  onMarker: ((m: MinimapMarker) => void) | null;
  /** Centre the main view on a tile's middle (the "Go there" helper). */
  goTo(tx: number, ty: number): void;
  /** True while the plate is laid out on screen (0×0 = hidden). */
  readonly visible: boolean;
  readonly stats: Readonly<MinimapStats>;
  destroy(): void;
}

export function createMinimap(host: HTMLElement, opts: MinimapOptions): Minimap {
  const pal = opts.palette ?? MINIMAP_PALETTE;
  const doc = host.ownerDocument;
  const win = doc.defaultView;

  const stats: MinimapStats = { terrain: 0, network: 0, view: 0, ms: 0 };
  const gate = createRedrawGate();
  let markers: readonly MinimapMarker[] = [];
  let markerSig = "";
  let destroyed = false;
  let broken = false;

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let tiles: HTMLCanvasElement | null = null;
  let tctx: CanvasRenderingContext2D | null = null;
  let img: ImageData | null = null;
  let tilesReady = false;
  let terrain: MinimapTerrain | null = null;
  let netBuf: Uint32Array | null = null;
  let layout: MinimapLayout | null = null;
  let bs = 0;               // backing px per CSS px
  let cssW = 0, cssH = 0;   // the canvas' laid-out CSS box

  // ── sizing: observed, never polled ───────────────────────────────────────
  // One observer watches the plate (to mount the canvas the first time it is
  // laid out) and then the canvas (its box: 0×0 while the plate is folded).
  // Nothing here reads layout per frame.
  const ro = typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === host && !canvas && e.contentRect.width > 0) mount();
        else if (e.target === canvas) { cssW = e.contentRect.width; cssH = e.contentRect.height; }
      }
    })
    : null;
  // Without an observer (old engines): measure now and on window resizes.
  const remeasure = () => {
    if (!canvas && host.clientWidth > 0) mount();
    if (canvas) { cssW = canvas.clientWidth; cssH = canvas.clientHeight; }
  };
  if (ro) ro.observe(host);
  else { remeasure(); win?.addEventListener("resize", remeasure); }

  function mount(): void {
    if (canvas || destroyed) return;
    const c = doc.createElement("canvas");
    c.className = "minimap-canvas";
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", "Minimap of the island — click or drag to move the view");
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    c.addEventListener("pointercancel", onUp);
    c.addEventListener("lostpointercapture", onUp);
    c.addEventListener("pointerleave", onLeave);
    c.addEventListener("contextmenu", onContext);
    host.appendChild(c);
    canvas = c;
    if (ro) ro.observe(c);
    else { cssW = c.clientWidth; cssH = c.clientHeight; }
  }

  const drawable = () => !!canvas && cssW >= 16 && cssH >= 8;

  /** Backing store + layout for the current box; false when not drawable. */
  function ensureCanvas(c: HTMLCanvasElement): boolean {
    const dpr = (win && win.devicePixelRatio) || 1;
    // At least 2× even on a dpr-1 screen: a road is a tile wide, and a tile
    // here is ~1.5 CSS px — supersampled, the browser's downscale keeps the
    // line instead of dropping every other tile.
    const nbs = Math.min(3, Math.max(2, Math.ceil(dpr)));
    const bw = Math.round(cssW * nbs), bh = Math.round(cssH * nbs);
    if (bw !== c.width || bh !== c.height || nbs !== bs || !layout || layout.w !== cssW || layout.h !== cssH) {
      c.width = bw;
      c.height = bh;
      bs = nbs;
      layout = minimapLayout(cssW, cssH);
    }
    if (!ctx) ctx = c.getContext("2d");
    if (!tiles) {
      tiles = doc.createElement("canvas");
      tiles.width = MAP_W;
      tiles.height = MAP_H;
      tctx = tiles.getContext("2d");
      const made = tctx && typeof tctx.createImageData === "function" ? tctx.createImageData(MAP_W, MAP_H) : null;
      img = made && made.data ? made : null;
    }
    return !!ctx && layout.s > 0;
  }

  const ownerCache = new Map<number, Rgba>();
  const ownerRgb = (id: number): Rgba => {
    let c = ownerCache.get(id);
    if (c === undefined) {
      c = parseColour(opts.ownerColour?.(id)) ?? hex(pal.owner);
      ownerCache.set(id, c);
    }
    return c;
  };

  function paintNet(): void {
    if (!terrain) return;
    ownerCache.clear();
    netBuf = paintNetwork(terrain, opts.scene(), ownerRgb, pal, netBuf ?? undefined);
    if (img && tctx) {
      writeTileImage(netBuf, img.data);
      tctx.putImageData(img, 0, 0);
      tilesReady = true;
    }
    stats.network++;
  }

  function drawMarker(g: CanvasRenderingContext2D, l: MinimapLayout, m: MinimapMarker): void {
    const [x, y] = tileToMinimap(l, m.tx + 0.5, m.ty + 0.5);
    g.beginPath();
    g.arc(x, y, 5.6, 0, Math.PI * 2);
    g.fillStyle = "rgba(8, 5, 3, 0.78)";
    g.fill();
    if (m.progress !== undefined) {
      const p = clamp01(m.progress);
      g.beginPath();
      g.arc(x, y, 4.3, 0, Math.PI * 2);
      g.strokeStyle = "rgba(242, 220, 166, 0.22)";
      g.lineWidth = 1.5;
      g.stroke();
      if (p > 0) {
        g.beginPath();
        g.arc(x, y, 4.3, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        g.strokeStyle = m.color;
        g.stroke();
      }
    }
    g.beginPath();
    g.arc(x, y, 2.3, 0, Math.PI * 2);
    g.fillStyle = m.color;
    g.fill();
  }

  function drawView(c: HTMLCanvasElement, cam: Camera): void {
    const g = ctx, l = layout;
    if (!g || !l) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // The renderer floats the island in an endless sea, so the plate does
    // too: the corners past the diamond are ocean, seamless with the map's
    // own edge water — not a void the viewport rectangle hangs out into.
    g.fillStyle = pal.water;
    g.fillRect(0, 0, c.width, c.height);
    if (tilesReady && tiles) {
      // Tile space → the iso diamond: pixel (tx,ty) of the tile image lands
      // on tile (tx,ty)'s diamond, exactly as `tileToScreen` projects it.
      const [a, b, cc, d, e, f] = tileImageTransform(l, bs);
      g.imageSmoothingEnabled = false;
      g.setTransform(a, b, cc, d, e, f);
      g.drawImage(tiles, 0, 0);
    }
    g.setTransform(bs, 0, 0, bs, 0, 0);
    const r = viewportRect(l, cam);
    g.lineJoin = "miter";
    g.strokeStyle = pal.viewportShadow;
    g.lineWidth = 3;
    g.strokeRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = pal.viewport;
    g.lineWidth = 1.25;
    g.strokeRect(r.x, r.y, r.w, r.h);
    for (const m of markers) drawMarker(g, l, m);
    stats.view++;
  }

  const api: Minimap = {
    onMarker: null,
    get canvas() { return canvas; },
    get markers() { return markers; },
    get visible() { return drawable(); },
    get stats() { return stats; },
    frame(netVersion, railRevision) {
      const c = canvas;
      if (destroyed || broken || !c || !drawable()) return;
      const t0 = performance.now();
      try {
        if (!ensureCanvas(c)) return;
        const cam = opts.camera();
        const d = gate.next({
          map: opts.ground,
          net: networkKey(netVersion, railRevision),
          view: viewKey(cam, `${c.width}x${c.height}@${cssW}x${cssH}`, markerSig),
        });
        if (!d.view) return;
        if (d.terrain) { terrain = terrainColours(opts.ground, pal); stats.terrain++; }
        if (d.network) paintNet();
        drawView(c, cam);
        stats.ms += performance.now() - t0;
      } catch (err) {
        // A HUD nicety must never cost the map a frame: log once, stand down.
        broken = true;
        console.warn("[minimap] disabled after an error:", err);
      }
    },
    setMarkers(list) {
      markers = list.slice();
      markerSig = markersKey(markers);
    },
    goTo(tx, ty) {
      opts.commit(cameraOnTile(opts.camera(), tx, ty));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ro?.disconnect();
      if (!ro) win?.removeEventListener("resize", remeasure);
      if (canvas) {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("lostpointercapture", onUp);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("contextmenu", onContext);
        canvas.remove();
        canvas = null;
      }
    },
  };

  // ── pointer: click/tap jumps, drag pans, a marker opens ──────────────────
  let drag: { id: number; grab: [number, number] } | null = null;
  const local = (c: HTMLCanvasElement, e: PointerEvent): [number, number] => {
    const r = c.getBoundingClientRect();
    const kx = r.width > 0 ? cssW / r.width : 1, ky = r.height > 0 ? cssH / r.height : 1;
    return [(e.clientX - r.left) * kx, (e.clientY - r.top) * ky];
  };
  const commitIfMoved = (next: Camera) => {
    const cam = opts.camera();
    if (next.x !== cam.x || next.y !== cam.y || next.zoom !== cam.zoom) opts.commit(next);
  };
  function onDown(e: PointerEvent): void {
    const c = canvas;
    if (!c || !layout || layout.s <= 0 || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const [mx, my] = local(c, e);
    const hit = e.pointerType === "mouse" ? MARKER_HIT_MOUSE : MARKER_HIT_TOUCH;
    const press = pressAt(layout, opts.camera(), mx, my, api.onMarker ? markers : null, hit);
    if (press.kind === "marker") { api.onMarker?.(press.marker); return; }
    drag = { id: e.pointerId, grab: press.grab };
    try { c.setPointerCapture?.(e.pointerId); } catch { /* not an active pointer */ }
    c.classList.add("dragging");
    commitIfMoved(press.camera);
  }
  function onMove(e: PointerEvent): void {
    const c = canvas;
    if (!c || !layout || layout.s <= 0) return;
    const [mx, my] = local(c, e);
    if (drag && e.pointerId === drag.id) {
      e.preventDefault();
      commitIfMoved(dragTo(layout, opts.camera(), mx, my, drag.grab));
      return;
    }
    if (e.pointerType === "mouse" && !drag) {
      c.classList.toggle("grab", rectContains(viewportRect(layout, opts.camera()), mx, my));
    }
  }
  function onUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    canvas?.classList.remove("dragging");
    try { canvas?.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
  }
  function onLeave(): void { if (!drag) canvas?.classList.remove("grab"); }
  function onContext(e: Event): void { e.preventDefault(); }

  return api;
}
