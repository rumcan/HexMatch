import { it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { buildRefusal } from "../../src/iso/track";
import { planFactoryPlacement } from "../../src/iso/placement";
import { createCamera, centerOnTile, zoomStepAt, tileToScreenAt } from "../../src/iso/camera";
import { CELL, BOARD_W } from "../../src/game/config";

const VIEW_W = 1280, VIEW_H = 720, DPR = 1;
const DIRS = [
  { name: "SW", dx: 0, dy: 1 }, { name: "NW", dx: -1, dy: 0 },
  { name: "NE", dx: 0, dy: -1 }, { name: "SE", dx: 1, dy: 0 },
];

it("seed 79 valid endpoints vs the boot-camera band", async () => {
  const grid = generateMap(79);
  const f = grid.industries[0];
  let cam = centerOnTile(createCamera(VIEW_W * DPR, VIEW_H * DPR), f.tx, f.ty);
  cam = zoomStepAt(cam, -1, (VIEW_W / 2) * DPR, (VIEW_H / 2) * DPR);
  const boardW = Math.ceil((CELL * BOARD_W + 10) * 0.68);
  const bandL = 10 + 300, bandR = VIEW_W - 10 - (boardW + 30);
  console.log(`focus ind0 (${f.tx},${f.ty}) band x ${bandL}..${bandR} (${bandR - bandL}px) boardW=${boardW}`);
  const hits: string[] = [];
  for (const ind of grid.industries) {
    for (const d of DIRS) {
      const hx = d.dx === 1 ? ind.tx + ind.w : d.dx === -1 ? ind.tx - 1 : ind.tx;
      const hy = d.dy === 1 ? ind.ty + ind.h : d.dy === -1 ? ind.ty - 1 : ind.ty;
      for (let j = 0; j <= 14; j++) {
        const tx = hx + d.dx * j, ty = hy + d.dy * j;
        if (buildRefusal(grid, "road", tx, ty) !== null) break;
        if (j >= 3) {
          const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true });
          if (plan.valid) {
            const [sx, sy] = tileToScreenAt(cam, tx, ty);
            const inBand = sx >= bandL && sx <= bandR && sy > 60 && sy < VIEW_H - 52;
            const inView = sx >= -20 && sx <= VIEW_W + 20 && sy >= -20 && sy <= VIEW_H + 20;
            hits.push(`ind${ind.id}@(${ind.tx},${ind.ty}) ${d.name} j=${j} end=(${tx},${ty}) screen=(${Math.round(sx)},${Math.round(sy)}) ${inBand ? "IN-BAND" : inView ? "in-view-but-covered/offband" : "OFF-VIEWPORT"}`);
          }
        }
      }
    }
  }
  for (const h of hits) console.log("  " + h);
}, 300_000);
