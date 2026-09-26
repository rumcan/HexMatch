// #444: no parallel side-by-side roads on generated maps
import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, setRoadTier, ROAD_TIER,
  mergedPresent, mergedBitsAt, tIdx,
} from "../../src/iso/track";
import { MAP_W, MAP_H } from "../../src/game/config";
import { findPath, planCandidates, executeCandidate, stepCost } from "../../src/iso/ai";
import type { EconomyState, Factory, Harvester } from "../../src/iso/economy";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";

const DIRS = { NE:1, SE:2, SW:4, NW:8 };
const DIR: Record<number, [number, number]> = { 1:[0,-1], 2:[1,0], 4:[0,1], 8:[-1,0] };

function buildComponents(track: any): Map<number, number> {
  const present = (x:number,y:number) => mergedPresent(track,x,y);
  const bits = (x:number,y:number) => mergedBitsAt(track,x,y);
  const comp = new Map<number, number>();
  let cid=1;
  const idx = (x:number,y:number) => y*MAP_W + x;
  for (let y=0; y<MAP_H; y++) {
    for (let x=0; x<MAP_W; x++) {
      if (!present(x,y)) continue;
      const i = idx(x,y);
      if (comp.has(i)) continue;
      const stack=[i];
      comp.set(i,cid);
      while (stack.length) {
        const cur=stack.pop()!;
        const cx=cur%MAP_W, cy=(cur/MAP_W)|0;
        const b=bits(cx,cy);
        for (const d of [1,2,4,8]) {
          if (!(b & d)) continue;
          const nx=cx+ (d===2?1:d===8?-1:0), ny=cy+ (d===1?-1:d===4?1:0);
          if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
          const ni=idx(nx,ny);
          if (!present(nx,ny)) continue;
          const nb=bits(nx,ny);
          const opp = d===1?4:d===4?1:d===2?8:2;
          if (!(nb & opp)) continue;
          if (comp.has(ni)) continue;
          comp.set(ni,cid);
          stack.push(ni);
        }
      }
      cid++;
    }
  }
  return comp;
}

function detectParallel(track: any): { type:string, x:number, y:number, len:number }[] {
  const present = (x:number,y:number) => mergedPresent(track,x,y);
  const bits = (x:number,y:number) => mergedBitsAt(track,x,y);
  const violations: { type:string, x:number, y:number, len:number }[] = [];
  // horizontal adjacency: (x,y) and (x,y+1) both road, not directly connected, both have east-west continuity, run >2
  for (let y=0; y<MAP_H-1; y++) {
    let run=0;
    let runStart=0;
    for (let x=0; x<MAP_W; x++) {
      if (!present(x,y) || !present(x,y+1)) { 
        if (run>2) violations.push({type:"h", x:runStart, y, len:run});
        run=0; continue; 
      }
      const b1=bits(x,y), b2=bits(x,y+1);
      const connected = (b1 & DIRS.SW) && (b2 & DIRS.NE);
      if (connected) { 
        if (run>2) violations.push({type:"h", x:runStart, y, len:run});
        run=0; continue; 
      }
      const h1 = (b1 & (DIRS.SE|DIRS.NW))!==0;
      const h2 = (b2 & (DIRS.SE|DIRS.NW))!==0;
      if (!h1 || !h2) { 
        if (run>2) violations.push({type:"h", x:runStart, y, len:run});
        run=0; continue; 
      }
      // check east-west continuity for run
      if (run===0) { run=1; runStart=x; }
      else {
        const prevB1=bits(x-1,y), prevB2=bits(x-1,y+1);
        const cont1 = (prevB1 & DIRS.SE) && (b1 & DIRS.NW);
        const cont2 = (prevB2 & DIRS.SE) && (b2 & DIRS.NW);
        if (cont1 && cont2) run++;
        else {
          if (run>2) violations.push({type:"h", x:runStart, y, len:run});
          run=1; runStart=x;
        }
      }
    }
    if (run>2) violations.push({type:"h", x:runStart, y, len:run});
  }
  // vertical
  for (let x=0; x<MAP_W-1; x++) {
    let run=0;
    let runStart=0;
    for (let y=0; y<MAP_H; y++) {
      if (!present(x,y) || !present(x+1,y)) { 
        if (run>2) violations.push({type:"v", x, y:runStart, len:run});
        run=0; continue; 
      }
      const b1=bits(x,y), b2=bits(x+1,y);
      const connected = (b1 & DIRS.SE) && (b2 & DIRS.NW);
      if (connected) { 
        if (run>2) violations.push({type:"v", x, y:runStart, len:run});
        run=0; continue; 
      }
      const v1 = (b1 & (DIRS.NE|DIRS.SW))!==0;
      const v2 = (b2 & (DIRS.NE|DIRS.SW))!==0;
      if (!v1 || !v2) { 
        if (run>2) violations.push({type:"v", x, y:runStart, len:run});
        run=0; continue; 
      }
      if (run===0) { run=1; runStart=y; }
      else {
        const prevB1=bits(x,y-1), prevB2=bits(x+1,y-1);
        const cont1 = (prevB1 & DIRS.SW) && (b1 & DIRS.NE);
        const cont2 = (prevB2 & DIRS.SW) && (b2 & DIRS.NE);
        if (cont1 && cont2) run++;
        else {
          if (run>2) violations.push({type:"v", x, y:runStart, len:run});
          run=1; runStart=y;
        }
      }
    }
    if (run>2) violations.push({type:"v", x, y:runStart, len:run});
  }
  return violations;
}

