// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — the drag, the crossings and the teardown.
//
// The ticket's acceptance list, one `describe` each:
//
//   preview/commit   a preview says what the commit does — same tiles, same
//                    price — and dragging over your own rail is a free no-op
//                    rather than a second charge;
//   refusals         water, slopes, industries, towns, structures, borders and
//                    the rival's own track; a drag TRUNCATES at the first one
//                    instead of failing, so a mis-drag costs nothing;
//   crossings        perpendicular straight-through only: the road must be a
//                    straight segment (not a dead end, curve or junction), the
//                    rail must not turn or branch on it, and the road's bytes
//                    must come out of the crossing untouched — owner, tier and
//                    the 0.25★ pave provenance included;
//   refunds          floor(50%) per resource, which for 1-Stone track is
//                    nothing and for a platform is half of everything;
//   conflicts        two seats holding a preview for the same ground: one
//                    builds and pays, the other is refused whole. Nothing is
//                    ever half-built and nothing is ever charged twice.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  previewRailDrag, commitRailDrag, railRefusal, railTileCost, costOfTiles,
  roadCrossingRefusal, crossingRefusal, refundFor, demolishRailTile,
  RAIL_COST, PLATFORM_COST, RAIL_DEPOT_COST, RAIL_REASON_TEXT, railReasonText,
  type RailWorld, type RailDragPreview,
} from "../../src/iso/railway/placement";
import { layRail, railBitsAt, railPresent, railOwnerAt, occAt, OCC_RAIL } from "../../src/iso/railway/state";
import { buildRailComponents } from "../../src/iso/railway/connectivity";
import { buildTile, hasTrack, isUpgradedRoad, tIdx, NE, SE, SW, NW, PUBLIC_OWNER } from "../../src/iso/track";
import { VICTORY } from "../../src/iso/config";
import { railWorld, town, industry, YOU, RIVAL } from "./helpers/rail-world";

const key = (t: readonly [number, number]) => `${t[0]},${t[1]}`;
const keys = (tiles: readonly (readonly [number, number])[]) => tiles.map(key);
const enough = { wood: 99, stone: 99, ore: 99, oil: 99, grain: 99 };

/** Preview + commit in one call — the pair the game makes on mouse-up. */
function drag(
  w: RailWorld, ownerId: number, purse: Record<string, number>,
  ax: number, ay: number, bx: number, by: number,
  xFirst = true, network?: Set<number>,
) {
  const preview = previewRailDrag(w, ownerId, purse, ax, ay, bx, by, xFirst, network);
  const commit = commitRailDrag(w, ownerId, preview);
  return { preview, commit };
}

describe("RAIL-02 preview and commit agree, tile for tile", () => {
  it("builds exactly the previewed tiles at exactly the previewed price", () => {
    const w = railWorld();
    const { preview, commit } = drag(w, YOU, enough, 10, 10, 14, 10);
    expect(keys(preview.tiles)).toEqual(["10,10", "11,10", "12,10", "13,10", "14,10"]);
    expect(preview.cost).toEqual({ stone: 5 });
    expect(preview.crossings).toEqual([]);
    expect(preview.vp).toBe(0);                        // rail track is worth nothing
    expect(commit).toEqual({ ok: true, built: preview.tiles, crossings: [], cost: preview.cost });
    for (const [x, y] of preview.tiles) expect(railPresent(w.rw, x, y)).toBe(true);
    // the masks are a chain: each interior tile faces its two neighbours
    expect(railBitsAt(w.rw, 12, 10)).toBe(NW | SE);
    expect(railBitsAt(w.rw, 10, 10)).toBe(SE);          // the west end, one bit
    expect(railBitsAt(w.rw, 14, 10)).toBe(NW);          // the east end, one bit
  });

  it("agrees on every L-path shape, in both axis orders, including the borders", () => {
    const cases: { a: [number, number]; b: [number, number] }[] = [
      { a: [20, 20], b: [24, 23] },
      { a: [24, 23], b: [20, 20] },
      { a: [0, 0], b: [3, 3] },                 // the map's north corner
      { a: [143, 143], b: [140, 141] },          // the south corner
      { a: [70, 5], b: [70, 9] },                // a straight vertical
      { a: [5, 70], b: [5, 70] },                // a single tile
    ];
    for (const { a, b } of cases) {
      for (const xFirst of [true, false]) {
        const w = railWorld();
        const preview = previewRailDrag(w, YOU, enough, a[0], a[1], b[0], b[1], xFirst);
        // the price of the previewed tiles, measured BEFORE the build turns
        // them into free no-ops — the comparison the ticket asks for
        const before = costOfTiles(w, YOU, preview.tiles);
        const commit = commitRailDrag(w, YOU, preview);
        expect(commit.ok).toBe(true);
        if (!commit.ok) continue;
        expect(keys(commit.built)).toEqual(keys(preview.tiles));
        expect(commit.cost).toEqual(preview.cost);
        expect(commit.cost).toEqual(before);
      }
    }
  });

  it("charges nothing to drag over your own rail, and never double-charges", () => {
    const w = railWorld();
    drag(w, YOU, enough, 30, 30, 33, 30);
    const again = previewRailDrag(w, YOU, enough, 30, 30, 34, 30);
    expect(again.cost).toEqual({ stone: 1 });          // only the new tile
    expect(again.free).toBe(4);
    const commit = commitRailDrag(w, YOU, again);
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.cost).toEqual({ stone: 1 });
    // the mask healed into one run, not two stubs
    expect(railBitsAt(w.rw, 32, 30)).toBe(NW | SE);
    expect(buildRailComponents(w.rw, YOU).count).toBe(1);
  });

  it("stops charging once the purse is empty, and marks the rest unaffordable", () => {
    const w = railWorld();
    const preview = previewRailDrag(w, YOU, { stone: 2 }, 40, 40, 44, 40);
    expect(keys(preview.tiles)).toEqual(["40,40", "41,40"]);
    expect(preview.cost).toEqual({ stone: 2 });
    expect(keys(preview.unaffordable)).toEqual(["42,40", "43,40", "44,40"]);
    expect(preview.reason).toBe("cannot-afford");
    const commit = commitRailDrag(w, YOU, preview);
    expect(commit.ok).toBe(true);
    if (commit.ok) expect(commit.cost).toEqual({ stone: 2 });
    expect(railPresent(w.rw, 42, 40)).toBe(false);
  });
});

