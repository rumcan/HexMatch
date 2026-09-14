// @ts-nocheck
// ══════════════════════════════════════════════════════════════════════════
// Railway graph — owner-scoped rail connectivity and occupancy
// Separate from road layers; never repurposes road/dirt/upgraded bytes.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../../game/config";
import { tIdx, inMapRail, RAIL_PRESENT, type RailwayState, type RailPlatform, type TrainDepot } from "./state";

// Directions identical to track.ts
export const NE = 1, SE = 2, SW = 4, NW = 8;
export const DIRS = [NE, SE, SW, NW] as const;
export const DIR: Record<number, [number, number]> = { [NE]: [0,-1], [SE]: [1,0], [SW]: [0,1], [NW]: [-1,0] };
export const OPPOSITE: Record<number, number> = { [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE };

export function railHas(state: RailwayState, tx:number, ty:number): boolean {
  if (!inMapRail(tx,ty)) return false;
  return (state.rail[tIdx(tx,ty)] & RAIL_PRESENT) !== 0;
}
export function railBits(state: RailwayState, tx:number, ty:number): number {
  if (!inMapRail(tx,ty)) return 0;
  return state.rail[tIdx(tx,ty)] & 0b1111;
}
export function railOwner(state: RailwayState, tx:number, ty:number): number {
  if (!inMapRail(tx,ty)) return 0;
  return state.railOwner[tIdx(tx,ty)];
}

// ── Platform geometry ────────────────────────────────────────────────────
// 2x3 footprint, rotatable. Lane = 3 tiles, platform strip = 3 tiles.
// rotation 0: lane at x=0 column (tx,ty .. ty+2), strip at x=1
// rotation 1: lane at y=0 row (tx..tx+2, ty), strip at y=1
// rotation 2: mirrored 0 (lane at x=1 column if desired) — but for simplicity
//             we keep lane at same side; rotation only affects port orientation.
//             For placement tests, all rotations occupy same 2x3 bounding box,
//             just ports swap.
// For v1 we keep lane always at (tx,ty) origin side, ports at ends of lane.
// The exact side doesn't affect connectivity beyond which tiles are lane.
// We'll define lane tiles explicitly per rotation.

export function platformFootprint(tx:number, ty:number, rotation: number): [number, number][] {
  const r = ((rotation % 4)+4)%4;
  const out: [number, number][] = [];
  // footprint is 2x3 in bounding box; orientation determines lane axis
  if (r === 0 || r === 2) {
    // vertical lane (along Y)
    for (let dy=0; dy<3; dy++) for (let dx=0; dx<2; dx++) out.push([tx+dx, ty+dy]);
  } else {
    // horizontal lane (along X): footprint 3x2
    for (let dy=0; dy<2; dy++) for (let dx=0; dx<3; dx++) out.push([tx+dx, ty+dy]);
  }
  return out;
}

export function platformLaneTiles(tx:number, ty:number, rotation:number): [number, number][] {
  const r = ((rotation%4)+4)%4;
  if (r===0 || r===2) {
    // lane column x=0
    return [[tx,ty],[tx,ty+1],[tx,ty+2]];
  } else {
    // lane row y=0
    return [[tx,ty],[tx+1,ty],[tx+2,ty]];
  }
}
export function platformPorts(tx:number, ty:number, rotation:number): [number, number][] {
  const lane = platformLaneTiles(tx,ty,rotation);
  // two ports at lane ends, outward direction
  // For vertical lane, ports outward north/south; for horizontal, west/east
  return [lane[0], lane[lane.length-1]];
}
export function platformStripTiles(tx:number, ty:number, rotation:number): [number, number][] {
  const r = ((rotation%4)+4)%4;
  if (r===0 || r===2) {
    return [[tx+1,ty],[tx+1,ty+1],[tx+1,ty+2]];
  } else {
    return [[tx,ty+1],[tx+1,ty+1],[tx+2,ty+1]];
  }
}

export function depotFootprint(tx:number, ty:number): [number, number][] {
  return [[tx,ty],[tx+1,ty],[tx,ty+1],[tx+1,ty+1]];
}
export function depotPortTile(tx:number, ty:number, rotation:number): [number, number] {
  const r = ((rotation%4)+4)%4;
  // one exit at midpoint of one side, depending on rotation
  // 0: north side center? For 2x2, define exit at edge tile
  // Simplify: exit at (tx,ty) for rot0, (tx+1,ty) for rot1, (tx+1,ty+1) for rot2, (tx,ty+1) for rot3
  // But to have consistent connectivity, we treat depot as having single port at its origin side
  if (r===0) return [tx,ty]; // north-west tile faces north
  if (r===1) return [tx+1,ty]; // north-east faces east
  if (r===2) return [tx+1,ty+1]; // south-east faces south
  return [tx,ty+1]; // south-west faces west
}
export function depotExitDir(rotation:number): number {
  const r = ((rotation%4)+4)%4;
  if (r===0) return NE;
  if (r===1) return SE;
  if (r===2) return SW;
  return NW;
}

// ── Occupancy ─────────────────────────────────────────────────────────────
export function isOccupiedByRailway(state: RailwayState, tx:number, ty:number): boolean {
  // check platform or depot footprint
  for (const p of state.platforms) {
    for (const [x,y] of platformFootprint(p.tx,p.ty,p.rotation)) if (x===tx && y===ty) return true;
  }
  for (const d of state.depots) {
    for (const [x,y] of depotFootprint(d.tx,d.ty)) if (x===tx && y===ty) return true;
  }
  return false;
}

export function platformAt(state: RailwayState, tx:number, ty:number): RailPlatform | null {
  for (const p of state.platforms) {
    for (const [x,y] of platformFootprint(p.tx,p.ty,p.rotation)) if (x===tx && y===ty) return p;
  }
  return null;
}
export function depotAt(state: RailwayState, tx:number, ty:number): TrainDepot | null {
  for (const d of state.depots) {
    for (const [x,y] of depotFootprint(d.tx,d.ty)) if (x===tx && y===ty) return d;
  }
  return null;
}

// ── Rail autotiling (incremental) ────────────────────────────────────────
function recomputeRailMask(state: RailwayState, tx:number, ty:number): void {
  const idx = tIdx(tx,ty);
  if ((state.rail[idx] & RAIL_PRESENT)===0) { state.rail[idx]=0; return; }
  let bits=0;
  for (const d of DIRS) {
    const nx=tx+DIR[d][0], ny=tx+DIR[d][1];
    if (!inMapRail(nx,ny)) continue;
    // neighbor contributes if it has rail OR is a platform lane tile belonging to same owner (virtual rail)
    // For now, check explicit rail presence or virtual lane
    let neighborIsRail = (state.rail[tIdx(nx,ny)] & RAIL_PRESENT)!==0;
    // Also consider platform lane virtual rail: any platform's lane tile at neighbor that is owned by same owner counts
    // But lane tiles are not stored in rail array; they are virtual. For connectivity we treat them as rail.
    // To simplify, we store virtual lane rail implicitly via isVirtualRailAt
    if (!neighborIsRail && isVirtualRailAt(state, nx, ny, state.railOwner[idx])) {
      // virtual rail considered present for adjacency
      neighborIsRail = true;
    }
    if (neighborIsRail) {
      // For adjacency we just set bit if neighbor exists; mutual check done in flood
      bits |= d;
    }
    // also check if neighbor is platform port connecting outward? For now bits as above.
  }
  // Include virtual lane bits: if this tile itself is virtual lane, we need to set bits along lane internally
  // For lane internal connectivity, lane tiles line up: vertical lanes connect north-south between lane tiles,
  // horizontal connect east-west. We'll set internal lane bits separately.
  if (isVirtualRailAt(state, tx, ty, state.railOwner[idx])) {
    // determine lane orientation from platform rotation
    const plat = platformAt(state, tx, ty);
    if (plat) {
      const lane = platformLaneTiles(plat.tx, plat.ty, plat.rotation);
      // find position along lane
      const isLane = lane.some(([x,y])=>x===tx && y===ty);
      if (isLane) {
        // lane internal: connect to adjacent lane tiles
        for (const d of DIRS) {
          const nx=tx+DIR[d][0], ny=tx+DIR[d][1];
          if (lane.some(([x,y])=>x===nx && y===ny)) bits |= d;
        }
        // also connect to external rail beyond lane ends (ports)
        // ports already handled above via neighborIsRail, but ensure bit outward is set if external rail exists
        // done.
      }
    }
    // depot port: single outward dir plus internal? depot occupies 2x2, we treat only port tile as rail, but it should connect outward
    // internal depot connectivity not needed for v1 (single tile)
  }
  state.rail[idx] = RAIL_PRESENT | (bits & 0b1111);
}

function isVirtualRailAt(state: RailwayState, tx:number, ty:number, owner:number): boolean {
  // platform lane tile?
  for (const p of state.platforms) {
    if (p.ownerId !== owner && owner!==0) continue; // owner-scoped virtual
    // lane tiles are virtual rail belonging to platform owner
    for (const [x,y] of platformLaneTiles(p.tx,p.ty,p.rotation)) if (x===tx && y===ty) return true;
  }
  for (const d of state.depots) {
    if (d.ownerId !== owner && owner!==0) continue;
    const [px,py]= depotPortTile(d.tx,d.ty,d.rotation);
    if (px===tx && py===ty) return true;
  }
  return false;
}

// Check if tile has rail (explicit or virtual) for owner
export function hasRailForOwner(state: RailwayState, owner:number, tx:number, ty:number): boolean {
  if (!inMapRail(tx,ty)) return false;
  const idx=tIdx(tx,ty);
  if ((state.rail[idx] & RAIL_PRESENT)!==0 && state.railOwner[idx]===owner) return true;
  // virtual
  for (const p of state.platforms) if (p.ownerId===owner) {
    for (const [x,y] of platformLaneTiles(p.tx,p.ty,p.rotation)) if (x===tx && y===ty) return true;
  }
  for (const d of state.depots) if (d.ownerId===owner) {
    const [px,py]=depotPortTile(d.tx,d.ty,d.rotation);
    if (px===tx && py===ty) return true;
  }
  return false;
}

export function autotileRailAround(state: RailwayState, tx:number, ty:number): void {
  const toTouch: [number,number][] = [[tx,ty]];
  for (const d of DIRS) toTouch.push([tx+DIR[d][0], ty+DIR[d][1]]);
  for (const [x,y] of toTouch) {
    if (!inMapRail(x,y)) continue;
    // only recompute if explicit rail present; virtual tiles are not stored
    const idx=tIdx(x,y);
    if ((state.rail[idx] & RAIL_PRESENT)!==0) recomputeRailMask(state,x,y);
  }
}

// ── Rail graph components (owner-scoped) ─────────────────────────────────
export interface RailComponents {
  comp: Int32Array; // per tile, -1 = none
  count: number;
}

export function buildRailComponents(state: RailwayState, owner:number): RailComponents {
  const comp = new Int32Array(MAP_W*MAP_H).fill(-1);
  let next=0;
  const stack: number[]=[];

  const hasRailAt = (x:number,y:number): boolean => {
    if (!inMapRail(x,y)) return false;
    const idx=tIdx(x,y);
    if ((state.rail[idx] & RAIL_PRESENT)!==0 && state.railOwner[idx]===owner) return true;
    // virtual platform lane / depot port
    for (const p of state.platforms) if (p.ownerId===owner) {
      for (const [lx,ly] of platformLaneTiles(p.tx,p.ty,p.rotation)) if (lx===x && ly===y) return true;
    }
    for (const d of state.depots) if (d.ownerId===owner) {
      const [px,py]=depotPortTile(d.tx,d.ty,d.rotation);
      if (px===x && py===y) return true;
    }
    return false;
  };

  // adjacency check: both tiles must have rail and be mutually facing (bits)
  // For virtual tiles, we consider them connected if adjacent lane tiles are sequenced or port connects to explicit rail
  const virtualBits = (x:number,y:number): number => {
    // lane internal bits
    for (const p of state.platforms) if (p.ownerId===owner) {
      const lane=platformLaneTiles(p.tx,p.ty,p.rotation);
      if (lane.some(([lx,ly])=>lx===x && ly===y)) {
        let b=0;
        for (const d of DIRS) {
          const nx=x+DIR[d][0], ny=y+DIR[d][1];
          if (lane.some(([lx,ly])=>lx===nx && ly===ny)) b|=d;
          else if ((state.rail[tIdx(nx,ny)] & RAIL_PRESENT)!==0 && state.railOwner[tIdx(nx,ny)]===owner) b|=d;
          // also check adjacent platform lane of same component? ignore for now
        }
        return b;
      }
    }
    for (const d of state.depots) if (d.ownerId===owner) {
      const [px,py]=depotPortTile(d.tx,d.ty,d.rotation);
      if (px===x && py===y) {
        // depot port connects outward along its exit dir and to adjacent rail
        // For simplicity, connect in all directions where rail exists (allow any)
        let b=0;
        for (const dir of DIRS) {
          const nx=x+DIR[dir][0], ny=y+DIR[dir][1];
          if (!inMapRail(nx,ny)) continue;
          if ((state.rail[tIdx(nx,ny)] & RAIL_PRESENT)!==0 && state.railOwner[tIdx(nx,ny)]===owner) b|=dir;
          // also virtual lane neighbor
          for (const p of state.platforms) if (p.ownerId===owner) {
            const lane=platformLaneTiles(p.tx,p.ty,p.rotation);
            if (lane.some(([lx,ly])=>lx===nx && ly===ny)) b|=dir;
          }
        }
        // Also ensure at least exit dir is considered if we want strict, but allow any for flood
        return b;
      }
    }
    return 0;
  };

  const bitsAt = (x:number,y:number): number => {
    const idx=tIdx(x,y);
    if ((state.rail[idx] & RAIL_PRESENT)!==0 && state.railOwner[idx]===owner) {
      return state.rail[idx] & 0b1111;
    }
    // virtual
    if (hasRailAt(x,y)) return virtualBits(x,y);
    return 0;
  };

  for (let y=0; y<MAP_H; y++) for (let x=0; x<MAP_W; x++) {
    if (!hasRailAt(x,y)) continue;
    const startIdx=tIdx(x,y);
    if (comp[startIdx]!==-1) continue;
    // flood
    const id=next++;
    comp[startIdx]=id;
    stack.push(startIdx);
    while (stack.length) {
      const cur=stack.pop()!;
      const cx=cur%MAP_W, cy=(cur/MAP_W)|0;
      const b=bitsAt(cx,cy);
      for (const d of DIRS) {
        if (!(b & d)) continue;
        const nx=cx+DIR[d][0], ny=cy+DIR[d][1];
        if (!inMapRail(nx,ny)) continue;
        if (!hasRailAt(nx,ny)) continue;
        const nb=bitsAt(nx,ny);
        if (!(nb & OPPOSITE[d])) continue;
        const ni=tIdx(nx,ny);
        if (comp[ni]!==-1) continue;
        comp[ni]=id;
        stack.push(ni);
      }
    }
  }
  return { comp, count: next };
}

export function railComponentOf(state: RailwayState, owner:number, tx:number, ty:number): number {
  const comps=buildRailComponents(state, owner);
  if (!inMapRail(tx,ty)) return -1;
  return comps.comp[tIdx(tx,ty)];
}

export function areRailConnected(state: RailwayState, owner:number, ax:number, ay:number, bx:number, by:number): boolean {
  const comps=buildRailComponents(state, owner);
  if (!inMapRail(ax,ay) || !inMapRail(bx,by)) return false;
  const ca=comps.comp[tIdx(ax,ay)], cb=comps.comp[tIdx(bx,by)];
  return ca!==-1 && ca===cb;
}

// Check if two platform ports are rail-connected (via lane + rail)
export function platformsRailConnected(state: RailwayState, owner:number, aId:number, bId:number): boolean {
  const a=state.platforms.find(p=>p.id===aId);
  const b=state.platforms.find(p=>p.id===bId);
  if (!a||!b) return false;
  if (a.ownerId!==owner || b.ownerId!==owner) return false;
  const aPorts=platformPorts(a.tx,a.ty,a.rotation);
  const bPorts=platformPorts(b.tx,b.ty,b.rotation);
  // platforms considered connected if ANY lane tile of A connects to ANY lane tile of B via rail graph
  const comps=buildRailComponents(state, owner);
  const aComps=new Set<number>();
  for (const [x,y] of platformLaneTiles(a.tx,a.ty,a.rotation)) {
    const c=comps.comp[tIdx(x,y)];
    if (c!==-1) aComps.add(c);
  }
  for (const [x,y] of platformLaneTiles(b.tx,b.ty,b.rotation)) {
    const c=comps.comp[tIdx(x,y)];
    if (c!==-1 && aComps.has(c)) return true;
  }
  // also try ports explicit (if lane tiles not correctly component due to bits)
  // fallback: check if rail graph connects any port adjacency to lane
  return false;
}

// Depot reachable to source platform?
export function depotReachableToPlatform(state: RailwayState, owner:number, depotId:number, platformId:number): boolean {
  const depot=state.depots.find(d=>d.id===depotId);
  const plat=state.platforms.find(p=>p.id===platformId);
  if (!depot||!plat) return false;
  if (depot.ownerId!==owner || plat.ownerId!==owner) return false;
  const [dx,dy]=depotPortTile(depot.tx,depot.ty,depot.rotation);
  const comps=buildRailComponents(state, owner);
  const dComp=comps.comp[tIdx(dx,dy)];
  if (dComp===-1) return false;
  for (const [x,y] of platformLaneTiles(plat.tx,plat.ty,plat.rotation)) {
    if (comps.comp[tIdx(x,y)]===dComp) return true;
  }
  return false;
}

// Count active trains per component
export function activeTrainsPerComponent(state: RailwayState, owner:number): Map<number, number> {
  const comps=buildRailComponents(state, owner);
  const map=new Map<number, number>();
  for (const tr of state.trains) {
    if (tr.ownerId!==owner) continue;
    if (tr.state==="stored" || tr.state==="blocked") continue;
    // find component of its depot port (where train is based) or its current position?
    // For v1, train belongs to component of its depot's port (since depot is anchor)
    const depot=state.depots.find(d=>d.id===tr.depotId);
    if (!depot) continue;
    const [dx,dy]=depotPortTile(depot.tx,depot.ty,depot.rotation);
    const c=comps.comp[tIdx(dx,dy)];
    if (c===-1) continue;
    map.set(c, (map.get(c)??0)+1);
  }
  return map;
}

export function componentHasActiveTrain(state: RailwayState, owner:number, compId:number): boolean {
  const per=activeTrainsPerComponent(state, owner);
  return (per.get(compId)??0)>0;
}

// Validate that no component has >1 active train
export function violatesOneTrainPerComponent(state: RailwayState, owner:number): boolean {
  const per=activeTrainsPerComponent(state, owner);
  for (const n of per.values()) if (n>1) return true;
  return false;
}
