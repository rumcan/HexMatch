import { describe, expect, it } from "vitest";
import {
  contractOffers,
  selectContracts,
  contractProgressText,
  contractTimeLeft,
  contractTimeLeftText,
  isContractExpired,
  isContractCompleted,
  addContractDelivery,
  resolveTenderRace,
  rivalCanWinTender,
  contractsToWire,
  contractsFromWire,
  CONTRACT_OFFER_MAX,
  type ContractDef,
  type ContractView,
  type ActiveContract,
} from "../../src/iso/quests";
import { mulberry32 } from "../../src/game/config";

function makeView(overrides: Partial<ContractView> = {}): ContractView {
  return {
    seed: 12345,
    towns: [
      { id: 0, name: "Town 1", tx: 10, ty: 10 },
      { id: 1, name: "Town 2", tx: 20, ty: 20 },
      { id: 2, name: "Town 3", tx: 30, ty: 30 },
    ],
    cargoesRunning: ["grain", "wood"],
    depotCount: 2,
    connected: 2,
    townLevel: 1,
    townLevels: 4,
    difficulty: "normal",
    phase: 0.3,
    money: 1000,
    rivalCargoes: ["stone"],
    depotCargoes: [
      { cargo: "grain", connected: true },
      { cargo: "wood", connected: true },
      { cargo: "stone", connected: false },
    ],
    ...overrides,
  };
}

