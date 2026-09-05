// ══════════════════════════════════════════════════════════════════════════
// E14 — the corridor picker the gameplay e2e plays its round on.
//
// WHY THIS FILE EXISTS
// The Kenney art cutover doubled every tile (TILE_W 64 → 132) and shrank the
// map (48×48 → 32×32). `pickCorridor` had been written for the old geometry:
// it wanted a fixed 7-tile column straight south of an industry, which at
// 132 px tiles is a 396 px-wide footprint that has to sit inside the ~592 px
// strip of map visible between the two `.iso-panel` asides. That is about 6 %
// of the viewport, so on the pinned seed no industry qualified and the helper
// answered `null` — killing the only real-browser proof that a player can play
// a turn, before the test had sent a single pointer event.
//
// WHAT THIS VERSION DOES DIFFERENTLY (ticket acceptance 1–4)
//  * GEOMETRY-RELATIVE (A4): nothing is hard-coded to a tile count or to
//    132 px. The corridor length is derived from the measured screen step of a
//    tile and the measured clear band between the HUD panels; the search takes
//    the widest-clearance corridor it can find within [minTiles, maxTiles].
//  * ALL FOUR TRACK DIRECTIONS, not just due south (fix candidate c): +tx and
//    -ty drift RIGHT on screen, so two of the four families are not fighting
//    the left panel at all.
//  * IT PICKS THE CLICK POINT (A2): for every tile it must be provable that a
//    pointer event at the chosen pixel (i) is not swallowed by HUD chrome and
//    (ii) resolves, through the game's own two-stage pick, back to THAT tile.
//    J1's "never under a `.iso-panel`" rule is kept — generalised to "the
//    element that would actually receive the event must be an `.iso-layer`
//    canvas", which also covers the topbar, the resbar and the guide banner —
//    and the pick check is what catches the C1/C3 "the click landed on the
//    tile behind the one I saw" bug class instead of tripping over it.
//  * THE GAME ANSWERS LEGALITY: tile legality comes from `__iso.tileProbe`
//    (`buildRefusal` in track.ts + the harvester catchment rule), so the
//    helper can never drift from the rules the click handlers enforce.
//  * LOUD FAILURE (A3): when nothing qualifies it throws with the closest
//    candidate, the exact tile that rejected it, the filter that rejected it,
//    the rejection histogram and the measured band/step — instead of leaving
//    `expect(received).not.toBeNull()` as the last word.
//
// WHY THE FUNCTIONS ARE SELF-CONTAINED
// `page.evaluate(fn, arg)` serialises `fn.toString()` into the browser, so any
// module-scope dependency (import, shared helper, constant) would be an
// undefined identifier in the page. Each export therefore repeats the handful
// of lines it needs. `tests/unit/iso-corridor-picker.test.ts` runs both the
// imported function AND the revived `String(fn)` form against the real map and
// the real camera maths, so the constraint is enforced by a test, not a comment.
// ══════════════════════════════════════════════════════════════════════════

/** The read-only slice of `window.__iso` this helper is allowed to touch. */
interface IsoHookLite {
  grid: {
    w: number;
    h: number;
    terrain: Uint8Array;
    occupancy: Int16Array;
    industries: { id: number; type: string; tx: number; ty: number; w: number; h: number }[];
  };
  tileScreenAt: (tx: number, ty: number) => [number, number];
  /** E14: the game's own legality answer for a tile (`tileProbe` in game.ts). */
  tileProbe?: (kind: string, tx: number, ty: number) => {
    build: { ok: boolean; why: string | null };
    harvester: { ok: boolean; why: string | null };
  };
  /** E14: what `renderer.pick` says about a canvas point (device px). */
  pickAt?: (sx: number, sy: number) => { tx: number; ty: number; sprite: string | null } | null;
  camera?: { zoom: number };
}

