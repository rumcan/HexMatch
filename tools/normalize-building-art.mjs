#!/usr/bin/env node
import { isCli } from "./is-cli.mjs";
// ══════════════════════════════════════════════════════════════════════════
// F5 (#273) — square a loose building drawing up to the game's 2:1 grid and
// seat it on its DECLARED footprint diamond.
//
// tools/fit-building-art.mjs takes a raw drawing and scales/anchors it by its
// ALPHA BOX (the reference sprite's ground span). That is exact for art that
// already sits on the game's angle, and wrong for everything else: AI art of a
// rectangular building comes back at a flatter, perspective-ish angle (its two
// ground edges climb at, say, +0.55 and −0.36 instead of +0.50 and −0.50), and
// a box fit then leaves the base OFF its footprint diamond — the parcel spills
// past the lot on one corner and falls short on the other, so the building
// reads as leaning off its tiles. docs/ART_PIPELINE.md §5.1: "The art's base
// edges must run at the game's angle: dy/dx = ±0.5 … Straighten it with a
// vertical shear (keeps uprights vertical)" — cut_train.py's `square_to_track`
// does exactly this for train cars, `cut_platform.py` for platforms. This is
// the same step for a building on a w×h footprint.
//
//   1. MEASURE the drawing's ground base. The bottom silhouette of the alpha
//      (the lowest opaque pixel per column — cut_train.py's `bottom_profile`)
//      is split at its lowest point, the drawn base's south vertex, and each
//      half is fitted with a RANSAC line, so a flight of steps, a parked cart
//      or a stray anti-aliased pixel cannot drag the fit. Each fitted edge is
//      then walked outward along the silhouette to the drawn corner.
//   2. SHEAR so both edges climb at exactly ±0.5 dy/dx:
//          y' = s(σ·y + k·x),  x' = s·x
//      Three parameters, three constraints that matter on the ground plane:
//      the two edge angles and the drawn base's total width (the footprint's
//      own diagonal, (w+h)·64 px at 2×). σ = 1/(mL − mR) and k = 0.5 − σ·mL,
//      the same family cut_platform.py solves for. Uprights stay vertical;
//      the drawing's flattening is removed. The fourth degree of freedom — how
//      the base's width splits across its south vertex, i.e. the drawn corner
//      proportions — is NOT free (a fourth constraint would need a leaning
//      affine, which would tilt the building's walls off vertical), so the
//      drawing's own split is kept and REPORTED as `cornerError2x`, the
//      distance from each drawn base corner to the declared diamond's corner.
//      Under ~8 px at 2× (a quarter tile at 1×) is invisible in game.
//   3. PLACE so the drawn base's centroid (the midpoint of its west–east
//      corner diagonal — the footprint diamond's own centroid) lands on the
//      authoring anchor (W/2, H − (w+h)·16). After the shear the base's south
//      vertex sits exactly (w+h)·16 px below that centroid, for ANY drawn
//      corners, and the base is exactly (w+h)·64 px wide with ±0.5 edges — so
//      the anchor contract in assets/buildings-src/README.md holds exactly and
//      the vertex lands on the canvas bottom row.
//   4. WRITE assets/buildings-src/<name>@2x.png on a W × H canvas that keeps
//      the ground diamond pinned to the canvas bottom: H is the drawing's own
//      height (it grows UPWARD — never downwards), W is at least the collar
//      lot (w+h−0.32)·64 the compiler enforces. `--mirror` mirrors the source
//      first and writes <name>_r: the second orientation of a w×h building
//      (#274), valid only where the lighting allows it — `--lighting-check`
//      measures the two wall bands (the world's light is upper-LEFT: every
//      shipped master has a lighter south-west wall, ratio 1.2–1.8).
//
// Then the usual pipeline (docs/ART_PIPELINE.md §5.2):
//   node tools/make-building-pngs.mjs <name>      → assets/buildings/<name>@*.png
//   node tools/overlay-building-template.mjs <name>   → guide + scale figure
//   node tools/footprint-check.mjs                → base inside its diamond
//
// Usage:
//   node tools/normalize-building-art.mjs <name> tools/art-src/<t>/<name>-raw.png
//                                        [--footprint WxH] [--foot-room N]
//                                        [--mirror] [--report-only]
//   node tools/normalize-building-art.mjs --lighting-check <file.png> [more…]
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(root, "assets", "buildings-src");
const DECLARATIONS = join(SRC_DIR, "footprints.json");

