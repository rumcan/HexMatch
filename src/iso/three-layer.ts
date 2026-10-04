// LIVE-3D spike (owner, 2026-10-03): instanced 3D buildings over the 2D game, behind `?three=1`.
// FRAME RATE FIRST: no per-frame allocation, instance matrices only rebuilt when the world changes.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { HW, HH } from "../game/config";
import { getViewYaw, getViewYawTarget, setViewYawTarget } from "./camera";

// LIVE-3D stage 3 (Meshy): tools/models/build-models.mjs bakes each model square to the grid exactly as the
// sprite renderer did and writes public/models/manifest.json: per model the sprite's front `turn` (quarter
// turns), the squared plan extents ex/ez (largest = 1) and the height h. So facing = `turn` (+1 for a `_r`
// sprite, which is the same model turned 90 degrees); no hand-tuned yaw is needed. MODEL_YAW is an extra
// per-sprite correction in radians if one ever looks wrong.
const MODEL_YAW: Record<string, number> = {};
// LIVE-3D (owner 2026-10-03: the big cream-banded 5-storey brick building towered over its block): store_2x4 (and its _r)
// is drawn at 60% in plan AND height, still centred on its lot.
// 3D-FIX-3 (2026-10-03): town_hotel is a true 1×2 now (#662), so it no longer needs the 60% stopgap
// 3D-FIX-1 bolted on here — the runtime already fits a model's plan to the footprint it stands on
// (`s = min((w*0.92)/ex, (h*0.92)/ez)`), and a 1×2 lot is half the plan a 2×2 lot gave it. The height
// follows the plan, so the hotel now stands at 1.149 tiles instead of 1.38. PLAN_FIT in
// tools/models/build-models.mjs records the fit for when the model is next rebuilt from source.
export const MODEL_SCALE: Record<string, number> = { store_2x4: 0.6 };
// compat alias: older code and tests may reference MODEL_SIZE
export const MODEL_SIZE = MODEL_SCALE;

/**
 * 3D-FIX-5 (#664) — A HEADING IS A GROUND DIRECTION, NOT A SCREEN ONE.
 *
 * The sprite names carry one of eight headings (`truck_red_se`, `car_bus_ne`, …). In ground coordinates
 * (u along +tx, v along +ty) a heading is a unit vector: se = +u, sw = +v, nw = -u, ne = -v, and the four
 * cardinals bisect them. Turning a model by this many radians about Y then points its front along the
 * heading — and because the whole three scene is seen through the turned camera, the SAME number is right at
 * every view yaw. Nothing here knows about the camera: that is what makes the table testable.
 */
export const HEADING_DEG: Record<string, number> = { se: 0, e: 45, ne: 90, n: 135, nw: 180, w: -135, sw: -90, s: -45 };

/**
 * 3D-FIX-5 (#664) — THE ONE alias table for the ambient cars. The sim's CAR_MODELS (sedan, sedan2, pickup,
 * bus, van) are 1950s-60s shapes the Meshy set does not carry, so each is an alias of a model we do have.
 * pickup, van and bus are lorry-bodied, so all three keep THE LORRY'S scaling: the same model, uniformly
 * scaled by `lengthM / 12` (one tile = 12 m) — only the length differs, never the proportions, which is what
 * "keep the lorry scaling" means. The lengths come from the 1x art widths, not from taste: the shipped lorry
 * sprite is 26 px at 7 m, and the ambience notes size the sedan at 22 px, the pickup at 24, the van at 22 and
 * the bus at 32 — so pickup 6.5 m, van 5.5 m, bus 9 m. A bus therefore reads as a bus without any of the three
 * being stretched into a shape the model is not.
 *
 * The two sedans take their model's own length (4.8 m) — no `lengthM` — so they are never distorted either.
 */