export interface CorridorOptions {
  /** Shortest corridor worth playing — it must prove a MULTI-tile drag (default 4). */
  minTiles?: number;
  /** Longest corridor to try; 7 is the pre-cutover length (default 7). */
  maxTiles?: number;
}

export interface CorridorTile { tx: number; ty: number }

/** Where to click, as a fraction of one tile step from the diamond CENTRE. */
export interface CorridorAim { x: number; y: number }

export interface Corridor {
  /** Harvester tile — the column's near end, adjacent to the industry. */
  hx: number; hy: number;
  /** Factory tile — the column's far end. */
  fx: number; fy: number;
  /** Track direction from harvester to factory (see `DIRS` in src/iso/track.ts). */
  dir: string;
  /** Column length, harvester..factory inclusive. The test derives its
   *  free-allowance and road-tile expectations from this, never a constant. */
  tiles: number;
  /** CSS px between the tightest click point in the column and the nearest HUD box. */
  margin: number;
  /** Index into `grid.industries` the corridor hangs off. */
  industry: number;
  /** The column, harvester → factory inclusive: the exact drag path. */
  col: CorridorTile[];
  /** The click offset every tile of this column was verified at. */
  aim: CorridorAim;
}

export interface OcclusionHit extends CorridorTile {
  /** the element that would swallow the click at that point */
  coveredBy: string;
}

/**
 * Find a legal, on-screen, clickable corridor to play the round on.
 *
 * Runs IN THE PAGE (passed to `page.evaluate`) and headlessly in the unit test,
 * so it may only touch `window.__iso`, `document` and its own argument.
 *
 * @throws when the clear band cannot hold `minTiles` at all (a layout/camera
 *         regression, not bad seed luck) or when no column qualifies — naming
 *         the closest candidate and the reason it lost.
 */
