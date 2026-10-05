// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.1 (#677) — map size becomes a runtime option (standard 144 / large 216).
//
// This file holds the node-side contract:
//   • STANDARD IS BYTE-IDENTICAL: every standard map the game can generate
//     (free play under the runner's all-OFF defaults, the shipped organic and
//     grid option sets, the Starter Island, every scenario and every tutorial
//     lesson) deep-equals the pre-change generator. The digests below were
//     captured from main c66a1a5 BEFORE any TOWN-4.1 source change, with the
//     same canonical digest (`digest`) — typed arrays by raw bytes, objects by
//     sorted key, i.e. deep-equality semantics. Do not re-capture them to make
//     a change pass: a moved digest means a standard map (and every save made
//     on it) moved.
//   • NOTHING READS THE SIZE AT IMPORT: a static scan of src/ for module-scope
//     MAP_W/MAP_H reads, plus a behavioural check — import everything at 144,
//     switch to 216, and every grid, track, rail layer, chunk grid, snapshot
//     byte count, minimap/terrain input and lazy buffer comes out 216-sized.
//   • setMapSize's contract (once per boot; locked after allocation → throws
//     in dev builds; claims/releases; withMapSize for throwaway work).
//   • the size option's chain of custody (explicit → new-game URL → save →
//     room, host wins → story/scenario → default) and the MatchSettings wire.
//   • the large generator (counts fixed, spacing spread ×1.5, deterministic).
//   • snapshot v18: a 144 snapshot is refused by a 216 client and vice versa.
//   • saves: a snap-17 save (no size) is a 144 save; a large save records and
//     restores its size; the menu scores a save at its own size.
// The booted-game half (a large game boots, saves and reloads; an old save
// boots at 144) lives in `town-4-1-large-boot.test.ts`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash, type Hash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import {
  MAP_W, MAP_H, MAP_SIZES, MAP_SIDE_MAX, setMapSize, lockMapSize, releaseMapSize,
  claimMapSize, isMapSizeLocked, withMapSize, mapSizedBuffer,
} from "../../src/game/config";
import {
  generateMap, starterIslandGrid, mapSpread, spread, ARCHIPELAGO_VX, ARCHIPELAGO_HY,
  WATER, type Grid, type MapGenOptions,
} from "../../src/iso/grid";
import { scatterScenery } from "../../src/iso/scenery";
import { SCENARIOS } from "../../src/story/scenarios";
import { tutorialMap } from "../../src/iso/guide/scenario";
import { GUIDE_SECTION_IDS } from "../../src/iso/guide/types";
import { createTrack, PRESENT } from "../../src/iso/track";
import { createRail, createRailState } from "../../src/iso/rail";
import { chunksX, chunksY, CHUNK } from "../../src/iso/renderer";
import "../../src/iso/road-renderer";
import "../../src/iso/rail-renderer";
import {
  SNAPSHOT_VERSION, EXPECTED_TRACK_BYTES, expectedTrackBytes, buildSnapshot, validateSnapshot,
  applySnapshot, joinFromSnapshot, type SnapshotSource,
} from "../../src/iso/snapshot";
import { terrainColours } from "../../src/iso/minimap";
import { terrainMapInput } from "../../src/iso/terrain-gl-adapter";
import { buildTerrainMesh } from "../../src/iso/terrain-gl/mesh";
import { createCamera, centerOnMap, mapWorldBounds, visibleTileRange } from "../../src/iso/camera";
import { INDUSTRY_QUOTA } from "../../src/iso/config";
import {
  resolveMapSize, readMapOptions, mapOptionsEqual, MAP_OPTIONS_OFF, MAP_OPTIONS_ON,
  MAP_SIZE_NAMES, readMapSize, defaultMapSize,
} from "../../src/iso/map-options";
import {
  normalizeMatchSettings, describeMatchSettings, isDefaultMatchSettings, DEFAULT_MATCH_SETTINGS,
  type MatchSettings,
} from "../../src/net/match-settings";
import { readMatchSettings } from "../../src/net/protocol";
import {
  SAVE_KEY, SAVEGAME_VERSION, SAVE_SNAP_VERSIONS, readSave, isOldSave, saveMapSide, saveFitsItsMap,
  trackSave, type SaveGamePayload,
} from "../../src/iso/savegame-runtime";
import { resumableSaves } from "../../src/iso/save-summary";

/** Read BEFORE any test runs: the imports above evaluated every module that
 *  owns map-sized state, and none of them may have allocated a map. */
