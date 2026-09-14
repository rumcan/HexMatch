#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — the railway art set: locomotive, wagon, platform, depot.
//
// The Railways epic (#142) asks for four replaceable transparent PNG families,
// each in the game's four dimetric headings, each authored once at 2× and
// derived down to 1× and 0.5× by a quality kernel:
//
//   assets/railway/locomotive_{ne,se,sw,nw}@{0.5x,1x,2x}.png   (moving)
//   assets/railway/wagon_{ne,se,sw,nw}@{0.5x,1x,2x}.png        (moving)
//   assets/railway/platform_{ne,se,sw,nw}@{0.5x,1x,2x}.png     (2×3 / 3×2)
//   assets/railway/train-depot_{ne,se,sw,nw}@{0.5x,1x,2x}.png  (2×2)
//   assets/railway/manifest.json, README.md, LICENSES.md, contact-sheet.png
//
// WHY PROCEDURAL, AND WHY IN TILE SPACE. The epic forbids extracting Transport
// Fever assets, the PNML trees in `src/assets/sprites/pnml/` only DEFINE engines
// and wagons — the referenced train PNGs are not in the tree — and the one
// candidate sheet (`RevStatBuilding_DanMacK.png`) is a station, not a platform.
// So the art here is ORIGINAL, drawn by this script from a parametric model in
// TILE space and rasterised through the game's own dimetric projection:
//
//   screen(u, v, z) = ( (u − v)·HW·s , (u + v)·HH·s − z·s )
//
// `u` runs along the grid's SE axis, `v` along its SW axis, `z` is height in
// tiles, HW/HH are the half tile (32×16 at 1×) and `s` is the zoom being
// authored. The four "views" are not four drawings: each sprite family is ONE
// model whose basis is rotated a quarter turn in tile space, exactly the way
// the in-game sprite headings relate to each other. That is what makes the
// footprint, the rail ports and the four headings agree by construction
// instead of by four chances to make a mistake.
//
// ANCHORS. Two conventions, both already in the renderer (`depth.ts`):
//   * moving sprites (locomotive, wagon) — the anchor is the GROUND CONTACT
//     point, the centre of the fractional tile the vehicle stands on, which is
//     where `drawOriginMoving` lands it. The model is drawn around tile
//     (u,v) = (0,0), so the anchor is simply the canvas origin of that point.
//   * static structures (platform, depot) — the anchor is the SOUTH VERTEX of
//     the footprint's last tile, which is where `drawOrigin`'s default branch
//     lands every other structure in this game (industries, factories, depots,
//     town houses). The model is authored around the footprint's centre, so
//     the anchor is derived from the footprint rather than hand-placed, and
//     the art and its declared tiles cannot drift apart.
//
// SIZES. Everything snaps to multiples of 4 at 2× (and the anchors to even
// pixels), so `round(size · zoom)` is the REAL pixel size of every zoom file
// and the anchor scales exactly: 2× → 1× → 0.5× are 1/2 and 1/4 of the master
// with no cropping and no half-pixel drift.
//
// Usage:
//   node tools/make-railway-art.mjs              # all 16 sprites + docs
//   node tools/make-railway-art.mjs platform_se  # a subset (files only)
// Reads  nothing (the model IS the source)
// Writes assets/railway/**
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "assets", "railway");

// ── the game's projection, in tile units ───────────────────────────────────
const HW = 32, HH = 16;                       // half tile at 1× (TILE_W/2, TILE_H/2)
const TILE_W = HW * 2, TILE_H = HH * 2;
/**
 * Pixels of on-screen height per unit of model `z`, at 1×. One unit of z is
 * one TILE EDGE of vertical structure (64 px), which is the usual isometric
 * convention: a box 0.4 tall stands a comfortable 26 px at 1× — about the
 * lorry's own height — while the same number in TILE_H units would be a
 * quarter of that and read as a flat slab.
 */
const Z_UNIT = TILE_W;

/** The four ground headings, as tile-space unit vectors (track.ts's bits). */
export const VIEW_VECTOR = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };
/** Views whose lane runs along `u` — the 3×2 platform footprints. */
export const U_AXIS_VIEWS = ["se", "nw"];
export const VIEWS = ["ne", "se", "sw", "nw"];
export const SPRITE_KINDS = ["locomotive", "wagon", "platform", "train-depot"];

/** `[w, h]` footprint of one rotated platform, matching src/iso/rail.ts. */
export const PLATFORM_FOOTPRINT = { se: [3, 2], nw: [3, 2], ne: [2, 3], sw: [2, 3] };
/** Every structure here is 2×2 except the platform. */
export const DEPOT_FOOTPRINT = [2, 2];

/**
 * The 1950s industrial palette. Charcoal running gear and slate roofing, oxide
 * red and brick for the railway's own livery, brass fittings, cream lining and
 * a single warm lamp — the same key light (upper-left, warm) the lorries use,
 * so a train and a lorry standing side by side read as one world.
 */
export const PALETTE = {
  charcoal: "#2f3033",
  charcoalTop: "#41434a",
  charcoalDark: "#1c1d20",
  oxide: "#8f3f2b",
  oxideTop: "#a34c34",
  brick: "#7d4536",
  brickTop: "#8f5342",
  slate: "#3a3f45",
  slateTop: "#4a5057",
  steel: "#9aa0a6",
  steelTop: "#b9bec4",
  brass: "#c8a13a",
  brassTop: "#e0bc5c",
  cream: "#e9e3d2",
  concrete: "#b9b5a8",
  concreteTop: "#cdc9bc",
  ballast: "#6f6659",
  ballastTop: "#847a6b",
  sleeper: "#4a3d31",
  window: "#191d21",
  glass: "#2b333c",
  load: "#6a5f52",
  loadTop: "#84796a",
  shadow: "rgba(18,16,14,0.42)",
  ink: "rgba(16,14,12,0.55)",
  lamp: "#ffd98a",
};

