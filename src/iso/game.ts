// ══════════════════════════════════════════════════════════════════════════
// E11 (partial) — the playable isometric game.
//
// Wires the E4–E7 modules into something you can actually sit down and play:
//
//   renderer (E4) + track (E5) + economy (E6) + ai (E7)
//
// This is the "vertical slice" cutover: it mounts the iso renderer as the real
// map with a real build loop, setup phase, resource economy, AI opponent and
// win condition. It deliberately does NOT yet delete hexmap.ts / MapView3D.ts
// or rewrite the 861-line hex ui.ts — those are the destructive half of E11
// and want their own pass once this has been played and the feel is agreed.
//
// E8's rule is honoured here: free setup builds are flagged `free` at the DATA
// level (see `FreeBuild`), never inferred from the phase, so no timer can ever
// claw them back. That is the K1 bug class and it does not recur.
// ══════════════════════════════════════════════════════════════════════════
import manifestJson from "../../assets/iso-atlas/manifest.json";
import atlas05 from "../../assets/iso-atlas/atlas@0.5x.png";
import atlas1 from "../../assets/iso-atlas/atlas@1x.png";
import atlas2 from "../../assets/iso-atlas/atlas@2x.png";

import { Atlas, buildMasks, type Manifest, type AtlasImage } from "./atlas";
import {
  createCamera, centerOnTile, resizeCamera, zoomStepAt, createGesture,
  pointerDown, pointerMove, pointerUp,
  type Camera, type GestureState,
} from "./camera";
import { IsoRenderer, type World } from "./renderer";
import { generateMap, type Grid, type Industry } from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, addCost, tIdx,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  createScoreState, rescore, vpFor, isServiced, industriesInCatchment,
  playerResources, buildAllComponents, resolveConnection, catchmentRect,
  type EconomyState, type Harvester, type ScoreState, type VpEvent,
} from "./economy";
import { aiBuildStep } from "./ai";
import { CARGO, INDUSTRY_BY_KEY, TRANSPORT, type Cargo } from "./config";
import { MAP_W, MAP_H } from "../game/config";

// ── tuning (E8's rebalance surface, all in one place) ─────────────────────
export const VP_TARGET = 12;
export const FREE_SETUP_TRACK = 12;
export const HARVEST_MS = 3000;      // economy tick
export const AI_BUILD_MS = 9000;
export const START_PURSE: Purse = { stone: 10, ore: 6 };

export type Tool = "road" | "rail" | "harvester" | "demolish";

export interface PlayerState {
  id: string;
  name: string;
  colour: string;
  purse: Purse;
  human: boolean;
  /** E8: free builds are DATA, not an inference from the phase. */
  freeTrack: number;
}

type Phase = "setup-factory" | "setup-harvester" | "play" | "won";

export interface Toast { text: string; kind: "good" | "bad" | "info"; until: number; }

