// ══════════════════════════════════════════════════════════════════════════
// M1 (#254) — the minimap's rules, headless and pure: the world ↔ minimap
// mapping, the click → camera target, the drag, the marker hook #256 builds
// on, the redraw gate ("terrain once per map, network on change, view on
// camera change"), and the palette's provenance in the shipped ground art.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { MAP_W, MAP_H, tileToScreen } from "../../src/game/config";
import {
  clampCamera, createCamera, centerOnTile, mapWorldBounds, screenToWorld, worldToScreen, type Camera,
} from "../../src/iso/camera";
import { GRASS, ROUGH, SAND, WATER } from "../../src/iso/grid";
import { PUBLIC_OWNER, createTrack } from "../../src/iso/track";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";
import {
  MINIMAP_PALETTE, RING_STEPS, cameraAt, cameraOnTile, createRedrawGate, dragTo, markerAt, markersKey,
  minimapLayout, minimapSceneOf, minimapToTile, minimapToWorld, mixRgba, networkKey, ownerShades,
  paintNetwork, parseColour, pressAt, rectContains, rgba, terrainColours, tileImageTransform,
  tileToMinimap, viewKey, viewportRect, worldToMinimap, writeTileImage,
  type MinimapMarker, type MinimapScene,
} from "../../src/iso/minimap";

// 200×100 with a 2px pad fits the 9216×4608 island at exactly s = 1/48.
const L = minimapLayout(200, 100, 2);
const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]) <= eps);

describe("M1 minimap — world ↔ minimap mapping", () => {
  it("fits the whole island, centred, inside the pad", () => {
    expect(L.s).toBeCloseTo(1 / 48, 12);
    // the diamond's four tips: top, right, bottom, left
    expect(near(tileToMinimap(L, 0, 0), [100, 2])).toBe(true);
    expect(near(tileToMinimap(L, MAP_W, 0), [196, 50])).toBe(true);
    expect(near(tileToMinimap(L, MAP_W, MAP_H), [100, 98])).toBe(true);
    expect(near(tileToMinimap(L, 0, MAP_H), [4, 50])).toBe(true);
    // a wider box letterboxes left/right, a taller one top/bottom — never stretches
    const wide = minimapLayout(300, 100, 2), tall = minimapLayout(200, 200, 2);
    const b = mapWorldBounds();
    expect(wide.s).toBeCloseTo(96 / (b.maxY - b.minY), 12);
    expect(near(worldToMinimap(wide, 0, 0), [150, 2])).toBe(true);
    expect(tall.s).toBeCloseTo(196 / (b.maxX - b.minX), 12);
    const [, topY] = worldToMinimap(tall, 0, b.minY), [, botY] = worldToMinimap(tall, 0, b.maxY);
    expect((topY + botY) / 2).toBeCloseTo(100, 9);
  });

  it("round-trips world ↔ minimap and tile ↔ minimap (every tile's middle)", () => {
    for (const [wx, wy] of [[0, 0], [-4608, 2304], [1234.5, 777.25], [4608, 2304]]) {
      const [mx, my] = worldToMinimap(L, wx, wy);
      expect(near(minimapToWorld(L, mx, my), [wx, wy], 1e-7)).toBe(true);
    }
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const [mx, my] = tileToMinimap(L, tx + 0.5, ty + 0.5);
        const [fx, fy] = minimapToTile(L, mx, my);
        if (!near([fx, fy], [tx + 0.5, ty + 0.5], 1e-7)) throw new Error(`tile (${tx},${ty}) → (${fx},${fy})`);
        expect(Math.floor(fx) === tx && Math.floor(fy) === ty).toBe(true);
        expect(mx > 0 && mx < 200 && my > 0 && my < 100).toBe(true);
      }
    }
  });

  it("the tile-image transform puts image pixel (tx,ty) on tile (tx,ty)'s diamond", () => {
    for (const bs of [2, 3]) {
      const [a, b, c, d, e, f] = tileImageTransform(L, bs);
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [37, 101], [MAP_W, MAP_H], [12.5, 99.5]]) {
        const [mx, my] = tileToMinimap(L, u, v);
        expect(near([a * u + c * v + e, b * u + d * v + f], [mx * bs, my * bs], 1e-9)).toBe(true);
      }
    }
  });

  it("the viewport rectangle is exactly what the main canvas shows", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const cam: Camera = centerOnTile({ ...createCamera(1280, 720), zoom }, 72, 72);
      const r = viewportRect(L, cam);
      // its middle is the world point at the canvas centre …
      const [cx, cy] = screenToWorld(cam, 640, 360);
      expect(near([r.x + r.w / 2, r.y + r.h / 2], worldToMinimap(L, cx, cy), 1e-9)).toBe(true);
      // … and it is the canvas' size in world px, scaled down
      expect(r.w).toBeCloseTo((1280 / zoom) * L.s, 9);
      expect(r.h).toBeCloseTo((720 / zoom) * L.s, 9);
      expect(rectContains(r, r.x + r.w / 2, r.y + r.h / 2)).toBe(true);
      expect(rectContains(r, r.x - 1, r.y)).toBe(false);
      expect(rectContains(r, r.x - 1, r.y, 1)).toBe(true);
    }
  });
});