/** Game angle of a ground edge (dy/dx): a 2:1 tile edge. */
export const TRACK_SLOPE = 0.5;
/** Alpha above this counts as art (matches cut_train.py's bottom_profile). */
export const ALPHA_MIN = 96;
/** Canvas breathing room either side of the art, 2× px. */
export const MARGIN = 8;
/** RANSAC inlier tolerance on the ground profile, 2× px. */
export const FIT_TOL = 1.5;
/** How far the silhouette may leave the fitted line and still count as the edge. */
export const EXTEND_TOL = 4;
/**
 * Canvas pixel allowance below the declared foot room, 2× px: the ground
 * profile at the base's lowest point is anti-aliased, so a fitted vertex line
 * always leaves a couple of px of art under it. Not a front detail — no
 * footRoom is declared for it.
 */
export const VERTEX_SLACK = 4;

const snap4 = (v) => Math.ceil(v / 4) * 4;
const flag = (args, k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** Lowest opaque pixel per column: [[x, y], …] ascending in x, empty columns dropped. */
export function bottomProfile(data, width, height, channels, alphaMin = ALPHA_MIN) {
  const out = [];
  for (let x = 0; x < width; x++) {
    let low = -1;
    for (let y = height - 1; y >= 0; y--) {
      if (data[(y * width + x) * channels + 3] > alphaMin) { low = y; break; }
    }
    if (low >= 0) out.push([x, low]);
  }
  return out;
}

/**
 * Robust straight-line fit (RANSAC + least squares on the inliers). A base
 * edge is the longest line in its half of the profile; steps, awnings and
 * carts resting on the ground are outliers, and a plain least-squares fit
 * would let them drag the slope.
 */
export function fitLine(pts, tol = FIT_TOL, iters = 600, rng = Math.random) {
  let best = null;
  for (let k = 0; k < iters; k++) {
    const i = (rng() * pts.length) | 0, j = (rng() * pts.length) | 0;
    if (i === j) continue;
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    if (x1 === x2) continue;
    const m = (y2 - y1) / (x2 - x1), b = y1 - m * x1;
    const inliers = [];
    for (const p of pts) if (Math.abs(p[1] - (m * p[0] + b)) <= tol) inliers.push(p);
    if (!best || inliers.length > best.length) best = inliers;
  }
  if (!best || best.length < 8) throw new Error("could not fit a ground edge — is the whole base in frame?");
  const ls = leastSquares(best);
  return { ...ls, m: ls.m, n: best.length, x0: best[0][0], x1: best[best.length - 1][0] };
}

/** Least-squares line through points ([[x, y], …]) → {m, b, residual}. */
export function leastSquares(pts) {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const m = sxx ? sxy / sxx : 0, b = my - m * mx;
  let residual = 0;
  for (const [x, y] of pts) residual += Math.abs(y - (m * x + b));
  return { m, b, residual: round4(residual / n) };
}

/**
 * A ground edge is the line the silhouette RESTS ON: it touches the base from
 * below and everything else is above it. Fitting it as a lower support line
 * (one-sided inliers — a column only counts when it is within `tol` of the
 * line and not below it) is what makes art with a raised platform or a
 * stepped base readable: a depot on posts touches the ground at each post tip
 * and floats 20–40 px above the line in between, and a two-sided least-squares
 * fit would average the two into a line that sits on neither.
 *
 * RANSAC over pairs of columns (so a cart, a step or a stray pixel cannot drag
 * it), then a least-squares refit of the inliers, then a shift that pushes the
 * line down onto its lowest contact point.
 */
export function fitGroundLine(pts, dir, { tol = 2.5, iters = 900, rng = Math.random } = {}) {
  // The two ground edges are told apart by their SIGN alone, so no split has
  // to be guessed: a cart, a flight of steps or a raised platform sticking out
  // below the base is simply not an inlier of either line.
  const sign = dir > 0 ? -1 : +1;                 // right edge climbs up-right, left edge up-left
  let best = null;
  for (let k = 0; k < iters; k++) {
    const i = (rng() * pts.length) | 0, j = (rng() * pts.length) | 0;
    if (i === j) continue;
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    if (x1 === x2) continue;
    const m = (y2 - y1) / (x2 - x1);
    if (m * sign < 0.05) continue;                // wrong direction for this edge
    const b = y1 - m * x1;
    let n = 0;
    for (const [x, y] of pts) {
      const dev = y - (m * x + b);
      if (dev >= -tol && dev <= tol) n++;
    }
    if (!best || n > best.n) best = { m, b, n };
  }
  if (!best || best.n < 12) throw new Error("could not fit a ground edge — is the whole base in frame?");
  const inliers = pts.filter(([x, y]) => { const dev = y - (best.m * x + best.b); return dev >= -tol && dev <= tol; });
  const line = leastSquares(inliers);
  // The corners: the OUTERMOST columns that still touch the ground line. A
  // column that leaves the band in the middle (a curb step, a shadow gap under
  // a platform) does not end the base — only the drawn corner does, and it is
  // the extreme touch, in either direction.
  let x0 = Infinity, x1 = -Infinity, touchN = 0;
  for (const [x, y] of pts) {
    const dev = y - (line.m * x + line.b);
    if (dev >= -tol && dev <= tol) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); touchN++; }
  }
  return { ...line, x0, x1, n: inliers.length, touchN };
}

