// ══════════════════════════════════════════════════════════════════════════
// C5 — the visual-debug console (`window.__iso.dump*` / `overlay` / `config`)
//
// The problem this solves: every art/geometry bug in this project has been
// reported as a screenshot ("the house floats", "the highlight is a level
// below the building", "I clicked a tile and nothing happened"), and every one
// of them then had to be re-derived from pixels plus a read of the renderer.
// The commands below make a screenshot traceable to STATE: each one returns
// structured data computed from the live camera, the atlas manifest and the
// same rule functions the game itself uses, so the numbers in a report are the
// numbers the renderer used.
//
//   __iso.dumpTile(tx, ty)      terrain cell, sprite, anchor, screen position,
//                               and what pick() says about it
//   __iso.shapes(tx, ty)        F2 (#272): place one of every non-square
//                               footprint shape side by side for visual
//                               depth/shadow/pick review (`"clear"` removes)
//   __iso.dumpAt(x, y)          which tile a SCREEN point resolves to (both the
//                               flat pick and the stage-2 sprite pick)
//   __iso.dumpBuilding(tx, ty)  every structure on the tile and the gap between
//                               its foot and the tile surface (the hover, in px)
//   __iso.dumpNetwork(player)   exactly which tiles count as that player's
//                               network — the adjacency answer for "why was my
//                               road refused"
//   __iso.overlay(name)         draw anchor / network / pick marks on the map,
//                               so a screenshot SHOWS them
//   __iso.config()              the resolved atlas entry (the packer's output
//                               for each cells.json cell) of every sprite on
//                               screen right now
//
// Gating: `shouldInstallDebugConsole` — DEV builds always, a production build
// only with `?iso-debug` on the URL. When it is off, game.ts installs nothing
// and the renderer's `debugPainter` stays null, so no dump code runs at all.
// Docs: docs/iso-debug-console.md.
// ══════════════════════════════════════════════════════════════════════════
import { HH, HW, MAP_W, MAP_H, TILE_H, tileToScreen } from "../game/config";
import { screenToTileAt, screenToWorld, visibleTileRange, worldToScreen, type Camera } from "./camera";
import { flatPick, terrainSprite, type IsoRenderer } from "./renderer";
import { WATER, ROUGH, industryAt, type Grid } from "./grid";
import {
  bitsAt, buildRefusal, hasTrack, isPublicRoad, isUpgradedRoad, ownerAt, playerNetwork,
  PRESENT, tIdx,
  type Track, type TrackKind,
} from "./track";
import { catchmentRect, industriesInCatchment, type EconomyState } from "./economy";
import { maskFromRGBA, type Atlas, type AtlasImage, type SpriteDef } from "./atlas";
import type { Placed } from "./depth";

export type DebugOverlayName = "anchor" | "network" | "pick";
export const DEBUG_OVERLAYS: DebugOverlayName[] = ["anchor", "network", "pick"];

/** Everything the console needs from the running game, via getters (live). */
export interface DebugContext {
  grid: Grid;
  track: Track;
  eco: EconomyState;
  players: { id: string; i: number }[];
  readonly camera: Camera;
  readonly renderer: IsoRenderer | null;
  readonly atlas: Atlas | null;
  readonly hover: { tx: number; ty: number; ref: unknown } | null;
  readonly tool: string;
  readonly phase: string;
  /** track-owner ids, so `dumpNetwork("you")` needs no magic numbers. */
  ownerOf: (player: string) => number | null;
  dpr: () => number;
}

/**
 * The install gate. Kept as a pure function of (dev, search) so it is unit
 * testable without a build, and so `import.meta.env` stays out of the logic.
 */
export function shouldInstallDebugConsole(env: { dev: boolean; search: string }): boolean {
  if (env.dev) return true;
  // `location.search` starts at "?"; accept a full path too so the rule is
  // testable with whatever string a caller has on hand.
  const qi = env.search.indexOf("?");
  const raw = qi >= 0 ? env.search.slice(qi + 1) : env.search;
  const q = new URLSearchParams(raw);
  const v = q.get("iso-debug") ?? q.get("debug");
  return v !== null && v !== "0" && v !== "false";
}

/**
 * D3: URL parameter gate to auto-enable debug overlays on startup (?debug=1 or ?debug or ?iso-debug=1).
 */
export function shouldAutoEnableDebugOverlays(env: { search: string }): boolean {
  const qi = env.search.indexOf("?");
  const raw = qi >= 0 ? env.search.slice(qi + 1) : env.search;
  const q = new URLSearchParams(raw);
  const debug = q.get("debug");
  const isoDebug = q.get("iso-debug");
  return debug === "1" || debug === "true" || (debug === "" && q.has("debug")) || isoDebug === "1" || isoDebug === "true";
}

