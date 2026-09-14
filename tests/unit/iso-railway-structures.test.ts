// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — the structures: platforms, depots and the train guards.
//
//   * all FOUR rotations of the 2×3 platform and the 2×2 depot build on legal
//     ground, keep their declared ports, and put their track into the owner's
//     network;
//   * the ANCHOR rule the epic spells out: an industry or one of the owner's
//     own processing plants within Manhattan distance 3, one platform per
//     owner per anchor, and an explicit choice when several qualify;
//   * the refusal vocabulary a UI can print (water, slopes, roads, structures,
//     borders, missing/ambiguous/taken anchors, a wrong depot port);
//   * demolition: floor(50%) per resource back, the ground released and the
//     lane's track lifted;
//   * the two train rules that make v1 safe — no edit under a train, and never
//     two trains on one connected component.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  planPlatform, planDepot, buildPlatform, buildRailDepot, demolishPlatform,
  demolishRailDepot, previewRailDrag, commitRailDrag, platformAtAnchor,
  platformOnNetwork, depotOnNetwork, refundFor, RAIL_REASON_TEXT,
  PLATFORM_COST, RAIL_DEPOT_COST,
} from "../../src/iso/railway/placement";
import {
  ROTATIONS, platformTiles, platformLaneTiles, platformStripTiles, platformPorts,
  depotTiles, depotPortDir, depotPortTiles, layRail, liftRail, railPresent,
  railOwnedBy, occAt, occOwnerAt, OCC_FREE, OCC_PLATFORM, OCC_DEPOT,
  type RailPlatform, type RailTrain,
} from "../../src/iso/railway";
import { DIR, hasTrack, buildTile, tIdx, SW } from "../../src/iso/track";
import { buildRailComponents } from "../../src/iso/railway/connectivity";
import { railWorld, industry, town, YOU, RIVAL } from "./helpers/rail-world";

const keys = (tiles: readonly (readonly [number, number])[]) => tiles.map(([x, y]) => `${x},${y}`);
const train = (id: number, ownerId: number, tiles: number[]): RailTrain => ({
  id, owner: ownerId === YOU ? "you" : "ai", ownerId, depotId: 0, lineId: null,
  state: "stored", tiles,
});