/**
 * Measure the drawn base: its two ground edges (lower support lines), the
 * corner they meet at (their intersection — the base's south vertex) and the
 * corners the silhouette runs out to.
 */
export function measureBase(data, width, height, channels) {
  const profile = bottomProfile(data, width, height, channels);
  if (profile.length < 32) throw new Error("the art's silhouette is too thin to measure a base");
  const left = fitGroundLine(profile, -1);
  const right = fitGroundLine(profile, +1);
  const vertex = { x: (right.b - left.b) / (left.m - right.m), y: 0 };
  vertex.y = left.m * vertex.x + left.b;
  const at = (m, b, x) => [x, m * x + b];
  return {
    profile,
    left, right,
    west: at(left.m, left.b, left.x0),
    east: at(right.m, right.b, right.x1),
    vertex,
    spans: { w: vertex.x - left.x0, h: right.x1 - vertex.x },
  };
}

/**
 * The plan for one drawing: the fitted transform, the canvas, the anchor and
 * how far the drawn base's corners end up from the declared diamond's. Pure —
 * no file writes — so the geometry can be pinned by a unit test.
 *
 * `resize` is sharp's own mapping (dest(x') samples source ((x'+0.5)·sw/newW − 0.5)):
 * it is part of the plan because the heavy resample happens there, in a
 * quality kernel, and the sub-pixel placement has to account for it.
 */