// ── colour maths (facet shading) ───────────────────────────────────────────
const hex = (c) => {
  const s = c.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((x) => x + x).join("") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const unhex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
/** Mix `c` toward `to` by `t` (0..1) — the one shading operator this file needs. */
const mix = (c, to, t) => {
  const a = hex(c), b = hex(to);
  return unhex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
};
const lighten = (c, t) => mix(c, "#ffffff", t);
const darken = (c, t) => mix(c, "#000000", t);
/** A facet pair for one material: the top, the +u face and the +v face. */
const facets = (base) => ({
  top: lighten(base, 0.10),
  u: darken(base, 0.14),
  v: darken(base, 0.30),
});

// ── the scene: primitives in model space, projected to SVG ─────────────────
/**
 * One sprite's painting surface. Model coordinates are
 *   f — forward, along the lane/heading, in tiles
 *   l — lateral, +90° from forward, in tiles
 *   z — height in tiles (0 = ground)
 * and every primitive is mapped into tile space through the view's basis
 * before projection, so the four headings share one model.
 */
class Scene {
  constructor({ view, scale, origin }) {
    const [fu, fv] = VIEW_VECTOR[view];
    // lateral = forward turned one quarter turn: (u,v) → (-v,u)
    const [lu, lv] = [-fv, fu];
    this.view = view;
    this.scale = scale;
    this.fu = fu; this.fv = fv; this.lu = lu; this.lv = lv;
    /** Canvas position of tile-space (0,0) at z = 0 — the anchor point. */
    this.origin = { x: origin.x, y: origin.y };
    this.parts = [];
    this.defs = [];
    this.min = { x: Infinity, y: Infinity };
    this.max = { x: -Infinity, y: -Infinity };
    this._filterSeq = 0;
  }
  /** Model → tile space. */
  tile(f, l) { return [f * this.fu + l * this.lu, f * this.fv + l * this.lv]; }
  /** Tile space → canvas px (this sprite's zoom). */
  px(u, v, z = 0) {
    return [
      this.origin.x + (u - v) * HW * this.scale,
      this.origin.y + (u + v) * HH * this.scale - z * Z_UNIT * this.scale,
    ];
  }
  track(x, y) {
    if (x < this.min.x) this.min.x = x;
    if (y < this.min.y) this.min.y = y;
    if (x > this.max.x) this.max.x = x;
    if (y > this.max.y) this.max.y = y;
  }
  poly(points, fill, opts = {}) {
    for (const [x, y] of points) this.track(x, y);
    const d = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const stroke = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.strokeWidth ?? 1}"` : "";
    const filter = opts.filter ? ` filter="url(#${opts.filter})"` : "";
    return `<polygon points="${d}" fill="${fill}"${stroke}${filter}${opts.opacity ? ` opacity="${opts.opacity}"` : ""}/>`;
  }
  /**
   * A box in model space: centre (f, l), half extents (hf, hl), from z0 to z1.
   * The three visible facets are the top and the two faces toward the camera
   * (+u and +v in tile space, whatever the model's heading), shaded from ONE
   * key light so all four headings agree.
   */
  box({ f = 0, l = 0, hf = 0.1, hl = 0.1, z0 = 0, z1 = 0.1, color, edge = true, opacity, filter }) {
    const [u0, v0] = this.tile(f - hf, l - hl);
    const [u1, v1] = this.tile(f + hf, l - hl);
    const [u2, v2] = this.tile(f + hf, l + hl);
    const [u3, v3] = this.tile(f - hf, l + hl);
    const uMin = Math.min(u0, u1, u2, u3), uMax = Math.max(u0, u1, u2, u3);
    const vMin = Math.min(v0, v1, v2, v3), vMax = Math.max(v0, v1, v2, v3);
    const c = facets(color);
    const out = [];
    // +v face (shaded), +u face (mid), top (lit) — back to front.
    out.push(this.poly([
      this.px(uMin, vMax, z1), this.px(uMax, vMax, z1),
      this.px(uMax, vMax, z0), this.px(uMin, vMax, z0),
    ], c.v, { stroke: edge ? PALETTE.ink : null, strokeWidth: 0.5, opacity, filter }));
    out.push(this.poly([
      this.px(uMax, vMin, z1), this.px(uMax, vMax, z1),
      this.px(uMax, vMax, z0), this.px(uMax, vMin, z0),
    ], c.u, { stroke: edge ? PALETTE.ink : null, strokeWidth: 0.5, opacity, filter }));
    out.push(this.poly([
      this.px(uMin, vMin, z1), this.px(uMax, vMin, z1),
      this.px(uMax, vMax, z1), this.px(uMin, vMax, z1),
    ], c.top, { stroke: edge ? PALETTE.ink : null, strokeWidth: 0.5, opacity, filter }));
    this.parts.push(...out);
    return this;
  }
  /**
   * A transform matrix for the face of a box: `axis` "u" is the plane u =
   * `at` (local coordinates are (v, z)), `axis` "v" is the plane v = `at`
   * (local coordinates are (u, z)). Painting inside the group is then plain
   * 2-D work — a rect is a rect — with the projection applied by the matrix.
   */
  faceMatrix(axis, at) {
    const s = this.scale;
    if (axis === "u") {
      // x = (at − v)·HW·s ; y = (at + v)·HH·s − z·s   ⇒  d/dv = (−HW·s, HH·s), d/dz = (0, −s)
      return `matrix(${-HW * s},${HH * s},0,${-Z_UNIT * s},${this.origin.x + at * HW * s},${this.origin.y + at * HH * s})`;
    }
    // axis "v": x = (u − at)·HW·s ; y = (u + at)·HH·s − z·s
    return `matrix(${HW * s},${HH * s},0,${-Z_UNIT * s},${this.origin.x - at * HW * s},${this.origin.y + at * HH * s})`;
  }
  /** A rectangle painted on a face: local `a` span × height span. */
  rectOnFace(axis, at, a0, a1, z0, z1, fill, opts = {}) {
    const m = this.faceMatrix(axis, at);
    const stroke = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.strokeWidth ?? 0.06}"` : "";
    this.parts.push(`<g transform="${m}"><rect x="${a0}" y="${z0}" width="${a1 - a0}" height="${z1 - z0}" fill="${fill}"${stroke}/></g>`);
    // Track the face's four corners so the canvas fits.
    const corners = axis === "u"
      ? [[a0, z0], [a1, z0], [a0, z1], [a1, z1]].map(([a, z]) => this.px(at, a, z))
      : [[a0, z0], [a1, z0], [a0, z1], [a1, z1]].map(([a, z]) => this.px(a, at, z));
    for (const [x, y] of corners) this.track(x, y);
    return this;
  }
  /** A disc painted on a face (wheels, lamps, gauges). */
  discOnFace(axis, at, a, z, r, fill, opts = {}) {
    const m = this.faceMatrix(axis, at);
    const stroke = opts.stroke ? ` stroke="${opts.stroke}" stroke-width="${opts.strokeWidth ?? 0.05}"` : "";
    this.parts.push(`<g transform="${m}"><circle cx="${a}" cy="${z}" r="${r}" fill="${fill}"${stroke}${opts.filter ? ` filter="url(#${opts.filter})"` : ""}/></g>`);
    const corners = [[a - r, z - r], [a + r, z + r], [a - r, z + r], [a + r, z - r]]
      .map(([aa, zz]) => axis === "u" ? this.px(at, aa, zz) : this.px(aa, at, zz));
    for (const [x, y] of corners) this.track(x, y);
    return this;
  }
  /** A soft contact shadow on the ground plane, centred on (f, l). */
  groundShadow({ f = 0, l = 0, rf = 0.7, rl = 0.28, opacity = 1 }) {
    const id = `sh${this._filterSeq++}`;
    this.defs.push(
      `<radialGradient id="${id}"><stop offset="0%" stop-color="${PALETTE.shadow}"/>` +
      `<stop offset="70%" stop-color="rgba(18,16,14,0.30)"/><stop offset="100%" stop-color="rgba(18,16,14,0)"/></radialGradient>`,
    );
    const [u, v] = this.tile(f, l);
    const [cx, cy] = this.px(u, v, 0);
    const [ex, ey] = this.px(u + rf, v, 0);
    const rx = Math.abs(ex - cx);
    const ry = Math.abs(ey - cy) + rl * HH * this.scale;
    this.track(cx - rx, cy - ry); this.track(cx + rx, cy + ry);
    this.parts.push(`<ellipse cx="${cx}" cy="${cy + HH * this.scale * 0.15}" rx="${rx}" ry="${ry}" fill="url(#${id})" opacity="${opacity}"/>`);
    return this;
  }
  /** A warm glow (the lamp) drawn as a radial gradient disc. */
  glow({ f = 0, l = 0, z = 0.6, r = 0.22 }) {
    const id = `gl${this._filterSeq++}`;
    this.defs.push(
      `<radialGradient id="${id}"><stop offset="0%" stop-color="${PALETTE.lamp}" stop-opacity="0.85"/>` +
      `<stop offset="55%" stop-color="${PALETTE.lamp}" stop-opacity="0.28"/><stop offset="100%" stop-color="${PALETTE.lamp}" stop-opacity="0"/></radialGradient>`,
    );
    const [u, v] = this.tile(f, l);
    const [cx, cy] = this.px(u, v, z);
    const [gx] = this.px(u + r, v, z);
    const rx = Math.abs(gx - cx), ry = rx * 0.8;
    this.track(cx - rx, cy - ry); this.track(cx + rx, cy + ry);
    this.parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id})"/>`);
    return this;
  }
  svg({ width, height }) {
    const body = this.parts.join("\n");
    const defs = this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}${body}</svg>`;
  }
}

// ── the models ─────────────────────────────────────────────────────────────
/**
 * A locomotive: footplate, boiler with brass bands, cab with two windows, a
 * chimney and steam dome, three wheels a side, buffers and a coupling hook,
 * and one warm headlamp — a 1950s shunter at the scale the lorries set
 * (about 1.3 tiles long, 0.46 wide).
 */
const LOCO = { len: 1.16, wid: 0.42, couplerFront: 0.63, couplerRear: -0.63 };
const WAGON = { len: 0.98, wid: 0.42, couplerFront: 0.54, couplerRear: -0.54 };

function drawLocomotive(scene) {
  const P = PALETTE;
  scene.groundShadow({ rf: 0.60, rl: 0.30 });
  const alongU = scene.fu !== 0;   // forward is the u axis
  const latHalf = LOCO.wid / 2;
  const flanks = [1, -1].map((sign) => {
    const [a, b] = scene.tile(0, sign * latHalf);
    return { axis: alongU ? "v" : "u", at: alongU ? b : a };
  });
  const ends = [LOCO.couplerFront, LOCO.couplerRear].map((f) => {
    const [a, b] = scene.tile(f, 0);
    return { axis: alongU ? "u" : "v", at: alongU ? a : b, f };
  });
  const forwardEnd = ends.find((e) => e.f === LOCO.couplerFront);
  const rearEnd = ends.find((e) => e.f === LOCO.couplerRear);

  // Running plate, boiler, smokebox, chimney and dome, cab — back to front.
  scene.box({ f: 0, hf: LOCO.len / 2 - 0.02, hl: 0.185, z0: 0.030, z1: 0.090, color: P.charcoalDark });
  scene.box({ f: 0.22, hf: 0.34, hl: 0.150, z0: 0.090, z1: 0.340, color: P.charcoal });
  scene.box({ f: 0.53, hf: 0.07, hl: 0.155, z0: 0.090, z1: 0.360, color: darken(P.charcoal, 0.22) });
  scene.box({ f: 0.50, hf: 0.045, hl: 0.050, z0: 0.360, z1: 0.510, color: P.charcoal });
  scene.box({ f: 0.50, hf: 0.055, hl: 0.060, z0: 0.510, z1: 0.535, color: P.charcoalTop });
  scene.box({ f: 0.30, hf: 0.055, hl: 0.055, z0: 0.340, z1: 0.420, color: P.charcoal });
  scene.box({ f: 0.30, hf: 0.065, hl: 0.065, z0: 0.420, z1: 0.442, color: P.brass });
  // Cab: taller than the boiler, oxide body, dark roof, cream lining.
  scene.box({ f: -0.30, hf: 0.235, hl: 0.200, z0: 0.090, z1: 0.560, color: P.oxide });
  scene.box({ f: -0.30, hf: 0.255, hl: 0.215, z0: 0.560, z1: 0.600, color: P.charcoal });
  scene.box({ f: -0.30, hf: 0.260, hl: 0.220, z0: 0.600, z1: 0.615, color: P.charcoalTop });
  // Buffer beams and coupling hooks.
  scene.box({ f: LOCO.couplerFront - 0.01, hf: 0.022, hl: 0.175, z0: 0.100, z1: 0.180, color: P.steel });
  scene.box({ f: LOCO.couplerRear + 0.01, hf: 0.022, hl: 0.175, z0: 0.100, z1: 0.180, color: P.steel });
  scene.box({ f: LOCO.couplerFront - 0.035, hf: 0.030, hl: 0.030, z0: 0.110, z1: 0.155, color: darken(P.steel, 0.3) });
  scene.box({ f: LOCO.couplerRear + 0.035, hf: 0.030, hl: 0.030, z0: 0.110, z1: 0.155, color: darken(P.steel, 0.3) });

  for (const flank of flanks) {
    // Boiler: a cream handrail line and two thin brass bands.
    scene.rectOnFace(flank.axis, flank.at, 0.00, 0.52, 0.185, 0.205, P.cream);
    scene.rectOnFace(flank.axis, flank.at, 0.16, 0.20, 0.100, 0.335, P.brass);
    scene.rectOnFace(flank.axis, flank.at, 0.40, 0.44, 0.100, 0.340, P.brass);
    // Cab: two windows, a lining stripe and a small number plate.
    scene.rectOnFace(flank.axis, flank.at, -0.465, -0.335, 0.345, 0.495, PALETTE.window);
    scene.rectOnFace(flank.axis, flank.at, -0.270, -0.140, 0.345, 0.495, PALETTE.window);
    scene.rectOnFace(flank.axis, flank.at, -0.500, -0.100, 0.300, 0.315, PALETTE.cream);
    scene.rectOnFace(flank.axis, flank.at, -0.450, -0.350, 0.150, 0.230, darken(P.brass, 0.30));
    scene.rectOnFace(flank.axis, flank.at, -0.440, -0.360, 0.160, 0.220, P.brass);
    // Three axles a side: tyre, wheel face, hub.
    for (const wf of [0.44, 0.04, -0.36]) {
      scene.discOnFace(flank.axis, flank.at, wf, 0.105, 0.078, P.charcoalDark);
      scene.discOnFace(flank.axis, flank.at, wf, 0.105, 0.052, P.steel, { stroke: darken(P.charcoal, 0.4), strokeWidth: 0.02 });
      scene.discOnFace(flank.axis, flank.at, wf, 0.105, 0.016, darken(P.steel, 0.5));
    }
  }
  if (rearEnd) {
    scene.rectOnFace(rearEnd.axis, rearEnd.at, -0.150, -0.020, 0.345, 0.495, PALETTE.window);
    scene.rectOnFace(rearEnd.axis, rearEnd.at, 0.020, 0.150, 0.345, 0.495, PALETTE.window);
    scene.rectOnFace(rearEnd.axis, rearEnd.at, -0.160, 0.160, 0.300, 0.315, PALETTE.cream);
  }
  if (forwardEnd) {
    scene.discOnFace(forwardEnd.axis, forwardEnd.at, 0.0, 0.300, 0.070, PALETTE.cream, { stroke: darken(P.brass, 0.35), strokeWidth: 0.018 });
    scene.discOnFace(forwardEnd.axis, forwardEnd.at, 0.0, 0.300, 0.040, PALETTE.lamp);
  }
  scene.glow({ f: LOCO.couplerFront + 0.07, z: 0.300, r: 0.24 });
  return { lenTiles: LOCO.len, widthTiles: LOCO.wid, coupler: { front: LOCO.couplerFront, rear: LOCO.couplerRear } };
}

function drawWagon(scene) {
  const P = PALETTE;
  scene.groundShadow({ rf: 0.52, rl: 0.28 });
  const alongU = scene.fu !== 0;
  const latHalf = WAGON.wid / 2;
  const flanks = [1, -1].map((sign) => {
    const [a, b] = scene.tile(0, sign * latHalf);
    return { axis: alongU ? "v" : "u", at: alongU ? b : a };
  });
  const ends = [WAGON.couplerFront, WAGON.couplerRear].map((f) => {
    const [a, b] = scene.tile(f, 0);
    return { axis: alongU ? "u" : "v", at: alongU ? a : b, f };
  });
  // Underframe, oxide body with a visible ore load, buffers.
  scene.box({ f: 0, hf: WAGON.len / 2 - 0.02, hl: 0.170, z0: 0.030, z1: 0.100, color: P.charcoalDark });
  scene.box({ f: 0, hf: 0.44, hl: 0.190, z0: 0.100, z1: 0.430, color: P.oxide });
  scene.box({ f: 0, hf: 0.37, hl: 0.140, z0: 0.430, z1: 0.470, color: P.load });
  scene.box({ f: 0.05, hf: 0.24, hl: 0.095, z0: 0.470, z1: 0.520, color: P.load });
  scene.box({ f: -0.08, hf: 0.13, hl: 0.075, z0: 0.520, z1: 0.560, color: P.loadTop });
  scene.box({ f: WAGON.couplerFront - 0.01, hf: 0.020, hl: 0.160, z0: 0.100, z1: 0.170, color: P.steel });
  scene.box({ f: WAGON.couplerRear + 0.01, hf: 0.020, hl: 0.160, z0: 0.100, z1: 0.170, color: P.steel });
  for (const flank of flanks) {
    // Cream lining, plank seams, a modest brass door and a brake lever.
    scene.rectOnFace(flank.axis, flank.at, -0.42, 0.42, 0.385, 0.420, PALETTE.cream);
    scene.rectOnFace(flank.axis, flank.at, -0.44, 0.44, 0.180, 0.192, darken(P.oxide, 0.35));
    scene.rectOnFace(flank.axis, flank.at, -0.44, 0.44, 0.278, 0.290, darken(P.oxide, 0.35));
    scene.rectOnFace(flank.axis, flank.at, -0.045, 0.045, 0.190, 0.375, darken(P.brass, 0.35));
    scene.rectOnFace(flank.axis, flank.at, -0.035, 0.035, 0.200, 0.365, P.brass);
    scene.rectOnFace(flank.axis, flank.at, -0.16, -0.10, 0.105, 0.250, darken(P.steel, 0.25));
    for (const wf of [0.30, -0.30]) {
      scene.discOnFace(flank.axis, flank.at, wf, 0.098, 0.068, P.charcoalDark);
      scene.discOnFace(flank.axis, flank.at, wf, 0.098, 0.044, P.steel, { stroke: darken(P.charcoal, 0.4), strokeWidth: 0.018 });
      scene.discOnFace(flank.axis, flank.at, wf, 0.098, 0.014, darken(P.steel, 0.5));
    }
  }
  for (const end of ends) {
    scene.rectOnFace(end.axis, end.at, -0.150, 0.150, 0.100, 0.360, darken(P.oxide, 0.24));
    scene.rectOnFace(end.axis, end.at, -0.150, 0.150, 0.360, 0.375, PALETTE.cream);
  }
  return { lenTiles: WAGON.len, widthTiles: WAGON.wid, coupler: { front: WAGON.couplerFront, rear: WAGON.couplerRear } };
}

/**
 * A rail platform: a 3-tile lane with two ports and, beside it, the platform
 * strip — slab, safety line, canopy on posts, lamp and a number board. The
 * lane runs along the view's forward axis, so the same model yields both the
 * 3×2 and the 2×3 rotations.
 */
function drawPlatform(scene) {
  const P = PALETTE;
  const LANE_L = -0.5;          // lane band: l ∈ [-1, 0]
  const STRIP_L = 0.5;          // platform strip: l ∈ [0, 1]
  const HALF = 1.5;             // three tiles long
  // Lane: ballast, sleepers, two rails (the internal track is part of the price).
  scene.box({ f: 0, l: LANE_L, hf: HALF, hl: 0.5, z0: 0, z1: 0.035, color: P.ballast, edge: false });
  for (let i = -6; i <= 6; i++) {
    scene.box({ f: i * 0.23, l: LANE_L, hf: 0.045, hl: 0.24, z0: 0.035, z1: 0.06, color: P.sleeper, edge: false });
  }
  for (const railL of [LANE_L - 0.16, LANE_L + 0.16]) {
    scene.box({ f: 0, l: railL, hf: HALF, hl: 0.035, z0: 0.06, z1: 0.105, color: P.steel });
    scene.box({ f: 0, l: railL, hf: HALF, hl: 0.035, z0: 0.06, z1: 0.078, color: darken(P.steel, 0.35), edge: false });
  }
  // Platform slab: concrete deck with a brick face toward the track and a
  // cream safety line along the edge.
  scene.box({ f: 0, l: STRIP_L, hf: HALF, hl: 0.5, z0: 0, z1: 0.17, color: P.concrete });
  const [su, sv] = scene.tile(0, 0);
  const laneFace = scene.fu !== 0 ? { axis: "v", at: sv } : { axis: "u", at: su };
  scene.rectOnFace(laneFace.axis, laneFace.at, -HALF, HALF, 0.02, 0.13, P.brick);
  scene.rectOnFace(laneFace.axis, laneFace.at, -HALF, HALF, 0.13, 0.17, lighten(P.brick, 0.2));
  scene.rectOnFace(laneFace.axis, laneFace.at, -HALF, HALF, 0.155, 0.168, PALETTE.cream);
  // Canopy on three posts, with a fascia stripe.
  for (const postF of [-1.15, -0.05, 1.05]) {
    scene.box({ f: postF, l: 0.78, hf: 0.055, hl: 0.055, z0: 0.17, z1: 0.74, color: P.charcoal });
  }
  scene.box({ f: 0, l: 0.70, hf: HALF - 0.10, hl: 0.36, z0: 0.74, z1: 0.81, color: P.slate });
  const [cu, cv] = scene.tile(0, 0.70);
  const canopyFace = scene.fu !== 0 ? { axis: "v", at: cv } : { axis: "u", at: cu };
  scene.rectOnFace(canopyFace.axis, canopyFace.at, -1.42, 1.42, 0.745, 0.775, P.cream);
  // Lamp post with a warm head, at the platform's mid-point.
  scene.box({ f: 0.62, l: 0.28, hf: 0.045, hl: 0.045, z0: 0.17, z1: 0.92, color: P.charcoal });
  scene.box({ f: 0.62, l: 0.16, hf: 0.05, hl: 0.14, z0: 0.92, z1: 0.96, color: P.brass });
  scene.glow({ f: 0.62, l: 0.16, z: 0.95, r: 0.3 });
  // Bench + number board ("1").
  scene.box({ f: -0.95, l: 0.42, hf: 0.20, hl: 0.09, z0: 0.17, z1: 0.30, color: P.charcoal });
  scene.box({ f: -0.16, l: 0.60, hf: 0.035, hl: 0.035, z0: 0.17, z1: 0.62, color: P.charcoal });
  scene.box({ f: -0.16, l: 0.60, hf: 0.30, hl: 0.03, z0: 0.62, z1: 0.84, color: darken(P.charcoal, 0.15) });
  const [bu, bv] = scene.tile(-0.16, 0.60);
  const boardFace = scene.fu !== 0 ? { axis: "v", at: bv } : { axis: "u", at: bu };
  scene.rectOnFace(boardFace.axis, boardFace.at, -0.28, 0.28, 0.645, 0.815, PALETTE.cream);
  scene.rectOnFace(boardFace.axis, boardFace.at, -0.25, -0.08, 0.675, 0.785, darken(P.charcoal, 0.2));
  scene.rectOnFace(boardFace.axis, boardFace.at, -0.20, -0.13, 0.70, 0.76, PALETTE.cream);
  return { footprint: null, ports: null };
}

/**
 * A train depot: a brick engine shed over a through track, one declared rail
 * exit at the front, a slate roof, coal/water column and a warm lamp over the
 * door.
 */
function drawDepot(scene) {
  const P = PALETTE;
  const LANE_L = -0.5;
  // Track apron: ballast + rails under the whole 2×2 block, so the shed's
  // track visibly meets the network at the exit.
  scene.box({ f: 0, l: LANE_L, hf: 1.0, hl: 0.45, z0: 0, z1: 0.03, color: P.ballast, edge: false });
  for (let i = -4; i <= 4; i++) {
    scene.box({ f: i * 0.23, l: LANE_L, hf: 0.045, hl: 0.22, z0: 0.03, z1: 0.05, color: P.sleeper, edge: false });
  }
  for (const railL of [LANE_L - 0.15, LANE_L + 0.15]) {
    scene.box({ f: 0, l: railL, hf: 1.0, hl: 0.033, z0: 0.05, z1: 0.09, color: P.steel });
  }
  // Concrete apron beside the lane and the brick pad under the shed.
  scene.box({ f: 0.5, l: 0.42, hf: 0.48, hl: 0.55, z0: 0, z1: 0.025, color: darken(P.concrete, 0.12), edge: false });
  // The shed: brick walls, open front over the lane, slate roof with a ridge.
  scene.box({ f: -0.52, l: 0, hf: 0.48, hl: 0.98, z0: 0.03, z1: 0.62, color: P.brick });
  scene.box({ f: -0.52, l: 0, hf: 0.54, hl: 1.04, z0: 0.62, z1: 0.74, color: P.slate });
  scene.box({ f: -0.52, l: 0, hf: 0.40, hl: 0.84, z0: 0.74, z1: 0.79, color: lighten(P.slate, 0.12), edge: false });
  // Door: a dark opening over the lane, in the shed's front face.
  const [fu, fv] = scene.tile(-0.04, 0);
  const frontFace = scene.fu !== 0 ? { axis: "u", at: fu } : { axis: "v", at: fv };
  const doorHalf = 0.30;
  scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L - doorHalf, LANE_L + doorHalf, 0.03, 0.30, PALETTE.window);
  scene.discOnFace(frontFace.axis, frontFace.at, LANE_L, 0.30, doorHalf, PALETTE.window);
  for (const edge of [-1, 1]) {
    scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L + edge * doorHalf, LANE_L + edge * (doorHalf + 0.05), 0.03, 0.33, darken(P.steel, 0.3));
  }
  scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L - doorHalf - 0.05, LANE_L + doorHalf + 0.05, 0.33, 0.365, P.steel);
  // Brick gable detail + a brass plate above the door.
  scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L + 0.52, LANE_L + 0.86, 0.24, 0.36, P.cream);
  scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L + 0.56, LANE_L + 0.82, 0.27, 0.33, darken(P.charcoal, 0.2));
  scene.rectOnFace(frontFace.axis, frontFace.at, LANE_L + 0.02, LANE_L + 0.46, 0.62, 0.685, PALETTE.brass);
  // Lamp over the door.
  scene.discOnFace(frontFace.axis, frontFace.at, LANE_L, 0.45, 0.055, PALETTE.lamp);
  scene.glow({ f: 0.14, l: LANE_L, z: 0.45, r: 0.40 });
  // Coal/water column beside the exit.
  scene.box({ f: 0.66, l: 0.52, hf: 0.05, hl: 0.05, z0: 0.03, z1: 0.82, color: P.charcoal });
  scene.box({ f: 0.48, l: 0.52, hf: 0.20, hl: 0.045, z0: 0.76, z1: 0.84, color: P.charcoal });
  scene.box({ f: 0.30, l: 0.52, hf: 0.035, hl: 0.035, z0: 0.60, z1: 0.80, color: darken(P.charcoal, 0.2) });
  scene.box({ f: 0.30, l: 0.52, hf: 0.045, hl: 0.045, z0: 0.56, z1: 0.61, color: P.brass });
  // A stack of sleepers on the apron.
  scene.box({ f: 0.72, l: 0.18, hf: 0.22, hl: 0.10, z0: 0.025, z1: 0.14, color: P.sleeper });
  return {};
}

const MODELS = {
  locomotive: { draw: drawLocomotive, moving: true, canvas: { w: 200, h: 150 }, origin: { x: 100, y: 104 } },
  wagon: { draw: drawWagon, moving: true, canvas: { w: 200, h: 150 }, origin: { x: 100, y: 104 } },
  // Platform/depot canvases are sized for the 3-tile span (224 px at 2×) plus
  // the canopy/lamp height; the trim step makes the shipped box tight.
  platform: { draw: drawPlatform, moving: false, canvas: { w: 420, h: 320 }, origin: { x: 210, y: 214 } },
  "train-depot": { draw: drawDepot, moving: false, canvas: { w: 360, h: 300 }, origin: { x: 180, y: 200 } },
};

/**
 * Where the sprite's anchor point sits in the untrimmed 2× canvas.
 *
 * Moving sprites anchor on the GROUND CONTACT point — the centre of the
 * fractional tile the vehicle stands on, which is the model origin the art is
 * drawn around. Static structures anchor on the SOUTH VERTEX of their
 * footprint's last tile: the model is centred on the footprint's own diamond,
 * so the south vertex is half the footprint diagonal's screen offset away —
 * `((fw − fh)/2 · HW, (fw + fh)/2 · HH)` at 1×.
 */
function anchorPoint(kind, view, origin, scale) {
  const model = MODELS[kind];
  if (model.moving) return { x: origin.x, y: origin.y };
  const [fw, fh] = footprintFor(kind, view);
  return {
    x: origin.x + ((fw - fh) / 2) * HW * scale,
    y: origin.y + ((fw + fh) / 2) * HH * scale,
  };
}

/** Footprint of one sprite (platforms rotate, so it depends on the view). */
export function footprintFor(kind, view) {
  if (kind === "platform") return PLATFORM_FOOTPRINT[view];
  if (kind === "train-depot") return DEPOT_FOOTPRINT;
  return [1, 1];
}
export const spriteName = (kind, view) => `${kind}_${view}`;
export const ALL_SPRITE_NAMES = SPRITE_KINDS.flatMap((k) => VIEWS.map((v) => spriteName(k, v)));

// ── rasterising one sprite ─────────────────────────────────────────────────
/** 2× master of one sprite, trimmed to its alpha box and padded to a ×4 grid. */
async function renderMaster(name) {
  const [kind, view] = [name.slice(0, name.lastIndexOf("_")), name.slice(name.lastIndexOf("_") + 1)];
  const model = MODELS[kind];
  if (!model) throw new Error(`unknown sprite kind in "${name}"`);
  if (!VIEWS.includes(view)) throw new Error(`unknown view in "${name}"`);
  const scene = new Scene({ view, scale: 2, origin: model.origin });
  const meta = model.draw(scene) ?? {};
  const svg = scene.svg({ width: model.canvas.w, height: model.canvas.h });
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const raw = await sharp(Buffer.from(svg)).png().toBuffer();
  const trimmed = await sharp(raw).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const info = trimmed.info;
  // sharp reports the trimmed art's offset inside the canvas, negative when
  // the art starts to the right/below the canvas origin — so the anchor moves
  // by the SAME signed offset, not by its negation.
  const offX = info.trimOffsetLeft ?? 0;
  const offY = info.trimOffsetTop ?? 0;
  // The anchor in TRIMMED 2× coordinates (see `anchorPoint`).
  const ap = anchorPoint(kind, view, model.origin, 2);
  let ax = ap.x + offX;
  let ay = ap.y + offY;
  // Pad so both dims are multiples of 4 and the anchor is even (exact halves
  // and quarters below). Extra left/top padding shifts the anchor with the art.
  const padL = ax % 2 !== 0 ? 1 : 0;
  const padT = ay % 2 !== 0 ? 1 : 0;
  ax += padL; ay += padT;
  const padR = (4 - ((info.width + padL) % 4)) % 4;
  const padB = (4 - ((info.height + padT) % 4)) % 4;
  const master = await sharp(trimmed.data).extend({
    left: padL, top: padT, right: padR, bottom: padB,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer({ resolveWithObject: true });
  return {
    kind, view, name, meta,
    buf2x: master.data,
    w2: master.info.width, h2: master.info.height,
    anchor2: [ax, ay],
    footprint: footprintFor(kind, view),
    moving: !!model.moving,
  };
}

/** Quality-kernel downscale to one zoom, from the 2× master. */
async function derive(master, zoom) {
  if (zoom === 2) return master.buf2x;
  const w = master.w2 / (2 / zoom);
  const h = master.h2 / (2 / zoom);
  return sharp(master.buf2x).resize(Math.round(w), Math.round(h), { kernel: "lanczos3" }).png().toBuffer();
}

/** Alpha facts the loader and the tests read: coverage and the corner test. */
async function alphaFacts(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  let opaque = 0;
  for (let i = 0; i < w * h; i++) if (data[i * channels + 3] > 8) opaque++;
  const at = (x, y) => data[(y * w + x) * channels + 3];
  return {
    coverage: +(opaque / (w * h)).toFixed(4),
    corners: [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)],
  };
}

// ── the contact sheet ──────────────────────────────────────────────────────
async function contactSheet(entries) {
  const CELL_W = 260, CELL_H = 220, PAD = 14, COLS = 4;
  const rows = Math.ceil(entries.length / COLS);
  const W = COLS * CELL_W, H = rows * CELL_H + 34;
  const parts = [
    `<rect width="${W}" height="${H}" fill="#111315"/>`,
    `<text x="14" y="23" font-family="DejaVu Sans, Helvetica, sans-serif" font-size="16" fill="#e9e3d2">HexMatch — Railway art (assets/railway) · 1× sprites, drawn at 2× and derived</text>`,
  ];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const col = i % COLS, row = (i / COLS) | 0;
    const x0 = col * CELL_W, y0 = 34 + row * CELL_H;
    parts.push(`<rect x="${x0 + 6}" y="${y0 + 6}" width="${CELL_W - 12}" height="${CELL_H - 12}" fill="#1b1e21" stroke="#2f3438"/>`);
    parts.push(`<text x="${x0 + PAD}" y="${y0 + CELL_H - 12}" font-family="DejaVu Sans, Helvetica, sans-serif" font-size="12" fill="#b9bec4">${e.name} · ${e.master.w2 / 2}x${e.master.h2 / 2} @1x · ${e.master.footprint[0]}x${e.master.footprint[1]}</text>`);
    const buf = await derive(e.master, 1);
    const left = Math.round(x0 + (CELL_W - e.master.w2 / 2) / 2);
    const top = Math.round(y0 + 18);
    parts.push(`<image x="${left}" y="${top}" width="${Math.round(e.master.w2 / 2)}" height="${Math.round(e.master.h2 / 2)}" href="data:image/png;base64,${buf.toString("base64")}" image-rendering="pixelated"/>`);
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">${parts.join("")}</svg>`)).png().toBuffer();
}

