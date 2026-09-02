import { describe, it, expect, beforeEach } from "vitest";
import { Quarry, Gem } from "../../src/iso/quarry";
import { setRng, mulberry32, Cargo } from "../../src/iso/config";

function gem(cargo: Cargo, r: number, c: number, extra: Partial<Gem> = {}): Gem {
  return { id: r * 100 + c + 1, cargo, tier: 0, special: null, hard: 0, block: false, r, c, ...extra };
}

function blankBoard(): (Gem | null)[][] {
  const g: (Gem | null)[][] = [];
  for (let r = 0; r < 9; r++) {
    g[r] = [];
    for (let c = 0; c < 9; c++) g[r][c] = null;
  }
  return g;
}

// A fully-filled checkerboard has no legal swap (classic dead board).
function checkerboard(): (Gem | null)[][] {
  const colors: Cargo[] = ["grain", "wood"];
  const g = blankBoard();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    g[r][c] = gem(colors[(r + c) % 2], r, c);
  }
  return g;
}

beforeEach(() => setRng(mulberry32(2026)));

describe("Quarry — determinism & fill (T1)", () => {
  it("fills 9×9 with the same cargoes for the same seed", () => {
    setRng(mulberry32(42));
    const a = new Quarry();
    setRng(mulberry32(42));
    const b = new Quarry();
    expect(a.gems().map((g) => g.cargo)).toEqual(b.gems().map((g) => g.cargo));
    expect(a.gems()).toHaveLength(81);
  });

  it("starts with no pre-existing matches", () => {
    const q = new Quarry();
    expect(q.findGroups()).toHaveLength(0);
  });

  it("reports hasMove on a fresh board", () => {
    const q = new Quarry();
    expect(q.hasMove()).toBe(true);
  });
});