describe("RAIL-02 refusals truncate the drag", () => {
  it("refuses water, slopes, industries, towns and other structures", () => {
    const w = railWorld({
      water: [[52, 40]],
      rough: [[52, 42]],
      industries: [industry(54, 44, 2, 2)],
      towns: [town(0, 58, 58)],
    });
    const stop = (ax: number, ay: number, bx: number, by: number) => {
      const p = previewRailDrag(w, YOU, enough, ax, ay, bx, by);
      return { last: p.tiles.length ? key(p.tiles[p.tiles.length - 1]) : null, reason: p.reason };
    };
    // A straight drag east stops at the tile BEFORE the obstacle, keeping the
    // prefix: water at (52,40), the slope at (52,42), the industry at (54,44).
    expect(stop(50, 40, 55, 40)).toEqual({ last: "51,40", reason: "water" });
    expect(stop(50, 42, 55, 42)).toEqual({ last: "51,42", reason: "rough" });
    expect(stop(50, 44, 55, 44)).toEqual({ last: "53,44", reason: "occupied" });
    expect(stop(50, 58, 60, 58)).toEqual({ last: "57,58", reason: "occupied" });   // the town
    expect(railRefusal(w, YOU, 54, 44)).toBe("occupied");            // industry
    expect(railRefusal(w, YOU, 58, 58)).toBe("occupied");            // town
    expect(railRefusal(w, YOU, 52, 40)).toBe("water");
    expect(railRefusal(w, YOU, 52, 42)).toBe("rough");
  });

  it("refuses the rival's rail and never joins to it", () => {
    const w = railWorld();
    layRail(w.rw, RIVAL, 70, 70);
    expect(railRefusal(w, YOU, 70, 70)).toBe("opponent-rail");
    const p = previewRailDrag(w, YOU, enough, 72, 70, 68, 70);
    expect(keys(p.tiles)).toEqual(["72,70", "71,70"]);
    expect(p.reason).toBe("opponent-rail");
    // your own rail, by contrast, is a free pass-through
    layRail(w.rw, YOU, 72, 71);
    expect(railRefusal(w, YOU, 72, 70)).toBe(null);
  });

  it("runs off the map rather than wrapping to the far side", () => {
    const w = railWorld();
    // A path that starts inside and runs a long way west must stop at x = 0.
    const p = previewRailDrag(w, YOU, enough, 1, 100, -3, 100);
    expect(keys(p.tiles)).toEqual(["1,100", "0,100"]);
    expect(p.reason).toBe("out-of-bounds");
    expect(railRefusal(w, YOU, -1, 100)).toBe("out-of-bounds");
    // …and the same drag from the corner of the grid touches nothing outside
    const corner = previewRailDrag(w, YOU, enough, 143, 143, 143, 143);
    expect(keys(corner.tiles)).toEqual(["143,143"]);
  });

  it("keeps a spur attached to your own railway when a network is supplied", () => {
    const w = railWorld();
    layRail(w.rw, YOU, 80, 80);
    layRail(w.rw, YOU, 81, 80);
    const network = new Set([tIdx(80, 80), tIdx(81, 80)]);
    const far = previewRailDrag(w, YOU, enough, 90, 90, 92, 90, true, network);
    expect(far.tiles).toEqual([]);                    // an orphan island
    expect(far.reason).toBe("not-adjacent");
    const attached = previewRailDrag(w, YOU, enough, 82, 80, 84, 80, true, network);
    expect(keys(attached.tiles)).toEqual(["82,80", "83,80", "84,80"]);
  });

  it("reads as a sentence for the player, not a code", () => {
    expect(railReasonText("water")).toBe(RAIL_REASON_TEXT.water);
    expect(railReasonText("crossing-skew")).toContain("perpendicular");
    expect(railReasonText("train-limit")).toContain("train");
    expect(railReasonText(null)).toBe(null);
    expect(railReasonText("something-new")).toBe("it is not buildable");
  });
});