describe("RAIL-02 platforms build at every rotation", () => {
  it("lands the whole 2×3, lays the lane and keeps the strip clear", () => {
    for (const rot of ROTATIONS) {
      const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
      const plan = planPlatform(w, [], YOU, 42, 42, rot, null);
      // the industry at (40,40) is in range (the strip column touches it)
      expect(plan.code, `rot ${rot}`).toBe(null);
      expect(plan.valid).toBe(true);
      expect(plan.cost).toEqual(PLATFORM_COST);
      expect(plan.vp).toBe(1);

      const res = buildPlatform(w, [], YOU, "you", 42, 42, rot, plan.anchor);
      expect(res.ok, `rot ${rot}`).toBe(true);
      if (!res.ok || !res.platform) continue;
      expect(res.platform.rot).toBe(rot);
      expect(res.platform.anchor).toEqual({ kind: "industry", id: 0 });

      const footprint = platformTiles(42, 42, rot);
      const lane = new Set(keys(platformLaneTiles(42, 42, rot)));
      for (const [x, y] of footprint) {
        const isLane = lane.has(`${x},${y}`);
        // the whole block is occupied by the platform; only the LANE carries
        // track (it is included in the platform's price, not a separate drag)
        expect(occAt(w.rw, x, y)).toBe(OCC_PLATFORM);
        expect(occOwnerAt(w.rw, x, y)).toBe(YOU);
        expect(railPresent(w.rw, x, y)).toBe(isLane ? true : false);
      }
      // the strip is not rail, and the lane is on the owner's network
      for (const [x, y] of platformStripTiles(42, 42, rot)) expect(railPresent(w.rw, x, y)).toBe(false);
      expect(buildRailComponents(w.rw, YOU).size[0]).toBe(3);        // the lane
      expect(platformOnNetwork(w, YOU, res.platform)).toBe(true);
    }
  });

  it("prices everything before the click and charges nothing when refused", () => {
    const w = railWorld({ water: [[60, 60]] });
    const plan = planPlatform(w, [], YOU, 60, 60, 0, null);
    expect(plan.valid).toBe(false);
    expect(plan.why).toBe(RAIL_REASON_TEXT.water);
    expect(plan.cost).toEqual(PLATFORM_COST);      // the label still shows the price
    const built = buildPlatform(w, [], YOU, "you", 60, 60, 0, null);
    expect(built.ok).toBe(false);
    expect(built.cost).toEqual({});                // …and a refusal charges nothing
    expect(w.rw.platforms).toHaveLength(0);
    expect(w.rw.nextId).toBe(1);                   // not even an id was burned
  });

  it("refuses overhanging footprints, slopes, towns, roads and other structures", () => {
    const w = railWorld({
      rough: [[70, 71]],
      industries: [industry(80, 80, 2, 2)],
      towns: [town(0, 90, 90)],
    });
    // borders: a footprint that leaves the map is refused, never clipped
    expect(planPlatform(w, [], YOU, 143, 40, 0, null).code).toBe("out-of-bounds");
    expect(planPlatform(w, [], YOU, 40, 143, 0, null).code).toBe("out-of-bounds");
    expect(planPlatform(w, [], YOU, 142, 40, 1, null).code).toBe("out-of-bounds");   // 3 wide now
    expect(planPlatform(w, [], YOU, 70, 70, 0, null).code).toBe("rough");
    expect(planPlatform(w, [], YOU, 80, 80, 0, null).code).toBe("occupied");
    expect(planPlatform(w, [], YOU, 90, 90, 0, null).code).toBe("occupied");
    // an existing ROAD is in the way (a structure needs the ground itself)
    buildTile(w.track, "road", 100, 100, YOU);
    expect(planPlatform(w, [], YOU, 100, 100, 0, null).code).toBe("occupied");
    // as is a paid rail tile: clear it (and take the refund) first
    layRail(w.rw, YOU, 110, 110);
    expect(planPlatform(w, [], YOU, 110, 110, 0, null).code).toBe("structure-occupied");
  });

  it("refuses a second platform on ground the first one took", () => {
    const w = railWorld({ industries: [industry(23, 22, 2, 2)] });
    const first = buildPlatform(w, [], YOU, "you", 20, 20, 0, { kind: "industry", id: 0 });
    expect(first.ok).toBe(true);
    for (const t of [[20, 20], [21, 20], [20, 21], [21, 21], [21, 22]] as [number, number][]) {
      expect(planPlatform(w, [], YOU, t[0], t[1], 0, { kind: "industry", id: 0 }).code, `${t[0]},${t[1]}`)
        .toBe("structure-occupied");
    }
  });

  it("burns each rotation's ids in order, never reusing one", () => {
    const w = railWorld({ industries: [industry(23, 22, 2, 2), industry(34, 32, 2, 2)] });
    const a = buildPlatform(w, [], YOU, "you", 20, 20, 0, { kind: "industry", id: 0 });
    const b = buildPlatform(w, [], YOU, "you", 30, 30, 2, { kind: "industry", id: 1 });
    expect(a.ok && b.ok).toBe(true);
    expect(b.platform!.id).toBeGreaterThan(a.platform!.id);
    expect(w.rw.platforms.map((p) => p.id)).toEqual([a.platform!.id, b.platform!.id]);
  });
});