// ── docs ───────────────────────────────────────────────────────────────────
const README = `# Railway art (RAIL-03 / #177)

Original transparent PNG art for the Railways epic (#142), compiled by
\`tools/make-railway-art.mjs\`. Nothing here is extracted from Transport Fever;
there is no third-party art in this folder at all — every pixel is generated
from a parametric model in tile space, so the licence is the repository's own.

## Files

\`\`\`
locomotive_{ne,se,sw,nw}@{0.5x,1x,2x}.png   moving, 1x1 footprint, 3 axles a side
wagon_{ne,se,sw,nw}@{0.5x,1x,2x}.png        moving, 1x1 footprint, ore load
platform_{ne,se,sw,nw}@{0.5x,1x,2x}.png     static, 2x3 (ne/sw) or 3x2 (se/nw)
train-depot_{ne,se,sw,nw}@{0.5x,1x,2x}.png  static, 2x2, one declared rail exit
manifest.json                               geometry + alpha facts (see below)
contact-sheet.png                           every sprite at 1x, labelled
LICENSES.md                                 provenance statement
\`\`\`

2× is the authored master (\`tools/make-railway-art.mjs\` draws straight into the
game's dimetric projection at double size). 1× and 0.5× are derived from it with
a Lanczos kernel, and every master is padded so both dimensions are multiples
of 4 and the anchor is an even 2× pixel — so \`round(size * zoom)\` is the real
pixel size of each zoom file and the anchor scales exactly.

## How the game uses it

\`src/iso/rail-art.ts\` imports these PNGs with an eager \`import.meta.glob\` (the
same route \`scenery-art.ts\` and \`vehicle-art.ts\` take, and why \`vite.config.ts\`
needs no copy step for this folder) and installs each sprite into the atlas — a
whole per-zoom image IS the sprite, placed by the manifest's anchor.
\`manifest.json\` rides in as a plain JSON import. Moving sprites (locomotive, wagon) are anchored
on their GROUND CONTACT point and drawn as \`world.vehicles\` items
(\`drawOriginMoving\`); the static ones (platform, depot) are ordinary
footprint-anchored structure sprites and are drawn as \`world.extra\` items,
exactly like a factory or a depot.

Art is an upgrade, never a gate: if this folder (or a single file) is missing,
\`loadRailwaySprites\` returns 0 and the game falls back to its flat vector-drawn
railway. Because the glob is eager, the PNGs are part of the bundle and resolve
identically under \`vite dev\`, \`vite preview\` and a deployed build — no manifest
fetch, no production copy. \`tests/unit/iso-rail-art.test.ts\` pins the contract.

## manifest.json

Per sprite:

| field | meaning |
| --- | --- |
| \`w\`, \`h\` | sprite size at 1× (the image is the whole sprite) |
| \`anchor\` | placement point at 1×, sprite-local: the ground contact point (moving) or the footprint's south vertex (static — the same convention every other structure in the atlas uses) |
| \`footprint\` | tiles covered: [1,1] vehicles, [3,2]/[2,3] platform, [2,2] depot |
| \`moving\` | true for locomotive/wagon — the renderer anchors these on a fractional tile |
| \`box2x\` | master size in pixels (2×), i.e. the file's own size ÷ 2 at 1× |
| \`lenTiles\`, \`widthTiles\` | vehicle body extents in tiles (wagon spacing) |
| \`coupler.front\`/\`.rear\` | tile offset of each coupler from the anchor, along the heading |
| \`alpha\` | \`coverage\` and the four \`corners\` (all 0 — the art is transparent) |

## Regenerating

\`\`\`bash
node tools/make-railway-art.mjs            # all 16 sprites + manifest + docs + sheet
node tools/make-railway-art.mjs wagon_se   # one sprite
\`\`\`
`;

