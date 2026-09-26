// ══════════════════════════════════════════════════════════════════════════
// Terrain-GL glue (docs/TERRAIN_GL.md): mounts the WebGL2 terrain renderer
// UNDER the 2D layer stack and feeds it the map, the camera and tile changes.
// ON by default (owner call 2026-09-25). `?terrain=2d` switches back to the
// old 2D ground (remembered); `?terrain=gl` clears that. When
// WebGL2 is missing the mount returns null and the 2D ground stays.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_H, MAP_W } from "../game/config";
import type { Grid } from "./grid";
import { cornerHeight, elevationActive } from "./elevation";
import { createTerrainRenderer, type TerrainCamera, type TerrainMapInput, type TerrainRenderer, type TerrainTextureUrls } from "./terrain-gl";

/** Every PNG in the ground-art folder, keyed by path. A glob (not static
 *  imports) means the #451 variant files — grass_b_512.png and friends — are
 *  picked up the moment the lead drops them in, with no build error while a
 *  file is still missing. */
const TERRAIN_FILES = import.meta.glob("../assets/terrain/*.png", {
  eager: true, query: "?url", import: "default",
}) as Record<string, string>;

const fileUrl = (name: string): string | undefined => {
  for (const key of Object.keys(TERRAIN_FILES)) if (key.endsWith(`/${name}`)) return TERRAIN_FILES[key];
  return undefined;
};

/** Painted ground set (tools/terrain/make_seamless.py). grass = the shipped
 *  grass texture, meadow = a lighter copy of it (owner call 2026-09-26); the
 *  water normal map stays procedural.
 *
 *  #451: each material has three variant slots. `_a_` is variant A, and today's
 *  `<material>_512.png` is used as A when the `_a_` file does not exist yet;
 *  variants B and C come from `<material>_b_512.png` / `_c_512.png`. A missing
 *  variant (the current art) falls back to a placeholder the renderer derives
 *  from variant A — rotated, hue/value shifted. Files the artist still owes:
 *    terrain/grass_{a,b,c}_512.png, terrain/meadow_{a,b,c}_512.png,
 *    terrain/dirt_{a,b,c}_512.png, terrain/rock_{a,b,c}_512.png,
 *    terrain/sand_{a,b,c}_512.png
 *  (all seamless, 512², same painterly style as the `_512.png` files). */
const TEXTURES: TerrainTextureUrls = {
  grass: fileUrl("grass_a_512.png") ?? fileUrl("grass_512.png"),
  grassB: fileUrl("grass_b_512.png"),
  grassC: fileUrl("grass_c_512.png"),
  meadow: fileUrl("meadow_a_512.png") ?? fileUrl("meadow_512.png"),
  meadowB: fileUrl("meadow_b_512.png"),
  meadowC: fileUrl("meadow_c_512.png"),
  dirt: fileUrl("dirt_a_512.png") ?? fileUrl("dirt_512.png"),
  dirtB: fileUrl("dirt_b_512.png"),
  dirtC: fileUrl("dirt_c_512.png"),
  rock: fileUrl("rock_a_512.png") ?? fileUrl("rock_512.png"),
  rockB: fileUrl("rock_b_512.png"),
  rockC: fileUrl("rock_c_512.png"),
  sand: fileUrl("sand_a_512.png") ?? fileUrl("sand_512.png"),
  sandB: fileUrl("sand_b_512.png"),
  sandC: fileUrl("sand_c_512.png"),
  detail: fileUrl("detail_256.png"),
};

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
  return { w: MAP_W, h: MAP_H, terrain: grid.terrain, rivers: grid.rivers, heights, seed: seed >>> 0 };
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