describe("M1 minimap — click and drag → camera", () => {
  const cam: Camera = centerOnTile(createCamera(1280, 720), 40, 40);

  it("a click centres the main view on the clicked spot (zoom and size kept)", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const c0 = { ...cam, zoom };
      const [mx, my] = tileToMinimap(L, 96.5, 60.5);
      const next = cameraAt(c0, L, mx, my);
      const [wx, wy] = tileToScreen(96.5, 60.5);
      expect(near(worldToScreen(next, wx, wy), [640, 360], 1e-6)).toBe(true);
      expect([next.zoom, next.vw, next.vh]).toEqual([zoom, 1280, 720]);
      // and the rectangle then sits centred on the click
      const r = viewportRect(L, next);
      expect(near([r.x + r.w / 2, r.y + r.h / 2], [mx, my], 1e-6)).toBe(true);
    }
  });

  it("a click off the island clamps like any camera write", () => {
    for (const [mx, my] of [[0, 0], [199, 99], [-50, 400]]) {
      const next = cameraAt(cam, L, mx, my);
      expect(clampCamera(next)).toEqual(next);
    }
  });

  it("a press inside the rectangle grabs it without a jump; the drag carries it", () => {
    const r = viewportRect(L, cam);
    const mx = r.x + r.w * 0.8, my = r.y + r.h * 0.25;
    const press = pressAt(L, cam, mx, my, null, 7);
    expect(press.kind).toBe("pan");
    if (press.kind !== "pan") return;
    expect(press.camera).toBe(cam);                 // nothing moves on the press
    expect(near(press.grab, [r.w * 0.3, -r.h * 0.25], 1e-9)).toBe(true);
    // drag by (+10, +6) minimap px: the rectangle follows by exactly that
    const moved = dragTo(L, cam, mx + 10, my + 6, press.grab);
    const r2 = viewportRect(L, moved);
    expect(near([r2.x - r.x, r2.y - r.y], [10, 6], 1e-6)).toBe(true);
  });

  it("a press outside the rectangle jumps there, then drags from the pointer", () => {
    const [mx, my] = tileToMinimap(L, 120, 120);
    const press = pressAt(L, cam, mx, my, null, 7);
    expect(press.kind).toBe("pan");
    if (press.kind !== "pan") return;
    expect(press.grab).toEqual([0, 0]);
    expect(press.camera).toEqual(cameraAt(cam, L, mx, my));
    const dragged = dragTo(L, press.camera, mx - 5, my + 3, press.grab);
    expect(dragged).toEqual(cameraAt(cam, L, mx - 5, my + 3));
  });

  it("\"Go there\" centres a tile's middle", () => {
    const next = cameraOnTile(cam, 88, 17);
    const [wx, wy] = tileToScreen(88.5, 17.5);
    expect(near(worldToScreen(next, wx, wy), [640, 360], 1e-6)).toBe(true);
  });
});