export function planNormalize({ data, width, height, channels, footprint, footRoom = 0, margin = MARGIN }) {
  const [w, h] = footprint;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new Error(`bad footprint ${JSON.stringify(footprint)} — want [w, h] of positive integers`);
  }
  const n = w + h;
  const base = measureBase(data, width, height, channels);
  const mL = base.left.m, mR = base.right.m;
  if (!(mL > 0) || !(mR < 0)) {
    throw new Error(`the base must have one edge climbing left-to-right and one right-to-left (got ${round4(mL)}, ${round4(mR)})`);
  }
  const sigma = 1 / (mL - mR);            // vertical stretch: σ·mL + k = +0.5, σ·mR + k = −0.5
  const k = TRACK_SLOPE - sigma * mL;     // vertical shear
  const scale = (n * 64) / (base.east[0] - base.west[0]);

  // The resampled (pre-shear) image: uniform scale, with σ folded into the
  // vertical axis. Sizes snap to integers; the exact ratios are used below.
  const newW = Math.max(2, Math.round(width * scale));
  const newH = Math.max(2, Math.round(height * scale * sigma));
  const rx = newW / width, ry = newH / height;
  /** source px → resampled px (sharp's resize mapping) */
  const resample = (x, y) => [(x + 0.5) * rx - 0.5, (y + 0.5) * ry - 0.5];
  /** resampled px → canvas px (the shear, then the placement offset) */
  const shear = ([x, y]) => [x, y + k * x];

  // Where the base's centroid must land: the authoring anchor.
  const cx = (base.west[0] + base.east[0]) / 2;
  const cy = (base.west[1] + base.east[1]) / 2;
  const centroid = shear(resample(cx, cy));

  // Canvas: the art must not be cut, so it is measured through the whole map.
  const alpha = alphaBox(data, width, height, channels);
  const corners = [[alpha.left, alpha.top], [alpha.right + 1, alpha.top], [alpha.left, alpha.bottom + 1], [alpha.right + 1, alpha.bottom + 1]]
    .map(([x, y]) => shear(resample(x, y)));
  const minX = Math.min(...corners.map((c) => c[0])), maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1])), maxY = Math.max(...corners.map((c) => c[1]));
  const minW = Math.round((n - 0.32) * 64);            // the compiler's collar lot
  const W = snap4(Math.max(minW, Math.ceil(maxX - minX) + margin * 2));
  // H is free above the ground zone: the drawing's own height, measured upward
  // from the anchor row (the art's top is never cut; the canvas grows UP).
  const H = snap4(Math.max(n * 32, Math.ceil(centroid[1] - minY) + n * 16 + footRoom + VERTEX_SLACK + margin));
  const anchor = [W / 2, H - footRoom - n * 16];
  // integer x offset keeps the horizontal axis sample-exact (no smeared columns)
  const off = [Math.round(anchor[0] - centroid[0]), anchor[1] - centroid[1]];
  // The art's own lowest pixel (from the bottom profile — a bounding-box
  // corner is empty after the shear, so the box is not the art). The base's
  // south vertex is n·16 px below the anchor, so anything deeper than the
  // declared foot room would be cut off: report it rather than shave it.
  let lowestArt = -Infinity;
  for (const [x, y] of base.profile) lowestArt = Math.max(lowestArt, shear(resample(x, y))[1]);
  const belowVertex = round4((lowestArt + off[1]) - (anchor[1] + n * 16));
  const toCanvas = ([x, y]) => { const [a, b] = shear([x, y]); return [a + off[0], b + off[1]]; };

  const placed = {
    west: toCanvas(resample(...base.west)),
    east: toCanvas(resample(...base.east)),
    vertex: toCanvas(resample(base.vertex.x, base.vertex.y)),
  };
  // The declared footprint's diamond, from the authoring anchor (2× px), the
  // same geometry templateGeometry() draws (see cut_platform.py's corner
  // cases for the two non-square orientations):
  //   N = anchor + ((h−w)·32, −n·16)   E = anchor + (+n·32, (w−h)·16)
  //   S = anchor + ((w−h)·32, +n·16)   W = anchor + (−n·32, (h−w)·16)
  const ideal = {
    west: [anchor[0] - n * 32, anchor[1] + (h - w) * 16],
    east: [anchor[0] + n * 32, anchor[1] + (w - h) * 16],
    vertex: [anchor[0] + (w - h) * 32, anchor[1] + n * 16],
  };
  const err = (p, q) => [round4(p[0] - q[0]), round4(p[1] - q[1])];
  /**
   * How far each front edge misses its diamond edge, PERPENDICULAR to it, in
   * 2× px. A base edge that runs at the game's angle but sits off the diamond
   * shows up here as one number per edge (the corner error above is measured
   * along the edge, where a few px hardly show); a quarter tile at 1× is 16 px
   * at 2×. Report-only: the drawn plan's own proportions decide how the base
   * splits across its south vertex, and that split cannot be corrected without
   * tilting the building's walls off vertical.
   */
  const perp = (p, q, m) => round4(((p[1] - q[1]) - m * (p[0] - q[0])) / Math.hypot(1, m));
  const edgeOffset2x = {
    sw: perp(placed.west, ideal.west, TRACK_SLOPE),
    se: perp(placed.east, ideal.east, -TRACK_SLOPE),
  };
  /** The drawn plan's proportions against the declared footprint's. */
  const drawnRatio = round4(base.spans.w / base.spans.h);
  const idealRatio = round4(w / h);

  return {
    footprint: [w, h], footRoom, margin,
    drawn: {
      leftSlope: round4(mL), rightSlope: round4(mR),
      west: base.west, east: base.east, vertex: base.vertex,
      spans: { w: round4(base.spans.w), h: round4(base.spans.h) },
      residual: { left: base.left.residual, right: base.right.residual, samples: { left: base.left.n, right: base.right.n } },
    },
    transform: { sigma: round4(sigma), k: round4(k), scale: round4(scale) },
    resample: { width: newW, height: newH, rx: round4(rx), ry: round4(ry) },
    canvas: { W, H }, anchor, offset: off, shearSlope: round4(k),
    /** Deepest art pixel below the base's south vertex, 2× px (want ≤ footRoom). */
    belowVertex,
    placed, ideal,
    cornerError2x: { west: err(placed.west, ideal.west), east: err(placed.east, ideal.east), vertex: err(placed.vertex, ideal.vertex) },
    edgeOffset2x,
    planRatio: { drawn: drawnRatio, declared: idealRatio, off: round4(drawnRatio / idealRatio) },
    warning: planWarn(w, h, drawnRatio) ?? (belowVertex > footRoom + VERTEX_SLACK
      ? `art reaches ${belowVertex}px below the base's south vertex but footRoom is ${footRoom} — ` +
        `pass --foot-room ${Math.max(4, snap4(belowVertex))} (front details are cut otherwise)`
      : null),
    /** Worst |x| corner error, 2× px — the lot overhang/undershoot to eyeball. */
    worstCornerX: round4(Math.max(Math.abs(err(placed.west, ideal.west)[0]), Math.abs(err(placed.east, ideal.east)[0]), Math.abs(err(placed.vertex, ideal.vertex)[0]))),
    _toCanvas: toCanvas,
  };
}