const LOCKED_AT_IMPORT = isMapSizeLocked();

const LARGE = MAP_SIZES.large;

/** Every test leaves the map as it found it: unlocked and standard. */
afterEach(() => {
  releaseMapSize();
  vi.unstubAllGlobals();
});

/** Switch to a size the way a boot would: nothing of the last map survives. */
function useSize(side: number): void {
  releaseMapSize();
  setMapSize(side, side);
}

/** Canonical deep digest: typed arrays by their raw bytes, objects by sorted
 *  key — deep-equality semantics, so equal digests ⇔ deep-equal values. */
function feed(h: Hash, v: unknown): void {
  if (v === undefined) { h.update("u;"); return; }
  if (v === null) { h.update("n;"); return; }
  if (ArrayBuffer.isView(v)) {
    const a = v as ArrayBufferView;
    h.update(`T${a.constructor.name}/${a.byteLength}:`);
    h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    return;
  }
  if (Array.isArray(v)) {
    h.update(`A${v.length}[`);
    for (const x of v) feed(h, x);
    h.update("]");
    return;
  }
  if (v instanceof Map) { h.update("M"); feed(h, [...v.entries()]); return; }
  if (v instanceof Set) { h.update("S"); feed(h, [...v.values()]); return; }
  switch (typeof v) {
    case "number": h.update(`#${Object.is(v, -0) ? "-0" : String(v)};`); return;
    case "string": h.update(`s${v.length}:${v}`); return;
    case "boolean": h.update(v ? "t;" : "f;"); return;
    case "function": h.update("F;"); return;
    case "object": {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      h.update(`O${keys.length}{`);
      for (const k of keys) { h.update(`k${k.length}:${k}`); feed(h, o[k]); }
      h.update("}");
      return;
    }
    default: h.update(`?${String(v)};`);
  }
}
const digest = (v: unknown): string => { const h = createHash("sha256"); feed(h, v); return h.digest("hex"); };

const SEEDS = [1, 7, 42, 1337, 20260926] as const;
/** The options a new free-play game generates with outside the runner. */
const SHIPPED: MapGenOptions = { rivers: true, elevation: true, shapes: true, rings: true, layout: "organic" };
/** …and the same features under the grid street plan (pre-TOWN-2 saves, rooms). */
const SHIPPED_GRID: MapGenOptions = { rivers: true, elevation: true, shapes: true, rings: true };

/** Every kind of standard map the game generates, named for the pin table. */
function standardMaps(): [string, () => Grid][] {
  const out: [string, () => Grid][] = [];
  for (const s of SEEDS) out.push([`off:${s}`, () => generateMap(s)]);
  for (const s of SEEDS) out.push([`shipped:${s}`, () => generateMap(s, SHIPPED)]);
  for (const s of SEEDS) out.push([`shipped-grid:${s}`, () => generateMap(s, SHIPPED_GRID)]);
  out.push(["starter-island", () => starterIslandGrid()]);
  for (const def of SCENARIOS) {
    out.push([`scenario:${def.id}`, () => generateMap(def.seed, {
      rivers: def.mapOptions.rivers, elevation: def.mapOptions.elevation,
      shapes: def.mapOptions.shapes, rings: def.mapOptions.rings, layout: "grid", ...def.gen,
    })]);
  }
  for (const id of GUIDE_SECTION_IDS) out.push([`tutorial:${id}`, () => tutorialMap(id)]);
  return out;
}