describe("RAIL-02 anchors: 3 tiles, one per owner per anchor, explicit when ambiguous", () => {
  it("needs an anchor in range", () => {
    const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
    // exactly at the limit: the platform's north corner is 3 tiles away
    expect(planPlatform(w, [], YOU, 40, 43, 0, null).anchor).toEqual({ kind: "industry", id: 0 });
    // one tile further and there is nothing to serve
    expect(planPlatform(w, [], YOU, 40, 46, 0, null).code).toBe("no-anchor");
    expect(planPlatform(w, [], YOU, 40, 46, 0, null).why).toBe(RAIL_REASON_TEXT["no-anchor"]);
  });

  it("accepts the owner's own plant, and the owner's only", () => {
    const w = railWorld();
    const mine = [{ owner: "you", ownerId: YOU, tx: 50, ty: 50, id: 0 }];
    const theirs = [{ owner: "ai", ownerId: RIVAL, tx: 50, ty: 50, id: 0 }];
    // NOTE: a "plant" IS a processing plant; both lists describe the same tile,
    // and only the owner-scoped one qualifies.
    expect(planPlatform(w, mine, YOU, 50, 52, 0, null).anchors).toEqual([{ kind: "plant", id: 0 }]);
    expect(planPlatform(w, theirs, YOU, 50, 52, 0, null).code).toBe("no-anchor");
    expect(planPlatform(w, theirs, RIVAL, 50, 52, 0, null).anchors).toEqual([{ kind: "plant", id: 0 }]);
  });

  it("makes the player CHOOSE when several anchors are in range", () => {
    const w = railWorld({
      industries: [industry(40, 40, 2, 2)],
    });
    const plants = [{ owner: "you", ownerId: YOU, tx: 44, ty: 40, id: 0 }];
    const plan = planPlatform(w, plants, YOU, 42, 40, 0, null);
    expect(plan.anchors).toEqual([{ kind: "industry", id: 0 }, { kind: "plant", id: 0 }]);
    expect(plan.code).toBe("anchor-ambiguous");
    expect(plan.anchor).toBe(null);
    // choosing one is what resolves it — and the choice is what gets stored
    const chosen = planPlatform(w, plants, YOU, 42, 40, 0, { kind: "plant", id: 0 });
    expect(chosen.valid).toBe(true);
    expect(chosen.anchor).toEqual({ kind: "plant", id: 0 });
    // an anchor that is not in range is refused, not silently snapped
    expect(planPlatform(w, plants, YOU, 42, 40, 0, { kind: "industry", id: 7 }).code).toBe("anchor-invalid");
  });

  it("allows one platform per owner per anchor — and the rival gets its own", () => {
    const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
    const first = buildPlatform(w, [], YOU, "you", 40, 43, 0, { kind: "industry", id: 0 });
    expect(first.ok).toBe(true);
    const again = planPlatform(w, [], YOU, 43, 40, 0, { kind: "industry", id: 0 });
    expect(again.code).toBe("anchor-taken");
    expect(again.why).toBe(RAIL_REASON_TEXT["anchor-taken"]);
    // …and a different owner may anchor to the same industry: exclusivity is
    // per OWNER, which is what makes the race for a resource a race.
    const rival = buildPlatform(w, [], RIVAL, "ai", 43, 40, 0, { kind: "industry", id: 0 });
    expect(rival.ok).toBe(true);
    expect(platformAtAnchor(w.rw, YOU, { kind: "industry", id: 0 })!.owner).toBe("you");
    expect(platformAtAnchor(w.rw, RIVAL, { kind: "industry", id: 0 })!.owner).toBe("ai");
  });
});

describe("RAIL-02 depots: a 2×2 with one declared exit", () => {
  it("builds at every rotation with the port the rotation declares", () => {
    for (const rot of ROTATIONS) {
      const w = railWorld();
      const plan = planDepot(w, 60, 60, rot);
      expect(plan.valid, `rot ${rot}`).toBe(true);
      expect(plan.cost).toEqual(RAIL_DEPOT_COST);
      expect(plan.vp).toBe(0);                       // infrastructure scores nothing
      const res = buildRailDepot(w, YOU, "you", 60, 60, rot);
      expect(res.ok).toBe(true);
      if (!res.ok || !res.depot) continue;
      expect(res.depot.port).toBe(depotPortDir(rot));
      for (const [x, y] of depotTiles(60, 60, rot)) expect(occAt(w.rw, x, y)).toBe(OCC_DEPOT);
      // the port edge carries the depot's own track stub, facing out
      const stubs = depotPortTiles(60, 60, rot);
      for (const [x, y] of stubs) {
        expect(railPresent(w.rw, x, y)).toBe(true);
        expect(buildRailComponents(w.rw, YOU).size[0]).toBe(2);
      }
      // it is attached once a drag reaches the stub's outside neighbour
      expect(depotOnNetwork(w, YOU, res.depot)).toBe(false);   // own stub only
      const [dx, dy] = DIR[res.depot.port];
      const [sx, sy] = stubs[0];
      const drag = previewRailDrag(w, YOU, { stone: 9 }, sx + dx, sy + dy, sx + dx, sy + dy);
      expect(commitRailDrag(w, YOU, drag).ok).toBe(true);
      expect(depotOnNetwork(w, YOU, res.depot)).toBe(true);
    }
  });

  it("rejects a port that contradicts the rotation, and a bad footprint", () => {
    const w = railWorld({ water: [[60, 60]] });
    expect(planDepot(w, 50, 50, 1, SW).code).toBe("bad-port");
    expect(planDepot(w, 50, 50, 1, depotPortDir(1)).valid).toBe(true);
    expect(planDepot(w, 60, 60, 0).code).toBe("water");
    expect(planDepot(w, 143, 143, 0).code).toBe("out-of-bounds");
    const built = buildRailDepot(w, YOU, "you", 60, 60, 0);
    expect(built.ok).toBe(false);
    expect(built.cost).toEqual({});
  });
});