/**
 * Warn when the drawing's own ground plan is nowhere near the footprint it is
 * declared on. Each ground edge maps to ±0.5 either way (that is what the
 * shear guarantees), but the DRAWN PROPORTIONS cannot be: an edgierart drawn
 * 1 : 2.5 declared on 2 : 4 comes out right, the same drawing declared on
 * 4 : 2 would have to be squashed five-fold along one axis to fit. Anything
 * past ~40 % means the art is drawn for a different footprint (usually the
 * mirrored one) — declare the orientation the drawing actually shows, and let
 * the `_r` mirror supply the other.
 */
function planWarn(w, h, drawnRatio) {
  const off = drawnRatio / (w / h);
  if (off >= 0.62 && off <= 1.6) return null;
  return `the drawing's ground plan is ${drawnRatio.toFixed(2)}:1 but the declared footprint ${w}×${h} is ` +
    `${(w / h).toFixed(2)}:1 (${off < 1 ? "1/" + (1 / off).toFixed(1) : off.toFixed(1)}× off) — ` +
    `declare the orientation the drawing actually shows (long side along grid y is <w>x<h> with the LARGER h)`;
}

/** Alpha bbox (threshold 8) as inclusive pixel bounds. */
export function alphaBox(data, width, height, channels, threshold = 8) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error("the drawing is fully transparent");
  return { left, top, right, bottom };
}