// Captured from main c66a1a5 (pre-TOWN-4.1) — see the header.
const PRE_CHANGE_GRIDS: Readonly<Record<string, string>> = {
  "off:1": "972c60cb033d8bf76ec62a5b7ec54ce4e05cceb7fe333f21a98c178db8fed80a",
  "off:7": "430fd0a5698d2fa31a1ae90cc426698de01924ac43bcae867f4a47c3e3bf0134",
  "off:42": "3be8fa347c2a640d8a6490931bae194635b1041a3cf627141a88ed66271eac3c",
  "off:1337": "771a7dc6150b5b0c626203775d9de1cb3681c29cd4ba0802a0f73f21b8160687",
  "off:20260926": "602258c03843926d0dc72899955a8206d494ff386233d2f4be2efe0308dd5b9e",
  "shipped:1": "8e1c1645a43310bce316590339bd17d05695a619920f02f61043f592e77880f2",
  "shipped:7": "fba52e77ecdc2356ad5c79ee912bbbe653841d6ef3d91ce6e6ed6f0618cd6fe3",
  "shipped:42": "c933eba278d7417565c3c6c01ce8cf9ce840ffaeaa005b26d6cbf24f07ab6cff",
  "shipped:1337": "3620a0833284fc17512b81edd8580fd74ee45e0d579f7c8852fe63b52b99ebf7",
  "shipped:20260926": "bf6ea35926d002e33926b7fa5fea07379c8dc86d7957ccd8d4fad626252834d2",
  "shipped-grid:1": "6c3ce72976fa64255e838b228551b02dfab549e3675c706a18b90c5bab0164f8",
  "shipped-grid:7": "8dd2803e9c699871c9007b6bda821314c46c3f94f107ae52c57849ce1286e366",
  "shipped-grid:42": "7b690005df1c1bcdc056a719ab63a01fc7fa33aa5422ef0be3b36bcd7a3fb6cf",
  "shipped-grid:1337": "7c1161149e08b0a5a59c5d7784598319cbb007a5942316d4d8d7c8fed8d303ce",
  "shipped-grid:20260926": "ee141764fd53b1ca9a0b72e0017acb33cd366860718934e39d526d151af21c8a",
  "starter-island": "8e054976fc0b4579be84f2dfa3e4d2862d9ab75e07d815d41af752ee1e9b7ef9",
  "scenario:river-valley": "c2b9f13739659fee2cf96ca93af9aaacf06ec85fce776c52b3c7f3245c317061",
  "scenario:highlands": "6a6e63367d83662a3ac489c6cd7b6466d513bd1357c3aaff8caacfb41d3150e5",
  "scenario:twin-towns": "b42c6307362bdafb4648ab163f46f5f9d56d2fc2bf4b6f4081b79b23d8d757ca",
  "scenario:archipelago": "a93ab0cf6c7313fddda60598bb42e5024419fed962eb1c8239883c0d95a078f9",
  "tutorial:getting-started": "e47202495b6274f4e5124039bc11ae541c269c9fe31fb8ddea155ecdb5a55a06",
  "tutorial:factory": "a53ad950689d72eacbb91eec5844e8d5e4c70131b3f009a587a89f001fa6a0ee",
  "tutorial:depots": "a36d6455ebcc5eb2f819b93a6586fdd5821b601274eb039a7ac7217b82658b0b",
  "tutorial:logistics": "d5551ae6be12086f692cb7861a176097fa9293ea80d8480e1321d505f0a31124",
  "tutorial:rail": "654adbc0b9ededdff4437078e6c54a5760e5cf142ff1c4d519ce47c70f2eaefd",
  "tutorial:upgrades": "4811c6139cc4c68529473d79281ef3692c252f51242b71d517b21bb668de334b",
  "tutorial:drawer": "f02b023a158d7c8b60c0dab9502f69c28eb3dc723141bd706282895f519fac4f",
  "tutorial:rivals": "8ae3a990c1c97297f85c02b7a9ebd3a882dc3d2bb18b18b8ba83397b52d13c38",
  "tutorial:winning": "d78fdf9c14f4c14fc49f301e40954373dfd41d80dc8eb8734ea2447c38ab0bbd",
  "tutorial:settings": "6d18e00161a495058a9da01c4d2a951b256188ffbb71a4006d58f9b227c18a4c",
};
const PRE_CHANGE_SCENERY: Readonly<Record<string, string>> = {
  "shipped:1": "225e1a00fdc7a2dcadaf8b2ad4f54f11fce120e4d8b7e9e1022d272cd0328c32",
  "shipped:7": "927f540ba31f7119f7d46b9fce32ecddc660bbbc1c676c277fe416019b12fd25",
  "shipped:42": "e0afe23914a79580c5dc0545e26cceaf2b22b685d38d27e8b87ba44f61a93212",
  "shipped:1337": "92c39ad325836805e67672d8a5a58fb5d2f57496b11d861aeb6714f2722f25f7",
  "shipped:20260926": "542da01e36054171b3095f08ac8b10acfd85997ba36ef1240ce132ab41b149c6",
};

describe("TOWN-4.1: standard maps are byte-identical to the pre-change generator", () => {
  it("pins every standard map kind (all seeds × option sets, Starter Island, scenarios, lessons)", () => {
    const got: Record<string, string> = {};
    for (const [name, make] of standardMaps()) got[name] = digest(make());
    expect(got).toEqual(PRE_CHANGE_GRIDS);
  });

  it("pins the shipped scenery scatter on the same maps", () => {
    const got: Record<string, string> = {};
    for (const s of SEEDS) got[`shipped:${s}`] = digest(scatterScenery(generateMap(s, SHIPPED)));
    expect(got).toEqual(PRE_CHANGE_SCENERY);
  });
});

