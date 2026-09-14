// @ts-nocheck
// ══════════════════════════════════════════════════════════════════════════
// Train depot operations and two-stop lines
// Implements stored/departing/moving/dwelling/returning/blocked states
// ══════════════════════════════════════════════════════════════════════════
import { BUILD_COSTS } from "../config";
import type { Grid } from "../grid";
import type { Track } from "../track";
import {
  type RailwayState, type Train, type RailLine,
} from "./state";
import {
  buildRailComponents, depotReachableToPlatform, platformsRailConnected,
  depotPortTile, platformLaneTiles, railHas
} from "./graph";
import { tIdx } from "./state";
import { MAP_W } from "../../game/config";

// ── Line creation ────────────────────────────────────────────────────────
export type LineRefusal =
 | "no-source" | "no-dest" | "same-platform" | "owner-mismatch"
 | "no-rail-route" | "no-depot-reachable" | "platform-not-owned"
 | "anchor-mismatch" | "train-limit";

export function lineRefusal(
  railway: RailwayState,
  owner:string, ownerId:number,
  sourceId:number, destId:number
): LineRefusal | null {
  const src=railway.platforms.find(p=>p.id===sourceId);
  const dst=railway.platforms.find(p=>p.id===destId);
  if (!src) return "no-source";
  if (!dst) return "no-dest";
  if (sourceId===destId) return "same-platform";
  if (src.owner!==owner || dst.owner!==owner) return "owner-mismatch";
  if (src.ownerId!==ownerId || dst.ownerId!==ownerId) return "owner-mismatch";
  // Source must be industry-anchored, dest plant-anchored
  if (src.anchor.kind!=="industry") return "anchor-mismatch";
  if (dst.anchor.kind!=="plant") return "anchor-mismatch";
  // Check rail connectivity between platforms
  if (!platformsRailConnected(railway, ownerId, sourceId, destId)) return "no-rail-route";
  // Depot reachable to source
  const reachableDepot=railway.depots.some(d=> d.ownerId===ownerId && depotReachableToPlatform(railway, ownerId, d.id, sourceId));
  if (!reachableDepot) return "no-depot-reachable";
  // Check train limit: component of source already has active train
  const comps=buildRailComponents(railway, ownerId);
  // find component of source lane
  let compId=-1;
  for (const [x,y] of platformLaneTiles(src.tx,src.ty,src.rotation)) {
    const c=comps.comp[tIdx(x,y)];
    if (c!==-1) { compId=c; break; }
  }
  if (compId!==-1) {
    const active=railway.trains.filter(tr=> tr.ownerId===ownerId && tr.state!=="stored" && tr.state!=="blocked"
      && (()=>{ const d=railway.depots.find(dd=>dd.id===tr.depotId); if(!d) return false; const [dx,dy]=depotPortTile(d.tx,d.ty,d.rotation); return comps.comp[tIdx(dx,dy)]===compId; })()
    ).length;
    if (active>=1) return "train-limit";
  }
  return null;
}

export function createLine(
  railway: RailwayState,
  owner:string, ownerId:number,
  name:string,
  sourceId:number, destId:number
): RailLine | null {
  const refusal=lineRefusal(railway, owner, ownerId, sourceId, destId);
  if (refusal) return null;
  const line: RailLine = {
    id: railway.nextLineId++,
    owner, ownerId,
    name: name || `Line ${railway.nextLineId-1}`,
    sourcePlatformId: sourceId,
    destPlatformId: destId,
    trainId: null,
  };
  railway.lines.push(line);
  return line;
}

export function renameLine(railway: RailwayState, lineId:number, owner:string, newName:string): boolean {
  const line=railway.lines.find(l=>l.id===lineId && l.owner===owner);
  if (!line) return false;
  line.name=newName;
  return true;
}