export const VEHICLE_MODEL_ALIAS: Record<string, { model: string; lengthM?: number }> = {
  sedan: { model: "car_sedan_1" },
  sedan2: { model: "car_sedan_2" },
  pickup: { model: "vehicle_truck", lengthM: 6.5 },
  van: { model: "vehicle_truck", lengthM: 5.5 },
  bus: { model: "vehicle_truck", lengthM: 9 },
};
interface ModelInfo { turn: number; ex: number; ez: number; h: number; moving?: boolean; lengthM?: number }
type Manifest = Record<string, ModelInfo>;
/**
 * Sprite name -> model name (+ extra quarter turns); null = no model (the box stays).
 *
 * 3D-FIX-5 (#664): exported (it was module-private) so the platform's and the depot's quarter turns are testable
 * data instead of a number only the render loop can see — see tests/unit/3d-fix-5-facing.test.ts.
 */
export const modelOf = (sprite: string, mf: Manifest | null): { name: string; extra: number } | null => {
  if (!mf) return null;
  if (mf[sprite]) return { name: sprite, extra: 0 };
  // LIVE-3D: the railway's platform (4x1 / 1x4 by view) and train depot (2x2). The platform model lies along X with
  // its shed at the -X end; the art keeps the shed at the SOUTH end (+x for the 4x1 views ne/sw, +y for the 1x4
  // views se/nw), so ne/sw turn it a half turn and se/nw a quarter (checked against the 2D art, all four views).
  // The depot table is a first guess, see the report. `extra` is quarter turns on top of the model's own turn.
  const rv = /^(platform|train-depot)_(ne|se|sw|nw)$/.exec(sprite);
  if (rv && mf[rv[1]]) return { name: rv[1], extra: (rv[1] === "platform" ? { ne: 2, se: 1, sw: 2, nw: 1 } : { ne: 0, se: 1, sw: 2, nw: 3 } as Record<string, number>)[rv[2]] };
  if (sprite.endsWith("_r") && mf[sprite.slice(0, -2)]) return { name: sprite.slice(0, -2), extra: 1 };
  // terrace_2x1_yard / _plain have no model of their own: the 1x2 terrace turned
  if (sprite.startsWith("terrace_2x1") && mf.terrace_1x2) return { name: "terrace_1x2", extra: 1 };
  return null;
};

/**
 * LIVE-3D (owner round 2): a town building's facing is a pure function of its tile (stable across reloads, yaw and
 * host/guest). Square footprints take any quarter turn; a non-square footprint can only be flipped 180 degrees
 * (the footprint and occupancy are never touched: the plan is turned about the footprint centre).
 */