describe("M1 minimap — the marker hook (#256)", () => {
  const blockade: MinimapMarker = { id: "blockade:3", tx: 50, ty: 60, color: "#ff7a5a", progress: 0.5, kind: "blockade" };
  const protest: MinimapMarker = { id: "protest:1", tx: 90, ty: 20, color: "#5aa8ff", progress: 1, kind: "protest" };

  it("hit-tests the nearest marker within the radius", () => {
    const [bx, by] = tileToMinimap(L, 50.5, 60.5);
    expect(markerAt(L, [blockade, protest], bx + 3, by - 2, 7)).toBe(blockade);
    expect(markerAt(L, [blockade, protest], bx + 9, by, 7)).toBeNull();
    const [px, py] = tileToMinimap(L, 90.5, 20.5);
    expect(markerAt(L, [blockade, protest], px, py, 7)).toBe(protest);
  });

  it("a press on a marker opens it — only when the game listens", () => {
    const cam = centerOnTile(createCamera(1280, 720), 50, 60);  // the rect covers the marker
    const [bx, by] = tileToMinimap(L, 50.5, 60.5);
    const hit = pressAt(L, cam, bx, by, [blockade], 7);
    expect(hit).toEqual({ kind: "marker", marker: blockade });
    expect(pressAt(L, cam, bx, by, null, 7).kind).toBe("pan");
    expect(pressAt(L, cam, bx, by, [], 7).kind).toBe("pan");
  });

  it("the signature moves with what is drawn, and only with that", () => {
    const k = markersKey([blockade, protest]);
    expect(markersKey([{ ...blockade }, { ...protest }])).toBe(k);
    // below one ring step: same picture, same key
    expect(markersKey([{ ...blockade, progress: 0.5 + 0.4 / RING_STEPS }, protest])).toBe(k);
    // a ring step, a move, a recolour, a new or an ended event: new key
    expect(markersKey([{ ...blockade, progress: 0.5 - 1 / RING_STEPS }, protest])).not.toBe(k);
    expect(markersKey([{ ...blockade, tx: 51 }, protest])).not.toBe(k);
    expect(markersKey([{ ...blockade, color: "#5aa8ff" }, protest])).not.toBe(k);
    expect(markersKey([blockade])).not.toBe(k);
    expect(markersKey([])).toBe("");
    // out-of-range progress is clamped, not drawn past the ring
    expect(markersKey([{ ...blockade, progress: 7 }])).toBe(markersKey([{ ...blockade, progress: 1 }]));
  });
});

describe("M1 minimap — redraw gating", () => {
  const mapA = {}, mapB = {};
  const cam = centerOnTile(createCamera(1280, 720), 40, 40);
  const keys = (map: object, nv: number, rr: number, c: Camera, markers = "") =>
    ({ map, net: networkKey(nv, rr), view: viewKey(c, "432x216@216x108", markers) });

  it("terrain once per map, the network on netVersion/rail.revision, the view on camera change", () => {
    const gate = createRedrawGate();
    expect(gate.next(keys(mapA, 0, 0, cam))).toEqual({ terrain: true, network: true, view: true });
    // a still frame redraws nothing
    expect(gate.next(keys(mapA, 0, 0, cam))).toEqual({ terrain: false, network: false, view: false });
    // panning: the view only — never the terrain or the network
    for (let i = 1; i <= 30; i++) {
      expect(gate.next(keys(mapA, 0, 0, { ...cam, x: cam.x - i * 7 })))
        .toEqual({ terrain: false, network: false, view: true });
    }
    const panned = { ...cam, x: cam.x - 210 };
    // a build (netVersion) or a rail change (revision): network + view
    expect(gate.next(keys(mapA, 1, 0, panned))).toEqual({ terrain: false, network: true, view: true });
    expect(gate.next(keys(mapA, 1, 1, panned))).toEqual({ terrain: false, network: true, view: true });
    expect(gate.next(keys(mapA, 1, 1, panned))).toEqual({ terrain: false, network: false, view: false });
    // a zoom step or a resized viewport is a view change
    expect(gate.next(keys(mapA, 1, 1, { ...panned, zoom: 2 }))).toEqual({ terrain: false, network: false, view: true });
    expect(gate.next(keys(mapA, 1, 1, { ...panned, zoom: 2, vw: 900 }))).toEqual({ terrain: false, network: false, view: true });
    // markers: view only
    expect(gate.next(keys(mapA, 1, 1, { ...panned, zoom: 2, vw: 900 }, "protest:1@1,1:#fff:48|")))
      .toEqual({ terrain: false, network: false, view: true });
    // a different map: everything
    expect(gate.next(keys(mapB, 1, 1, cam))).toEqual({ terrain: true, network: true, view: true });
    gate.invalidate();
    expect(gate.next(keys(mapB, 1, 1, cam))).toEqual({ terrain: true, network: true, view: true });
  });

  it("the canvas size is part of the view key", () => {
    const gate = createRedrawGate();
    gate.next({ map: mapA, net: networkKey(0, 0), view: viewKey(cam, "432x216@216x108", "") });
    expect(gate.next({ map: mapA, net: networkKey(0, 0), view: viewKey(cam, "504x252@252x126", "") }))
      .toEqual({ terrain: false, network: false, view: true });
  });
});

