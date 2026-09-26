// ══════════════════════════════════════════════════════════════════════════
// Terrain-GL glue (docs/TERRAIN_GL.md): mounts the WebGL2 terrain renderer
// UNDER the 2D layer stack and feeds it the map, the camera and tile changes.
// ON by default (owner call 2026-09-25). `?terrain=2d` switches back to the
// old 2D ground (remembered); `?terrain=gl` clears that. When
// WebGL2 is missing the mount returns null and the 2D ground stays.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_H, MAP_W } from "../game/config";
import { settledGroundBytes, type Grid } from "./grid";
import { cornerHeight, elevationActive } from "./elevation";
import { createTerrainRenderer, type TerrainCamera, type TerrainMapInput, type TerrainRenderer } from "./terrain-gl";

import grassUrl from "../assets/terrain/grass_512.png";
import meadowUrl from "../assets/terrain/meadow_512.png";
import dirtUrl from "../assets/terrain/dirt_512.png";
import rockUrl from "../assets/terrain/rock_512.png";
import sandUrl from "../assets/terrain/sand_512.png";
import detailUrl from "../assets/terrain/detail_256.png";

/** Painted ground set (tools/terrain/make_seamless.py). grass = the shipped
 *  grass texture, meadow = a lighter copy of it (owner call 2026-09-26);
 *  the water normal map stays procedural. */
const TEXTURES = { grass: grassUrl, meadow: meadowUrl, dirt: dirtUrl, rock: rockUrl, sand: sandUrl, detail: detailUrl };

const STORE_KEY = "hexmatch:terrain-gl";

/** Is the GL terrain asked for? URL wins over the stored choice. */
export function terrainGlWanted(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  try {
    const q = new URLSearchParams(search).get("terrain");
    if (q === "gl") { localStorage.removeItem(STORE_KEY); return true; }
    if (q === "2d") { localStorage.setItem(STORE_KEY, "0"); return false; }
    return localStorage.getItem(STORE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The map as the module's contract wants it (corner heights built here). */
export function terrainMapInput(grid: Grid, seed: number): TerrainMapInput {
  let heights: Uint8Array | undefined;
  if (elevationActive(grid)) {
    heights = new Uint8Array((MAP_W + 1) * (MAP_H + 1));
    for (let j = 0; j <= MAP_H; j++) {
      for (let i = 0; i <= MAP_W; i++) heights[j * (MAP_W + 1) + i] = Math.max(0, Math.round(cornerHeight(grid, i, j)));
    }
  }
  // #437: the tended-ground mask — town blocks and industry footprints. The
  // shader grows its apron from this and keeps the bare-earth material off
  // both, so no town lot or works yard renders as flat brown dirt.
  const settled = settledGroundBytes(grid) ?? undefined;
  return { w: MAP_W, h: MAP_H, terrain: grid.terrain, rivers: grid.rivers, heights, settled, seed: seed >>> 0 };
}

export interface TerrainGl {
  canvas: HTMLCanvasElement;
  renderer: TerrainRenderer;
  render(cam: TerrainCamera, timeMs: number): void;
  resize(w: number, h: number): void;
  invalidateTiles(tiles: ReadonlyArray<readonly [number, number]>): void;
  dispose(): void;
}

/** Mount under `host`'s first layer. Returns null (and leaves no canvas) when WebGL2 is unavailable. */
export function mountTerrainGl(host: HTMLElement, grid: Grid, seed: number, quality: "high" | "low" = "high"): TerrainGl | null {
  const canvas = document.createElement("canvas");
  canvas.className = "iso-layer iso-terrain-gl";
  canvas.style.zIndex = "0";
  host.insertBefore(canvas, host.firstChild);
  let renderer: TerrainRenderer | null = null;
  try { renderer = createTerrainRenderer(canvas, { quality, textures: TEXTURES }); } catch { renderer = null; }
  if (!renderer) { canvas.remove(); return null; }
  renderer.setMap(terrainMapInput(grid, seed));
  const r = renderer;
  return {
    canvas, renderer: r,
    render: (cam, t) => r.render(cam, t),
    resize: (w, h) => { canvas.width = w; canvas.height = h; r.resize(w, h); },
    invalidateTiles: (tiles) => { if (tiles.length) r.invalidateTiles(tiles); },
    dispose: () => { r.dispose(); canvas.remove(); },
  };
}