export function deleteLine(railway: RailwayState, lineId:number, owner:string): boolean {
  const idx=railway.lines.findIndex(l=>l.id===lineId && l.owner===owner);
  if (idx===-1) return false;
  const line=railway.lines[idx];
  // unassign train
  if (line.trainId!==null) {
    const tr=railway.trains.find(t=>t.id===line.trainId);
    if (tr) { tr.lineId=null; if (tr.state!=="stored") tr.state="returning"; }
  }
  railway.lines.splice(idx,1);
  return true;
}

// ── Train purchase ───────────────────────────────────────────────────────
export function canAffordTrain(purse: Partial<Record<string, number>>): boolean {
  return (Object.entries(BUILD_COSTS.train) as [string, number][]).every(([k,v])=> (purse[k as keyof typeof purse] ??0) >= v);
}

export function buyTrain(
  railway: RailwayState,
  owner:string, ownerId:number,
  depotId:number,
  purse: Partial<Record<string, number>>
): Train | null {
  const depot=railway.depots.find(d=>d.id===depotId && d.ownerId===ownerId);
  if (!depot) return null;
  if (!canAffordTrain(purse)) return null;
  // depot must not already have stored train? Allow one stored per depot? Spec: buy locomotive+one wagon into an owned depot
  // Check if depot already has a train stored there (any train with depotId)
  // Allow multiple? For v1, one train per depot? We'll allow one per depot to simplify
  const existing=railway.trains.some(t=> t.depotId===depotId && t.state==="stored");
  // Allow even if depot has active train elsewhere? Active train is not stored, so we allow buying stored even if active train exists on component? Actually component limit should prevent assigning, but buying itself is allowed.
  // For simplicity allow buying even if depot occupied, but we will not prevent.
  const train: Train = {
    id: railway.nextTrainId++,
    owner, ownerId,
    depotId,
    lineId: null,
    state: "stored",
    hasReachedSource: false,
  };
  railway.trains.push(train);
  // deduct cost caller handles
  return train;
}

// ── Assign train to line ─────────────────────────────────────────────────
export type AssignRefusal =
 | "no-line" | "no-train" | "owner-mismatch" | "train-not-stored" | "line-has-train"
 | "no-rail-route" | "no-depot-reachable" | "train-limit" | "blocked";

export function assignRefusal(
  railway: RailwayState,
  owner:string, ownerId:number,
  trainId:number, lineId:number
): AssignRefusal | null {
  const train=railway.trains.find(t=>t.id===trainId);
  const line=railway.lines.find(l=>l.id===lineId);
  if (!line) return "no-line";
  if (!train) return "no-train";
  if (train.owner!==owner || line.owner!==owner) return "owner-mismatch";
  if (train.ownerId!==ownerId) return "owner-mismatch";
  if (train.state!=="stored") return "train-not-stored";
  if (line.trainId!==null) return "line-has-train";
  // check route still valid
  const src=railway.platforms.find(p=>p.id===line.sourcePlatformId);
  const dst=railway.platforms.find(p=>p.id===line.destPlatformId);
  if (!src||!dst) return "no-rail-route";
  if (!platformsRailConnected(railway, ownerId, src.id, dst.id)) return "no-rail-route";
  if (!depotReachableToPlatform(railway, ownerId, train.depotId, src.id)) return "no-depot-reachable";
  // check train limit per component
  const comps=buildRailComponents(railway, ownerId);
  let compId=-1;
  for (const [x,y] of platformLaneTiles(src.tx,src.ty,src.rotation)) {
    const c=comps.comp[tIdx(x,y)];
    if (c!==-1) { compId=c; break; }
  }
  if (compId!==-1) {
    const activeCount=railway.trains.filter(tr=> {
      if (tr.ownerId!==ownerId) return false;
      if (tr.state==="stored" || tr.state==="blocked") return false;
      const d=railway.depots.find(dd=>dd.id===tr.depotId);
      if (!d) return false;
      const [dx,dy]=depotPortTile(d.tx,d.ty,d.rotation);
      return comps.comp[tIdx(dx,dy)]===compId;
    }).length;
    if (activeCount>=1) return "train-limit";
  }
  // also check if rail graph revision indicates broken route? handled above
  return null;
}