/**
 * Render a plan: resample (lanczos3, via sharp), apply the vertical shear
 * (2-tap bilinear on premultiplied colour — a single pass, no halo), and
 * composite onto the plan's canvas at the plan's offset.
 */
export async function renderPlan(plan, resizedBuf, resizedInfo) {
  const { W, H } = plan.canvas;
  const [ox, oy] = plan.offset;
  const k = plan.shearSlope;
  const sw = resizedInfo.width, sh = resizedInfo.height, sc = resizedInfo.channels;
  const out = Buffer.alloc(W * H * 4);
  const src = resizedBuf;
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const u = X - ox;
      if (u < 0 || u >= sw) continue;
      const v = Y - oy - k * u;
      const v0 = Math.floor(v), f = v - v0;
      const o = (Y * W + X) * 4;
      if (v0 < -1 || v0 > sh - 1) continue;
      let a0 = 0, a1 = 0, r0 = 0, g0 = 0, b0 = 0, r1 = 0, g1 = 0, b1 = 0;
      if (v0 >= 0) {
        const i = (v0 * sw + u) * sc; const al = src[i + 3] / 255;
        a0 = al; r0 = src[i] * al; g0 = src[i + 1] * al; b0 = src[i + 2] * al;
      }
      if (v0 + 1 <= sh - 1) {
        const i = ((v0 + 1) * sw + u) * sc; const al = src[i + 3] / 255;
        a1 = al; r1 = src[i] * al; g1 = src[i + 1] * al; b1 = src[i + 2] * al;
      }
      const a = a0 * (1 - f) + a1 * f;
      if (a <= 0) continue;
      out[o] = Math.round((r0 * (1 - f) + r1 * f) / a);
      out[o + 1] = Math.round((g0 * (1 - f) + g1 * f) / a);
      out[o + 2] = Math.round((b0 * (1 - f) + b1 * f) / a);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * Fit one raw drawing onto its declared footprint and write the master.
 * `--mirror` mirrors the SOURCE first (so the measurement and the fit see the
 * mirrored base) and writes `<name>_r`.
 */
export async function normalizeBuilding(name, rawPath, opts = {}) {
  const { footprint, footRoom = 0, mirror = false, out, srcDir = SRC_DIR, dry = false, margin = MARGIN } = opts;
  if (!footprint) throw new Error(`${name}: no footprint — declare it in footprints.json or pass --footprint WxH`);
  const flip = mirror ? await sharp(rawPath, { limitInputPixels: false }).flop().png().toBuffer() : rawPath;
  const { data, info } = await sharp(flip, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plan = planNormalize({ data, width: info.width, height: info.height, channels: info.channels, footprint, footRoom, margin });
  const { data: resized, info: rinfo } = await sharp(flip, { limitInputPixels: false })
    .resize(plan.resample.width, plan.resample.height, { kernel: "lanczos3", fit: "fill" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const canvas = await renderPlan(plan, resized, rinfo);
  const fileName = `${mirror ? `${name}_r` : name}@2x.png`;
  const outPath = out ?? join(srcDir, fileName);
  if (!dry) {
    if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, canvas);
  }
  const { _toCanvas, ...json } = plan;
  return { ...json, name: mirror ? `${name}_r` : name, raw: rawPath, out: dry ? "(report only)" : outPath };
}

/** Mean luminance of the opaque pixels in a box, or null when the box is empty. */
function meanLuminance(data, width, channels, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const o = (y * width + x) * channels;
      if (data[o + 3] <= 200) continue;
      sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      n++;
    }
  }
  return n ? sum / n : null;
}

/**
 * Lighting check for a mirror candidate. The world's light comes from the
 * upper LEFT — every shipped 1950s master has a lighter south-west wall than
 * south-east one (ratio 1.2–1.8, measured across assets/buildings/) — so a
 * mirrored sprite has its lit and shaded walls the wrong way round. Reports
 * the ratio of the two wall bands just above the base's south vertex.
 *
 * A MEASUREMENT, not a gate: a roof-dominated or awning-covered ground floor
 * can read near 1.0 without being wrong, so the number is quoted in the PR and
 * the call is made by looking at the sprite.
 */
export async function lightingCheck(file) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const base = measureBase(data, width, height, channels);
  const vx = Math.round(base.vertex.x), vy = Math.round(base.vertex.y);
  const band = Math.round((base.spans.w + base.spans.h) * 0.12);
  const across = Math.round((base.spans.w + base.spans.h) * 0.25);
  const sw = meanLuminance(data, width, channels, vx - across, vy - band * 2, vx, vy - 2);
  const se = meanLuminance(data, width, channels, vx, vy - band * 2, vx + across, vy - 2);
  return {
    file,
    swWall: sw === null ? null : round4(sw),
    seWall: se === null ? null : round4(se),
    ratio: sw !== null && se !== null && se > 0 ? round4(sw / se) : null,
  };
}