function makeTrackForGrid(grid: any) {
  const track = createTrack(false);
  seedTownRoads(track, grid);
  for (const town of grid.towns) for (const [x,y] of town.roads) setRoadTier(track, x,y, ROAD_TIER.street);
  seedPublicRoads(track, grid);
  return track;
}

describe("#444 parallel roads", () => {
  it("no parallel adjacent roads at generation over 30 seeds (all options ON)", { timeout: 180_000 }, () => {
    const seeds = Array.from({length:30}, (_,i)=>i);
    for (const seed of seeds) {
      const grid = generateMap(seed, { rivers:true, elevation:true, shapes:true, rings:true });
      const track = makeTrackForGrid(grid);
      const v = detectParallel(track);
      expect(v, `seed ${seed}: parallel roads ${JSON.stringify(v.slice(0,2))}`).toEqual([]);
    }
  });

  it("no parallel after 5 rival turns over 15 seeds", { timeout: 180_000 }, () => {
    // Simulate rival building dirt roads from its factory to industries
    const seeds = [0,1,2,3,4,5,6,7,42,1337, 10,11,12,13,14];
    for (const seed of seeds) {
      const grid = generateMap(seed, { rivers:true, elevation:true, shapes:true, rings:true });
      const track = makeTrackForGrid(grid);
      // Find a rival factory spot: use first town's ring as approximation, far from centre
      const factory: Factory = { owner:"ai", ownerId:2, tx: grid.towns[0]?.tx ?? 10, ty: grid.towns[0]?.ty ?? 10 } as any;
      // Simple economy state
      const state: EconomyState = {
        grid, track,
        harvesters: [] as Harvester[],
        factories: [factory] as any,
        dams: [] as any,
      } as any;
      const purse = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999, gold: 999 };
      for (let turn=0; turn<5; turn++) {
        const cands = planCandidates(state, factory, { stock: purse, purse, free:0, freeDepots:0, newLoop:true });
        if (!cands.length) break;
        const best = cands[0];
        executeCandidate(state, best, "ai", 2, state.harvesters.length+1, 0,0,true);
      }
      const v = detectParallel(track);
      expect(v, `seed ${seed} after 5 rival turns: ${JSON.stringify(v.slice(0,2))}`).toEqual([]);
    }
  });
});