describe("RAIL-02 level crossings: perpendicular, straight through, road intact", () => {
  /** A straight east–west road run at y = 40, x = 60…66. */
  const roadRun = () => railWorld({ roads: [{ tiles: [[60, 40], [61, 40], [62, 40], [63, 40], [64, 40], [65, 40], [66, 40]] }] });

  it("crosses a straight road at right angles", () => {
    const w = roadRun();
    expect(railReasonText(roadCrossingRefusal(w, 63, 40))).toBe(null);   // a straight segment
    const { preview, commit } = drag(w, YOU, enough, 63, 37, 63, 43);
    expect(commit.ok).toBe(true);
    expect(keys(preview.crossings)).toEqual(["63,40"]);
    expect(railBitsAt(w.rw, 63, 40)).toBe(NE | SW);      // straight through, north–south
    // the road is exactly where it was: same bits, same owner, same tier
    expect(hasTrack(w.track, "road", 63, 40)).toBe(true);
    expect(hasTrack(w.track, "dirt", 63, 40)).toBe(false);
    expect(w.track.owner[tIdx(63, 40)]).toBe(YOU);
    expect(w.track.road[tIdx(63, 40)]).toBe(10 | 16);    // SE|NW + PRESENT
  });

  it("refuses to run ALONG a road — a crossing must be perpendicular", () => {
    const w = roadRun();
    const p = previewRailDrag(w, YOU, enough, 60, 40, 66, 40);
    // (60,40) is a dead end of the run, so the first refusal is the road end…
    expect(p.reason).toBe("road-end");
    expect(p.tiles).toEqual([]);
    // …and a parallel run over a straight stretch is a SKEW crossing: the rail
    // pair and the road pair share bits, which is the definition of "not
    // perpendicular" for two straight lines.
    const along = new Set([61, 62, 63, 64, 65].map((x) => tIdx(x, 40)));
    expect(crossingRefusal(w, YOU, along, 63, 40)).toBe("crossing-skew");
  });

  it("refuses to TURN on a road — no curved crossings", () => {
    const w = roadRun();
    // in from the north, out to the east: the rail bits are NE|SE at the road
    const set = new Set([tIdx(63, 39), tIdx(63, 40), tIdx(64, 40)]);
    expect(crossingRefusal(w, YOU, set, 63, 40)).toBe("crossing-curve");
    // the drag stops BEFORE the road and keeps the two tiles it may legally
    // lay: a refusal truncates, it never throws the whole gesture away.
    const p = previewRailDrag(w, YOU, enough, 63, 39, 64, 40, true);
    expect(keys(p.tiles)).toEqual(["63,39", "64,39"]);
    expect(p.reason).toBe("crossing-curve");
  });

  it("refuses dead ends, curves and junctions on the road side", () => {
    const w = railWorld({ roads: [
      { tiles: [[30, 30]] },                                       // a dead end
      { tiles: [[34, 30], [35, 30], [35, 31]] },                   // a curve at (35,30)
      { tiles: [[40, 30], [41, 30], [42, 30], [41, 31]] },         // a T junction at (41,30)
    ] });
    expect(roadCrossingRefusal(w, 30, 30)).toBe("road-end");
    expect(roadCrossingRefusal(w, 35, 30)).toBe("road-curve");
    expect(roadCrossingRefusal(w, 41, 30)).toBe("road-junction");
    expect(roadCrossingRefusal(w, 50, 50)).toBe(null);             // no road: no crossing
    // and a drag that tries to cross each of them stops short
    expect(previewRailDrag(w, YOU, enough, 30, 28, 30, 32).reason).toBe("road-end");
    expect(previewRailDrag(w, YOU, enough, 35, 28, 35, 32).reason).toBe("road-curve");
    expect(previewRailDrag(w, YOU, enough, 41, 28, 41, 32).reason).toBe("road-junction");
  });

  it("refuses rail that would BRANCH off an existing crossing", () => {
    const w = roadRun();
    drag(w, YOU, enough, 63, 38, 63, 42);                  // the crossing at (63,40)
    expect(railBitsAt(w.rw, 63, 40)).toBe(NE | SW);
    // A second rail line through the NEXT road tile (64,40) would sit one tile
    // from the crossing. Rail masks are physical adjacency, so those two tiles
    // would face each other and turn the first crossing into a junction — the
    // "curved/junction crossing" the ticket rejects. The drag stops short.
    const p = previewRailDrag(w, YOU, enough, 64, 37, 64, 43);
    expect(keys(p.tiles)).toEqual(["64,37", "64,38", "64,39"]);
    expect(p.reason).toBe("crossing-branch");
    expect(railBitsAt(w.rw, 63, 40)).toBe(NE | SW);        // still a plain crossing
  });

  it("crosses a PUBLIC highway — shared road, and the rail stays private", () => {
    const w = railWorld();
    for (const x of [99, 100, 101]) buildTile(w.track, "road", x, 90, PUBLIC_OWNER);
    expect(roadCrossingRefusal(w, 100, 90)).toBe(null);
    const { commit } = drag(w, YOU, enough, 100, 88, 100, 92);
    expect(commit.ok).toBe(true);
    expect(railPresent(w.rw, 100, 90)).toBe(true);
    expect(railOwnerAt(w.rw, 100, 90)).toBe(YOU);
    // the highway is still public, still paved, and still nobody's rail
    expect(w.track.owner[tIdx(100, 90)]).toBe(PUBLIC_OWNER);
    expect(hasTrack(w.track, "road", 100, 90)).toBe(true);
    expect(railOwnerAt(w.rw, 99, 90)).toBe(0);
  });

  it("crosses a PAVED road without disturbing its 0.25★ provenance", () => {
    const w = railWorld();
    // a straight east–west road whose middle tile was gravel first (VP-01)
    buildTile(w.track, "dirt", 89, 90, YOU);
    buildTile(w.track, "road", 89, 90, YOU);
    buildTile(w.track, "dirt", 90, 90, YOU);
    buildTile(w.track, "road", 90, 90, YOU);
    buildTile(w.track, "dirt", 91, 90, YOU);
    buildTile(w.track, "road", 91, 90, YOU);
    expect(isUpgradedRoad(w.track, 90, 90)).toBe(true);
    expect(w.track.road[tIdx(90, 90)] & 0b1111).toBe(SE | NW);     // a straight segment

    const { commit } = drag(w, YOU, enough, 90, 88, 90, 92);
    expect(commit.ok).toBe(true);
    // the road came out of the crossing exactly as it went in
    expect(isUpgradedRoad(w.track, 90, 90)).toBe(true);
    expect(w.track.owner[tIdx(90, 90)]).toBe(YOU);
    expect(w.track.road[tIdx(90, 90)]).toBe(SE | NW | 16);
    expect(w.track.upgraded[tIdx(90, 90)]).toBe(16);
  });

  it("refuses a TOWN road: the settlement's own streets are not crossable", () => {
    const w = railWorld({ towns: [town(0, 100, 100)] });
    // the town's house tiles are TOWN_OCC — including the ones the roads run on
    buildTile(w.track, "road", 100, 100, PUBLIC_OWNER);
    expect(railRefusal(w, YOU, 100, 100)).toBe("occupied");
    const p = previewRailDrag(w, YOU, enough, 100, 98, 100, 102);
    expect(keys(p.tiles)).toEqual(["100,98", "100,99"]);
    expect(p.reason).toBe("occupied");
  });

  it("crosses a DIRT road too, and leaves the gravel byte alone", () => {
    const w = railWorld({ roads: [{ kind: "dirt", tiles: [[80, 40], [81, 40], [82, 40], [83, 40], [84, 40]] }] });
    expect(roadCrossingRefusal(w, 82, 40)).toBe(null);
    const { commit } = drag(w, YOU, enough, 82, 38, 82, 42);
    expect(commit.ok).toBe(true);
    // the crossing is rail OVER gravel: neither tier is converted, and the
    // tile is still a usable Dirt Road for the road graph
    expect(hasTrack(w.track, "dirt", 82, 40)).toBe(true);
    expect(hasTrack(w.track, "road", 82, 40)).toBe(false);
    expect(w.track.dirt[tIdx(82, 40)]).toBe(SE | NW | 16);
    expect(railBitsAt(w.rw, 82, 40)).toBe(NE | SW);
  });

  it("prices a crossing as one rail tile and refunds it like any other", () => {
    const w = roadRun();
    expect(railTileCost(w, YOU, 63, 40)).toEqual(RAIL_COST);
    const { commit } = drag(w, YOU, enough, 63, 39, 63, 41);
    expect(commit.ok).toBe(true);
    // three rail tiles: the two approaches and the crossing itself
    if (commit.ok) expect(commit.cost).toEqual({ stone: 3 });
    expect(occAt(w.rw, 63, 40)).toBe(OCC_RAIL);
  });
});