describe("M1 minimap — colours", () => {
  const P = MINIMAP_PALETTE;
  const c = (css: string) => parseColour(css)!;

  it("parses and mixes CSS colours", () => {
    expect(parseColour("#5aa8ff")).toBe(rgba(0x5a, 0xa8, 0xff));
    expect(parseColour("#fa0")).toBe(rgba(0xff, 0xaa, 0x00));
    expect(parseColour("rgb(1, 2, 3)")).toBe(rgba(1, 2, 3));
    expect(parseColour("nonsense")).toBeNull();
    expect(parseColour(undefined)).toBeNull();
    expect(mixRgba(rgba(0, 0, 0), rgba(200, 100, 50), 0.5)).toBe(rgba(100, 50, 25));
    const buf = new Uint8ClampedArray(8);
    writeTileImage(Uint32Array.of(rgba(1, 2, 3, 4), rgba(250, 251, 252)), buf);
    expect([...buf]).toEqual([1, 2, 3, 4, 250, 251, 252, 255]);
  });

  // The prompt for #254: the ground palette changed in #343 — sample the
  // minimap's colours from assets/ground. This re-derives them from the
  // shipped files, so the next texture pass cannot silently orphan the plate.
  it("the ground palette is the linear-light mean of the shipped textures", async () => {
    const toLin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
    for (const [file, css] of [["grass", P.grass], ["sand", P.sand], ["water", P.water]] as const) {
      const { data } = await sharp(`assets/ground/${file}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        for (let k = 0; k < 3; k++) sum[k] += toLin(data[i + k]);
        n++;
      }
      const mean = sum.map((s) => toSrgb(s / n));
      const want = c(css);
      const got = [want >>> 24, (want >>> 16) & 255, (want >>> 8) & 255];
      for (let k = 0; k < 3; k++) expect(Math.abs(mean[k] - got[k]), `${file}.png channel ${k}`).toBeLessThanOrEqual(2);
    }
  });

  it("paints the terrain: sea, shallows, beach, grass, rough, woods", () => {
    const terrain = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
    const at = (x: number, y: number) => y * MAP_W + x;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < 10; x++) terrain[at(x, y)] = WATER;
    for (let y = 0; y < MAP_H; y++) terrain[at(10, y)] = SAND;
    terrain[at(50, 50)] = ROUGH;
    const trees = new Uint8Array(MAP_W * MAP_H);
    trees[at(60, 60)] = 3;
    trees[at(5, 5)] = 3;                            // a "tree" at sea is ignored
    const t = terrainColours({ terrain, trees, forests: [{ tx: 80, ty: 80 }] });
    expect(t.full[at(0, 0)]).toBe(c(P.water));
    expect(t.full[at(9, 20)]).toBe(mixRgba(c(P.water), c(P.shallows), P.shallowsMix));   // beside the beach
    expect(t.full[at(8, 20)]).toBe(c(P.water));
    expect(t.full[at(10, 20)]).toBe(c(P.sand));
    expect(t.full[at(30, 30)]).toBe(c(P.grass));
    expect(t.full[at(50, 50)]).toBe(mixRgba(c(P.grass), c(P.rocky), P.roughMix));
    expect(t.full[at(60, 60)]).toBe(mixRgba(c(P.grass), c(P.forest), P.treeMix));
    expect(t.full[at(5, 5)]).toBe(c(P.water));
    expect(t.full[at(83, 83)]).toBe(c(P.forest));
    expect(t.full[at(84, 84)]).toBe(c(P.grass));
    // `ground` is the same map without its woods
    expect(t.ground[at(60, 60)]).toBe(c(P.grass));
    expect(t.ground[at(83, 83)]).toBe(c(P.grass));
  });

  it("paints the network over it, each in its owner's colour, in ground order", () => {
    const terrain = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
    const trees = new Uint8Array(MAP_W * MAP_H);
    const at = (x: number, y: number) => y * MAP_W + x;
    trees[at(3, 3)] = 1;
    const ground = terrainColours({ terrain, trees });
    const track = createTrack();
    track.road[at(20, 20)] = 5; track.owner[at(20, 20)] = PUBLIC_OWNER;    // a highway
    track.road[at(21, 20)] = 5; track.owner[at(21, 20)] = 1;               // your paved road
    track.dirt[at(22, 20)] = 5; track.owner[at(22, 20)] = 2;               // the rival's dirt
    track.road[at(40, 40)] = 5; track.owner[at(40, 40)] = 1;               // under a depot
    const rail = { tile: new Uint8Array(MAP_W * MAP_H), owner: new Uint8Array(MAP_W * MAP_H) };
    rail.tile[at(30, 30)] = 0x81; rail.owner[at(30, 30)] = 2;
    const scene: MinimapScene = {
      track, rail,
      towns: [{ houses: [[70, 70], [71, 70]] }],
      fields: [{ tx: 90, ty: 90, sprite: "wheat_field" }, { tx: 95, ty: 95, sprite: "trees" }],
      cleared: new Set([at(3, 3)]),
      sites: [
        { kind: "industry", tx: 100, ty: 100, w: 3, h: 3, owner: 0 },
        { kind: "industry", tx: 110, ty: 100, w: 3, h: 3, owner: 2 },
        { kind: "depot", tx: 40, ty: 40, w: 2, h: 2, owner: 1 },
        { kind: "depot", tx: 44, ty: 40, w: 2, h: 2, owner: 1, closed: true },
        { kind: "platform", tx: 30, ty: 31, w: 1, h: 3, owner: 2 },
      ],
    };
    const you = c("#5aa8ff"), rival = c("#ff7a5a");
    const out = paintNetwork(ground, scene, (id) => (id === 1 ? you : rival));
    expect(out[at(20, 20)]).toBe(c(P.publicRoad));
    expect(out[at(21, 20)]).toBe(ownerShades(you).road);
    expect(out[at(22, 20)]).toBe(ownerShades(rival).dirt);
    expect(out[at(30, 30)]).toBe(ownerShades(rival).rail);
    expect(out[at(30, 32)]).toBe(ownerShades(rival).station);
    expect(out[at(70, 70)]).toBe(c(P.town));
    expect(out[at(91, 91)]).toBe(c(P.wheat));
    expect(out[at(96, 96)]).toBe(c(P.forest));
    expect(out[at(101, 101)]).toBe(c(P.industry));                  // nobody holds it
    expect(out[at(111, 101)]).toBe(ownerShades(rival).road);        // claimed: the holder's colour
    expect(out[at(40, 40)]).toBe(ownerShades(you).site);            // the depot wins its road tile
    expect(out[at(45, 41)]).toBe(mixRgba(ownerShades(you).site, c(P.closed), 0.6));
    expect(out[at(3, 3)]).toBe(c(P.grass));                         // built over: tree hidden
    expect(out[at(60, 60)]).toBe(c(P.grass));
    // the three owners stay apart from each other and from the ground
    const distinct = new Set([out[at(20, 20)], out[at(21, 20)], out[at(22, 20)], out[at(30, 30)], c(P.grass)]);
    expect(distinct.size).toBe(5);
  });

  it("reads the scene off the live game: holders, plants, truck lots, platforms", () => {
    const track = createTrack();
    const industries = [
      { id: 0, type: "farm", tx: 10, ty: 10, w: 3, h: 3, output: 0, banditUntil: 0 },
      { id: 1, type: "farm", tx: 30, ty: 30, w: 3, h: 3, output: 0, banditUntil: 0 },
    ];
    const grid = { towns: [{ id: 0, tx: 5, ty: 5, houses: [[5, 5]], roads: [] }], industries, terrain: new Uint8Array(MAP_W * MAP_H) };
    const eco = {
      grid, track,
      factories: [{ owner: "you", ownerId: 1, tx: 60, ty: 60 }],
      harvesters: [
        // a platform-Depot claims its industry the moment it stands
        { id: 1, owner: "ai", ownerId: 2, tx: 14, ty: 10, platformId: 9, railIndustryId: 0 },
        // a truck Depot with no road behind it claims nothing yet
        { id: 2, owner: "you", ownerId: 1, tx: 33, ty: 30, closed: true },
      ],
    };
    const rail = { structures: [{ id: 9, kind: "platform", ownerId: 2, owner: "ai", tx: 14, ty: 10, w: 1, h: 3 }] };
    const drawRail = { tile: new Uint8Array(MAP_W * MAP_H), owner: new Uint8Array(MAP_W * MAP_H) };
    const scene = minimapSceneOf({ grid, track, eco, rail, drawRail } as never);
    expect(scene.track).toBe(track);
    expect(scene.rail).toBe(drawRail);
    expect(scene.towns).toBe(grid.towns);
    const [fw, fh] = FACTORY_FOOTPRINT;
    expect(scene.sites).toEqual([
      { kind: "industry", tx: 10, ty: 10, w: 3, h: 3, owner: 2 },
      { kind: "industry", tx: 30, ty: 30, w: 3, h: 3, owner: 0 },
      { kind: "plant", tx: 60, ty: 60, w: fw, h: fh, owner: 1, closed: false },
      { kind: "depot", tx: 33, ty: 30, w: 2, h: 2, owner: 1, closed: true },
      { kind: "platform", tx: 14, ty: 10, w: 1, h: 3, owner: 2 },
    ]);
  });
});