// ── setMapSize's contract ──────────────────────────────────────────────────
describe("TOWN-4.1: setMapSize — once per boot, locked after allocation", () => {
  it("names the two sizes the wire knows, with the ticket's sides", () => {
    expect(MAP_SIZES).toEqual({ standard: 144, large: 216 });
    // The protocol leaf mirrors the names (it may not import config.ts).
    expect([...MAP_SIZE_NAMES].sort()).toEqual(Object.keys(MAP_SIZES).sort());
    expect(defaultMapSize()).toBe("standard");
    expect([MAP_W, MAP_H]).toEqual([144, 144]);   // the unit runner's default
  });

  it("MAP_W/MAP_H are live bindings every importer reads at call time", () => {
    useSize(LARGE);
    expect([MAP_W, MAP_H]).toEqual([216, 216]);
    releaseMapSize();
    expect([MAP_W, MAP_H]).toEqual([144, 144]);
  });

  it("refuses sides that are not playable integers", () => {
    for (const bad of [0, 7, 143.5, MAP_SIDE_MAX + 1, Number.NaN]) {
      expect(() => setMapSize(bad, bad)).toThrow(RangeError);
    }
    expect([MAP_W, MAP_H]).toEqual([144, 144]);
  });

  it("a different size after an allocation throws (dev); the same size is a no-op", () => {
    releaseMapSize();
    createTrack();                                  // allocators lock the size
    expect(isMapSizeLocked()).toBe(true);
    expect(() => setMapSize(144, 144)).not.toThrow();
    expect(() => setMapSize(LARGE, LARGE)).toThrow(/after the 144×144 map was allocated/);
    expect([MAP_W, MAP_H]).toEqual([144, 144]);
    releaseMapSize();
    expect(isMapSizeLocked()).toBe(false);
    expect(() => setMapSize(LARGE, LARGE)).not.toThrow();
    for (const make of [() => generateMap(1), () => createRail(), () => createRailState()]) {
      releaseMapSize();
      setMapSize(LARGE, LARGE);
      make();
      expect(isMapSizeLocked(), "every allocator locks").toBe(true);
    }
  });

  it("only the latest claim releases (two games in one page)", () => {
    useSize(LARGE);
    const host = claimMapSize();
    const guest = claimMapSize();
    lockMapSize();
    releaseMapSize(host);                           // the first game's late dispose
    expect([MAP_W, isMapSizeLocked()]).toEqual([216, true]);
    releaseMapSize(guest);
    expect([MAP_W, isMapSizeLocked()]).toEqual([144, false]);
  });

  it("withMapSize runs throwaway work at another size and restores size AND lock", () => {
    releaseMapSize();
    const inside = withMapSize(LARGE, LARGE, () => {
      const t = createTrack();
      return { w: MAP_W, cells: t.dirt.length, locked: isMapSizeLocked() };
    });
    expect(inside).toEqual({ w: 216, cells: 216 * 216, locked: true });
    expect([MAP_W, MAP_H, isMapSizeLocked()]).toEqual([144, 144, false]);
    // …even when the work throws, and even at the current size.
    expect(() => withMapSize(LARGE, LARGE, () => { throw new Error("boom"); })).toThrow("boom");
    withMapSize(144, 144, () => createTrack());
    expect([MAP_W, isMapSizeLocked()]).toEqual([144, false]);
  });

  it("mapSizedBuffer allocates on first use and again only when the size moves", () => {
    let made = 0;
    const buf = mapSizedBuffer((n) => { made++; return new Uint8Array(n); });
    const a = buf();
    expect(a.length).toBe(144 * 144);
    expect(buf()).toBe(a);
    useSize(LARGE);
    expect(buf().length).toBe(216 * 216);
    expect(made).toBe(2);
  });
});