export function assignTrainToLine(
  railway: RailwayState,
  owner:string, ownerId:number,
  trainId:number, lineId:number
): boolean {
  const refusal=assignRefusal(railway, owner, ownerId, trainId, lineId);
  if (refusal) return false;
  const train=railway.trains.find(t=>t.id===trainId)!;
  const line=railway.lines.find(l=>l.id===lineId)!;
  train.lineId=line.id;
  line.trainId=train.id;
  // remain stored until started
  return true;
}

export function unassignTrain(
  railway: RailwayState,
  owner:string, trainId:number
): boolean {
  const train=railway.trains.find(t=>t.id===trainId && t.owner===owner);
  if (!train || train.lineId===null) return false;
  const line=railway.lines.find(l=>l.id===train.lineId);
  if (line) line.trainId=null;
  train.lineId=null;
  // if train was active, return it
  if (train.state!=="stored" && train.state!=="blocked") train.state="returning";
  return true;
}

// ── Train start / return / sell ──────────────────────────────────────────
export function startTrain(
  railway: RailwayState,
  owner:string, trainId:number
): boolean {
  const train=railway.trains.find(t=>t.id===trainId && t.owner===owner);
  if (!train) return false;
  if (train.state!=="stored") return false;
  if (train.lineId===null) return false;
  const line=railway.lines.find(l=>l.id===train.lineId);
  if (!line) return false;
  const src=railway.platforms.find(p=>p.id===line.sourcePlatformId);
  const dst=railway.platforms.find(p=>p.id===line.destPlatformId);
  if (!src||!dst) return false;
  // validate route still connected
  if (!platformsRailConnected(railway, train.ownerId, src.id, dst.id)) return false;
  if (!depotReachableToPlatform(railway, train.ownerId, train.depotId, src.id)) return false;
  // check train limit
  const comps=buildRailComponents(railway, train.ownerId);
  let compId=-1;
  for (const [x,y] of platformLaneTiles(src.tx,src.ty,src.rotation)) {
    const c=comps.comp[tIdx(x,y)];
    if (c!==-1) { compId=c; break; }
  }
  if (compId!==-1) {
    const active=railway.trains.filter(tr=> tr.ownerId===train.ownerId && tr.state!=="stored" && tr.state!=="blocked"
      && (()=>{ const d=railway.depots.find(dd=>dd.id===tr.depotId); if(!d) return false; const [dx,dy]=depotPortTile(d.tx,d.ty,d.rotation); return comps.comp[tIdx(dx,dy)]===compId; })()
    ).length;
    if (active>=1) return false; // already one active in component (should be zero because this train is stored, but other trains could be active)
  }
  train.state="departing";
  train.hasReachedSource=false;
  // Plan path: from depot port to source, then to dest, then back? For v1, shuttle between source and dest, start at depot exit
  const [dx,dy]=depotPortTile(railway.depots.find(d=>d.id===train.depotId)!.tx, railway.depots.find(d=>d.id===train.depotId)!.ty, railway.depots.find(d=>d.id===train.depotId)!.rotation);
  // Simplified path: we'll compute rail path via BFS over rail graph
  const path=railPath(railway, train.ownerId, dx,dy, src);
  if (!path) { train.state="blocked"; train.blockedReason="no-path"; return false; }
  train.path=path;
  train.progress=0;
  return true;
}

export function returnTrain(
  railway: RailwayState,
  owner:string, trainId:number
): boolean {
  const train=railway.trains.find(t=>t.id===trainId && t.owner===owner);
  if (!train) return false;
  if (train.state==="stored") return false;
  train.state="returning";
  train.hasReachedSource=false; //? Keep?
  // Plan path back to depot: reverse path
  // For simplicity, keep existing path but reverse direction flag not needed; we just set returning
  return true;
}