describe("Quarry — matching harvests cargo", () => {
  it("resolves a horizontal match and mines cargo from tiered gems", async () => {
    const q = new Quarry();
    const g = q.grid;
    g[4][3] = gem("wood", 4, 3, { tier: 1 });
    g[4][4] = gem("wood", 4, 4);
    g[4][5] = gem("wood", 4, 5);
    const harvested: Partial<Record<Cargo, number>> = {};
    q.onHarvest = (c, n) => { harvested[c] = (harvested[c] ?? 0) + n; };
    const gains = await q.settle();
    expect(gains.wood).toBe(1);
    expect(harvested.wood).toBe(1);
    expect(q.gems()).toHaveLength(81); // refilled
  });

  it("gold acts as a wildcard in matches", () => {
    const q = new Quarry();
    q.grid = blankBoard(); // isolate the run from incidental neighbours
    q.grid[2][1] = gem("ore", 2, 1);
    q.grid[2][2] = gem("gold", 2, 2);
    q.grid[2][3] = gem("ore", 2, 3);
    const groups = q.findGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("a 4-match mints a tier-1 token of the matched colour", async () => {
    const q = new Quarry();
    q.grid = blankBoard(); // isolate the run; no incidental matches
    for (let c = 2; c <= 5; c++) q.grid[6][c] = gem("stone", 6, c);
    await q.settle();
    const tokens = q.gems().filter((x) => x.tier === 1 && x.cargo === "stone");
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  it("a 5-match creates a bomb", async () => {
    const q = new Quarry();
    for (let c = 2; c <= 6; c++) q.grid[7][c] = gem("oil", 7, c);
    await q.settle();
    expect(q.gems().some((x) => x.special === "bomb")).toBe(true);
  });

  it("double-length match (4+) mines double cargo from tiered gems", async () => {
    const q = new Quarry();
    q.grid[3][2] = gem("grain", 3, 2, { tier: 2 });
    for (let c = 3; c <= 5; c++) q.grid[3][c] = gem("grain", 3, c);
    const gains = await q.settle();
    expect(gains.grain).toBe(4); // tier 2 × mult 2
  });
});

describe("Quarry — swaps", () => {
  it("rejects a swap that makes no match and restores the board", async () => {
    setRng(mulberry32(7));
    const q = new Quarry();
    // Find a non-productive adjacent pair deterministically, or craft one:
    q.grid[0][0] = gem("wood", 0, 0); q.grid[0][1] = gem("ore", 0, 1);
    q.grid[1][0] = gem("stone", 1, 0); q.grid[1][1] = gem("oil", 1, 1);
    q.grid[0][2] = gem("stone", 0, 2); q.grid[1][2] = gem("wood", 1, 2);
    q.grid[2][0] = gem("oil", 2, 0); q.grid[2][1] = gem("grain", 2, 1);
    const before = JSON.stringify(q.grid.map((row) => row.map((g) => g?.cargo)));
    const gains = await q.trySwap(0, 0, 0, 1, 0);
    const after = JSON.stringify(q.grid.map((row) => row.map((g) => g?.cargo)));
    expect(gains).toEqual({});
    expect(after).toBe(before);
  });

  it("resolves a productive swap", async () => {
    const q = new Quarry();
    // row 4: ore ore [wood] | row 5 position c=5: wood → swap (4,5) with (5,5)
    q.grid[4][3] = gem("ore", 4, 3);
    q.grid[4][4] = gem("ore", 4, 4);
    q.grid[4][5] = gem("wood", 4, 5);
    q.grid[5][5] = gem("ore", 5, 5, { tier: 1 });
    const gains = await q.trySwap(4, 5, 5, 5, 0);
    expect(gains.ore).toBe(1);
  });

  it("detonates a bomb swapped into a gem, clearing that colour off the board", async () => {
    const q = new Quarry();
    q.pool = ["wood", "grain", "stone", "oil"]; // many colours, but ore never comes back
    q.grid = blankBoard();
    q.grid[0][0] = gem("wood", 0, 0, { special: "bomb" });
    q.grid[0][1] = gem("ore", 0, 1);
    // sprinkle other ore gems
    q.grid[3][3] = gem("ore", 3, 3);
    q.grid[7][8] = gem("ore", 7, 8, { tier: 2 });
    const harvested: Partial<Record<Cargo, number>> = {};
    q.onHarvest = (c, n) => { harvested[c] = (harvested[c] ?? 0) + n; };
    await q.trySwap(0, 0, 0, 1, 0);
    expect(q.gems().filter((g) => g.cargo === "ore" && g.special !== "bomb")).toHaveLength(0);
    expect(harvested.ore).toBe(2); // tier-2 ore harvested
  });
});

describe("Quarry — network tokens", () => {
  it("spawnTokens upgrades existing same-colour gems to the access tier", () => {
    const q = new Quarry();
    q.spawnTokens({ wood: 2, ore: 1 });
    const wood = q.gems().filter((g) => g.cargo === "wood");
    const ore = q.gems().filter((g) => g.cargo === "ore");
    expect(wood.some((g) => g.tier === 2)).toBe(true);
    expect(ore.some((g) => g.tier === 1)).toBe(true);
  });

  it("gold access mints a gold wildcard gem", () => {
    const q = new Quarry();
    expect(q.gems().some((g) => g.cargo === "gold")).toBe(false);
    q.spawnTokens({ gold: 1 });
    const golds = q.gems().filter((g) => g.cargo === "gold");
    expect(golds.length).toBe(1);
  });

  it("never spawns gold in the ordinary fill pool", () => {
    const q = new Quarry();
    q.pool = ["wood", "ore"];
    q.initFill();
    expect(q.gems().every((g) => g.cargo === "wood" || g.cargo === "ore")).toBe(true);
  });
});

describe("Quarry — dead board", () => {
  it("hasMove is false when every gem is locked (blocked) — a dead board", () => {
    const q = new Quarry();
    q.grid = checkerboard().map((row) => row.map((g) => (g ? { ...g, block: true } : null)));
    expect(q.hasMove()).toBe(false);
  });

  it("reshuffle leaves a playable board with no immediate matches", async () => {
    const q = new Quarry(); // a fresh, multi-colour board
    await q.reshuffle();
    expect(q.hasMove()).toBe(true);
    expect(q.findGroups()).toHaveLength(0);
  });
});