/** `?render-log=1` turns on the per-blit `[render]` console.debug trace. */
export function shouldAutoEnableRenderLog(env: { search: string }): boolean {
  const qi = env.search.indexOf("?");
  const raw = qi >= 0 ? env.search.slice(qi + 1) : env.search;
  const q = new URLSearchParams(raw);
  return q.get("render-log") === "1" || q.get("render-log") === "true";
}

const r = (n: number): number => Math.round(n * 100) / 100;
const TERRAIN_NAME = ["grass", "water", "rough"] as const;
const terrainName = (v: number) => TERRAIN_NAME[v] ?? `#${v}`;

// ── F2 (#272) — the non-square shape gallery ─────────────────────────────────
// A debug view that drops one synthetic building of EVERY supported footprint
// shape side by side on the map, drawn through the REAL pipeline (world.extra →
// buildDrawList → place → depthSort → shadows → pickSprite), so draw order,
// shadow diamonds and hover picking can be reviewed at zoom 0.5 / 1 / 2 without
// waiting for #273's real art. Pure geometry here so the layout and defs are
// unit-testable; the raster side lives in the `shapes` command below.

/** One placed gallery shape: name, footprint and footprint-origin tile. */
export interface ShapeSlot {
  name: string;
  footprint: [number, number];
  tx: number;
  ty: number;
}

/**
 * The shapes F2 must support: every w≠h combination of lengths up to 4 (the
 * six of the spec plus the 1×4 / 4×1 pair the ticket names), and a 2×2 square
 * as the "no change for existing square buildings" control.
 */
export const SHAPE_GALLERY_FOOTPRINTS: ReadonlyArray<[number, number]> = [
  [2, 2], [1, 2], [2, 1], [1, 3], [3, 1], [4, 2], [2, 4], [1, 4], [4, 1],
];

/**
 * Lay the gallery out along ONE row starting at (tx, ty): each shape advances
 * by its width plus one empty column, so neighbouring shadows and pick masks
 * can be reviewed against grass as well as against each other. The row is
 * deliberately long and thin — the 3×1 / 4×1 pieces beside the 1×3 / 1×4
 * pieces are exactly the "long thin footprints next to each other" case.
 */
export function shapeGalleryLayout(tx: number, ty: number): ShapeSlot[] {
  const out: ShapeSlot[] = [];
  let x = tx;
  for (const [fw, fh] of SHAPE_GALLERY_FOOTPRINTS) {
    out.push({ name: `shape_${fw}x${fh}`, footprint: [fw, fh], tx: x, ty });
    x += fw + 1;
  }
  return out;
}

/** Headroom (world px) of the synthetic building box standing on its plate. */
const shapeArtUp = (fw: number, fh: number): number => Math.round((fw + fh) * HH * 0.9) + 24;

/**
 * The synthetic sprite def for one gallery shape: a `def.center` box standing
 * on a footprint-sized ground plate — art is the footprint diamond's bbox plus
 * the tower's headroom, anchored on the footprint bbox centre exactly like the
 * per-building PNGs (`loadBuildingLayers`' authoring convention).
 */
export function shapeGalleryDef(footprint: [number, number]): SpriteDef {
  const [fw, fh] = footprint;
  const w = (fw + fh) * HW;
  const up = shapeArtUp(fw, fh);
  const h = (fw + fh) * HH + up;
  return {
    x: 0, y: 0, w, h,
    footprint: [fw, fh],
    anchor: [w / 2, up + (fw + fh) * HH / 2],
    center: true,
  };
}

/**
 * Paint one gallery shape in 1× units: a footprint-sized ground plate (the
 * w×h footprint's diamond, centred on the anchor) with a small box standing on
 * it, a hue per shape, and a magenta dot on the anchor so a screenshot can
 * verify placement at a glance. The plate is opaque — the built pick mask IS
 * the footprint silhouette, so hover picking is reviewable against it.
 */
function paintShapeArt(
  c: CanvasRenderingContext2D, footprint: [number, number], def: SpriteDef,
): void {
  const [fw, fh] = footprint;
  const [ax, ay] = def.anchor;
  const rx = (fw + fh) * HW / 2, ry = (fw + fh) * HH / 2;
  const hue = (fw * 47 + fh * 83) % 360;
  c.fillStyle = `hsla(${hue}, 55%, 52%, 0.85)`;
  c.strokeStyle = `hsla(${hue}, 60%, 22%, 1)`;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(ax, ay - ry);
  c.lineTo(ax + rx, ay);
  c.lineTo(ax, ay + ry);
  c.lineTo(ax - rx, ay);
  c.closePath();
  c.fill();
  c.stroke();
  const up = shapeArtUp(fw, fh);
  const bw = Math.min((fw + fh) * HW * 0.34, 52), bh = up - 8;
  c.fillStyle = `hsla(${hue}, 62%, 68%, 1)`;
  c.fillRect(ax - bw / 2, ay - bh, bw, bh);
  c.strokeRect(ax - bw / 2, ay - bh, bw, bh);
  c.fillStyle = "#ff5af0";
  c.fillRect(ax - 1.5, ay - 1.5, 3, 3);
}