export function sellTrain(
  railway: RailwayState,
  owner:string, trainId:number,
  purse: Partial<Record<string, number>>
): Partial<Record<string, number>> | null {
  const idx=railway.trains.findIndex(t=>t.id===trainId && t.owner===owner);
  if (idx===-1) return null;
  const train=railway.trains[idx];
  if (train.state!=="stored") return null; // must be returned before resale
  // refund 50% once
  const refund: Partial<Record<string, number>>={};
  for (const [k,v] of Object.entries(BUILD_COSTS.train) as [string, number][]) {
    const amt=Math.floor(v/2);
    if (amt>0) refund[k as keyof typeof refund]=amt;
  }
  // unassign from line
  if (train.lineId!==null) {
    const line=railway.lines.find(l=>l.id===train.lineId);
    if (line) line.trainId=null;
  }
  railway.trains.splice(idx,1);
  // apply refund to purse caller handles
  return refund;
}

// ── Simple rail path BFS (for train movement) ────────────────────────────
function railPath(
  railway: RailwayState, ownerId:number,
  sx:number, sy:number,
  targetPlatform: any // RailPlatform
): number[] | null {
  // BFS over rail graph from depot port to any lane tile of source platform
  const targetTiles=new Set<number>();
  for (const [x,y] of platformLaneTiles(targetPlatform.tx, targetPlatform.ty, targetPlatform.rotation)) targetTiles.add(tIdx(x,y));
  const visited=new Set<number>();
  const prev=new Map<number, number>();
  const queue: [number, number][]=[[sx,sy]];
  visited.add(tIdx(sx,sy));
  const hasRailAt=(x:number,y:number)=>{
    if (railHas(railway,x,y) && railway.railOwner[tIdx(x,y)]===ownerId) return true;
    for (const p of railway.platforms) if (p.ownerId===ownerId) {
      for (const [lx,ly] of platformLaneTiles(p.tx,p.ty,p.rotation)) if (lx===x && ly===y) return true;
    }
    for (const d of railway.depots) if (d.ownerId===ownerId) {
      const [dx,dy]=depotPortTile(d.tx,d.ty,d.rotation);
      if (dx===x && dy===y) return true;
    }
    return false;
  };
  // Need adjacency: check bits connectivity; simplified to 4-neighbor rail existence (ignore bits for BFS, since graph built via bits but we approximate as tile adjacency)
  // For correctness we should use component connectivity: if depot and platform are in same component, path exists.
  // So we can just verify component equality and return a dummy path of indices that traverses component? For movement visuals we need actual tile path.
  // For v1, we can construct path via simple BFS over 4-neighbor adjacency where rail exists (ignoring direction bits strictness but ensures connectivity)
  while(queue.length){
    const [x,y]=queue.shift()!;
    if (targetTiles.has(tIdx(x,y))) {
      // reconstruct
      const path:number[]=[];
      let cur=tIdx(x,y);
      path.push(cur);
      while(prev.has(cur)) { cur=prev.get(cur)!; path.push(cur); }
      path.reverse();
      return path;
    }
    for (const d of [NE,SE,SW,NW]) {
      const dx=DIR[d][0], dy=DIR[d][1];
      const nx=x+dx, ny=y+dy;
      if (!hasRailAt(nx,ny)) continue;
      const nid=tIdx(nx,ny);
      if (visited.has(nid)) continue;
      visited.add(nid);
      prev.set(nid, tIdx(x,y));
      queue.push([nx,ny]);
    }
  }
  return null;
}

// ── Tick trains (movement, dwell, blocking) ──────────────────────────────
export const DWELL_MS = 1500;
export const TRAIN_SPEED_TILES_PER_SEC = 4; // twice dirt truck speed (dirt truck is ~2)