const SPIN_ART = /^(town_|terrace_|shops_|store_)/;
const NO_SPIN = /^(town_center|town_lawn|town_tree|town_park)/;
export const spinOf = (sprite: string, tx: number, ty: number, w: number, h: number): number => {
  if (!SPIN_ART.test(sprite) || NO_SPIN.test(sprite)) return 0;
  let x = (Math.imul(tx + 1, 73856093) ^ Math.imul(ty + 1, 19349663)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; x ^= x >>> 13;
  return w === h ? (x >>> 3) & 3 : ((x >>> 3) & 1) * 2;
};

export interface ThreeItem { sprite: string; tx: number; ty: number; w: number; h: number; lift?: number }   // lift: terrain elevation in px at zoom 1
export interface ThreeStats { fps: number; drawCalls: number; triangles: number; instances: number; textures: number; vehicles: number }
interface Cam { x: number; y: number; zoom: number; vw: number; vh: number }

// screen px per tile-unit of height at zoom 1: 12 m tile, 30 degree elevation, as tools/meshy/render.html
const K = (128 * Math.cos(Math.PI / 6)) / (2 * Math.SQRT2);   // 39.19
const DEPTH = 2048;
// Terrain elevation (E3, depth.ts): 2D sprites ride up the hill by surfaceHeight * LEVEL_PX; ThreeItem.lift carries it.
// This was the "buildings sit a little low" bug: the 3D layer stood every model on level 0 (8 px per level).

export const threeWanted = (s: string = typeof location !== "undefined" ? location.search : ""): boolean =>
  new URLSearchParams(s).get("three") === "1";

export interface ThreeLayer {
  canvas: HTMLCanvasElement;
  setItems(items: ThreeItem[]): void;
  update(cam: Cam): void;
  stats(): ThreeStats;
  /** True when the 3D layer draws this sprite (a ready model, or box mode), so the 2D sprite must hide. */
  drawsSprite(sprite: string): boolean;
  /** True when this vehicle sprite is drawn as a ready 3D model (so the 2D sprite hides). */
  drawsVehicle(sprite: string): boolean;
  /** Per frame: instance the moving vehicles from the composed draw items (sprite name = model + heading; fx/fy = tile). */
  updateVehicles(items: readonly { sprite: string; fx?: number; fy?: number; alpha?: number }[], liftOf: (u: number, v: number) => number): void;
  /** Called (debounced) when more models become ready, so the game can re-sync what 2D still draws. */
  onModels: (() => void) | null;
  dispose(): void;
}

export function mountThreeLayer(host: HTMLElement, before: HTMLElement | null, search: string = location.search): ThreeLayer | null {
  const q = new URLSearchParams(search);
  const tris = Number(q.get("tris") ?? 0) | 0;
  const fixedYaw = q.get("yaw");
  const noBoxes = q.get("models") === "none";   // debug: hide the 2D buildings and draw nothing (empty-scene reference shot)
  const noModels = tris > 0 || q.get("models") === "0" || noBoxes;   // stress mode and ?models=0 keep the boxes
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3";
  host.insertBefore(canvas, before);
  let renderer: any;
  try {
    // Owner (2026-10-03): "is there a type of anti alias we can turn on". MSAA on the 3D layer (the buildings and
    // vehicles are the jagged edges); `?aa=0` switches it off if the frame rate ever needs the fill back.
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: q.get("aa") !== "0", powerPreference: "high-performance" });
  } catch { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  // The sprite renderer's light rig (tools/meshy/render.html, defaults --sun 1.1 --ambient 2.8): the SW wall (+Z) is lit.
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
  sun.position.set(-25, 135, 100);
  scene.add(sun, new THREE.HemisphereLight(0xfff4e0, 0x5a5040, 2.8));

  // The camera is a hand-built projection: the game's 2:1 iso, exactly.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const P = camera.projectionMatrix;
  const view = camera.matrixWorldInverse;
  const viewInv = camera.matrixWorld;

  const geo: any = tris > 0
    ? new THREE.IcosahedronGeometry(0.5, Math.max(0, Math.round(Math.sqrt(tris / 20)) - 1))   // 20*(d+1)^2 triangles
    : new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  interface Pool { mesh: any; cap: number }
  interface Model { parts: { geo: any; mat: any }[] }
  let manifest: Manifest | null = null;
  let notifyTimer = 0;
  const drawsSprite = (sprite: string): boolean => {
    if (noModels) return true;
    const mo = modelOf(sprite, manifest);
    const m = mo ? models.get(mo.name) : undefined;
    return !!m && m !== "loading" && m !== "missing";
  };
  const boxPool = new Map<string, Pool>();
  const partPools = new Map<string, Pool[]>();
  const models = new Map<string, Model | "loading" | "missing">();
  const lists = new Map<string, ThreeItem[]>();
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  let instances = 0;

  const hashOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };

  // LIVE-3D stage 2: models load lazily, one GLB per sprite name, cached; the box stays until (unless) one lands.
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = (import.meta as any).env?.BASE_URL ?? "/";
  const loadModel = (sprite: string) => {
    if (models.has(sprite)) return;
    models.set(sprite, "loading");
    loader.load(`${base}models/${sprite}.glb`, (gltf: any) => {
      gltf.scene.updateMatrixWorld(true);
      const parts: { geo: any; mat: any }[] = [];
      gltf.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);          // bake the pipeline's normalise node into the vertices
        if (!g.attributes.normal) g.computeVertexNormals();   // the pipeline drops the per-face normals
        const src = o.material;
        const mat = new THREE.MeshLambertMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : (src.color ?? 0xcccccc) });
        parts.push({ geo: g, mat });
      });
      if (!parts.length) { models.set(sprite, "missing"); return; }
      models.set(sprite, { parts });
      for (const s of lists.keys()) if (modelOf(s, manifest)?.name === sprite) fill(s);
      if (notifyTimer === 0) notifyTimer = window.setTimeout(() => { notifyTimer = 0; api.onModels?.(); }, 150);
    }, undefined, () => models.set(sprite, "missing"));
  };

  const poolFor = (map: Map<string, Pool>, key: string, geoOf: any, matOf: any, n: number, colored: boolean): Pool => {
    let p = map.get(key);
    if (!p || p.cap < n) {
      if (p) { scene.remove(p.mesh); p.mesh.dispose(); }
      const cap = Math.max(16, n * 2);
      const mesh = new THREE.InstancedMesh(geoOf, matOf, cap);
      mesh.frustumCulled = false;       // one mesh per model: culling it whole buys nothing
      if (colored) { tint.setHSL((hashOf(key) % 360) / 360, 0.3, 0.72); for (let i = 0; i < cap; i++) mesh.setColorAt(i, tint); }
      p = { mesh, cap }; map.set(key, p); scene.add(mesh);
    }
    return p;
  };

  // Screen culling at instance granularity (InstancedMesh culls only as a whole): the buildings the camera
  // cannot see are left out of the instance buffers, rebuilt only when the camera has moved a fifth of the
  // view or zoomed. Off while the 3D view is yawed (the screen test below is the unrotated projection).
  let cullOn = false, cX = 0, cY = 0, cZ = 1, cW = 0, cH = 0, cYaw = 0, cCos = 1, cSin = 0;
  const scratch: ThreeItem[] = [];
  const cullList = (all: ThreeItem[]): ThreeItem[] => {
    if (!cullOn) return all;
    scratch.length = 0;
    const mx = cW * 0.25 + 300 * cZ, my = cH * 0.25 + 450 * cZ;
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      const ax = it.tx + it.w / 2, az = it.ty + it.h / 2;
      const gx = ax * cCos + az * cSin, gz = -ax * cSin + az * cCos;   // the view turn (camera.ts)
      const sx = (gx - gz) * HW * cZ + cX, sy = (gx + gz) * HH * cZ + cY;
      if (sx > -mx && sx < cW + mx && sy > -my && sy < cH + my) scratch.push(it);
    }
    return scratch;
  };

  /** Rebuild one sprite's instance matrices (only when the world or its model changed). */
  const fill = (sprite: string) => {
    const list = cullList(lists.get(sprite) ?? []);
    const mo = modelOf(sprite, manifest);
    const model = mo ? models.get(mo.name) : undefined;
    const ready = mo && model && model !== "loading" && model !== "missing" ? model : null;
    const box = boxPool.get(sprite);
    if (box) box.mesh.count = 0;
    for (const p of partPools.get(sprite) ?? []) p.mesh.count = 0;
    if (!list.length) return;
    if (ready) {
      const pools = partPools.get(sprite) ?? [];
      partPools.set(sprite, pools);
      const yawBase = MODEL_YAW[sprite] ?? 0;
      ready.parts.forEach((part, k) => {
        const mapK = new Map<string, Pool>(); if (pools[k]) mapK.set(`${sprite}#${k}`, pools[k]);
        const p = poolFor(mapK, `${sprite}#${k}`, part.geo, part.mat, list.length, false);
        pools[k] = p;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          // as render.html: turn by the sprite's quarter turns, then fit the plan uniformly into the footprint (fill 0.92)
          const mi = manifest![mo!.name];
          const rot = (mi.turn + mo!.extra + spinOf(sprite, it.tx, it.ty, it.w, it.h)) & 3;
          const ex = rot & 1 ? mi.ez : mi.ex, ez = rot & 1 ? mi.ex : mi.ez;
          const s = Math.min((it.w * 0.92) / ex, (it.h * 0.92) / ez) * (MODEL_SCALE[mo!.name] ?? 1);
          pos.set(it.tx + it.w / 2, (it.lift ?? 0) / K, it.ty + it.h / 2);
          quat.setFromAxisAngle(up, yawBase + (rot * Math.PI) / 2);
          scl.set(s, s, s);
          m4.compose(pos, quat, scl);
          p.mesh.setMatrixAt(i, m4);
        }
        p.mesh.count = list.length;
        p.mesh.instanceMatrix.needsUpdate = true;
      });
      return;
    }
    if (!noModels || noBoxes) return;     // no model (yet): the 2D sprite stays; boxes are only the ?models=0 / ?tris= stress modes
    const p = poolFor(boxPool, sprite, geo, mat, list.length, true);
    const hgt = 1 + (hashOf(sprite) % 100) / 100;     // 1..2 tiles
    quat.identity();
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      pos.set(it.tx + it.w / 2, (it.lift ?? 0) / K, it.ty + it.h / 2);
      scl.set(it.w * 0.92, hgt, it.h * 0.92);
      m4.compose(pos, quat, scl);
      p.mesh.setMatrixAt(i, m4);
    }
    p.mesh.count = list.length;
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  };

  const setItems = (items: ThreeItem[]) => {
    for (const l of lists.values()) l.length = 0;
    for (const it of items) { let a = lists.get(it.sprite); if (!a) lists.set(it.sprite, a = []); a.push(it); }
    instances = items.length;
    refillAll();
  };
  const refillAll = () => {
    for (const sprite of lists.keys()) {
      const mo = modelOf(sprite, manifest);
      if (mo && lists.get(sprite)!.length && !noModels) loadModel(mo.name);
      fill(sprite);
    }
  };
  if (!noModels) {
    fetch(`${base}models/manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => { if (m) { manifest = m; refillAll(); } }).catch(() => {});
  }

  // ── vehicles (LIVE-3D step 2) ─────────────────────────────────────────────
  // The sims already compose per-frame draw items (carItems / truckItems / trainItems, in game.ts
  // composeVehicles): a sprite name that encodes model + heading, and the fractional tile fx/fy. We read those,
  // so every selection rule (livery per owner, wagon per cargo, heading octant) stays the sim's. Nothing is
  // allocated per frame: one InstancedMesh per model part, preallocated, `count` set each frame.
  // 3D-FIX-5 (#664): HEADING_DEG and VEHICLE_MODEL_ALIAS are module constants now (see the top of the file) so
  // the facing rules are DATA the tests can drive, not numbers buried in this closure.
  const SEDANS = ["car_sedan_1", "car_sedan_2", "car_sedan_3"];
  const WAGON_KIND: Record<string, string> = { grain: "box", ore: "box", gold: "box", wood: "flat", stone: "flat", oil: "tank" };
  interface VState { model: string; lengthM?: number; count: number; pools: Pool[]; ready: boolean }
  interface VSpec { st: VState; yaw: number }
  const vStates = new Map<string, VState>();
  const vSpecs = new Map<string, VSpec | null>();
  const stateOf = (model: string, lengthM?: number): VState => {
    let st = vStates.get(`${model}|${lengthM ?? ""}`);
    if (!st) { st = { model, lengthM, count: 0, pools: [], ready: false }; vStates.set(`${model}|${lengthM ?? ""}`, st); }
    return st;
  };
  const specOf = (sprite: string): VSpec | null => {
    let sp = vSpecs.get(sprite);
    if (sp !== undefined) return sp;
    sp = null;
    let m: RegExpExecArray | null;
    const V = "(ne|nw|se|sw|n|e|s|w)";
    let model = "", view = "", lengthM: number | undefined;
    if ((m = new RegExp(`^truck_(red|blue|goods)_${V}$`).exec(sprite))) { model = m[1] === "blue" ? "vehicle_truck_blue" : "vehicle_truck"; view = m[2]; }
    else if ((m = new RegExp(`^car_(sedan2|sedan|pickup|bus|van)_${V}$`).exec(sprite))) { const c = VEHICLE_MODEL_ALIAS[m[1]]; model = c.model; lengthM = c.lengthM; view = m[2]; }
    else if ((m = new RegExp(`^car(\\d+)_${V}$`).exec(sprite))) { model = SEDANS[(Number(m[1]) - 1) % 3]; view = m[2]; }
    else if ((m = new RegExp(`^car-(loco|tender|box|flat|tank)_${V}$`).exec(sprite))) { model = `rail_${m[1]}`; view = m[2]; }
    else if ((m = new RegExp(`^wagon_([a-z]+)_${V}(_loaded)?$`).exec(sprite)) && WAGON_KIND[m[1]]) { model = `rail_${WAGON_KIND[m[1]]}`; view = m[2]; }
    if (model) sp = { st: stateOf(model, lengthM), yaw: (HEADING_DEG[view] * Math.PI) / 180 };
    vSpecs.set(sprite, sp);
    return sp;
  };
  const vReady = (st: VState): boolean => {
    if (st.ready) return true;
    const mdl = models.get(st.model);
    if (mdl && mdl !== "loading" && mdl !== "missing") { st.ready = true; return true; }
    return false;
  };
  const drawsVehicle = (sprite: string): boolean => {
    if (noModels) return false;
    const sp = specOf(sprite);
    return !!sp && vReady(sp.st);
  };
  const vehicleCount = (): number => { let n = 0; for (const st of vStates.values()) n += st.count; return n; };
  const vq = new THREE.Quaternion();
  interface VItem { sprite: string; fx?: number; fy?: number; alpha?: number }
  const updateVehicles = (items: readonly VItem[], liftOf: (u: number, v: number) => number) => {
    if (noModels || !manifest) return;
    for (const st of vStates.values()) st.count = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.fx === undefined || it.fy === undefined) continue;
      const sp = specOf(it.sprite);
      if (!sp) continue;
      const st = sp.st;
      if (!st.ready) { loadModel(st.model); if (!vReady(st)) continue; }
      if (it.alpha !== undefined && it.alpha < 0.5) continue;           // ambient cars fade at the town gates: pop instead
      const X = it.fx + 0.5, Z = it.fy + 0.5;
      if (cullOn) {
        const gx = X * cCos + Z * cSin, gz = -X * cSin + Z * cCos;
        const sx = (gx - gz) * HW * cZ + cX, sy = (gx + gz) * HH * cZ + cY;
        if (sx < -200 || sx > cW + 200 || sy < -200 || sy > cH + 200) continue;
      }
      const mdl = models.get(st.model) as Model;
      const mi = manifest[st.model];
      if (!mi) continue;
      const slot = st.count++;
      if (st.pools.length === 0 || st.pools[0].cap <= slot) {
        for (let k = 0; k < mdl.parts.length; k++) {
          const old = st.pools[k];
          if (old) { scene.remove(old.mesh); old.mesh.dispose(); }
          const cap = Math.max(32, (old ? old.cap : 0) * 2);
          const mesh = new THREE.InstancedMesh(mdl.parts[k].geo, mdl.parts[k].mat, cap);
          mesh.frustumCulled = false;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          st.pools[k] = { mesh, cap }; scene.add(mesh);
        }
      }
      const s = (st.lengthM ?? mi.lengthM ?? 5) / 12;
      pos.set(X, liftOf(X, Z) / K, Z);
      vq.setFromAxisAngle(up, sp.yaw);
      scl.set(s, s, s);
      m4.compose(pos, vq, scl);
      for (let k = 0; k < st.pools.length; k++) st.pools[k].mesh.setMatrixAt(slot, m4);
    }
    for (const st of vStates.values()) for (let k = 0; k < st.pools.length; k++) {
      const mesh = st.pools[k].mesh;
      mesh.count = st.count;
      if (st.count > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  };

  // [ and ] turn the WHOLE view 90 degrees about the screen-centre ground point, eased; ?yaw=<deg> pins it.
  // The yaw itself lives in camera.ts (the game loop eases it and re-pivots the camera), so picking, labels and
  // the 2D painters follow; this layer just reads it.
  if (fixedYaw != null) setViewYawTarget((Number(fixedYaw) * Math.PI) / 180);
  const onKey = (e: KeyboardEvent) => {
    if (fixedYaw != null || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "[") setViewYawTarget(getViewYawTarget() - Math.PI / 2);
    else if (e.key === "]") setViewYawTarget(getViewYawTarget() + Math.PI / 2);
  };
  window.addEventListener("keydown", onKey);

  let cw = 0, ch = 0;
  const update = (cam: Cam) => {
    const yaw = getViewYaw();
    if (yaw === getViewYawTarget()) {
      // settled: cull to the (rotated) view, rebuilt when the camera moved a fifth of the view, zoomed or turned
      if (!cullOn || cam.zoom !== cZ || cam.vw !== cW || cam.vh !== cH || yaw !== cYaw || Math.abs(cam.x - cX) > cam.vw * 0.2 || Math.abs(cam.y - cY) > cam.vh * 0.2) {
        cullOn = true; cX = cam.x; cY = cam.y; cZ = cam.zoom; cW = cam.vw; cH = cam.vh; cYaw = yaw; cCos = Math.cos(yaw); cSin = Math.sin(yaw);
        refillAll();
      }
    } else if (cullOn) { cullOn = false; refillAll(); }   // mid-turn: draw everything, the cull rect would lag
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== cw || h !== ch) { cw = w; ch = h; renderer.setSize(w, h, false); }
    const z = cam.zoom, vw = cam.vw, vh = cam.vh;
    // the view turn is a rotation about tile (0,0); the camera offset already pivots it on the screen centre
    view.makeRotationY(yaw);
    viewInv.copy(view).invert();
    const sx = (2 / vw) * z * HW, sy = (2 / vh) * z * HH, sh = (2 / vh) * z * K;
    // clip.x = sx*(x-z) + (2cx/vw - 1); clip.y = -sy*(x+z) + sh*y + (1 - 2cy/vh); clip.z = (-(x+z) + .5y)/DEPTH
    P.set(
      sx, 0, -sx, 2 * cam.x / vw - 1,
      -sy, sh, -sy, 1 - 2 * cam.y / vh,
      -1 / DEPTH, 0.5 / DEPTH, -1 / DEPTH, 0,
      0, 0, 0, 1,
    );
    renderer.render(scene, camera);
  };

  // fps: 5 s rolling average from rAF
  const stamps = new Float64Array(1024);
  let sHead = 0, sCount = 0, rafId = 0;
  const tick = (t: number) => {
    stamps[sHead] = t; sHead = (sHead + 1) & 1023; if (sCount < 1024) sCount++;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  const stats = (): ThreeStats => {
    let n = 0, oldest = 0, newest = 0;
    for (let i = 0; i < sCount; i++) {
      const t = stamps[(sHead - 1 - i + 2048) & 1023];
      if (i === 0) newest = t;
      if (newest - t > 5000) break;
      oldest = t; n++;
    }
    const fps = n > 1 && newest > oldest ? ((n - 1) * 1000) / (newest - oldest) : 0;
    const r = renderer.info.render;
    return { fps: Math.round(fps * 10) / 10, drawCalls: r.calls, triangles: r.triangles, instances, textures: renderer.info.memory.textures, vehicles: vehicleCount() };
  };

  const api: ThreeLayer = {
    canvas, setItems, update, stats, drawsSprite, drawsVehicle, updateVehicles, onModels: null,
    dispose() {
      cancelAnimationFrame(rafId);
      window.clearTimeout(notifyTimer);
      window.removeEventListener("keydown", onKey);
      renderer.dispose(); canvas.remove();
    },
  };
  return api;
}