// ── nothing reads the size at import time ──────────────────────────────────
const SRC = join(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

interface ImportTimeRead { file: string; line: number; names: string[]; isLet: boolean }

/**
 * Every top-level statement of `file` that reads MAP_W/MAP_H while the module
 * EVALUATES — i.e. outside any function body (parameter defaults included:
 * they run per call) and outside class instance members (they run per
 * construction). Type positions, import/export specifiers and the bindings'
 * own declarations are not reads.
 */
function importTimeSizeReads(file: string): ImportTimeRead[] {
  const text = readFileSync(file, "utf8");
  if (!/\bMAP_[WH]\b/.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: ImportTimeRead[] = [];
  const isStatic = (m: ts.Node) => ts.canHaveModifiers(m)
    && (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.StaticKeyword);
  const readsIn = (node: ts.Node): boolean => {
    if (ts.isFunctionLike(node) || ts.isTypeNode(node)) return false;
    if (ts.isClassLike(node)) {
      return node.members.some((m) => (ts.isClassStaticBlockDeclaration(m) || (ts.isPropertyDeclaration(m) && isStatic(m)))
        && ts.forEachChild(m, (c) => readsIn(c) || undefined) === true);
    }
    if (ts.isIdentifier(node) && (node.text === "MAP_W" || node.text === "MAP_H")) {
      const p = node.parent;
      if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false;
      if (ts.isVariableDeclaration(p) && p.name === node) return false;
      return true;
    }
    return ts.forEachChild(node, (c) => readsIn(c) || undefined) === true;
  };
  for (const st of sf.statements) {
    if (!readsIn(st)) continue;
    const names = ts.isVariableStatement(st)
      ? st.declarationList.declarations.map((d) => d.name.getText(sf)) : [];
    const isLet = ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Let) !== 0;
    out.push({ file: relative(SRC, file).split("\\").join("/"), line: sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1, names, isLet });
  }
  return out;
}

/** The module-scope values that MAY read the size at import, because an
 *  `onMapSize` callback re-derives them on every change (live bindings). */
const LIVE_DERIVED: Readonly<Record<string, readonly string[]>> = {
  "iso/renderer.ts": ["chunksX", "chunksY"],
  "iso/track.ts": ["chunksX"],
  "iso/grid.ts": ["ARCHIPELAGO_VX", "ARCHIPELAGO_HY"],
  "iso/snapshot.ts": ["EXPECTED_TRACK_BYTES"],
};

describe("TOWN-4.1: no module computes anything map-sized at import time", () => {
  it("importing every map module allocated nothing (the size was never locked)", () => {
    expect(LOCKED_AT_IMPORT).toBe(false);
  });

  it("static scan: src/ reads MAP_W/MAP_H at module scope only for live, re-derived values", () => {
    const reads = sourceFiles(SRC).flatMap(importTimeSizeReads);
    const unexpected = reads.filter((r) =>
      !(r.isLet && r.names.length > 0 && r.names.every((n) => LIVE_DERIVED[r.file]?.includes(n))));
    expect(unexpected, "module-scope MAP_W/MAP_H reads freeze at the import-time size").toEqual([]);
    // …and every allowed one really is re-derived when the size changes.
    for (const [file, names] of Object.entries(LIVE_DERIVED)) {
      const text = readFileSync(join(SRC, file), "utf8");
      const hook = text.slice(text.indexOf("onMapSize("));
      for (const n of names) {
        expect(text.indexOf("onMapSize("), `${file} registers onMapSize`).toBeGreaterThan(-1);
        expect(hook, `${file}: ${n} is re-derived in its onMapSize callback`).toMatch(new RegExp(`\\b${n} = `));
      }
    }
  });

  it("imported at 144, switched to 216: every map-sized thing follows the size", () => {
    useSize(LARGE);
    const n = 216 * 216;
    // live derived values
    expect([chunksX, chunksY]).toEqual([Math.ceil(216 / CHUNK), Math.ceil(216 / CHUNK)]);
    expect(EXPECTED_TRACK_BYTES).toBe(n);
    expect(expectedTrackBytes()).toBe(n);
    expect([ARCHIPELAGO_VX, ARCHIPELAGO_HY]).toEqual([Math.floor(216 * 0.38), Math.floor(216 * 0.62)]);
    // allocations (an elevated, rivered map so every layer exists)
    const grid = generateMap(42, { elevation: true, rivers: true });
    expect([grid.w, grid.h, grid.terrain.length, grid.occupancy.length, grid.height!.length, grid.rivers!.length])
      .toEqual([216, 216, n, n, n, n]);
    const track = createTrack();
    for (const layer of [track.dirt, track.road, track.owner, track.upgraded, track.tier!]) expect(layer.length).toBe(n);
    const rail = createRail();
    expect([rail.tile.length, rail.owner.length]).toEqual([n, n]);
    // the readers that size their own buffers from the live map
    const scenery = scatterScenery(grid);
    expect(scenery.trees.length).toBe(n);
    expect(terrainColours({ terrain: grid.terrain, trees: scenery.trees }).ground.length).toBe(n);
    const input = terrainMapInput(grid, grid.seed);
    expect([input.w, input.h, input.heights?.length]).toEqual([216, 216, 217 * 217]);
    const mesh = buildTerrainMesh(input);
    expect([mesh.positions.length, mesh.indices.length]).toEqual([217 * 217 * 2, 216 * 216 * 6]);
    // camera bounds and culling reach the far corner
    expect(mapWorldBounds().maxY).toBe((216 + 216) * 16);
    const range = visibleTileRange(centerOnMap(createCamera(4000, 4000)), 999);
    expect([range.x1, range.y1]).toEqual([215, 215]);
  });
});

// ── the large generator ────────────────────────────────────────────────────
const SHIPPED_LARGE_SEEDS = [1, 7, 42] as const;
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

describe("TOWN-4.1: a large map keeps the counts and spreads the spacing", () => {
  it("spread() is the identity on standard and ×1.5 on large", () => {
    expect(mapSpread()).toBe(1);
    expect([spread(28), spread(8), spread(10), spread(24), spread(12)]).toEqual([28, 8, 10, 24, 12]);
    useSize(LARGE);
    expect(mapSpread()).toBe(1.5);
    expect([spread(28), spread(8), spread(10), spread(24), spread(12), spread(2)]).toEqual([42, 12, 15, 36, 18, 3]);
  });

  it.each(SHIPPED_LARGE_SEEDS)("seed %i on large: same counts, legal sites, wider gaps, deterministic", (seed) => {
    useSize(LARGE);
    const g = generateMap(seed, SHIPPED);
    const quota = Object.values(INDUSTRY_QUOTA).reduce((a, b) => a + b, 0);
    expect(g.towns.length).toBe(4);                 // TOWN_COUNT, unchanged
    expect(g.industries.length).toBe(quota);        // INDUSTRY_QUOTA, unchanged
    for (const ind of g.industries) {
      expect(ind.tx >= 0 && ind.ty >= 0 && ind.tx + ind.w <= 216 && ind.ty + ind.h <= 216).toBe(true);
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) expect(g.terrain[y * 216 + x]).not.toBe(WATER);
      }
    }
    // TOWN_TOWN_SEP 28 → 42 between centres
    for (let a = 0; a < g.towns.length; a++) {
      for (let b = a + 1; b < g.towns.length; b++) {
        expect(cheb(g.towns[a].tx, g.towns[a].ty, g.towns[b].tx, g.towns[b].ty)).toBeGreaterThanOrEqual(42);
      }
    }
    // TOWN_INDUSTRY_SEP 8 → 12 from every house to every industry tile
    for (const t of g.towns) {
      for (const [hx, hy] of t.houses) {
        for (const ind of g.industries) {
          const dx = Math.max(ind.tx - hx, 0, hx - (ind.tx + ind.w - 1));
          const dy = Math.max(ind.ty - hy, 0, hy - (ind.ty + ind.h - 1));
          expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(12);
        }
      }
    }
    expect(digest(generateMap(seed, SHIPPED))).toBe(digest(g));   // a pure function of seed + size
  });

  it("generateMap holds a caller to the size it names", () => {
    expect(() => generateMap(1, { size: "large" })).toThrow(/call setMapSize/);
    expect(generateMap(1, { size: "standard" }).w).toBe(144);
    useSize(LARGE);
    expect(() => generateMap(1, { size: "standard" })).toThrow(/216×216/);
    expect(generateMap(1, { size: "large" }).w).toBe(216);
  });
});