// ── main ───────────────────────────────────────────────────────────────────

/** footprints.json as {<name>: {footprint, footRoom}} (keys starting "_" are notes). */
export function declaredFootprints(path = DECLARATIONS) {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const out = {};
  for (const [name, v] of Object.entries(raw)) {
    if (name.startsWith("_")) continue;
    out[name] = Array.isArray(v) ? { footprint: v, footRoom: 0 } : v;
  }
  return out;
}

/** The value to put in assets/buildings-src/footprints.json for a new name. */
export function declarationSnippet(footprint, footRoom = 0) {
  return footRoom ? { footprint, footRoom } : { footprint };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    process.exit(args.length ? 0 : 1);
  }
  if (args.includes("--lighting-check")) {
    for (const f of args.filter((a) => !a.startsWith("--"))) console.log(JSON.stringify(await lightingCheck(f)));
    return;
  }
  const name = args[0], rawPath = args[1];
  if (!name || !rawPath) throw new Error("usage: node tools/normalize-building-art.mjs <name> <raw.png> [--footprint WxH] [--mirror]");
  const fpArg = flag(args, "--footprint", null);
  const mirror = args.includes("--mirror");
  const declared = declaredFootprints();
  const baseFp = fpArg ? fpArg.split("x").map(Number) : declared[name]?.footprint ?? null;
  if (!baseFp) {
    throw new Error(`${name}: declare it in assets/buildings-src/footprints.json or pass --footprint WxH`);
  }
  // #274: the mirrored orientation of a w×h building is h×w. `<name>_r`'s own
  // declaration wins when it has one; otherwise the swap is the default.
  const rotated = [baseFp[1], baseFp[0]];
  const mirrorFp = declared[`${name}_r`]?.footprint ?? rotated;
  const footprint = mirror ? mirrorFp : baseFp;
  const footRoom = Number(flag(args, "--foot-room",
    (mirror ? declared[`${name}_r`]?.footRoom : declared[name]?.footRoom) ?? 0));
  const result = await normalizeBuilding(name, rawPath, {
    footprint, footRoom, mirror,
    dry: args.includes("--report-only") || args.includes("--dry"),
  });
  console.log(JSON.stringify({ ...result, declare: declarationSnippet(footprint, footRoom) }, null, 1));
  if (mirror) {
    console.log(`\nNOW: declare "${result.name}" in assets/buildings-src/footprints.json as ` +
      `${JSON.stringify(declarationSnippet(footprint, footRoom))} (the mirror of ${name} ${baseFp.join("×")} is ` +
      `${footprint.join("×")}), then measure the lighting — the world's light is upper-LEFT, so the mirror is only ` +
      `usable where the ratio holds: node tools/normalize-building-art.mjs --lighting-check ${result.out}`);
  }
}

if (isCli(import.meta.url)) await main();