describe("RAIL-02 refunds and the teardown half", () => {
  it("refunds floor(50%) per resource — which for 1-Stone rail is nothing", () => {
    expect(refundFor(RAIL_COST)).toEqual({});            // floor(0.5 × 1 stone) = 0
    expect(refundFor(PLATFORM_COST)).toEqual({ wood: 2, stone: 2, ore: 6, oil: 1 });
    expect(refundFor(RAIL_DEPOT_COST)).toEqual({ wood: 1, stone: 1, ore: 2, oil: 1 });
    expect(refundFor({ ore: 3 }, 0.5)).toEqual({ ore: 1 });
  });

  it("takes rail up byte by byte, and heals the neighbours' masks", () => {
    const w = railWorld();
    drag(w, YOU, enough, 110, 110, 112, 110);
    const res = demolishRailTile(w, YOU, 111, 110);
    expect(res.ok).toBe(true);
    expect(res.refund).toEqual({});
    expect(railPresent(w.rw, 111, 110)).toBe(false);
    expect(railBitsAt(w.rw, 110, 110)).toBe(0);          // the stub healed
    expect(occAt(w.rw, 110, 110)).toBe(OCC_RAIL);
    expect(demolishRailTile(w, RIVAL, 110, 110).code).toBe("not-yours");
    expect(demolishRailTile(w, YOU, 111, 110).code).toBe("no-rail");
  });
});