// ── the option's chain of custody ──────────────────────────────────────────
describe("TOWN-4.1: resolveMapSize — explicit, new-game URL, save, room (host wins), story, default", () => {
  const room = (size?: "standard" | "large"): { map?: typeof MAP_OPTIONS_OFF } =>
    ({ map: { ...MAP_OPTIONS_ON, ...(size ? { size } : {}) } });

  it("a new game: the default is standard; ?size= picks; explicit wins", () => {
    expect(resolveMapSize({})).toBe("standard");
    expect(resolveMapSize({ search: "?size=large" })).toBe("large");
    expect(resolveMapSize({ search: "?seed=4&size=standard" })).toBe("standard");
    expect(resolveMapSize({ search: "?size=huge" })).toBe("standard");
    expect(resolveMapSize({ search: "?size=large", explicit: { size: "standard" } })).toBe("standard");
  });

  it("a resumed save keeps its own size (absent = standard), whatever the URL says", () => {
    expect(resolveMapSize({ save: { map: { rivers: true, size: "large" } }, search: "?size=standard" })).toBe("large");
    expect(resolveMapSize({ save: { map: { rivers: true } }, search: "?size=large" })).toBe("standard");
    expect(resolveMapSize({ save: {} })).toBe("standard");
  });

  it("a room's size comes from the HOST's record; a guest's ?size= is ignored", () => {
    expect(resolveMapSize({ room: room("large"), search: "?size=standard" })).toBe("large");
    expect(resolveMapSize({ room: room("standard"), search: "?size=large" })).toBe("standard");
    // a room whose record names no size (old settings) plays standard — even
    // against a new-game default that is not standard (TOWN-4.5's flip)
    expect(resolveMapSize({ room: room(), search: "?size=large" }, "large")).toBe("standard");
    expect(resolveMapSize({ room: {} }, "large")).toBe("standard");
  });

  it("story and scenario maps are standard, whatever the new-game default", () => {
    expect(resolveMapSize({ story: {} }, "large")).toBe("standard");
    expect(resolveMapSize({ scenario: { mapOptions: {} } }, "large")).toBe("standard");
    expect(resolveMapSize({ scenario: { mapOptions: { size: "large" } } })).toBe("large");
  });

  it("rides MatchSettings.map on the wire: strict, optional, absent = standard", () => {
    const large: MatchSettings = { ...DEFAULT_MATCH_SETTINGS, map: { ...MAP_OPTIONS_ON, size: "large" } };
    const back = readMatchSettings(JSON.parse(JSON.stringify(large)))!;
    expect(back.map?.size).toBe("large");
    expect(normalizeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: { rivers: true, size: "giant" } })!.map).toBeUndefined();
    expect(readMapOptions({ rivers: true })).not.toHaveProperty("size");   // old records keep their shape
    expect(readMapSize("large")).toBe("large");
    expect(readMapSize(216)).toBeNull();
    expect(mapOptionsEqual({ ...MAP_OPTIONS_OFF }, { ...MAP_OPTIONS_OFF, size: "standard" })).toBe(true);
    expect(mapOptionsEqual({ ...MAP_OPTIONS_OFF }, { ...MAP_OPTIONS_OFF, size: "large" })).toBe(false);
    expect(isDefaultMatchSettings(large)).toBe(false);   // a large room is custom rules (never ranked)
    expect(describeMatchSettings(large)).toContain("Large map");
    expect(describeMatchSettings(DEFAULT_MATCH_SETTINGS)).not.toContain("map");
  });
});