export function findIsoCorridor(opts?: CorridorOptions): Corridor {
  const want = opts || {};
  const minTiles = want.minTiles ?? 4;
  const maxTiles = want.maxTiles ?? 7;

  const h = (window as unknown as { __iso?: IsoHookLite }).__iso;
  if (!h || !h.grid || typeof h.tileScreenAt !== "function") {
    throw new Error("findIsoCorridor: window.__iso (grid + tileScreenAt) is not mounted — did bootIso() resolve?");
  }
  const grid = h.grid;
  const MAP_W = grid.w, MAP_H = grid.h;
  const dpr = window.devicePixelRatio || 1;

  // The hook speaks DEVICE px; `elementsFromPoint`, `inView` and `page.mouse`
  // speak CSS px. At dpr 1 the division is a no-op; every Playwright project
  // that runs this helper is dpr 1 except the mobile ones (which skip it).
  const devAt = (tx: number, ty: number): [number, number] => h.tileScreenAt(tx, ty);
  const inView = (x: number, y: number) =>
    x >= -20 && x <= window.innerWidth + 20 && y >= -20 && y <= window.innerHeight + 20;

  // J1 (generalised): the tile is only clickable if the element a real pointer
  // event would hit at that pixel is one of the iso canvases. `elementsFromPoint`
  // skips `pointer-events: none` boxes, so this is the actual hit-test.
  const coverAt = (x: number, y: number): string | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "off-screen";
    const top = (document.elementsFromPoint(x, y) || [])[0] as HTMLElement | undefined;
    if (!top) return "no-element";
    if (top.closest?.(".iso-layer")) return null;
    const panel = top.closest?.(".iso-panel") ? " (iso-panel)" : "";
    const cls = top.className ? "." + String(top.className).trim().split(/\s+/).join(".") : "";
    return "covered:" + `${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}${cls}${panel}`;
  };
  // Stage-2 pick: does the game agree that this pixel is this tile?
  const pickOk = (dx: number, dy: number, tx: number, ty: number) => {
    if (!h.pickAt) return null;                 // hook without the probe: no opinion
    const p = h.pickAt(dx, dy);
    if (!p) return "no-renderer";
    return p.tx === tx && p.ty === ty ? null : `picked-${p.tx},${p.ty}${p.sprite ? `(${p.sprite})` : ""}`;
  };
  // Ground legality comes from the game, with a tile-level cache: the search
  // revisits the same tiles across directions, aims and lengths.
  const whyCache = new Map<string, string | null>();
  const memo = (key: string, run: () => string | null) => {
    const hit = whyCache.get(key);
    if (hit !== undefined) return hit;
    const out = run();
    whyCache.set(key, out);
    return out;
  };
  const buildWhy = (tx: number, ty: number) => memo(`b${tx},${ty}`, () => {
    if (h.tileProbe) {
      const p = h.tileProbe("road", tx, ty);
      return p.build.ok ? null : (p.build.why || "unbuildable");
    }
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return "out-of-bounds";
    const i = ty * MAP_W + tx;
    if (grid.terrain[i] === 1 /* WATER */) return "water";
    if (grid.occupancy[i] >= 0) return "occupied";
    return null;
  });
  const harvesterWhy = (tx: number, ty: number) => memo(`h${tx},${ty}`, () => {
    if (!h.tileProbe) return null;
    const p = h.tileProbe("road", tx, ty);
    return p.harvester.ok ? null : (p.harvester.why || "no-industry-in-catchment");
  });

  // One step along a ±tx or ±ty line moves the screen by exactly (HW·z, HH·z).
  // Measured, not assumed — that is what makes the rest of this geometry
  // relative (A4), so the next TILE_W change cannot silently break it.
  const d0 = devAt(0, 0);
  const d1 = devAt(0, 1);
  const stepDev: [number, number] = [Math.abs(d1[0] - d0[0]), Math.abs(d1[1] - d0[1])];
  const stepX = stepDev[0] / dpr;
  const stepY = stepDev[1] / dpr;

  // The clear band, measured from the HUD panels themselves. A hidden aside
  // (mobile/narrow layout) reports a 0-size box and so does not shrink it.
  const boxes = [...document.querySelectorAll<HTMLElement>(".iso-panel")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 1 && r.height > 1);
  let clearLeft = 0;
  let clearRight = window.innerWidth;
  for (const r of boxes) {
    if (r.left < window.innerWidth / 2) clearLeft = Math.max(clearLeft, r.right);
    else clearRight = Math.min(clearRight, r.left);
  }
  const band = clearRight - clearLeft;
  const zoom = h.camera ? h.camera.zoom : null;
  const geom = `band ${Math.round(band)}px (x ${Math.round(clearLeft)}..${Math.round(clearRight)}) · `
    + `tile step ${Math.round(stepX)}×${Math.round(stepY)}px · zoom ${zoom ?? "?"} · `
    + `dpr ${dpr} · viewport ${window.innerWidth}×${window.innerHeight}`;
  const fit = stepX > 0 ? Math.floor(band / stepX) + 1 : 0;

  if (fit < minTiles) {
    throw new Error(
      `findIsoCorridor: the corridor cannot fit between the HUD panels. `
      + `A ${minTiles}-tile column needs ${Math.round(stepX * (minTiles - 1))}px of clear map; ${geom}. `
      + `Panels measured: ${boxes.map((r) => `[${Math.round(r.left)},${Math.round(r.right)}]`).join(" ") || "none"}. `
      + `This is a LAYOUT/CAMERA problem, not a search problem — change the camera (the spec zooms with a real `
      + `wheel gesture) or the panel geometry; do NOT shrink the corridor or relax the hit-test to get past it.`,
    );
  }
  const lenMax = Math.min(maxTiles, fit);

  const DIRS = [
    { name: "SW", dx: 0, dy: 1 },    // down-LEFT  (the pre-cutover "south" column)
    { name: "NW", dx: -1, dy: 0 },  // up-LEFT
    { name: "NE", dx: 0, dy: -1 },  // up-RIGHT
    { name: "SE", dx: 1, dy: 0 },   // down-RIGHT
  ];
  // Where inside the diamond to click, as multiples of a tile step from the
  // centre. [0, 0.5] is the convention the rest of the spec uses (half a step
  // down the tile surface, past the K4 pick-cell offset); the others are there
  // so a sprite or a HUD box that clips the conventional point cannot make the
  // whole test unrunnable when a perfectly clickable tile is two pixels away.
  const AIMS: CorridorAim[] = [
    { x: 0, y: 0.5 }, { x: 0, y: 0 }, { x: 0, y: -0.5 },
    { x: -0.25, y: 0.25 }, { x: 0.25, y: 0.25 },
  ];

  // Rank industries by distance from the boot camera's focus (industries[0] is
  // what `centerOnTile` framed), so a near-camera corridor wins when the
  // geometry allows one — the camera is never moved to make the test pass.
  const focus = grid.industries[0];
  const ranked = grid.industries
    .map((ind, i) => ({ ind, i, d: Math.abs(ind.tx - focus.tx) + Math.abs(ind.ty - focus.ty) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);

  const counts: Record<string, number> = {};
  // histogram bucket for a reason tag: keep the reason whole in the message and
  // group it here, so the counts read as categories, not as string fragments.
  const category = (why: string) =>
    why.startsWith("covered:") ? "covered" : why.startsWith("picked-") ? "pick" : why;
  const sample: Record<string, string> = {};
  const bump = (why: string) => {
    const k = category(why);
    counts[k] = (counts[k] || 0) + 1;
    if (!sample[k]) sample[k] = why;   // one concrete example per category
  };
  let tried = 0;
  interface Near { ok: number; why: string; tx: number; ty: number; ind: string; dir: string; aim: string }
  let near: Near | null = null;
  let best: Corridor | null = null;

  for (const { ind } of ranked) {
    for (const d of DIRS) {
      // The harvester stands on the footprint's edge tile in direction d, so
      // the industry is inside its 4×4 catchment by construction — asserted,
      // via the game's own rule, not assumed.
      const hx = d.dx === 1 ? ind.tx + ind.w : d.dx === -1 ? ind.tx - 1 : ind.tx;
      const hy = d.dy === 1 ? ind.ty + ind.h : d.dy === -1 ? ind.ty - 1 : ind.ty;
      for (const aim of AIMS) {
        tried++;
        // Extend the column one tile at a time: the first tile a filter
        // refuses caps the length, because every longer column shares it.
        let margin = Infinity;
        let j = 0;
        for (; j < lenMax; j++) {
          const tx = hx + d.dx * j, ty = hy + d.dy * j;
          let why: string | null = null;
          const dev = devAt(tx, ty);
          const px = dev[0] + aim.x * stepDev[0];
          const py = dev[1] + aim.y * stepDev[1];
          const [cx, cy] = [px / dpr, py / dpr];
          if (!inView(cx, cy)) why = "off-screen";
          else if (j === 0) why = harvesterWhy(tx, ty) ?? buildWhy(tx, ty);
          else why = buildWhy(tx, ty);
          if (why === null) why = pickOk(px, py, tx, ty);
          if (why === null) why = coverAt(cx, cy);   // "covered:<element>" — who ate the click
          // V1: the factory highlight is a single diamond and the test samples
          // the tile diagonally BELOW it on screen (+tx +ty) to prove no 3×3
          // ghost is painted. The sample is only meaningful if that tile is on
          // screen, so a candidate must end where it can be checked.
          if (why === null && j >= minTiles - 1) {
            if (tx + 1 >= MAP_W || ty + 1 >= MAP_H) why = "factory-diagonal-off-map";
            else {
              const b = devAt(tx + 1, ty + 1);
              if (!inView(b[0] / dpr, b[1] / dpr)) why = "factory-diagonal-off-screen";
            }
          }
          if (why !== null) {
            bump(why);
            if (!near || near.ok < j) near = { ok: j, why, tx, ty, ind: ind.type, dir: d.name, aim: `${aim.x},${aim.y}` };
            break;
          }
          margin = Math.min(margin, cx - clearLeft, clearRight - cx);
          if (j >= minTiles - 1 && margin > 4) {
            const col: CorridorTile[] = [];
            for (let k = 0; k <= j; k++) col.push({ tx: hx + d.dx * k, ty: hy + d.dy * k });
            const cand: Corridor = {
              hx, hy, fx: tx, fy: ty, dir: d.name, tiles: col.length,
              margin, industry: ind.id, col, aim,
            };
            // widest clearance first; a shorter corridor breaks ties (less can
            // drift between the search and the real click).
            if (!best || cand.margin > best.margin + 0.5
              || (Math.abs(cand.margin - best.margin) <= 0.5 && cand.tiles < best.tiles)) best = cand;
          }
        }
      }
    }
  }

  if (!best) {
    const n = near as Near | null;
    throw new Error(
      `findIsoCorridor: no ${minTiles}–${lenMax}-tile corridor is legal, in view, clickable and pick-correct. `
      + `${tried} columns searched (${ranked.length} industries × ${DIRS.length} directions × ${AIMS.length} click points). ${geom}. `
      + (n
        ? `Closest: industry "${n.ind}" along ${n.dir}, click offset (${n.aim}) — ${n.ok} tile(s) passed, `
          + `then tile (${n.tx},${n.ty}) was rejected by \`${n.why}\`.`
        : "No candidate reached the first column tile.")
      + ` Rejections: ${JSON.stringify(counts)}; examples: ${JSON.stringify(sample)}. `
      + `If \`covered\` dominates, the corridor drifts under HUD chrome; if \`off-screen\` does, the camera `
      + `is framing a different part of the map; if \`picked-\` does, geometry and picking disagree (C1/C3); `
      + `if \`water\`/\`occupied\` do, the seed's terrain changed.`,
    );
  }
  return best;
}

/**
 * Which of these tiles are NOT clickable right now (A2), i.e. the element a
 * real pointer event would hit is not the map.
 *
 * A separate page function on purpose: the corridor is only worth asserting on
 * if the spec re-checks reachability independently of the helper that used that
 * very rule to choose the corridor. Same self-containment rule as
 * `findIsoCorridor` — the click point is recomputed here from the same inputs.
 */
export function isoTileOcclusion(sel: { tiles: CorridorTile[]; aim?: CorridorAim }): OcclusionHit[] {
  const h = (window as unknown as { __iso?: IsoHookLite }).__iso;
  if (!h) throw new Error("isoTileOcclusion: window.__iso is not mounted");
  const dpr = window.devicePixelRatio || 1;
  const d0 = h.tileScreenAt(0, 0);
  const d1 = h.tileScreenAt(0, 1);
  const step: [number, number] = [Math.abs(d1[0] - d0[0]), Math.abs(d1[1] - d0[1])];
  const aim = sel.aim ?? { x: 0, y: 0.5 };
  const out: OcclusionHit[] = [];
  for (const t of sel.tiles) {
    const d = h.tileScreenAt(t.tx, t.ty);
    const x = (d[0] + aim.x * step[0]) / dpr;
    const y = (d[1] + aim.y * step[1]) / dpr;
    const top = (document.elementsFromPoint(x, y) || [])[0] as HTMLElement | undefined;
    if (!top || !top.closest?.(".iso-layer")) {
      const cls = top && top.className ? "." + String(top.className).trim().split(/\s+/).join(".") : "";
      out.push({
        tx: t.tx, ty: t.ty,
        coveredBy: top ? `${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}${cls}` : "nothing",
      });
    }
  }
  return out;
}