describe("RAIL-02 simultaneous conflicts: one winner, no half-builds, no double charge", () => {
  it("gives the ground to the first seat and refuses the second whole", () => {
    const w = railWorld();
    // Both seats previewed the same ground before either committed.
    const previewA = previewRailDrag(w, YOU, enough, 120, 120, 123, 120);
    const previewB = previewRailDrag(w, RIVAL, enough, 120, 120, 123, 120);
    expect(previewA.cost).toEqual({ stone: 4 });
    expect(previewB.cost).toEqual({ stone: 4 });

    expect(commitRailDrag(w, YOU, previewA).ok).toBe(true);
    const second = commitRailDrag(w, RIVAL, previewB);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("opponent-rail");
    // the loser built NOTHING and still owes nothing
    expect(railOwnerAt(w.rw, 123, 120)).toBe(YOU);
    expect(railOwnerAt(w.rw, 122, 120)).toBe(YOU);
    expect(buildRailComponents(w.rw, RIVAL).count).toBe(0);
  });

  it("leaves the world untouched when a commit fails half way", () => {
    const w = railWorld();
    const preview = previewRailDrag(w, YOU, enough, 130, 130, 134, 130);
    //…and then the rival claims a tile in the middle of the accepted run.
    layRail(w.rw, RIVAL, 132, 130);
    const railBefore = w.rw.rail.slice();
    const ownerBefore = w.rw.railOwner.slice();
    const revBefore = w.rw.revision;
    const commit = commitRailDrag(w, YOU, preview);
    expect(commit.ok).toBe(false);
    if (!commit.ok) expect(commit.code).toBe("opponent-rail");
    expect(w.rw.rail).toEqual(railBefore);
    expect(w.rw.railOwner).toEqual(ownerBefore);
    expect(w.rw.revision).toBe(revBefore);
    expect(commit.ok === false && "cost" in commit).toBe(false);   // no cost on a refusal
  });

  it("never pays VP for rail, whatever the drag looks like", () => {
    const w = railWorld();
    const p: RailDragPreview = previewRailDrag(w, YOU, enough, 20, 30, 25, 30);
    expect(p.vp).toBe(0);
    expect(VICTORY.platform).toBe(1);      // the only rail asset that scores
  });
});
