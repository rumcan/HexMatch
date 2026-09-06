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
//   __iso.dumpTile(tx, ty)      terrain cell, sprite, measured skirt, anchor,
//                               screen position, and what pick() says about it
//   __iso.dumpAt(x, y)          which tile a SCREEN point resolves to (both the
//                               flat pick and the stage-2 sprite pick)
//   __iso.dumpBuilding(tx, ty)  every structure on the tile: its stack parts,
//                               their draw offsets, and the gap between its
//                               foot and the tile surface (the hover, in px)
//   __iso.dumpNetwork(player)   exactly which tiles count as that player's
//                               network — the adjacency answer for "why was my
//                               road refused"
//   __iso.overlay(name)         draw skirt / anchor / network / pick marks on
//                               the map, so a screenshot SHOWS them
//   __iso.config()              the resolved atlas entry (the packer's output
//                               for each cells.json cell) of every sprite on
//                               screen right now
//
// Gating: `shouldInstallDebugConsole` — DEV builds always, a production build
// only with `?iso-debug` on the URL. When it is off, game.ts installs nothing
// and the renderer's `debugPainter` stays null, so no dump code runs at all.
// Docs: docs/iso-debug-console.md.
// ══════════════════════════════════════════════════════════════════════════
import { BLOCK_H, HH, HW, MAP_W, MAP_H, tileToScreen } from "../game/config";
import { screenToWorld, visibleTileRange, worldToScreen, type Camera } from "./camera";
import { flatPick, terrainSprite, type IsoRenderer } from "./renderer";
import { WATER, ROUGH, industryAt, type Grid } from "./grid";
import {
  bitsAt, buildRefusal, hasTrack, ownerAt, playerNetwork, tIdx, type Track, type TrackKind,
} from "./track";
import { catchmentRect, industriesInCatchment, type EconomyState } from "./economy";
import type { Atlas, SpriteDef } from "./atlas";
import type { Placed } from "./depth";

export type DebugOverlayName = "skirt" | "anchor" | "network" | "pick";
export const DEBUG_OVERLAYS: DebugOverlayName[] = ["skirt", "anchor", "network", "pick"];

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
  const v = q.get("iso-debug");
  return v !== null && v !== "0" && v !== "false";
}

const r = (n: number): number => Math.round(n * 100) / 100;
const TERRAIN_NAME = ["grass", "water", "rough"] as const;
const terrainName = (v: number) => TERRAIN_NAME[v] ?? `#${v}`;

/** The manifest entry for a sprite, trimmed to what a geometry report needs. */
function cellOf(atlas: Atlas | null, name: string) {
  const def: SpriteDef | undefined = atlas?.get(name);
  if (!def) return null;
  return {
    sprite: name,
    atlasRect: [def.x, def.y, def.w, def.h],
    footprint: def.footprint,
    anchor: def.anchor,
    kind: (def as SpriteDef & { kind?: string }).kind ?? null,
    frames: def.frames ?? 1,
    variants: def.variants ?? null,
    parts: def.parts ?? null,
    /** px of block below the sprite's anchor row — for a flat tile, its skirt. */
    belowAnchorPx: def.h - def.anchor[1],
  };
}

/**
 * Build the console. Returns null when the gate says "off" — the caller then
 * installs nothing.
 */