describe("RAIL-02 demolition: floor(50%) back, ground released, track lifted", () => {
  it("refunds half of a platform and clears its occupancy and lane", () => {
    const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
    const built = buildPlatform(w, [], YOU, "you", 40, 43, 0, { kind: "industry", id: 0 });
    const id = built.platform!.id;
    const res = demolishPlatform(w, YOU, id);
    expect(res.ok).toBe(true);
    expect(res.refund).toEqual(refundFor(PLATFORM_COST));
    expect(res.refund).toEqual({ wood: 2, stone: 2, ore: 6, oil: 1 });
    expect(res.vp).toBe(1);                          // the scoreboard revokes this
    expect(w.rw.platforms).toHaveLength(0);
    for (const [x, y] of platformTiles(40, 43, 0)) {
      expect(occAt(w.rw, x, y)).toBe(OCC_FREE);
      expect(railPresent(w.rw, x, y)).toBe(false);
    }
    expect(demolishPlatform(w, YOU, id).code).toBe("no-rail");
  });

  it("refuses the rival's structure and a second demolition", () => {
    const w = railWorld();
    const built = buildRailDepot(w, YOU, "you", 60, 60, 0);
    expect(demolishRailDepot(w, RIVAL, built.depot!.id).code).toBe("not-yours");
    expect(demolishPlatform(w, YOU, built.depot!.id).code).toBe("no-rail");
    const res = demolishRailDepot(w, YOU, built.depot!.id);
    expect(res.ok).toBe(true);
    expect(res.refund).toEqual({ wood: 1, stone: 1, ore: 2, oil: 1 });
    expect(occAt(w.rw, 60, 60)).toBe(OCC_FREE);
    expect(railPresent(w.rw, 60, 60)).toBe(false);
  });

  it("refuses to demolish a depot a train is assigned to", () => {
    const w = railWorld();
    const built = buildRailDepot(w, YOU, "you", 60, 60, 0);
    w.rw.trains.push(train(1, YOU, []));
    w.rw.trains[0].depotId = built.depot!.id;
    expect(demolishRailDepot(w, YOU, built.depot!.id).code).toBe("train-assigned");
    // once the train is gone, the depot may come down
    w.rw.trains = [];
    expect(demolishRailDepot(w, YOU, built.depot!.id).ok).toBe(true);
  });
});