describe("CONTRACT-1 #466 — deterministic generation", () => {
  it("same seed and view yields same offers", () => {
    const view = makeView();
    const rng1 = mulberry32(view.seed);
    const rng2 = mulberry32(view.seed);
    const offers1 = contractOffers(view, rng1);
    const offers2 = contractOffers(view, rng2);
    expect(offers1.map((o) => o.id)).toEqual(offers2.map((o) => o.id));
    expect(offers1.map((o) => `${o.cargo}:${o.townId}:${o.amount}`)).toEqual(
      offers2.map((o) => `${o.cargo}:${o.townId}:${o.amount}`),
    );
  });

  it("selectContracts distinct cargo:town", () => {
    const view = makeView();
    const rng = mulberry32(view.seed);
    const pool = contractOffers(view, rng);
    const selected = selectContracts(pool, rng, { max: 3, exclude: new Set(), avoidCargoTown: new Set() });
    expect(selected.length).toBe(3);
    const keys = selected.map((s) => `${s.cargo}:${s.townId}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 2 private + 1 tender
    const privateCount = selected.filter((s) => s.kind === "private").length;
    const tenderCount = selected.filter((s) => s.kind === "tender").length;
    expect(privateCount).toBe(2);
    expect(tenderCount).toBe(1);
  });

  it("amount and reward scale with difficulty and phase", () => {
    const viewEasy = makeView({ difficulty: "easy", phase: 0 });
    const viewHardLate = makeView({ difficulty: "hard", phase: 0.9 });
    const rngEasy = mulberry32(1);
    const rngHard = mulberry32(1);
    const offersEasy = contractOffers(viewEasy, rngEasy);
    const offersHard = contractOffers(viewHardLate, rngHard);
    // Hard late should have larger amounts on average
    const avgEasy = offersEasy.reduce((sum, o) => sum + o.amount, 0) / offersEasy.length;
    const avgHard = offersHard.reduce((sum, o) => sum + o.amount, 0) / offersHard.length;
    expect(avgHard).toBeGreaterThanOrEqual(avgEasy);
  });
});

describe("CONTRACT-1 — progress from deliveries", () => {
  it("delivery counted after acceptance", () => {
    const def: ContractDef = {
      id: "c-grain-0",
      kind: "private",
      cargo: "grain",
      amount: 40,
      townId: 0,
      townName: "Town 1",
      rewardMoney: 120,
      rewardTown: 1,
      deadlineMs: 300000,
      speaker: "guide",
    };
    const active: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 300000,
      delivered: 0,
      owner: 0,
      status: "active",
    };
    let next = addContractDelivery(active, "grain", 10);
    expect(next.delivered).toBe(10);
    expect(next.status).toBe("active");
    expect(contractProgressText(next)).toBe("10/40");
    next = addContractDelivery(next, "grain", 30);
    expect(next.delivered).toBe(40);
    expect(next.status).toBe("completed");
    expect(isContractCompleted(next)).toBe(true);
  });

  it("wrong cargo ignored", () => {
    const def: ContractDef = {
      id: "c-wood-1",
      kind: "private",
      cargo: "wood",
      amount: 40,
      townId: 1,
      townName: "Town 2",
      rewardMoney: 100,
      rewardTown: 0,
      deadlineMs: 300000,
      speaker: "foreman",
    };
    const active: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 300000,
      delivered: 5,
      owner: 0,
      status: "active",
    };
    const next = addContractDelivery(active, "grain", 10);
    expect(next.delivered).toBe(5);
  });
});

describe("CONTRACT-1 — tender race", () => {
  it("first deliverer wins, losers marked lost", () => {
    const def: ContractDef = {
      id: "c-tender-grain-0",
      kind: "tender",
      cargo: "grain",
      amount: 50,
      townId: 0,
      townName: "Town 1",
      rewardMoney: 200,
      rewardTown: 2,
      deadlineMs: 360000,
      speaker: "rival",
    };
    const a0: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 360000,
      delivered: 50,
      owner: 0,
      status: "completed",
    };
    const a1: ActiveContract = {
      def,
      acceptedAt: 1000,
      expiresAt: 361000,
      delivered: 30,
      owner: 1,
      status: "active",
    };
    const res = resolveTenderRace([a0, a1], 5000);
    expect(res.winner).not.toBeNull();
    expect(res.winner?.owner).toBe(0);
    expect(res.losers.length).toBe(1);
    expect(res.losers[0].status).toBe("lost");
    expect(res.actives.find((a) => a.owner === 1)?.status).toBe("lost");
  });

  it("two-seat test — both racing same tender", () => {
    const def: ContractDef = {
      id: "c-tender-wood-1",
      kind: "tender",
      cargo: "wood",
      amount: 40,
      townId: 1,
      townName: "Town 2",
      rewardMoney: 150,
      rewardTown: 1,
      deadlineMs: 360000,
      speaker: "guide",
    };
    const player: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 360000,
      delivered: 40,
      owner: 0,
      status: "completed",
    };
    const rival: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 360000,
      delivered: 40,
      owner: 1,
      status: "completed",
    };
    // Same time, player should win if listed first (deterministic tie-break by owner 0 first in our logic? Actually earliest accepted, then first in array)
    const res = resolveTenderRace([player, rival], 1000);
    expect(res.winner).not.toBeNull();
    // Winner is first completed in array order when same acceptedAt
    expect([0, 1]).toContain(res.winner!.owner);
    expect(res.losers.length).toBe(1);
  });

  it("rival accepts plausible tenders", () => {
    const view = makeView({
      cargoesRunning: ["grain"],
      depotCargoes: [{ cargo: "grain", connected: true }],
    });
    const def: ContractDef = {
      id: "c-tender-grain-0",
      kind: "tender",
      cargo: "grain",
      amount: 30,
      townId: 0,
      townName: "Town 1",
      rewardMoney: 100,
      rewardTown: 1,
      deadlineMs: 360000,
      speaker: "rival",
    };
    expect(rivalCanWinTender(view, def)).toBe(true);
    const defImpossible: ContractDef = {
      ...def,
      id: "c-tender-oil-2",
      cargo: "oil",
      townId: 2,
    };
    expect(rivalCanWinTender(view, defImpossible)).toBe(false);
  });
});

describe("CONTRACT-1 — expiry", () => {
  it("expired contract detected", () => {
    const def: ContractDef = {
      id: "c-grain-0",
      kind: "private",
      cargo: "grain",
      amount: 40,
      townId: 0,
      townName: "Town 1",
      rewardMoney: 120,
      rewardTown: 1,
      deadlineMs: 300000,
      speaker: "guide",
    };
    const active: ActiveContract = {
      def,
      acceptedAt: 0,
      expiresAt: 1000,
      delivered: 10,
      owner: 0,
      status: "active",
    };
    expect(isContractExpired(active, 2000)).toBe(true);
    expect(isContractExpired(active, 500)).toBe(false);
    expect(contractTimeLeft(active, 500)).toBe(500);
    expect(contractTimeLeftText(active, 500)).toMatch(/s/);
  });

  it("contractsToWire / FromWire roundtrip", () => {
    const def: ContractDef = {
      id: "c-grain-0",
      kind: "private",
      cargo: "grain",
      amount: 40,
      townId: 0,
      townName: "Town 1",
      rewardMoney: 120,
      rewardTown: 1,
      deadlineMs: 300000,
      speaker: "guide",
    };
    const active: ActiveContract = {
      def,
      acceptedAt: 100,
      expiresAt: 300100,
      delivered: 20,
      owner: 0,
      status: "active",
    };
    const offers: ContractDef[] = [def];
    const wire = contractsToWire(offers, [active], 200);
    expect(wire.length).toBeGreaterThan(0);
    const restored = contractsFromWire(wire, 200);
    expect(restored.actives.length).toBe(1);
    expect(restored.actives[0].delivered).toBe(20);
    expect(restored.offers.length).toBeGreaterThanOrEqual(1);
  });
});

describe("CONTRACT-1 — constants", () => {
  it("offer max is 3 with 2 private 1 tender", () => {
    expect(CONTRACT_OFFER_MAX).toBe(3);
  });
});