const LICENSES = `# Licences and provenance — assets/railway

**Every file in this directory is generated by this repository's own tool
\`tools/make-railway-art.mjs\`.** There is no third-party art here:

* no Transport Fever / Urban Games asset has been extracted, converted or
  referenced (the epic forbids it, and the PNML trees under
  \`src/assets/sprites/pnml/\` only DEFINE vehicles — the train PNGs they point
  at are not in this repository);
* the candidate station sheet \`src/assets/sprites/pnml/.../RevStatBuilding_DanMacK.png\`
  was inspected during the art audit and **not** used;
* the drawing is procedural: boxes in tile space projected through the game's
  own dimetric transform, shaded from one key light.

Licence: the same as the repository's \`LICENSE\` (see the repository root).
You may regenerate, modify or replace these files with your own art — the
manifest in this folder is the only contract the game reads.
`;

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const names = only.length ? only : ALL_SPRITE_NAMES;
  for (const n of names) {
    if (!ALL_SPRITE_NAMES.includes(n)) throw new Error(`unknown sprite "${n}"; try: ${ALL_SPRITE_NAMES.join(" ")}`);
  }
  mkdirSync(OUT, { recursive: true });
  const entries = [];
  for (const name of names) {
    const master = await renderMaster(name);
    const oneX = await derive(master, 1);
    const alpha = await alphaFacts(oneX);
    entries.push({ master, alpha, w: master.w2 / 2, h: master.h2 / 2 });
    for (const [suffix, zoom] of [["0.5x", 0.5], ["1x", 1], ["2x", 2]]) {
      writeFileSync(join(OUT, `${name}@${suffix}.png`), await derive(master, zoom));
    }
    const coupler = master.meta?.coupler
      ? `,\n      "coupler": { "front": ${master.meta.coupler.front}, "rear": ${master.meta.coupler.rear} }`
      : "";
    const vehicle = master.meta?.lenTiles
      ? `,\n      "lenTiles": ${master.meta.lenTiles},\n      "widthTiles": ${master.meta.widthTiles}${coupler}`
      : "";
    console.log(
      `${name.padEnd(20)} ${String(master.w2 / 2).padStart(4)}x${String(master.h2 / 2).padStart(3)} @1x  ` +
      `anchor [${master.anchor2[0] / 2}, ${master.anchor2[1] / 2}]  cov ${alpha.coverage}` +
      (vehicle ? "  (vehicle)" : ""),
    );
  }
  if (only.length) {
    console.log(`\n${entries.length} sprite(s) written. Re-run without arguments to refresh manifest + docs.`);
    return;
  }
  const manifest = {
    tileW: TILE_W,
    tileH: TILE_H,
    zooms: [0.5, 1, 2],
    generatedBy: "tools/make-railway-art.mjs",
    license: "Repository LICENSE (original art, procedurally generated — no third-party assets)",
    meta: {
      note:
        "Per-sprite PNG layers for the railway (epic #142). The defs are complete geometry " +
        "(rect 0,0,w,h at 1x, origin anchor, footprint, moving) so src/iso/rail-art.ts can install " +
        "them straight into the atlas table the renderer reads. A missing file leaves the vector fallback.",
      palette: {
        charcoal: PALETTE.charcoal, oxide: PALETTE.oxide, brick: PALETTE.brick,
        slate: PALETTE.slate, steel: PALETTE.steel, brass: PALETTE.brass, cream: PALETTE.cream,
      },
    },
    sprites: {},
  };
  for (const e of entries) {
    const m = e.master;
    const def = {
      name: m.name,
      kind: m.kind,
      view: m.view,
      w: m.w2 / 2,
      h: m.h2 / 2,
      anchor: [m.anchor2[0] / 2, m.anchor2[1] / 2],
      footprint: m.footprint,
      moving: m.moving,
      box2x: [m.w2, m.h2],
      alpha: { coverage: e.alpha.coverage, corners: e.alpha.corners },
      note: `${m.kind} ${m.view}; original procedural art (tools/make-railway-art.mjs).`,
    };
    if (m.meta?.lenTiles) {
      def.lenTiles = m.meta.lenTiles;
      def.widthTiles = m.meta.widthTiles;
      def.coupler = { front: m.meta.coupler.front, rear: m.meta.coupler.rear };
    }
    manifest.sprites[m.name] = def;
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(OUT, "README.md"), README);
  writeFileSync(join(OUT, "LICENSES.md"), LICENSES);
  writeFileSync(join(OUT, "contact-sheet.png"), await contactSheet(entries));
  console.log(`\nmanifest.json, README.md, LICENSES.md and contact-sheet.png written to assets/railway/.`);
}

// Only run when invoked directly (the unit test imports the tables above).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