/** The manifest entry for a sprite, trimmed to what a geometry report needs. */
function cellOf(atlas: Atlas | null, name: string) {
  const def: SpriteDef | undefined = atlas?.get(name);
  if (!def) return null;
  return {
    sprite: name,
    atlasRect: [def.x, def.y, def.w, def.h],
    footprint: def.footprint,
    anchor: def.anchor,
    frames: def.frames ?? 1,
  };
}

/**
 * Build the console. Returns null when the gate says "off" — the caller then
 * installs nothing.
 */
export function createIsoDebug(ctx: DebugContext) {
  const overlays = new Set<DebugOverlayName>();

  /**
   * The ONE ground line every sprite is anchored to. Terrain is the floor by
   * definition, so `terrain_grass`'s declared anchor row IS the reference;
   * every other tile's drift from it is what would make the map step. For the
   * flat OpenGFX set this is the declared yrel of the ground tile (31), not
   * HH — the anchor is the pixel of the sprite that lands on the footprint's
   * south corner (a different quantity from the diamond's half-height).
   */
  const groundReference = (): number =>
    ctx.atlas?.get("terrain_grass")?.anchor[1] ?? TILE_H;

  /** World (1×, camera-free) position of the TOP vertex of tile (tx,ty) —
   *  the flat pick lattice point (tileToScreen). */
  const topVertex = (tx: number, ty: number): [number, number] =>
    tileToScreen(tx, ty);

  /** World position where a sprite's anchor lands — the exact point
   *  `depth.drawOrigin` places the declared anchor pixel on.
   *
   *  K4: the default (sheet) branch lands on the footprint's SOUTH corner (the
   *  bottom vertex of the S tile's diamond) — `tileToScreen(tx + fw - 1,
   *  ty + fh - 1) + (0, TILE_H)`. This used to add `HW` too, which is half a
   *  tile EAST of the south vertex and exactly the offset `drawOrigin` removed
   *  when the ground-plane roads landed (see its docstring): the mark sat
   *  beside the anchor it claimed to report. F2 (#272): a `def.center` sprite
   *  (building layers) lands its anchor on the footprint bbox CENTRE instead —
   *  "back off the east lean" for non-square footprints — so the report is
   *  footprint-aware (`centre` selects the branch). */
  const footCorner = (tx: number, ty: number, fw = 1, fh = 1, centre = false): [number, number] => {
    const [sx, sy] = tileToScreen(tx + fw - 1, ty + fh - 1);
    if (centre) {
      return [sx - (fw - fh) * (HW / 2), sy + TILE_H - (fw + fh) * (HH / 2)];
    }
    return [sx, sy + TILE_H];
  };

  const screenOf = (tx: number, ty: number): [number, number] => {
    const [wx, wy] = topVertex(tx, ty);
    return worldToScreen(ctx.camera, wx, wy);
  };

  // ── dumps ───────────────────────────────────────────────────────────────
  const dumpTile = (tx: number, ty: number) => {
    const inMap = tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
    const i = inMap ? tIdx(tx, ty) : -1;
    const terrain = inMap ? ctx.grid.terrain[i] : WATER;
    const sprite = inMap ? terrainSprite(ctx.grid, tx, ty) : null;
    const cell = sprite ? cellOf(ctx.atlas, sprite) : null;
    const [wx, wy] = topVertex(tx, ty);
    const [fx, fy] = footCorner(tx, ty);
    const [sx, sy] = screenOf(tx, ty);
    const [ax, ay] = worldToScreen(ctx.camera, fx, fy);
    const ind = inMap ? industryAt(ctx.grid, tx, ty) : null;
    const renderer = ctx.renderer;
    // What a click HERE resolves to. `pick` takes device px, exactly like the
    // pointer handler (`pos()` in game.ts), so the numbers are comparable with
    // a screenshot scaled by dpr.
    const picked = renderer ? renderer.pick(sx, sy) : null;
    const buildKind: TrackKind = ctx.tool === "road" ? "road" : "dirt";
    const refusal = inMap ? buildRefusal(ctx.grid, buildKind, tx, ty) : "out-of-bounds";
    const out = {
      tile: [tx, ty] as [number, number],
      terrain,
      terrainName: terrainName(terrain),
      index: i,
      sprite,
      cell,
      /**
       * The number that settles a "terrain is stepping" report: how far this
       * tile's anchor row sits from the shared ground line. Flat OpenGFX tiles
       * all declare the same yrel, so this is 0 for every terrain tile; ≠ 0
       * means the anchor is wrong.
       */
      surfaceDriftPx: cell ? cell.anchor[1] - groundReference() : null,
      world: [r(wx), r(wy)] as [number, number],           // top vertex (pick lattice)
      anchorWorld: [r(fx), r(fy)] as [number, number],     // south corner (anchor lands here)
      /** live camera, DEVICE px (what the canvas and pick() speak). */
      screen: [r(sx), r(sy)] as [number, number],
      anchorScreen: [r(ax), r(ay)] as [number, number],
      /** the same point in CSS px (what a screenshot and page.mouse speak). */
      css: [r(sx / ctx.dpr()), r(sy / ctx.dpr())] as [number, number],
      /** on-screen diamond half-extents at the live zoom, for hit-box maths. */
      halfDiamond: [r(HW * ctx.camera.zoom), r(HH * ctx.camera.zoom)] as [number, number],
      occupancy: ind ? ind.id : -1,
      industry: ind ? { id: ind.id, type: ind.type, tx: ind.tx, ty: ind.ty, w: ind.w, h: ind.h } : null,
      track: inMap ? {
        dirtBits: bitsAt(ctx.track, "dirt", tx, ty),
        roadBits: bitsAt(ctx.track, "road", tx, ty),
        dirtPresent: hasTrack(ctx.track, "dirt", tx, ty),
        roadPresent: hasTrack(ctx.track, "road", tx, ty),
        owner: ownerAt(ctx.track, tx, ty),
        /** PP-13: one of the map's public highways (owner PUBLIC_OWNER). */
        publicRoad: isPublicRoad(ctx.track, tx, ty),
        /** VP-01: the paved Road here replaced a Dirt Road, so it is worth
         *  `VICTORY.upgrade` to whoever owns the tile. This is the ONE bit the
         *  scoreboard reads about a road, so a screenshot of a disputed point
         *  resolves here. */
        upgradedRoad: isUpgradedRoad(ctx.track, tx, ty),
        /** VP-01: what a `road` build at this tile would be: nothing (already
         *  paved), the in-place PAVE (dirt under it — the scored case), or a
         *  fresh Road (full price, no point). */
        paveState: hasTrack(ctx.track, "road", tx, ty)
          ? (isUpgradedRoad(ctx.track, tx, ty) ? "upgraded" : "laid-new")
          : hasTrack(ctx.track, "dirt", tx, ty) ? "paveable" : "empty",
      } : null,
      /** Would a build with the CURRENT tool be refused here, and why? */
      build: { kind: buildKind, ok: refusal === null, why: refusal },
      pickAtCentre: picked
        ? { tx: picked.tx, ty: picked.ty, sprite: picked.sprite?.sprite ?? null, hit: !!picked.sprite }
        : null,
    };
    console.log("[iso] dumpTile", tx, ty, out);
    return out;
  };

  /**
   * Resolve a SCREEN point (CSS px by default, i.e. what a screenshot or
   * `page.mouse` uses) to a tile — with both halves of the two-stage pick, so
   * "I clicked the tile I could see and got the one behind it" is a one-line
   * answer. Pass `{ device: true }` for raw canvas pixels.
   */
  const dumpAt = (x: number, y: number, opts?: { device?: boolean }) => {
    const dpr = ctx.dpr();
    const device = opts?.device === true;
    const sx = device ? x : x * dpr;
    const sy = device ? y : y * dpr;
    const [wx, wy] = screenToWorld(ctx.camera, sx, sy);
    const flat = flatPick(wx, wy);
    const renderer = ctx.renderer;
    const picked = renderer ? renderer.pick(sx, sy) : null;
    const tx = picked?.tx ?? flat[0];
    const ty = picked?.ty ?? flat[1];
    const out = {
      input: { x, y, unit: device ? ("device" as const) : ("css" as const) },
      device: [r(sx), r(sy)] as [number, number],
      world: [r(wx), r(wy)] as [number, number],
      flatPick: flat as [number, number],
      spritePick: picked ? { tx: picked.tx, ty: picked.ty, sprite: picked.sprite?.sprite ?? null } : null,
      /** the flat pick and the sprite pick disagreeing is the stage-2 override. */
      overridden: !!picked && (picked.tx !== flat[0] || picked.ty !== flat[1]),
      resolvesTo: [tx, ty] as [number, number],
      inMap: tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H,
    };
    console.log("[iso] dumpAt", out);
    return out;
  };

  /**
   * Every structure drawn on a tile, with the ONE number that settles a hover
   * report: `gapPx` is the distance between the sprite's anchor row (where the
   * declared base is painted) and the footprint's south corner it should stand
   * on. 0 = flush; > 0 = floating; < 0 = sunk.
   */
  const dumpBuilding = (tx: number, ty: number) => {
    const renderer = ctx.renderer;
    const atlas = ctx.atlas;
    const order = renderer?.drawOrder ?? [];
    const hits = order.filter((p: Placed) => {
      const [fw, fh] = p.def.footprint;
      return tx >= p.tx && tx < p.tx + fw && ty >= p.ty && ty < p.ty + fh;
    });
    const [swx, swy] = topVertex(tx, ty);
    const items = hits.map((p) => {
      const [fw, fh] = p.def.footprint;
      const [fx, fy] = footCorner(p.tx, p.ty, fw, fh, !!p.def.center);
      const footWorldY = p.wy + p.def.anchor[1];
      const [, footScreenY] = worldToScreen(ctx.camera, fx, footWorldY);
      const pds = worldToScreen(ctx.camera, p.wx, p.wy);
      return {
        sprite: p.sprite,
        footprint: p.def.footprint,
        anchor: p.def.anchor,
        box: [r(p.w), r(p.h)] as [number, number],
        drawWorld: [r(p.wx), r(p.wy)] as [number, number],
        drawScreen: [r(pds[0]), r(pds[1])] as [number, number],
        /** world y of the footprint's south corner vs of the sprite's anchor row */
        surfaceWorldY: r(fy),
        footWorldY: r(footWorldY),
        footScreenY: r(footScreenY),
        gapPx: r(footWorldY - fy),
        /** the footprint origin this sprite is anchored to (may not be the
         *  tile asked about — a multi-tile building is drawn from its origin). */
        origin: [p.tx, p.ty] as [number, number],
        isIndustry: p.ref != null,
      };
    });
    const tileTerrain = terrainSprite(ctx.grid, tx, ty);
    const tileCell = cellOf(atlas, tileTerrain);
    const out = {
      tile: [tx, ty] as [number, number],
      topVertexWorld: [r(swx), r(swy)] as [number, number],
      ground: {
        sprite: tileTerrain,
        /** the tile's anchor row vs the shared ground line. */
        driftPx: tileCell ? tileCell.anchor[1] - groundReference() : null,
      },
      structures: items,
      note: tileCell && tileCell.anchor[1] !== groundReference()
        ? "this tile's anchor row is off the shared ground line — the sprite is mis-anchored and the terrain will step"
        : "tile is anchored on the shared ground line (flat OpenGFX tile)",
    };
    console.log("[iso] dumpBuilding", tx, ty, out);
    return out;
  };

  /** The tile set that counts as one player's network (the C3 adjacency answer). */
  const dumpNetwork = (player = "you") => {
    const owner = ctx.ownerOf(player);
    if (owner === null) {
      const known = ctx.players.map((p) => p.id).join(", ");
      console.log("[iso] dumpNetwork: unknown player", player);
      return { error: `unknown player "${player}" — try one of: ${known}` };
    }
    const net = playerNetwork(ctx.track, owner, ctx.eco.factories, ctx.eco.harvesters);
    const tiles = [...net].sort((a, b) => a - b).map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
    const dirt = tiles.filter(([x, y]) => hasTrack(ctx.track, "dirt", x, y)).length;
    const road = tiles.filter(([x, y]) => hasTrack(ctx.track, "road", x, y)).length;
    const out = {
      player,
      ownerId: owner,
      seeds: {
        factories: ctx.eco.factories.filter((f) => f.ownerId === owner).map((f) => [f.tx, f.ty]),
        harvesters: ctx.eco.harvesters.filter((x) => x.ownerId === owner).map((x) => [x.tx, x.ty]),
      },
      tiles: tiles.length,
      dirtTiles: dirt,
      roadTiles: road,
      /** VP-01: the paved-over-dirt tiles in this network — the only road
       *  tiles on the scoreboard. `paved * VICTORY.upgrade` is the road half of
       *  the player's total, so a VP number in a screenshot is reproducible. */
      pavedScoredTiles: [...ctx.track.upgraded].filter((v, i) => v !== 0
        && (ctx.track.road[i] & PRESENT) !== 0 && ctx.track.owner[i] === owner).length,
      /** capped so the console stays readable; the count above is exact. */
      list: tiles.slice(0, 256),
      truncated: tiles.length > 256,
    };
    console.log("[iso] dumpNetwork", out);
    return out;
  };

  /**
   * The resolved atlas entry of every sprite on screen (C5's `config()`): the
   * packer's output for the matching `tools/iso-atlas.cells.json` cell —
   * rect, footprint, measured anchor, kind, stack parts, variants. This is
   * what a screenshot gets matched back to a tile choice.
   */
  const config = () => {
    const cam = ctx.camera;
    const range = visibleTileRange(cam, 0);
    const names = new Set<string>();
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        names.add(terrainSprite(ctx.grid, tx, ty));
        if (hasTrack(ctx.track, "road", tx, ty)) names.add(`road_${bitsAt(ctx.track, "road", tx, ty).toString(2).padStart(4, "0")}`);
        if (hasTrack(ctx.track, "dirt", tx, ty)) names.add(`dirt_${bitsAt(ctx.track, "dirt", tx, ty).toString(2).padStart(4, "0")}`);
      }
    }
    for (const p of ctx.renderer?.drawOrder ?? []) names.add(p.sprite);
    const sprites: Record<string, unknown> = {};
    for (const n of names) {
      const c = cellOf(ctx.atlas, n);
      if (c) sprites[n] = c;
    }
    const out = {
      camera: { zoom: cam.zoom, vw: cam.vw, vh: cam.vh, x: r(cam.x), y: r(cam.y) },
      geometry: { tileW: ctx.atlas?.manifest.tileW ?? null, tileH: ctx.atlas?.manifest.tileH ?? null, HW, HH, map: [MAP_W, MAP_H] },
      visibleTiles: { x0: range.x0, y0: range.y0, x1: range.x1, y1: range.y1 },
      /** `assets/iso-atlas/manifest.json` entries — the packer's resolved
       *  output for each cell of `tools/iso-atlas.cells.json` (the manifest
       *  deliberately carries no PNG paths; re-run `npm run slice-atlas` and
       *  read that file if you need the source art for a sprite). */
      manifestMeta: ctx.atlas?.manifest.meta ?? null,
      sprites,
    };
    console.log("[iso] config", out);
    return out;
  };

  // ── the overlay painter ─────────────────────────────────────────────────
  const diamondPath = (c: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number) => {
    c.beginPath();
    c.moveTo(cx, cy - hh);
    c.lineTo(cx + hw, cy);
    c.lineTo(cx, cy + hh);
    c.lineTo(cx - hw, cy);
    c.closePath();
  };

  const paint = (c: CanvasRenderingContext2D, cam: Camera) => {
    const z = cam.zoom;
    const hw = HW * z, hh = HH * z;
    // The drawn tile diamond has its TOP vertex at the pick lattice point
    // (tileToScreen), so its centre sits HH below that point on screen.
    const diamondCentre = (tx: number, ty: number): [number, number] => {
      const [sx, sy] = screenOf(tx, ty);
      return [sx, sy + hh];
    };
    if (overlays.has("network")) {
      const you = ctx.ownerOf("you"), ai = ctx.ownerOf("ai");
      for (const [owner, colour] of [[you, "rgba(80,220,120,0.45)"], [ai, "rgba(255,110,80,0.45)"]] as const) {
        if (owner === null) continue;
        const net = playerNetwork(ctx.track, owner, ctx.eco.factories, ctx.eco.harvesters);
        c.fillStyle = colour;
        for (const i of net) {
          const [tx, ty] = [i % MAP_W, (i / MAP_W) | 0];
          const [cx, cy] = diamondCentre(tx, ty);
          diamondPath(c, cx, cy, hw, hh);
          c.fill();
        }
      }
    }
    if (overlays.has("anchor") && ctx.renderer) {
      c.strokeStyle = "#7cff5a";
      c.fillStyle = "#7cff5a";
      c.font = `${Math.max(9, Math.round(9 * z))}px monospace`;
      for (const p of ctx.renderer.drawOrder) {
        const [fx, fy] = footCorner(p.tx, p.ty, p.def.footprint[0], p.def.footprint[1], !!p.def.center);
        const footY = p.wy + p.def.anchor[1];
        const [sx, sy] = worldToScreen(cam, fx, footY);
        c.beginPath();
        c.moveTo(sx - 6, sy); c.lineTo(sx + 6, sy);
        c.moveTo(sx, sy - 6); c.lineTo(sx, sy + 6);
        c.stroke();
        const gap = footY - fy;
        if (Math.abs(gap) > 0.5) c.fillText(`${p.sprite} ${r(gap)}px`, sx + 8, sy - 2);
      }
    }
    if (overlays.has("pick")) {
      const hov = ctx.hover;
      if (hov) {
        // ONE convention: the pick cell IS the drawn diamond — the diamond's
        // top vertex sits on tileToScreen and its body is what the flat pick
        // resolves. A visible offset between the two outlines is a bug.
        const [cx, cy] = diamondCentre(hov.tx, hov.ty);
        c.strokeStyle = "#ffffff";
        diamondPath(c, cx, cy, hw, hh);
        c.stroke();
        c.strokeStyle = "#ff5af0";
        c.setLineDash([4, 3]);
        diamondPath(c, cx, cy, hw, hh);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = "#ff5af0";
        c.fillRect(cx - 1, cy - 1, 3, 3);
      }
      const [mx, my] = [ctx.camera.vw / 2, ctx.camera.vh / 2];
      c.strokeStyle = "#ffffff";
      c.beginPath();
      c.moveTo(mx - 4, my); c.lineTo(mx + 4, my);
      c.moveTo(mx, my - 4); c.lineTo(mx, my + 4);
      c.stroke();
    }
    // D3: HUD line / legend when debug overlays are active
    if (overlays.size > 0) {
      const activeList = [...overlays].join("+");
      const legend = `DEBUG: [${activeList}] green=anchor magenta=pick (~ toggle)`;
      c.fillStyle = "rgba(0, 0, 0, 0.75)";
      c.fillRect(8, 8, 490, 20);
      c.strokeStyle = "#ffb01f";
      c.strokeRect(8, 8, 490, 20);
      c.fillStyle = "#ffffff";
      c.font = "11px monospace";
      c.fillText(legend, 14, 22);
    }
  };

  const attachRenderer = () => {
    const renderer = ctx.renderer;
    if (!renderer) return;
    renderer.debugPainter = overlays.size ? paint : null;
  };

  /** Toggle a debug overlay. `overlay()` lists the active ones. */
  const overlay = (name?: DebugOverlayName | "none" | "all", on = true) => {
    if (!name) return { active: [...overlays], drawn: overlays.size > 0 };
    if (name === "none") overlays.clear();
    else if (name === "all") for (const o of DEBUG_OVERLAYS) overlays.add(o);
    else if (on) overlays.add(name);
    else overlays.delete(name);
    attachRenderer();
    const out = { active: [...overlays], drawn: overlays.size > 0 };
    console.log("[iso] overlay", out);
    return out;
  };

  const catchmentOf = (tx: number, ty: number) => {
    const rect = catchmentRect(tx, ty);
    const seen = industriesInCatchment(ctx.grid, { id: -1, owner: "you", ownerId: 0, tx, ty });
    return { rect, industries: seen.map((x) => ({ id: x.id, type: x.type, tx: x.tx, ty: x.ty })) };
  };

  const commands: Record<string, unknown> = {
    dumpTile, dumpAt, dumpBuilding, dumpNetwork, overlay, config,
    /**
     * Render-debug surface: the exact rects/clip/depth numbers the renderer
     * used on the last frame, plus warnings for known bug classes (anchor
     * drift, standing sprite clipped, fractional zoom source rect, depth
     * cycles). `__iso.rendering()` returns the same object.
     */
    rendering: () => {
      const out = ctx.renderer ? ctx.renderer.renderDiagnostics() : null;
      console.log("[iso] rendering", out);
      return out;
    },
    /**
     * `__iso.roadMode('textured'|'sprites')` switches the road renderer.
     *
     * An A/B switch for the vector-road work, deliberately living only on the
     * debug console: it is renderer state, not game state, so it never enters
     * a save or the multiplayer protocol and both players always simulate the
     * same roads whatever they are looking at.
     */
    roadMode: (mode?: "sprites" | "textured") => {
      if (mode) ctx.renderer?.setRoadMode(mode);
      ctx.renderer?.invalidateAll();
      const out = ctx.renderer?.roadDiagnostics() ?? null;
      console.log("[iso] roadMode", out);
      return out;
    },
    /**
     * `__iso.highlightMode('vector'|'sprites')` switches the placement overlay
     * between the vector grid + ghost preview and the four baked atlas cells.
     *
     * The same A/B seam `roadMode` is: renderer state only, so it never enters
     * a save or the protocol — both players place by the same rules whatever
     * they are looking at.
     */
    highlightMode: (mode?: "sprites" | "vector") => {
      if (mode) ctx.renderer?.setHighlightMode(mode);
      const out = ctx.renderer?.overlayDiagnostics() ?? null;
      console.log("[iso] highlightMode", out);
      return out;
    },
    /** `__iso.renderLog(true)` toggles the per-blit `[render]` console trace. */
    renderLog: (on = true) => {
      ctx.renderer?.setRenderLog(!!on);
      const out = { on: !!on };
      console.log("[iso] renderLog", out);
      return out;
    },
    /** C5: the harvester catchment + build legality for a tile, in one call. */
    probe: (tx: number, ty: number) => {
      const kind: TrackKind = ctx.tool === "road" ? "road" : "dirt";
      const why = buildRefusal(ctx.grid, kind, tx, ty);
      const taken = ctx.eco.harvesters.some((x) => x.tx === tx && x.ty === ty);
      const cat = catchmentOf(tx, ty);
      const out = {
        tile: [tx, ty], tool: ctx.tool, phase: ctx.phase,
        terrain: terrainName(ctx.grid.terrain[tIdx(tx, ty)] ?? WATER),
        build: { kind, ok: why === null, why },
        harvester: {
          ok: why === null && !taken && cat.industries.length > 0,
          why: why ?? (taken ? "harvester-taken" : cat.industries.length ? null : "no-industry-in-catchment"),
          industries: cat.industries,
          rect: cat.rect,
        },
        rough: ctx.grid.terrain[tIdx(tx, ty)] === ROUGH,
        occupied: ctx.grid.occupancy[tIdx(tx, ty)] ?? -1,
      };
      console.log("[iso] probe", out);
      return out;
    },

    /**
     * `__iso.shapes(tx?, ty?)` — F2 (#272): one synthetic building of EVERY
     * supported footprint shape, side by side on one row, drawn through the
     * real pipeline (world.extra → depth sort → shadows → picking). The art is
     * generated here (plate = the footprint diamond, plus a box standing on
     * it), so the plate's silhouette is the footprint and hover picking can be
     * reviewed against it at zoom 0.5 / 1 / 2. `__iso.shapes("clear")` takes
     * them out again. Note: `syncWorld` rebuilds `world.extra` on any build or
     * demolish — re-run this after changing the map.
     */
    shapes: (where?: [number, number] | "clear") => {
      const renderer = ctx.renderer;
      const atlas = ctx.atlas;
      if (!renderer || !atlas) {
        const out = { error: "no renderer/atlas yet" };
        console.log("[iso] shapes", out);
        return out;
      }
      // Always clear first, so re-running never stacks a second row.
      const isShapeItem = (e: { ref?: unknown }) =>
        (e.ref as { kind?: string } | null | undefined)?.kind === "shapeDebug";
      renderer.world.extra = (renderer.world.extra ?? []).filter((e) => !isShapeItem(e));
      const names = SHAPE_GALLERY_FOOTPRINTS.map(([fw, fh]) => `shape_${fw}x${fh}`);
      if (where === "clear") {
        for (const name of names) {
          delete atlas.manifest.sprites[name];
          atlas.buildingImages.delete(name);
        }
        renderer.recomputePad();
        renderer.invalidateAll();
        const out = { cleared: true };
        console.log("[iso] shapes", out);
        return out;
      }
      if (typeof document === "undefined") {
        const out = { error: "shapes() needs a browser canvas" };
        console.log("[iso] shapes", out);
        return out;
      }
      const cam = ctx.camera;
      const [ax, ay] = where ?? screenToTileAt(cam, cam.vw / 2, cam.vh / 2);
      const layout = shapeGalleryLayout(ax - 15, ay);
      for (const slot of layout) {
        const def = shapeGalleryDef(slot.footprint);
        atlas.manifest.sprites[slot.name] = def;
        const byZoom = new Map<number, AtlasImage>();
        let pixels: Uint8ClampedArray | null = null;
        for (const z of [0.5, 1, 2]) {
          const w = Math.round(def.w * z), h = Math.round(def.h * z);
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const c2 = cv.getContext("2d");
          if (!c2) break;
          c2.scale(z, z);
          paintShapeArt(c2, slot.footprint, def);
          byZoom.set(z, cv as unknown as AtlasImage);
          if (z === 1) pixels = c2.getImageData(0, 0, w, h).data;
        }
        atlas.buildingImages.set(slot.name, byZoom);
        if (pixels) atlas.setMask(slot.name, maskFromRGBA(pixels, def.w, def.h, 8, 1));
        renderer.world.extra!.push({
          sprite: slot.name, tx: slot.tx, ty: slot.ty,
          ref: { kind: "shapeDebug", shape: slot.name } as unknown,
        });
      }
      renderer.recomputePad();
      renderer.invalidateAll();
      // Recentre the camera on the row so the gallery is in frame at once.
      const last = layout[layout.length - 1];
      const [lx, ly] = tileToScreen(last.tx + last.footprint[0] - 1, last.ty + last.footprint[1] - 1);
      const [fx0, fy0] = tileToScreen(layout[0].tx, layout[0].ty);
      const cx = (fx0 + lx) / 2, cy = (fy0 + ly) / 2 + TILE_H;
      cam.x = cam.vw / 2 - cx * cam.zoom;
      cam.y = cam.vh / 2 - cy * cam.zoom;
      const out = {
        slots: layout.map((s) => ({ name: s.name, footprint: s.footprint, tx: s.tx, ty: s.ty })),
        camera: { zoom: cam.zoom, x: r(cam.x), y: r(cam.y) },
        note: "drawn via world.extra — re-run __iso.shapes() after any build/demolish (syncWorld rebuilds the list)",
      };
      console.log("[iso] shapes", out);
      return out;
    },
  };

  return { commands, attachRenderer, overlay, activeOverlays: () => [...overlays], paint };
}

export type IsoDebug = NonNullable<ReturnType<typeof createIsoDebug>>;