// ── snapshot v18 ───────────────────────────────────────────────────────────
function snapshotSource(): SnapshotSource {
  const track = createTrack();
  track.dirt[3] = PRESENT;
  track.owner[3] = 1;
  return { seed: 42, track, harvesters: [], factories: [], setupPhase: false, won: false, players: [] };
}

describe("TOWN-4.1: snapshot v18 carries the map size; a mismatch is refused both ways", () => {
  it("bumped the version, and writes the size it was built at", () => {
    expect(SNAPSHOT_VERSION).toBe(19);   // v19: TOWN-4.7 (#700)
    const s = buildSnapshot(snapshotSource());
    expect([s.mapW, s.mapH]).toEqual([144, 144]);
    expect(validateSnapshot({ ...s, version: 17 })?.code).toBe("version");
  });

  it("a 144 snapshot is refused by a 216 client", () => {
    const s144 = buildSnapshot(snapshotSource());
    const legacy: Record<string, unknown> = { ...s144 };
    delete legacy.mapW;
    delete legacy.mapH;                            // absent = 144
    expect(validateSnapshot(legacy)).toBeNull();
    useSize(LARGE);
    for (const snap of [s144, legacy]) {
      const err = validateSnapshot(snap);
      expect(err?.code).toBe("size");
      expect(err?.message).toMatch(/144×144 map, but this game built a 216×216/);
      expect(() => applySnapshot(snap)).toThrow(/Rejoin the room/);
    }
  });

  it("a 216 snapshot is refused by a 144 client — and applies on a 216 one", () => {
    useSize(LARGE);
    const src = snapshotSource();
    src.track.road[216 * 216 - 1] = PRESENT;       // the far corner, past any 144 map
    const s216 = buildSnapshot(src);
    expect([s216.mapW, s216.mapH]).toEqual([216, 216]);
    const applied = applySnapshot(s216, 42);
    expect(applied.track.road.length).toBe(216 * 216);
    expect(applied.track.road[216 * 216 - 1]).toBe(PRESENT);
    expect(joinFromSnapshot(s216).grid.w).toBe(216);
    releaseMapSize();
    expect(validateSnapshot(s216)?.code).toBe("size");
    expect(() => applySnapshot(s216)).toThrow(/216×216 map, but this game built a 144×144/);
  });

  it("a malformed size is malformed, not a size mismatch", () => {
    const s = buildSnapshot(snapshotSource());
    for (const bad of [0, 7, 1000, 143.5, "144"]) {
      expect(validateSnapshot({ ...s, mapW: bad })?.code).toBe("malformed");
    }
  });
});

