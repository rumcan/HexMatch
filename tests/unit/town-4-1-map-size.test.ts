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
// The booted-game half (a large game saves and reloads) lives in
// `town-4-1-large-boot.test.ts`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { createHash, type Hash } from "node:crypto";
import { generateMap, starterIslandGrid, type Grid, type MapGenOptions } from "../../src/iso/grid";
import { scatterScenery } from "../../src/iso/scenery";
import { SCENARIOS } from "../../src/story/scenarios";
import { tutorialMap } from "../../src/iso/guide/scenario";
import { GUIDE_SECTION_IDS } from "../../src/iso/guide/types";

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
