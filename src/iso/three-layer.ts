// LIVE-3D spike (owner, 2026-10-03): instanced 3D buildings over the 2D game, behind `?three=1`.
// FRAME RATE FIRST: no per-frame allocation, instance matrices only rebuilt when the world changes.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { HW, HH } from "../game/config";

// LIVE-3D stage 3 (Meshy): tools/models/build-models.mjs bakes each model square to the grid exactly as the
// sprite renderer did and writes public/models/manifest.json: per model the sprite's front `turn` (quarter
// turns), the squared plan extents ex/ez (largest = 1) and the height h. So facing = `turn` (+1 for a `_r`
// sprite, which is the same model turned 90 degrees); no hand-tuned yaw is needed. MODEL_YAW is an extra
// per-sprite correction in radians if one ever looks wrong.
const MODEL_YAW: Record<string, number> = {};
interface ModelInfo { turn: number; ex: number; ez: number; h: number }
type Manifest = Record<string, ModelInfo>;
/** Sprite name -> model name (+ extra quarter turns); null = no model (the box stays). */
const modelOf = (sprite: string, mf: Manifest | null): { name: string; extra: number } | null => {
  if (!mf) return null;
  if (mf[sprite]) return { name: sprite, extra: 0 };
  if (sprite.endsWith("_r") && mf[sprite.slice(0, -2)]) return { name: sprite.slice(0, -2), extra: 1 };
  // terrace_2x1_yard / _plain have no model of their own: the 1x2 terrace turned
  if (sprite.startsWith("terrace_2x1") && mf.terrace_1x2) return { name: "terrace_1x2", extra: 1 };
  return null;
};

export interface ThreeItem { sprite: string; tx: number; ty: number; w: number; h: number }
export interface ThreeStats { fps: number; drawCalls: number; triangles: number; instances: number; textures: number }
interface Cam { x: number; y: number; zoom: number; vw: number; vh: number }

// screen px per tile-unit of height at zoom 1: 12 m tile, 30 degree elevation, as tools/meshy/render.html
const K = (128 * Math.cos(Math.PI / 6)) / (2 * Math.SQRT2);   // 39.19
const DEPTH = 2048;

export const threeWanted = (s: string = typeof location !== "undefined" ? location.search : ""): boolean =>
  new URLSearchParams(s).get("three") === "1";

export interface ThreeLayer {
  canvas: HTMLCanvasElement;
  setItems(items: ThreeItem[]): void;
  update(cam: Cam, nowMs: number): void;
  stats(): ThreeStats;
  /** True when the 3D layer draws this sprite (a ready model, or box mode), so the 2D sprite must hide. */
  drawsSprite(sprite: string): boolean;
  /** Called (debounced) when more models become ready, so the game can re-sync what 2D still draws. */
  onModels: (() => void) | null;
  dispose(): void;
}

export function mountThreeLayer(host: HTMLElement, before: HTMLElement | null, search: string = location.search): ThreeLayer | null {
  const q = new URLSearchParams(search);
  const tris = Number(q.get("tris") ?? 0) | 0;
  const fixedYaw = q.get("yaw");
  const noModels = tris > 0 || q.get("models") === "0";   // stress mode and ?models=0 keep the boxes
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3";
  host.insertBefore(canvas, before);
  let renderer: any;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
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
  const tmpA = new THREE.Matrix4(), tmpB = new THREE.Matrix4(), tmpC = new THREE.Matrix4();

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
  let cullOn = false, cX = 0, cY = 0, cZ = 1, cW = 0, cH = 0;
  const scratch: ThreeItem[] = [];
  const cullList = (all: ThreeItem[]): ThreeItem[] => {
    if (!cullOn) return all;
    scratch.length = 0;
    const mx = cW * 0.25 + 300 * cZ, my = cH * 0.25 + 450 * cZ;
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      const gx = it.tx + it.w / 2, gz = it.ty + it.h / 2;
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
          const rot = (mi.turn + mo!.extra) & 3;
          const ex = rot & 1 ? mi.ez : mi.ex, ez = rot & 1 ? mi.ex : mi.ez;
          const s = Math.min((it.w * 0.92) / ex, (it.h * 0.92) / ez);
          pos.set(it.tx + it.w / 2, 0, it.ty + it.h / 2);
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
    if (!noModels) return;     // no model (yet): the 2D sprite stays; boxes are only the ?models=0 / ?tris= stress modes
    const p = poolFor(boxPool, sprite, geo, mat, list.length, true);
    const hgt = 1 + (hashOf(sprite) % 100) / 100;     // 1..2 tiles
    quat.identity();
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      pos.set(it.tx + it.w / 2, 0, it.ty + it.h / 2);
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

  // [ and ] turn 90 degrees about the screen-centre ground point, eased; ?yaw=<deg> pins it.
  let yawTarget = fixedYaw != null ? (Number(fixedYaw) * Math.PI) / 180 : 0;
  let yaw = yawTarget;
  let lastT = 0;
  const onKey = (e: KeyboardEvent) => {
    if (fixedYaw != null || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "[") yawTarget -= Math.PI / 2;
    else if (e.key === "]") yawTarget += Math.PI / 2;
  };
  window.addEventListener("keydown", onKey);

  let cw = 0, ch = 0;
  const update = (cam: Cam, nowMs: number) => {
    const dt = lastT ? Math.min(0.1, (nowMs - lastT) / 1000) : 0.016;
    lastT = nowMs;
    if (yaw !== yawTarget) {
      yaw += (yawTarget - yaw) * Math.min(1, dt * 10);
      if (Math.abs(yawTarget - yaw) < 1e-3) yaw = yawTarget;
    }
    if (yaw === 0 && yawTarget === 0) {
      if (!cullOn || cam.zoom !== cZ || cam.vw !== cW || cam.vh !== cH || Math.abs(cam.x - cX) > cam.vw * 0.2 || Math.abs(cam.y - cY) > cam.vh * 0.2) {
        cullOn = true; cX = cam.x; cY = cam.y; cZ = cam.zoom; cW = cam.vw; cH = cam.vh;
        refillAll();
      }
    } else if (cullOn) { cullOn = false; refillAll(); }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== cw || h !== ch) { cw = w; ch = h; renderer.setSize(w, h, false); }
    const z = cam.zoom, vw = cam.vw, vh = cam.vh;
    // ground point under the screen centre (tile units, fractional)
    const wx = (vw / 2 - cam.x) / z, wy = (vh / 2 - cam.y) / z;
    const px = (wx / HW + wy / HH) / 2, pz = (wy / HH - wx / HW) / 2;
    tmpA.makeTranslation(px, 0, pz);
    tmpB.makeRotationY(yaw);
    tmpC.makeTranslation(-px, 0, -pz);
    view.copy(tmpA).multiply(tmpB).multiply(tmpC);
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
    return { fps: Math.round(fps * 10) / 10, drawCalls: r.calls, triangles: r.triangles, instances, textures: renderer.info.memory.textures };
  };

  const api: ThreeLayer = {
    canvas, setItems, update, stats, drawsSprite, onModels: null,
    dispose() {
      cancelAnimationFrame(rafId);
      window.clearTimeout(notifyTimer);
      window.removeEventListener("keydown", onKey);
      renderer.dispose(); canvas.remove();
    },
  };
  return api;
}