describe("RAIL-02 the train guards", () => {
  it("refuses every edit on a tile a train stands on", () => {
    const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
    const platform = buildPlatform(w, [], YOU, "you", 40, 43, 0, { kind: "industry", id: 0 }).platform!;
    const lane = platformLaneTiles(40, 43, 0);
    w.rw.trains.push(train(1, YOU, [tIdx(lane[1][0], lane[1][1])]));
    expect(demolishPlatform(w, YOU, platform.id).code).toBe("train-occupied");
    expect(planPlatform(w, [], YOU, 40, 43, 0, { kind: "industry", id: 0 }).code).toBe("structure-occupied");
    // rail may not be laid under it either — the drag stops JUST SHORT
    const p = previewRailDrag(w, YOU, { stone: 9 }, 36, 44, 41, 44);
    expect(p.reason).toBe("train-occupied");
    expect(keys(p.tiles)).toEqual(["36,44", "37,44", "38,44", "39,44"]);
    expect(railPresent(w.rw, 40, 44)).toBe(true);      // the lane, not the drag
  });

  it("refuses a drag that would MERGE two components that each hold a train", () => {
    const w = railWorld();
    // two stretches, one train each
    for (const x of [10, 11, 12]) layRail(w.rw, YOU, x, 10);
    for (const x of [16, 17, 18]) layRail(w.rw, YOU, x, 10);
    w.rw.trains.push(train(1, YOU, [tIdx(11, 10)]), train(2, YOU, [tIdx(17, 10)]));
    expect(buildRailComponents(w.rw, YOU).count).toBe(2);

    const preview = previewRailDrag(w, YOU, { stone: 9 }, 12, 10, 16, 10);
    expect(preview.cost).toEqual({ stone: 3 });         // 13, 14, 15
    const railBefore = w.rw.rail.slice();
    const ownerBefore = w.rw.railOwner.slice();
    const commit = commitRailDrag(w, YOU, preview);
    expect(commit.ok).toBe(false);
    if (!commit.ok) {
      expect(commit.code).toBe("train-limit");
      expect(commit.why).toBe(RAIL_REASON_TEXT["train-limit"]);
    }
    // the whole drag was rolled back — the world is byte-for-byte where it was
    expect(w.rw.rail).toEqual(railBefore);
    expect(w.rw.railOwner).toEqual(ownerBefore);
    expect(buildRailComponents(w.rw, YOU).count).toBe(2);
    expect(railPresent(w.rw, 14, 10)).toBe(false);

    // with ONE train in play the merge is legal, so the rule is about trains
    // and not about merging
    w.rw.trains.pop();
    expect(commitRailDrag(w, YOU, preview).ok).toBe(true);
    expect(buildRailComponents(w.rw, YOU).count).toBe(1);
  });

  it("refuses a drag that would run a second train onto one component any other way", () => {
    const w = railWorld();
    for (const x of [20, 21, 22]) layRail(w.rw, YOU, x, 20);
    w.rw.trains.push(train(1, YOU, [tIdx(21, 20)]));
    // a spur hanging off the same component is fine (one train still)
    const spur = previewRailDrag(w, YOU, { stone: 9 }, 22, 20, 22, 22);
    expect(commitRailDrag(w, YOU, spur).ok).toBe(true);
    expect(buildRailComponents(w.rw, YOU).count).toBe(1);
  });
});

describe("RAIL-02 the platform's own records stand on their own", () => {
  it("keeps platform, lane and occupancy consistent for a hover or a panel", () => {
    const w = railWorld({ industries: [industry(40, 40, 2, 2)] });
    const built = buildPlatform(w, [], YOU, "you", 40, 43, 0, { kind: "industry", id: 0 });
    const platform = built.platform as RailPlatform;
    const ports = platformPorts(platform.tx, platform.ty, platform.rot);
    expect(ports).toHaveLength(2);
    for (const { tile } of ports) {
      expect(railOwnedBy(w.rw, YOU, tile[0], tile[1])).toBe(true);
      expect(occAt(w.rw, tile[0], tile[1])).toBe(OCC_PLATFORM);
    }
    // an unrelated hover reads the empty world
    expect(occAt(w.rw, 5, 5)).toBe(OCC_FREE);
    expect(hasTrack(w.track, "dirt", 40, 43)).toBe(false);
    // lifting the lane by hand (a debug or migration path) cannot corrupt the
    // structure's occupancy: the record and the ground are separate truths
    liftRail(w.rw, ports[0].tile[0], ports[0].tile[1]);
    expect(occAt(w.rw, ports[0].tile[0], ports[0].tile[1])).toBe(OCC_PLATFORM);
    expect(railPresent(w.rw, ports[0].tile[0], ports[0].tile[1])).toBe(false);
  });
});