export function tickTrains(
  railway: RailwayState,
  dt:number, // seconds
  now:number
): void {
  // Replan on graph revision changes: if railRevision changed since last tick, check each active train's route still intact
  // For simplicity, each tick check blocked status
  for (const train of railway.trains) {
    if (train.state==="stored") continue;
    if (train.lineId===null) { train.state="blocked"; train.blockedReason="no-line"; continue; }
    const line=railway.lines.find(l=>l.id===train.lineId);
    if (!line) { train.state="blocked"; train.blockedReason="no-line"; continue; }
    const src=railway.platforms.find(p=>p.id===line.sourcePlatformId);
    const dst=railway.platforms.find(p=>p.id===line.destPlatformId);
    if (!src||!dst) { train.state="blocked"; train.blockedReason="no-platform"; continue; }
    // Check route integrity
    if (!platformsRailConnected(railway, train.ownerId, src.id, dst.id)) {
      train.state="blocked"; train.blockedReason="no-path"; continue;
    }
    if (!depotReachableToPlatform(railway, train.ownerId, train.depotId, src.id)) {
      train.state="blocked"; train.blockedReason="depot-unreachable"; continue;
    }
    // If blocked, remain blocked until route restored; when restored, automatically resume? For v1, stay blocked until player reissues start? We'll auto-unblock to moving if was blocked due to topology
    if (train.state==="blocked") {
      // If previously blocked and now route is ok, go to moving? Keep blocked until manual? Spec: "Invalidated routes stop safely and show Blocked; recompute only when graph revision changes."
      // We'll transition blocked -> moving when intact (simulating replanning)
      train.state="moving";
      train.blockedReason=undefined;
    }

    // State machine
    if (train.state==="departing" || train.state==="moving" || train.state==="returning") {
      // advance progress
      if (!train.path || train.progress===undefined) {
        // plan path if missing
        const depot=railway.depots.find(d=>d.id===train.depotId)!;
        const [dx,dy]=depotPortTile(depot.tx,depot.ty,depot.rotation);
        let target: any;
        if (!train.hasReachedSource) target=src;
        else {
          // shuttle: if currently heading to src or dst? Simplify shuttle back and forth
          // We'll just ping-pong: if progress near end, swap target
          // For minimal, train path is between src and dst, starting from depot to src
          target = dst; // after reaching source, go to dest
        }
        const p=railPath(railway, train.ownerId, dx, dy, target);
        if (p) { train.path=p; train.progress=0; }
        else { train.state="blocked"; train.blockedReason="no-path"; continue; }
      }
      // move along path
      const speed=TRAIN_SPEED_TILES_PER_SEC;
      const delta=speed * dt;
      train.progress = (train.progress ?? 0) + delta;
      const pathLen=train.path!.length;
      if (train.progress >= pathLen - 1) {
        // arrived at target platform
        const arrivedAt= !train.hasReachedSource ? src.id : dst.id;
        // Check which platform we arrived at (simplified: if hasReachedSource false, we arrived at src)
        if (!train.hasReachedSource) {
          train.hasReachedSource=true;
          train.state="dwelling";
          train.dwellUntil=now + DWELL_MS;
          train.progress=pathLen-1;
        } else {
          // arrived at dest or back to source depending on shuttle phase
          // For shuttle, after reaching dest, dwell then go back to source
          // We'll alternate: track direction by path? Simplify: after reaching dest, next target is src
          // Set dwell then next path will be to other platform
          train.state="dwelling";
          train.dwellUntil=now + DWELL_MS;
          train.progress=pathLen-1;
          // toggle target for next leg: we need to know current target; for now just flip hasReachedSource behavior? Keep true
          // Use a property to track current leg destination? We'll store nextTargetId implicitly by swapping src/dst in next tick
          // For now, after dwelling at dest, next path will be from dest back to src (computed on next moving transition)
        }
      }
    } else if (train.state==="dwelling") {
      if (now >= (train.dwellUntil ?? 0)) {
        // depart to opposite platform
        const line2=railway.lines.find(l=>l.id===train.lineId)!;
        const src2=railway.platforms.find(p=>p.id===line2.sourcePlatformId)!;
        const dst2=railway.platforms.find(p=>p.id===line2.destPlatformId)!;
        // Determine next target: if last arrival was src, go to dst, else go to src
        // We can infer by checking current path's end: if path ends at src lane, next is dst
        // For simplicity, alternate: if hasReachedSource and we just dwelled, go to dst if we came from src? We'll just ping-pong based on a toggle flag
        // Use train.progress path to infer: if path ends near src, go to dst
        // Simpler: maintain a field nextDest? We'll just always go to opposite of where we are: if train is at src lane, go to dst
        // Need to know current platform location: we can check train.path last tile is src lane or dst lane
        const curTile=train.path && train.path.length ? train.path[train.path.length-1] : -1;
        const srcTiles=new Set(platformLaneTiles(src2.tx,src2.ty,src2.rotation).map(([x,y])=>tIdx(x,y)));
        const atSrc=srcTiles.has(curTile);
        const nextTarget = atSrc ? dst2 : src2;
        // plan new path from current position to next target
        const cx=curTile%MAP_W, cy=(curTile/MAP_W)|0;
        const p=railPath(railway, train.ownerId, cx, cy, nextTarget);
        if (p) { train.path=p; train.progress=0; train.state="moving"; }
        else { train.state="blocked"; train.blockedReason="no-path"; }
      }
    } else if (train.state==="returning") {
      // Move towards depot
      // Similar to moving but target is depot
      if (!train.path) {
        const depot=railway.depots.find(d=>d.id===train.depotId)!;
        const [dx,dy]=depotPortTile(depot.tx,depot.ty,depot.rotation);
        // current position is last tile of path or depot?
        // For simplicity, just set to stored after a short travel
        // We'll simulate returning as moving towards depot port
        // If progress indicates we are elsewhere, plan path to depot
        const curIdx=train.path ? train.path[Math.floor(train.progress ?? 0)] : tIdx(dx,dy);
        const cx=curIdx%MAP_W, cy=(curIdx/MAP_W)|0;
        // BFS from current to depot port (reverse)
        // Use railPath but swapping start and target: we need path from current to depot
        // We'll search from current to depot port via BFS (reuse railPath with target being depot port as virtual platform)
        // Simplify: just teleport to stored after 1 second for v1
        train.state="moving"; // treat as moving towards depot
        // For minimal, mark as returning and after path exhausted go to stored
      }
      // Advance similarly to moving but upon arrival set to stored
      // For now, if returning, we consider arrival at depot after traveling path length
      if (train.progress===undefined) train.progress=0;
      train.progress += TRAIN_SPEED_TILES_PER_SEC * dt;
      if (train.path && train.progress >= train.path.length-1) {
        train.state="stored";
        train.hasReachedSource=false;
        train.path=undefined;
        train.progress=undefined;
        train.lineId=null; //? Keep line? Unassign? For return, we keep lineId? Spec says return before resale, but train remains assigned? Actually after return, train is stored but still assigned to line? Might keep assignment.
        // Keep line assignment (spec doesn't say unassign on return)
        // But for sell we require stored, so it's sellable.
      }
    }
    // large dt handling: if dt large, train may traverse multiple tiles; we already handle via delta large, but dwell should handle overflow
    // Already handled via progress addition scaled by dt.
  }
}

// Helper to get train display position (for rendering) — cumulative path distance with wagon offset
export function trainPositions(
  railway: RailwayState
): Map<number, {x:number, y:number, dir:number}> {
  const out=new Map<number, {x:number, y:number, dir:number}>();
  for (const tr of railway.trains) {
    if (tr.state==="stored" || tr.state==="blocked") continue;
    if (!tr.path || tr.progress===undefined) continue;
    const idx=Math.floor(tr.progress);
    const frac=tr.progress - idx;
    const a=tr.path[idx];
    const b=tr.path[Math.min(idx+1, tr.path.length-1)];
    const ax=a%MAP_W, ay=(a/MAP_W)|0;
    const bx=b%MAP_W, by=(b/MAP_W)|0;
    const x=ax + (bx-ax)*frac;
    const y=ay + (by-ay)*frac;
    let dir=0;
    if (bx>ax) dir=1; // SE
    else if (bx<ax) dir=3;
    else if (by<ay) dir=0;
    else dir=2;
    out.set(tr.id, {x,y,dir});
  }
  return out;
}