// ── saves ──────────────────────────────────────────────────────────────────
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    clear: () => store.clear(),
  });
  return store;
}

function savePayload(side: number, size: "standard" | "large" | undefined, snapV = SNAPSHOT_VERSION): SaveGamePayload {
  const track = withMapSize(side, side, () => {
    const t = createTrack();
    // 20 paved tiles of the seat's own (5★ on the shipped table) at the map's far edge row.
    for (let k = 0; k < 20; k++) {
      const i = (side - 2) * side + 10 + k;
      t.dirt[i] = PRESENT; t.road[i] = PRESENT; t.upgraded[i] = PRESENT; t.owner[i] = 1;
    }
    return t;
  });
  return {
    v: SAVEGAME_VERSION, snapV, savedAt: Date.now(), seed: 1337,
    map: { rivers: false, elevation: false, shapes: false, rings: false, diag: false, ...(size ? { size } : {}) },
    skillKey: "normal", phase: "play", winnerId: null, bandit: {},
    track: trackSave(track),
    eco: {
      harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 6, ty: 5 } as never],
      factories: [{ owner: "you", ownerId: 1, tx: 5, ty: 5, id: 0, townId: 0 } as never],
    },
    players: [], clocks: {},
  };
}

describe("TOWN-4.1: saves record the size; a save without it is a 144 save", () => {
  it("a snap-17 save (written before the option) still loads, as a 144 map", () => {
    expect(SAVE_SNAP_VERSIONS).toEqual([17, 18, 19]);
    const store = stubStorage();
    const old = savePayload(144, undefined, 17);
    store.set(SAVE_KEY, JSON.stringify(old));
    const back = readSave()!;
    expect(back).not.toBeNull();
    expect(isOldSave(back)).toBe(false);
    expect(saveMapSide(back)).toBe(144);
    expect(saveFitsItsMap(back)).toBe(true);
    expect(resolveMapSize({ save: back })).toBe("standard");
    for (const [snapV, old] of [[16, true], [17, false], [18, false], [19, true]] as const) {
      expect(isOldSave({ ...back, snapV }), `snapV ${snapV}`).toBe(old);
    }
  });

  it("a large save names its size, fits it, and resolves back to large", () => {
    const d = savePayload(216, "large");
    expect(saveMapSide(d)).toBe(216);
    expect(saveFitsItsMap(d)).toBe(true);
    expect(resolveMapSize({ save: d, search: "?size=standard" })).toBe("large");
    // layers of another size, or a size this build has no table entry for: refused
    expect(saveFitsItsMap({ ...d, map: { ...d.map!, size: "standard" } })).toBe(false);
    expect(saveFitsItsMap({ ...d, map: { ...d.map!, size: "huge" as never } })).toBe(false);
    expect(saveMapSide({ map: { size: "huge" } })).toBeNull();
    // an empty layer (old fixtures) is nothing to misplace
    expect(saveFitsItsMap({ ...d, track: { dirt: "", road: "", owner: "", upgraded: "" } })).toBe(true);
  });

  it("the menu scores a large save at its own size and leaves the map standard and unlocked", () => {
    const store = stubStorage();
    store.set(SAVE_KEY, JSON.stringify(savePayload(216, "large")));
    const [s] = resumableSaves(Date.now());
    expect(s.youStars).toBe(5);                    // the far-row paves count: scored on a 216 track
    expect([MAP_W, MAP_H, isMapSizeLocked()]).toEqual([144, 144, false]);
  });
});
