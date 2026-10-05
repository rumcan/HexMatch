// ══════════════════════════════════════════════════════════════════════════
// BRIDGE-1 (#685): decks that read as bridges.
//
// Owner (2026-10-04): a public highway crossing a river read as plain asphalt
// on the water. The cause: a deck was the tile's square narrowed across ONE
// axis, and the highway crosses as a staircase that BENDS on the water, so its
// surface left the deck. A deck now follows the arms its surface has, carries a
// width and material for what it bears, stands on piers, meets the banks on
// abutments, and has railings along every arm — all in the cached raster.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  BRIDGE_DECK_HALF, deckArms, offsetArm, paintBridgeDecks, paintBridgeRailings, type BridgeDeck,
} from "../../src/iso/bridge-renderer";
import { roadBridgeDecksIn } from "../../src/iso/road-renderer";
import { WATER, type Grid } from "../../src/iso/grid";
import { DIR, buildTile, createTrack, setRoadTier } from "../../src/iso/track";
import { MAP_W, MAP_H } from "../../src/game/config";

/** A canvas stand-in that records what is stroked. */
function recorder() {
  const calls: { op: string; color?: string; width?: number }[] = [];
  const ctx: Record<string, unknown> = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
    stroke() { calls.push({ op: "stroke", color: String(ctx.strokeStyle), width: Number(ctx.lineWidth) }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("BRIDGE-1 deck geometry", () => {
  it("an axis deck keeps the old two arms (centre to both edges)", () => {
    const arms = deckArms({ tx: 4, ty: 7, axis: "x" });
    expect(arms).toEqual([[[4.5, 7.5], [4, 7.5]], [[4.5, 7.5], [5, 7.5]]]);
  });

  it("a deck with its own arms draws exactly those (a bend, a diagonal)", () => {
    const bend: BridgeDeck = { tx: 0, ty: 0, axis: "x", arms: [[[0.5, 0.5], [0, 0.5]], [[0.5, 0.5], [0.5, 1]]] };
    expect(deckArms(bend)).toHaveLength(2);
    const diag: BridgeDeck = { tx: 0, ty: 0, axis: "x", arms: [[[0.5, 0.5], [1, 1]]] };
    expect(deckArms(diag)[0][1]).toEqual([1, 1]);
  });

  it("offsets an arm sideways by exactly the distance asked, on both sides", () => {
    const [a, b] = offsetArm([[0, 0], [1, 0]], 0.4);
    expect(a[1]).toBeCloseTo(0.4);
    expect(b[1]).toBeCloseTo(0.4);
    const [c] = offsetArm([[0, 0], [1, 1]], 0.5);
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(0.5);
  });
});

describe("BRIDGE-1 painting", () => {
  it("draws shadow, pier, abutment, fascia and surface under the road, railings over it", () => {
    const deck: BridgeDeck = { tx: 2, ty: 2, axis: "x", kind: "concrete", half: 0.52, landEnds: [true, false] };
    const under = recorder();
    paintBridgeDecks(under.ctx, [deck]);
    const colours = under.calls.map((c) => c.color);
    expect(colours[0]).toMatch(/^rgba/);                       // the shadow on the water first
    expect(colours).toContain("#4d4840");                      // the pier
    expect(colours).toContain("#8f8676");                      // the bank abutment
    expect(colours).toContain("#5f5b55");                      // the concrete fascia lip
    expect(colours).toContain("#a7a29a");                      // the concrete surface
    expect(under.calls.find((c) => c.color === "#a7a29a")!.width).toBeCloseTo(1.04);
    const over = recorder();
    paintBridgeRailings(over.ctx, [deck]);
    expect(over.calls.length).toBeGreaterThanOrEqual(3);       // edge, rail, posts
  });

  it("skips the pier for a deck that does not stand in water", () => {
    const r = recorder();
    paintBridgeDecks(r.ctx, [{ tx: 0, ty: 0, axis: "y", kind: "steel", pier: false }]);
    expect(r.calls.some((c) => c.color === "#4d4840")).toBe(false);
  });

  it("keeps the old width when nothing asks for more", () => {
    const r = recorder();
    paintBridgeDecks(r.ctx, [{ tx: 0, ty: 0, axis: "y" }]);
    expect(r.calls.some((c) => Math.abs((c.width ?? 0) - BRIDGE_DECK_HALF * 2) < 1e-9)).toBe(true);
  });
});

describe("BRIDGE-1 decks from the road layer", () => {
  /** A map that is all land except one water column at x = 10..11 (a 2-wide river). */
  const world = () => {
    const terrain = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) for (const x of [10, 11]) terrain[y * MAP_W + x] = WATER;
    return { terrain } as unknown as Grid;
  };
  const lay = (t: ReturnType<typeof createTrack>, path: [number, number][], tier = 0) => {
    for (const [x, y] of path) buildTile(t, "road", x, y, 1);
    for (const [x, y] of path) setRoadTier(t, x, y, tier as never);
  };

  it("a highway bridge is a wider concrete deck, with abutments at both banks", () => {
    const t = createTrack(false);
    lay(t, [[9, 5], [10, 5], [11, 5], [12, 5]], 2);
    const decks = roadBridgeDecksIn({ roadBits: t.road, dirtBits: t.dirt, roadTiers: t.tier, grid: world(), diagonalRoads: false },
      0, 0, 20, 20);
    expect(decks.map((d) => [d.tx, d.ty])).toEqual([[10, 5], [11, 5]]);
    for (const d of decks) {
      expect(d.kind).toBe("concrete");
      expect(d.half).toBeGreaterThan(BRIDGE_DECK_HALF);
      expect(deckArms(d)).toHaveLength(2);
    }
    // The west deck's west arm and the east deck's east arm land on the banks.
    expect(decks[0].landEnds!.filter(Boolean)).toHaveLength(1);
    expect(decks[1].landEnds!.filter(Boolean)).toHaveLength(1);
  });

  it("a bend on the water keeps both of its arms on the deck", () => {
    const t = createTrack(false);
    lay(t, [[9, 5], [10, 5], [10, 6], [10, 7], [9, 7]]);
    const decks = roadBridgeDecksIn({ roadBits: t.road, dirtBits: t.dirt, roadTiers: t.tier, grid: world(), diagonalRoads: false },
      0, 0, 20, 20);
    const bend = decks.find((d) => d.tx === 10 && d.ty === 5)!;
    const ends = deckArms(bend).map((a) => a[1]);
    for (const dir of [1, 2, 4, 8]) {
      if (!(t.road[5 * MAP_W + 10] & dir)) continue;
      expect(ends).toContainEqual([10.5 + DIR[dir][0] * 0.5, 5.5 + DIR[dir][1] * 0.5]);
    }
    expect(bend.kind ?? "timber").toBe("timber");
  });
});
