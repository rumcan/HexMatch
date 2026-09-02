// ─────────────────────────────────────────────────────────────────────────
// E-loop — the isometric quarry (match-3 board). Adapted from the hex board
// but keyed directly by Cargo: six gem colours, gold as the wildcard. The
// network's connected industries mint TIERED gems (player spawns); matching a
// tiered gem mines cargo of that colour. Uses the injectable iso RNG (T1) so
// fills are reproducible. Pure logic, no DOM.
// ─────────────────────────────────────────────────────────────────────────

import {
  Cargo, BOARD_W, BOARD_H, choice,
} from "./config";

export interface Gem {
  id: number;
  cargo: Cargo;
  tier: 0 | 1 | 2;
  special: null | "bomb";
  hard: 0 | 1 | 2;
  block: boolean;
  r: number; c: number;
}

const PROD: Cargo[] = ["grain", "wood", "ore", "stone", "oil"];
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class Quarry {
  W = BOARD_W; H = BOARD_H;
  grid: (Gem | null)[][] = [];
  seq = 1;
  busy = false;
  // cargoes the network currently harvests (the spawn pool); gold never falls.
  pool: Cargo[] = [];
  fogUntil = 0;
  blockUntil = 0;
  comboCount = 0;
  static COMBOS_PER_GOLD = 2;

  onHarvest: (cargo: Cargo, amount: number) => void = () => {};
  onFx: (type: string, r: number, c: number, text?: string) => void = () => {};
  onChange: () => void = () => {};
  onCombo: (count: number, need: number, granted: boolean) => void = () => {};

  constructor() { this.initFill(); }

  private newGem(cargo: Cargo, r: number, c: number): Gem {
    return { id: this.seq++, cargo, tier: 0, special: null, hard: 0, block: false, r, c };
  }

  private randCargo(): Cargo {
    return this.pool.length ? choice(this.pool) : choice(PROD);
  }

  initFill() {
    this.grid = [];
    for (let r = 0; r < this.H; r++) {
      this.grid[r] = [];
      for (let c = 0; c < this.W; c++) {
        let cargo = this.randCargo();
        for (let tries = 0; tries < 25; tries++) {
          const bad =
            (c >= 2 && this.grid[r][c - 1]?.cargo === cargo && this.grid[r][c - 2]?.cargo === cargo) ||
            (r >= 2 && this.grid[r - 1][c]?.cargo === cargo && this.grid[r - 2][c]?.cargo === cargo);
          if (!bad) break;
          cargo = this.randCargo();
        }
        this.grid[r][c] = this.newGem(cargo, r, c);
      }
    }
  }

  gems(): Gem[] {
    const out: Gem[] = [];
    for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) { const g = this.grid[r][c]; if (g) out.push(g); }
    return out;
  }

  private matchable(g: Gem | null): g is Gem {
    return !!g && !g.block && g.special !== "bomb";
  }
  private isWild(g: Gem | null): boolean {
    return !!g && g.cargo === "gold" && !g.block && g.special !== "bomb";
  }

  private lineRuns(cells: (Gem | null)[]): Gem[][] {
    const runs: Gem[][] = [];
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const g = cells[i];
      if (!this.matchable(g)) { i++; continue; }
      let color: Cargo | null = this.isWild(g) ? null : g.cargo;
      const run: Gem[] = [g];
      let j = i + 1;
      while (j < n) {
        const h = cells[j];
        if (!this.matchable(h)) break;
        if (this.isWild(h)) { run.push(h); j++; continue; }
        if (color === null) { color = h.cargo; run.push(h); j++; continue; }
        if (h.cargo === color) { run.push(h); j++; continue; }
        break;
      }
      const matched = run.length >= 3 && color !== null;
      if (matched) runs.push(run);
      let trailing = 0, k = run.length - 1;
      while (k >= 0 && this.isWild(run[k])) { trailing++; k--; }
      i = matched ? Math.max(i + 1, j - trailing) : i + 1;
    }
    return runs;
  }

  findGroups(): Gem[][] {
    const groups: Gem[][] = [];
    for (let r = 0; r < this.H; r++) groups.push(...this.lineRuns(this.grid[r]));
    for (let c = 0; c < this.W; c++) {
      const col: (Gem | null)[] = [];
      for (let r = 0; r < this.H; r++) col.push(this.grid[r][c]);
      groups.push(...this.lineRuns(col));
    }
    return groups;
  }

  private resolve(groups: Gem[][], gains: Partial<Record<Cargo, number>>) {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    for (const grp of groups) {
      const size = grp.length;
      const anchor = (grp.find((g) => g.cargo !== "gold") ?? grp[0]).cargo;
      const tokenPresent = grp.some((g) => g.tier > 0);
      const mult = size >= 4 ? 2 : 1;
      for (const g of grp) {
        if (g.hard > 0) { crackIds.add(g.id); continue; }
        removeIds.add(g.id);
        if (g.tier > 0) {
          const amt = g.tier * mult;
          this.onHarvest(g.cargo, amt);
          gains[g.cargo] = (gains[g.cargo] ?? 0) + amt;
        }
      }
      const mid = grp[Math.floor(size / 2)];
      if (size === 4 && !tokenPresent) { const g = this.newGem(anchor, mid.r, mid.c); g.tier = 1; this.grid[mid.r][mid.c] = g; this.onFx("up", mid.r, mid.c); }
      if (size >= 5) {
        const g = this.newGem(anchor, mid.r, mid.c); g.special = "bomb"; this.grid[mid.r][mid.c] = g;
        this.onFx("boom", mid.r, mid.c);
      }
    }
    const removed: { r: number; c: number }[] = [];
    for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) {
      const g = this.grid[r][c];
      if (!g) continue;
      if (removeIds.has(g.id) && this.grid[r][c]?.id === g.id) {
        this.grid[r][c] = null; removed.push({ r, c }); this.onFx("pop", r, c);
      }
      else if (crackIds.has(g.id)) { g.hard = (g.hard - 1) as 0 | 1 | 2; this.onFx("crack", r, c); }
    }
    for (const { r, c } of removed) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= this.H || nc < 0 || nc >= this.W) continue;
        const b = this.grid[nr][nc];
        if (b && b.block) { b.block = false; this.onFx("crack", nr, nc); }
      }
    }
  }

  private gravity() {
    for (let c = 0; c < this.W; c++) {
      const stack: Gem[] = [];
      for (let r = this.H - 1; r >= 0; r--) { const g = this.grid[r][c]; if (g) stack.push(g); this.grid[r][c] = null; }
      let r = this.H - 1;
      for (const g of stack) { g.r = r; g.c = c; this.grid[r][c] = g; r--; }
      for (; r >= 0; r--) this.grid[r][c] = this.newGem(this.randCargo(), r, c);
    }
  }

  async settle(startCascade = 0) {
    this.busy = true;
    let chain = startCascade, maxChain = startCascade;
    const gains: Partial<Record<Cargo, number>> = {};
    while (true) {
      const groups = this.findGroups();
      if (!groups.length) break;
      chain++; maxChain = Math.max(maxChain, chain);
      this.resolve(groups, gains);
      this.onChange();
      await sleep(160);
      this.gravity();
      this.onChange();
      await sleep(180);
      if (chain >= 2) { const mid = groups[0][0]; this.onFx("chain", mid.r, mid.c, `CHAIN x${chain}`); }
    }
    if (maxChain >= 2) {
      this.comboCount++;
      const need = Quarry.COMBOS_PER_GOLD;
      if (this.comboCount >= need) {
        this.comboCount -= need;
        this.spawnGold(1);
        this.onCombo(0, need, true);
      } else this.onCombo(this.comboCount, need, false);
    }
    if (!this.hasMove()) await this.reshuffle();
    this.busy = false;
    return gains;
  }

  async trySwap(r1: number, c1: number, r2: number, c2: number, now: number): Promise<Partial<Record<Cargo, number>>> {
    if (this.busy || this.fogUntil > now) return {};
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return {};
    const g1 = this.grid[r1][c1], g2 = this.grid[r2][c2];
    if (!g1 || !g2 || g1.block || g2.block) return {};
    this.busy = true;
    this.grid[r1][c1] = g2; this.grid[r2][c2] = g1;
    g1.r = r2; g1.c = c2; g2.r = r1; g2.c = c1;
    this.onChange();
    if (g1.special === "bomb" || g2.special === "bomb") {
      await sleep(140);
      const bomb = g1.special === "bomb" ? g1 : g2;
      const other = g1.special === "bomb" ? g2 : g1;
      const gains = await this.detonate(bomb, other.cargo);
      this.busy = false;
      return gains;
    }
    await sleep(140);
    if (!this.findGroups().length) {
      this.grid[r1][c1] = g1; this.grid[r2][c2] = g2;
      g1.r = r1; g1.c = c1; g2.r = r2; g2.c = c2;
      this.onFx("bad", r1, c1);
      this.onChange();
      await sleep(140);
      this.busy = false;
      return {};
    }
    const gains = await this.settle(0);
    return gains;
  }

  async detonate(bomb: Gem, color: Cargo): Promise<Partial<Record<Cargo, number>>> {
    const gains: Partial<Record<Cargo, number>> = {};
    this.grid[bomb.r][bomb.c] = null; this.onFx("boom", bomb.r, bomb.c);
    for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) {
      const g = this.grid[r][c];
      if (!g || g.block || g.cargo !== color) continue;
      if (g.tier > 0) { this.onHarvest(g.cargo, g.tier); gains[g.cargo] = (gains[g.cargo] ?? 0) + g.tier; }
      this.grid[r][c] = null; this.onFx("pop", r, c);
    }
    this.onChange();
    await sleep(220);
    this.gravity(); this.onChange(); await sleep(200);
    return this.settle(2);
  }

  // 20s token spawn from the network's access tiers (never gold in place).
  spawnTokens(tiers: Partial<Record<Cargo, 1 | 2>>) {
    for (const cargo of Object.keys(tiers) as Cargo[]) {
      if (cargo === "gold") continue;
      const tier = tiers[cargo]!;
      const eligible: Gem[] = [];
      for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) {
        const g = this.grid[r][c];
        if (g && g.cargo === cargo && g.tier === 0 && !g.special && !g.block && g.hard === 0) eligible.push(g);
      }
      if (eligible.length) { const g = choice(eligible); g.tier = tier; this.onFx("up", g.r, g.c); }
    }
    // gold mine access mints a gold coin directly
    if (tiers["gold" as Cargo]) this.spawnGold((tiers["gold" as Cargo] as number) >= 2 ? 2 : 1);
    this.onChange();
  }

  spawnGold(tier: 1 | 2) {
    const eligible = this.gems().filter((g) => g.cargo !== "gold" && g.tier === 0 && !g.special && !g.block && g.hard === 0);
    if (!eligible.length) return;
    const g = choice(eligible);
    g.cargo = "gold"; g.tier = tier;
    this.onFx("up", g.r, g.c);
  }

  hasMove(): boolean {
    const test = (r1: number, c1: number, r2: number, c2: number) => {
      const a = this.grid[r1][c1], b = this.grid[r2][c2];
      if (!a || !b || a.block || b.block || a.special === "bomb" || b.special === "bomb") return false;
      this.grid[r1][c1] = b; this.grid[r2][c2] = a;
      const ok = this.findGroups().length > 0;
      this.grid[r1][c1] = a; this.grid[r2][c2] = b;
      return ok;
    };
    for (let r = 0; r < this.H; r++) for (let c = 0; c < this.W; c++) {
      if (c < this.W - 1 && test(r, c, r, c + 1)) return true;
      if (r < this.H - 1 && test(r, c, r + 1, c)) return true;
      if (this.grid[r][c]?.special === "bomb") return true;
    }
    return false;
  }

  async reshuffle() {
    this.busy = true;
    // Regenerate the fill rather than permute: an 81-gem multiset over a few
    // colours almost always contains accidental runs, so a clean permutation
    // can be extremely rare. initFill() guarantees no initial matches; try a
    // handful of seeds until the new board also has a legal move.
    for (let attempt = 0; attempt < 12; attempt++) {
      this.seq = 1;
      this.initFill();
      if (this.hasMove()) break;
    }
    this.onFx("bad", 0, 0);
    this.onChange();
    await sleep(200);
    this.busy = false;
  }
}

export { PROD as PRODUCTION_CARGOES };