export function createIsoDebug(ctx: DebugContext) {
  const overlays = new Set<DebugOverlayName>();

  /** World (1×, camera-free) position of a tile's diamond centre-line. */
  const surfaceWorld = (tx: number, ty: number, fw = 1, fh = 1): [number, number] =>
    tileToScreen(tx + (fw - 1) / 2, ty + (fh - 1) / 2);

  const screenOf = (tx: number, ty: number): [number, number] => {
    const [wx, wy] = tileToScreen(tx, ty);
    return worldToScreen(ctx.camera, wx, wy);
  };

  // ── dumps ───────────────────────────────────────────────────────────────
  const dumpTile = (tx: number, ty: number) => {
    const inMap = tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
    const i = inMap ? tIdx(tx, ty) : -1;
    const terrain = inMap ? ctx.grid.terrain[i] : WATER;
    const sprite = inMap ? terrainSprite(ctx.grid, tx, ty) : null;
    const cell = sprite ? cellOf(ctx.atlas, sprite) : null;
    const [wx, wy] = surfaceWorld(tx, ty);
    const [sx, sy] = screenOf(tx, ty);
    const ind = inMap ? industryAt(ctx.grid, tx, ty) : null;
    const renderer = ctx.renderer;
    // What a click HERE resolves to. `pick` takes device px, exactly like the
    // pointer handler (`pos()` in game.ts), so the numbers are comparable with
    // a screenshot scaled by dpr.
    const picked = renderer ? renderer.pick(sx, sy) : null;
    const refusal = inMap ? buildRefusal(ctx.grid, (ctx.tool === "rail" ? "rail" : "road") as TrackKind, tx, ty) : "out-of-bounds";
    const out = {
      tile: [tx, ty] as [number, number],
      terrain,
      terrainName: terrainName(terrain),
      index: i,
      sprite,
      cell,
      /** px of block below the tile's widest row; BLOCK_H (50) is canonical. */
      skirtPx: cell ? cell.belowAnchorPx : null,
      canonicalSkirtPx: BLOCK_H,
      /** ≠ 0 means this tile's block is shallower/deeper than the canonical —
       *  the C1 hover class of bug, in one number. */
      skirtDriftPx: cell ? cell.belowAnchorPx - BLOCK_H : null,
      world: [r(wx), r(wy)] as [number, number],
      /** live camera, DEVICE px (what the canvas and pick() speak). */
      screen: [r(sx), r(sy)] as [number, number],
      /** the same point in CSS px (what a screenshot and page.mouse speak). */
      css: [r(sx / ctx.dpr()), r(sy / ctx.dpr())] as [number, number],
      /** on-screen diamond half-extents at the live zoom, for hit-box maths. */
      halfDiamond: [r(HW * ctx.camera.zoom), r(HH * ctx.camera.zoom)] as [number, number],
      occupancy: ind ? ind.id : -1,
      industry: ind ? { id: ind.id, type: ind.type, tx: ind.tx, ty: ind.ty, w: ind.w, h: ind.h } : null,
      track: inMap ? {
        roadBits: bitsAt(ctx.track, "road", tx, ty),
        railBits: bitsAt(ctx.track, "rail", tx, ty),
        roadPresent: hasTrack(ctx.track, "road", tx, ty),
        railPresent: hasTrack(ctx.track, "rail", tx, ty),
        owner: ownerAt(ctx.track, tx, ty),
      } : null,
      /** Would a build with the CURRENT tool be refused here, and why? */
      build: { kind: ctx.tool === "rail" ? "rail" : "road", ok: refusal === null, why: refusal },
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
   * report: `gapPx` is the distance between the sprite's contact row (its
   * anchor, where the base diamond's widest row is painted) and the tile
   * surface it should stand on. 0 = flush; > 0 = floating; < 0 = sunk.
   */
  const dumpBuilding = (tx: number, ty: number) => {
    const renderer = ctx.renderer;
    const atlas = ctx.atlas;
    const order = renderer?.drawOrder ?? [];
    const hits = order.filter((p: Placed) => {
      const [fw, fh] = p.def.footprint;
      return tx >= p.tx && tx < p.tx + fw && ty >= p.ty && ty < p.ty + fh;
    });
    const [swx, swy] = surfaceWorld(tx, ty);
    const items = hits.map((p) => {
      const [fw, fh] = p.def.footprint;
      const [cx, cy] = surfaceWorld(p.tx, p.ty, fw, fh);
      const footWorldY = p.wy + p.def.anchor[1];
      const [, footScreenY] = worldToScreen(ctx.camera, cx, footWorldY);
      const pds = worldToScreen(ctx.camera, p.wx, p.wy);
      const parts = p.def.parts?.map((part) => {
        const def = atlas?.get(part.sprite);
        return {
          sprite: part.sprite,
          offset: [part.dx, part.dy] as [number, number],
          anchor: def?.anchor ?? null,
          /** this layer's own contact row, relative to the stack box */
          layerFootY: def ? part.dy + def.anchor[1] : null,
        };
      }) ?? null;
      return {
        sprite: p.sprite,
        footprint: p.def.footprint,
        anchor: p.def.anchor,
        box: [r(p.w), r(p.h)] as [number, number],
        drawWorld: [r(p.wx), r(p.wy)] as [number, number],
        drawScreen: [r(pds[0]), r(pds[1])] as [number, number],
        /** world y of the tile surface vs of the sprite's contact row */
        surfaceWorldY: r(cy),
        footWorldY: r(footWorldY),
        footScreenY: r(footScreenY),
        gapPx: r(footWorldY - cy),
        /** the standing block drawn BELOW the contact row (terrain skirt depth). */
        belowFootPx: r(p.wy + p.def.h - footWorldY),
        /** the footprint origin this sprite is anchored to (may not be the
         *  tile asked about — a 2×2 building is drawn from its origin). */
        origin: [p.tx, p.ty] as [number, number],
        isIndustry: p.ref != null,
        parts,
      };
    });
    const tileTerrain = terrainSprite(ctx.grid, tx, ty);
    const tileCell = cellOf(atlas, tileTerrain);
    const out = {
      tile: [tx, ty] as [number, number],
      surfaceWorld: [r(swx), r(swy)] as [number, number],
      ground: { sprite: tileTerrain, skirtPx: tileCell?.belowAnchorPx ?? null, driftPx: tileCell ? tileCell.belowAnchorPx - BLOCK_H : null },
      structures: items,
      /** the ground's own drift is what makes a flush building LOOK wrong (C1). */
      note: tileCell && tileCell.belowAnchorPx !== BLOCK_H
        ? "this tile's block depth differs from the canonical skirt — buildings are flush with the SURFACE, but the block silhouette is offset"
        : "tile geometry matches the canonical block",
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
    const road = tiles.filter(([x, y]) => hasTrack(ctx.track, "road", x, y)).length;
    const rail = tiles.filter(([x, y]) => hasTrack(ctx.track, "rail", x, y)).length;
    const out = {
      player,
      ownerId: owner,
      seeds: {
        factories: ctx.eco.factories.filter((f) => f.ownerId === owner).map((f) => [f.tx, f.ty]),
        harvesters: ctx.eco.harvesters.filter((x) => x.ownerId === owner).map((x) => [x.tx, x.ty]),
      },
      tiles: tiles.length,
      roadTiles: road,
      railTiles: rail,
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
        if (hasTrack(ctx.track, "rail", tx, ty)) names.add(`rail_${bitsAt(ctx.track, "rail", tx, ty).toString(2).padStart(4, "0")}`);
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
      geometry: { tileW: ctx.atlas?.manifest.tileW ?? null, tileH: ctx.atlas?.manifest.tileH ?? null, blockH: BLOCK_H, HW, HH, map: [MAP_W, MAP_H] },
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
    const atlas = ctx.atlas;
    if (overlays.has("network")) {
      const you = ctx.ownerOf("you"), ai = ctx.ownerOf("ai");
      for (const [owner, colour] of [[you, "rgba(80,220,120,0.45)"], [ai, "rgba(255,110,80,0.45)"]] as const) {
        if (owner === null) continue;
        const net = playerNetwork(ctx.track, owner, ctx.eco.factories, ctx.eco.harvesters);
        c.fillStyle = colour;
        for (const i of net) {
          const [tx, ty] = [i % MAP_W, (i / MAP_W) | 0];
          const [sx, sy] = screenOf(tx, ty);
          diamondPath(c, sx, sy, hw, hh);
          c.fill();
        }
      }
    }
    if (overlays.has("skirt") && atlas) {
      const range = visibleTileRange(cam, 0);
      c.lineWidth = 1;
      for (let ty = Math.max(0, range.y0); ty <= Math.min(MAP_H - 1, range.y1); ty++) {
        for (let tx = Math.max(0, range.x0); tx <= Math.min(MAP_W - 1, range.x1); tx++) {
          const cell = cellOf(atlas, terrainSprite(ctx.grid, tx, ty));
          if (!cell) continue;
          const [sx, sy] = screenOf(tx, ty);
          // the surface line (cyan) and the block bottom (amber): a tile whose
          // skirt ≠ BLOCK_H shows a different gap between the two.
          c.strokeStyle = "#37e0ff";
          c.beginPath(); c.moveTo(sx - hw, sy); c.lineTo(sx + hw, sy); c.stroke();
          const drift = cell.belowAnchorPx - BLOCK_H;
          c.strokeStyle = drift === 0 ? "#ffb01f" : "#ff2d55";
          const by = sy + cell.belowAnchorPx * z;
          c.beginPath(); c.moveTo(sx - hw, by); c.lineTo(sx + hw, by); c.stroke();
          if (drift !== 0) {
            c.strokeStyle = "#ff2d55";
            diamondPath(c, sx, sy, hw, hh);
            c.stroke();
            c.fillStyle = "#ff2d55";
            c.font = `${Math.max(9, Math.round(9 * z))}px monospace`;
            c.fillText(`${drift > 0 ? "+" : ""}${drift}`, sx - 6, sy - hh - 2);
          }
        }
      }
    }
    if (overlays.has("anchor") && ctx.renderer) {
      c.strokeStyle = "#7cff5a";
      c.fillStyle = "#7cff5a";
      c.font = `${Math.max(9, Math.round(9 * z))}px monospace`;
      for (const p of ctx.renderer.drawOrder) {
        const [cx, cy] = surfaceWorld(p.tx, p.ty, p.def.footprint[0], p.def.footprint[1]);
        const footY = p.wy + p.def.anchor[1];
        const [sx, sy] = worldToScreen(cam, cx, footY);
        c.beginPath();
        c.moveTo(sx - 6, sy); c.lineTo(sx + 6, sy);
        c.moveTo(sx, sy - 6); c.lineTo(sx, sy + 6);
        c.stroke();
        const gap = footY - cy;
        if (Math.abs(gap) > 0.5) c.fillText(`${p.sprite} ${r(gap)}px`, sx + 8, sy - 2);
      }
    }
    if (overlays.has("pick")) {
      const hov = ctx.hover;
      if (hov) {
        // drawn diamond (what you SEE under the cursor) vs the pick cell (the
        // lattice floor() resolves to) — the K4 HH offset, visible at last.
        const [sx, sy] = screenOf(hov.tx, hov.ty);
        c.strokeStyle = "#ffffff";
        diamondPath(c, sx, sy, hw, hh);
        c.stroke();
        c.strokeStyle = "#ff5af0";
        diamondPath(c, sx, sy + hh, hw, hh);
        c.stroke();
        c.fillStyle = "#ff5af0";
        c.fillRect(sx - 1, sy + hh - 1, 3, 3);
      }
      const [mx, my] = [ctx.camera.vw / 2, ctx.camera.vh / 2];
      c.strokeStyle = "#ffffff";
      c.beginPath();
      c.moveTo(mx - 4, my); c.lineTo(mx + 4, my);
      c.moveTo(mx, my - 4); c.lineTo(mx, my + 4);
      c.stroke();
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
    /** C5: the harvester catchment + build legality for a tile, in one call. */
    probe: (tx: number, ty: number) => {
      const kind: TrackKind = ctx.tool === "rail" ? "rail" : "road";
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
  };

  return { commands, attachRenderer, overlay, activeOverlays: () => [...overlays], paint };
}

export type IsoDebug = NonNullable<ReturnType<typeof createIsoDebug>>;