export function startIsoGame(root: HTMLElement) {
  // ── DOM ────────────────────────────────────────────────────────────────
  root.innerHTML = "";
  root.classList.add("iso-game");
  const stage = document.createElement("div");
  stage.className = "iso-stage";
  root.appendChild(stage);

  const mk = (z: number) => {
    const c = document.createElement("canvas");
    c.className = "iso-layer";
    c.style.zIndex = String(z);
    stage.appendChild(c);
    return c;
  };
  const canvases = { terrain: mk(1), structures: mk(2), overlay: mk(3) };

  const ui = document.createElement("div");
  ui.className = "iso-ui";
  root.appendChild(ui);
  ui.innerHTML = `
    <div class="iso-top">
      <div class="iso-res" id="iso-res"></div>
      <div class="iso-vp" id="iso-vp"></div>
    </div>
    <div class="iso-banner" id="iso-banner"></div>
    <div class="iso-toasts" id="iso-toasts"></div>
    <div class="iso-inspect" id="iso-inspect"></div>
    <div class="iso-tools" id="iso-tools">
      <button data-tool="road">Road<small>1 stone · 1 VP</small></button>
      <button data-tool="rail">Rail<small>2 ore + 1 stone · 3 VP</small></button>
      <button data-tool="harvester">Harvester<small>free · on industry</small></button>
      <button data-tool="demolish">Demolish<small>refund none</small></button>
      <button data-act="recenter" class="iso-alt">Recentre</button>
    </div>
    <div class="iso-cost" id="iso-cost"></div>`;

  const $ = (id: string) => ui.querySelector(`#${id}`) as HTMLElement;
  const elRes = $("iso-res"), elVp = $("iso-vp"), elBanner = $("iso-banner");
  const elToasts = $("iso-toasts"), elCost = $("iso-cost"), elInspect = $("iso-inspect");

  // ── state ──────────────────────────────────────────────────────────────
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const grid: Grid = generateMap(seed);
  const track: Track = createTrack();
  const score: ScoreState = createScoreState();

  const players: PlayerState[] = [
    { id: "you", name: "You", colour: "#5aa8ff", purse: { ...START_PURSE }, human: true, freeTrack: FREE_SETUP_TRACK },
    { id: "ai", name: "Rival", colour: "#ff7a5a", purse: { ...START_PURSE }, human: false, freeTrack: FREE_SETUP_TRACK },
  ];
  const me = players[0], rival = players[1];

  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  let nextHarvesterId = 1;
  let phase: Phase = "setup-factory";
  let tool: Tool = "road";
  let toasts: Toast[] = [];
  let winner: PlayerState | null = null;

  const world: World = {
    grid,
    roadBits: drawBits(track, "road"),
    railBits: drawBits(track, "rail"),
    extra: [],
  };

  // Start the camera somewhere with industries in view.
  const focus = grid.industries[0] ?? { tx: MAP_W / 2, ty: MAP_H / 2 };
  let cam: Camera = centerOnTile(
    createCamera(stage.clientWidth || 800, stage.clientHeight || 600),
    focus.tx, focus.ty,
  );

  let renderer: IsoRenderer | null = null;
  let hover: { tx: number; ty: number; ref: unknown } | null = null;
  let drag: { ax: number; ay: number } | null = null;
  let preview: DragPreview | null = null;

  // ── helpers ────────────────────────────────────────────────────────────
  const toast = (text: string, kind: Toast["kind"] = "info") => {
    toasts.push({ text, kind, until: performance.now() + 3200 });
  };

  const spend = (p: PlayerState, cost: Purse) => {
    for (const [k, v] of Object.entries(cost) as [Cargo, number][]) {
      p.purse[k] = (p.purse[k] ?? 0) - v;
    }
  };
  const earn = (p: PlayerState, gain: Purse) => {
    for (const [k, v] of Object.entries(gain) as [Cargo, number][]) {
      p.purse[k] = (p.purse[k] ?? 0) + v;
    }
  };

  const factoryOf = (id: string) => eco.factories.find((f) => f.owner === id) ?? null;

  const syncWorld = () => {
    world.roadBits = drawBits(track, "road");
    world.railBits = drawBits(track, "rail");
    world.extra = [
      ...eco.factories.map((f) => ({
        sprite: f.owner === "you" ? "factory_blue" : "factory_red",
        tx: f.tx, ty: f.ty, ref: { kind: "factory", owner: f.owner },
      })),
      ...eco.harvesters.map((h) => ({
        sprite: h.owner === "you" ? "depot_blue" : "depot_red",
        tx: h.tx, ty: h.ty, ref: { kind: "harvester", id: h.id, owner: h.owner },
      })),
    ];
    renderer?.setWorld(world);
  };

  const applyVpEvents = (events: VpEvent[]) => {
    for (const e of events) {
      const h = eco.harvesters.find((x) => x.id === e.harvester);
      const owner = h?.owner ?? score.owners.get(e.harvester);
      if (owner !== "you") continue;
      if (e.type === "awarded") toast(`Connected by ${e.to} — +${e.delta} VP`, "good");
      else if (e.type === "revoked") toast(`Connection broken — ${e.delta} VP`, "bad");
      else if (e.type === "upgraded") toast(`Upgraded to rail — +${e.delta} VP`, "good");
      else if (e.type === "downgraded") toast(`Rail broken, fell back to road — ${e.delta} VP`, "bad");
    }
  };

  const rescoreNow = () => {
    applyVpEvents(rescore(eco, score));
    if (phase === "play") {
      for (const p of players) {
        if (vpFor(score, p.id) >= VP_TARGET) {
          phase = "won"; winner = p;
          toast(`${p.name} reached ${VP_TARGET} VP!`, p.human ? "good" : "bad");
        }
      }
    }
  };

  // ── actions ────────────────────────────────────────────────────────────
  function placeFactory(tx: number, ty: number): boolean {
    if (!canBuildOn(grid, "road", tx, ty)) { toast("Can't build there.", "bad"); return false; }
    eco.factories.push({ owner: "you", tx, ty });
    // Give the rival a factory a good distance away, on legal ground.
    let best: [number, number] | null = null, bestD = -1;
    for (let y = 2; y < MAP_H - 2; y += 2) {
      for (let x = 2; x < MAP_W - 2; x += 2) {
        if (!canBuildOn(grid, "road", x, y)) continue;
        const d = Math.abs(x - tx) + Math.abs(y - ty);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) eco.factories.push({ owner: "ai", tx: best[0], ty: best[1] });
    phase = "setup-harvester";
    syncWorld();
    toast("Factory placed. Now place your first harvester beside an industry.", "info");
    return true;
  }

  function placeHarvester(tx: number, ty: number, p: PlayerState, free: boolean): boolean {
    if (!canBuildOn(grid, "road", tx, ty)) { toast("Can't build there.", "bad"); return false; }
    if (eco.harvesters.some((h) => h.tx === tx && h.ty === ty)) {
      toast("A harvester is already there.", "bad"); return false;
    }
    const h: Harvester = { id: nextHarvesterId++, owner: p.id, tx, ty };
    if (!industriesInCatchment(grid, h).length) {
      toast("A harvester needs an industry in its 4×4 catchment.", "bad");
      return false;
    }
    if (!free && !isServiced(track, h)) {
      toast("A harvester must touch road or rail.", "bad");
      return false;
    }
    eco.harvesters.push(h);
    syncWorld();
    rescoreNow();
    return true;
  }

  function commitTrackDrag(p: PlayerState, pv: DragPreview, kind: TrackKind) {
    const res = commitDrag(track, kind, pv);
    // Free setup tiles are consumed from the allowance first; only the
    // remainder is charged. The allowance is data, so nothing can revoke it.
    const n = res.built.length;
    const free = Math.min(p.freeTrack, n);
    p.freeTrack -= free;
    if (n > free) {
      let cost: Purse = {};
      for (let i = 0; i < n - free; i++) cost = addCost(cost, TRANSPORT[kind].cost);
      spend(p, cost);
    }
    for (const [bx, by] of res.built) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    syncWorld();
    rescoreNow();
    if (free > 0) toast(`${free} free setup tile${free > 1 ? "s" : ""} used.`, "info");
  }

  function doDemolish(tx: number, ty: number) {
    const hi = eco.harvesters.findIndex((h) => h.tx === tx && h.ty === ty && h.owner === "you");
    if (hi >= 0) {
      eco.harvesters.splice(hi, 1);
      syncWorld(); rescoreNow();
      toast("Harvester removed.", "info");
      return;
    }
    let removed = false;
    for (const kind of ["rail", "road"] as TrackKind[]) {
      if (hasTrack(track, kind, tx, ty)) { demolishTile(track, kind, tx, ty); removed = true; break; }
    }
    if (!removed) { toast("Nothing to demolish there.", "bad"); return; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    syncWorld();
    rescoreNow();
  }

  // ── economy + AI clocks ────────────────────────────────────────────────
  let lastHarvest = 0, lastAi = 0;

  function economyTick(now: number) {
    if (phase !== "play") return;
    if (now - lastHarvest < HARVEST_MS) return;
    lastHarvest = now;
    const comp = buildAllComponents(track);
    for (const p of players) {
      const y = playerResources(eco, p.id, now, comp);
      const gain: Purse = {};
      let any = false;
      for (const [cargo, v] of Object.entries(y) as [Cargo, number][]) {
        const n = Math.max(0, Math.round(v));
        if (n > 0) { gain[cargo] = n; any = true; }
      }
      if (any) earn(p, gain);
    }
  }

  function aiTick(now: number) {
    if (phase !== "play") return;
    if (now - lastAi < AI_BUILD_MS) return;
    lastAi = now;
    const f = factoryOf("ai");
    if (!f) return;
    const out = aiBuildStep(eco, f, { stock: rival.purse, purse: rival.purse }, nextHarvesterId);
    if (!out) return;
    nextHarvesterId++;
    spend(rival, out.spent);
    for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
    syncWorld();
    rescoreNow();
  }

  // ── rendering ──────────────────────────────────────────────────────────
  const overlayItems = () => {
    const items: { sprite: string; tx: number; ty: number }[] = [];
    if (preview) {
      for (const [x, y] of preview.tiles) items.push({ sprite: "highlight", tx: x, ty: y });
    } else if (hover) {
      items.push({ sprite: "highlight", tx: hover.tx, ty: hover.ty });
      // show the catchment when siting a harvester
      if (tool === "harvester" || phase === "setup-harvester") {
        const r = catchmentRect(hover.tx, hover.ty);
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          if (x === hover.tx && y === hover.ty) continue;
          items.push({ sprite: "highlight", tx: x, ty: y });
        }
      }
    }
    return items;
  };

  const cargoChip = (c: Cargo, n: number) =>
    `<span class="chip" style="--c:${CARGO[c].c2}">${CARGO[c].icon}${n}</span>`;

  function paintUi(now: number) {
    elRes.innerHTML = (Object.keys(CARGO) as Cargo[])
      .filter((c) => (me.purse[c] ?? 0) > 0 || ["stone", "ore"].includes(c))
      .map((c) => cargoChip(c, me.purse[c] ?? 0)).join("");

    const mine = vpFor(score, "you"), theirs = vpFor(score, "ai");
    elVp.innerHTML =
      `<b style="color:#5aa8ff">You ${mine}</b> / <b style="color:#ff7a5a">Rival ${theirs}</b>` +
      `<small>first to ${VP_TARGET}</small>`;

    let banner = "";
    if (phase === "setup-factory") banner = "Click a tile to place your Factory";
    else if (phase === "setup-harvester") banner = "Place your first Harvester — it needs an industry in its 4×4 catchment";
    else if (phase === "won") banner = `${winner?.name} wins with ${vpFor(score, winner?.id ?? "")} VP`;
    else if (me.freeTrack > 0) banner = `${me.freeTrack} free track tiles remaining — connect your harvester to your Factory`;
    elBanner.textContent = banner;
    elBanner.style.display = banner ? "block" : "none";

    toasts = toasts.filter((t) => t.until > now);
    elToasts.innerHTML = toasts
      .map((t) => `<div class="toast ${t.kind}">${t.text}</div>`).join("");

    if (preview) {
      const parts = Object.entries(preview.cost).map(([k, v]) => `${v} ${k}`);
      const n = preview.tiles.length;
      const freeN = Math.min(me.freeTrack, n);
      const label = freeN >= n ? "free (setup)" : (parts.join(" + ") || "free");
      elCost.style.display = "block";
      elCost.innerHTML = `<b>${n}</b> tiles · ${label}` +
        (preview.truncated ? ` · <i>blocked</i>` : "") +
        ` · would score <b>${TRANSPORT[tool === "rail" ? "rail" : "road"].vp} VP</b>`;
    } else elCost.style.display = "none";

    // industry / harvester inspector
    let info = "";
    const ref = hover?.ref as { kind?: string; id?: number } | null;
    if (ref && ref.kind === "harvester") {
      const h = eco.harvesters.find((x) => x.id === ref.id);
      if (h) {
        const comp = buildAllComponents(track);
        const conn = resolveConnection(eco, comp, h);
        const inds = industriesInCatchment(grid, h);
        info = `<b>Harvester</b> (${h.owner === "you" ? "yours" : "rival"})<br>` +
          `serving ${inds.length} industr${inds.length === 1 ? "y" : "ies"}<br>` +
          `link: ${conn.kind ?? "<i>none</i>"} ×${conn.multiplier || 0}`;
      }
    } else if (hover) {
      const occ = grid.occupancy[tIdx(hover.tx, hover.ty)];
      if (occ >= 0) {
        const ind: Industry = grid.industries[occ];
        const def = INDUSTRY_BY_KEY[ind.type];
        const servers = eco.harvesters.filter((h) =>
          industriesInCatchment(grid, h).some((i) => i.id === ind.id));
        info = `<b>${def?.name ?? ind.type}</b><br>` +
          `${CARGO[def.cargo].icon} ${CARGO[def.cargo].name} · output ${ind.output}<br>` +
          `${servers.length} harvester${servers.length === 1 ? "" : "s"}`;
      }
    }
    elInspect.innerHTML = info;
    elInspect.style.display = info ? "block" : "none";

    ui.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
      b.classList.toggle("on", b.dataset.tool === tool);
    });
  }

  // ── input ──────────────────────────────────────────────────────────────
  let g: GestureState = createGesture();
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const pos = (e: PointerEvent): [number, number] => {
    const b = stage.getBoundingClientRect();
    return [(e.clientX - b.left) * dpr(), (e.clientY - b.top) * dpr()];
  };
  let downAt: [number, number] | null = null;
  let moved = false;

  canvases.overlay.addEventListener("pointerdown", (e) => {
    canvases.overlay.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    downAt = [x, y]; moved = false;
    const p = renderer?.pick(x, y);
    if (!p) return;
    const isTrackTool = tool === "road" || tool === "rail";
    if (phase === "play" && isTrackTool && e.isPrimary
        && canBuildOn(grid, tool as TrackKind, p.tx, p.ty)) {
      drag = { ax: p.tx, ay: p.ty };
      return;
    }
    g = pointerDown(g, { id: e.pointerId, x, y });
  });

  canvases.overlay.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    if (downAt && (Math.abs(x - downAt[0]) > 4 || Math.abs(y - downAt[1]) > 4)) moved = true;
    const p = renderer?.pick(x, y);
    if (p) hover = { tx: p.tx, ty: p.ty, ref: p.ref };
    if (drag && p) {
      const kind = tool === "rail" ? "rail" : "road";
      // Free setup tiles make the whole drag affordable regardless of purse.
      const purse: Purse = me.freeTrack > 0
        ? { stone: 9999, ore: 9999 } : me.purse;
      preview = previewDrag(grid, track, kind, purse, drag.ax, drag.ay, p.tx, p.ty, true);
      return;
    }
    const out = pointerMove(g, { id: e.pointerId, x, y }, cam);
    g = out.gesture;
    if (out.cam !== cam) { cam = out.cam; renderer?.setCamera(cam); }
  });

  const onUp = (e: PointerEvent) => {
    const [x, y] = pos(e);
    if (drag && preview) {
      commitTrackDrag(me, preview, tool === "rail" ? "rail" : "road");
      drag = null; preview = null; downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    drag = null; preview = null;

    if (!moved) {
      const p = renderer?.pick(x, y);
      if (p) {
        if (phase === "setup-factory") placeFactory(p.tx, p.ty);
        else if (phase === "setup-harvester") {
          if (placeHarvester(p.tx, p.ty, me, true)) {
            phase = "play";
            lastHarvest = performance.now();
            lastAi = performance.now();
            toast("Now connect it to your Factory with road or rail.", "info");
          }
        } else if (phase === "play") {
          if (tool === "harvester") placeHarvester(p.tx, p.ty, me, false);
          else if (tool === "demolish") doDemolish(p.tx, p.ty);
        }
      }
    }
    downAt = null;
    g = pointerUp(g, e.pointerId);
  };
  canvases.overlay.addEventListener("pointerup", onUp);
  canvases.overlay.addEventListener("pointercancel", (e) => {
    drag = null; preview = null; downAt = null; g = pointerUp(g, e.pointerId);
  });
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    cam = zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y);
    renderer?.setCamera(cam);
  }, { passive: false });

  ui.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    if (b.dataset.tool) { tool = b.dataset.tool as Tool; }
    if (b.dataset.act === "recenter") {
      const f = factoryOf("you") ?? focus;
      cam = centerOnTile(cam, f.tx, f.ty);
      renderer?.setCamera(cam);
    }
  });

  window.addEventListener("keydown", (e) => {
    const map: Record<string, Tool> = { "1": "road", "2": "rail", "3": "harvester", "4": "demolish" };
    if (map[e.key]) tool = map[e.key];
  });

  // ── resize ─────────────────────────────────────────────────────────────
  const resize = () => {
    const d = dpr();
    const w = Math.max(1, Math.floor(stage.clientWidth * d));
    const h = Math.max(1, Math.floor(stage.clientHeight * d));
    for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
    cam = resizeCamera(cam, w, h);
    renderer?.setCamera(cam);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  window.visualViewport?.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  // ── boot ───────────────────────────────────────────────────────────────
  let raf = 0;
  let disposed = false;

  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });

  (async () => {
    const images = new Map<number, AtlasImage>();
    const [a05, a1, a2] = await Promise.all([load(atlas05), load(atlas1), load(atlas2)]);
    images.set(0.5, a05); images.set(1, a1); images.set(2, a2);
    const atlas = new Atlas(manifestJson as unknown as Manifest, images);
    buildMasks(atlas);
    if (disposed) return;

    renderer = new IsoRenderer(canvases, atlas, cam, world);
    resize();
    syncWorld();

    const frame = (t: number) => {
      if (disposed) return;
      economyTick(t);
      aiTick(t);
      renderer!.render(t, overlayItems());
      paintUi(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })().catch((err) => {
    elBanner.style.display = "block";
    elBanner.textContent = `Failed to load art: ${err}`;
  });

  // expose for e2e (mirrors the existing window.__hex hook)
  (window as unknown as Record<string, unknown>).__iso = {
    get phase() { return phase; },
    get tool() { return tool; },
    get vp() { return { you: vpFor(score, "you"), ai: vpFor(score, "ai") }; },
    get purse() { return me.purse; },
    get harvesters() { return eco.harvesters; },
    get factories() { return eco.factories; },
    get freeTrack() { return me.freeTrack; },
    grid, track, eco,
    setTool: (t: Tool) => { tool = t; },
  };

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}
