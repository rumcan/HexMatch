import { BOARD_W as W, BOARD_H as H, ResKey, RES_KEYS, randInt, choice, shuffle } from "./config";

export interface Gem {
  id: number;
  res: ResKey;
  tier: 0 | 1 | 2;
  special: null | "bomb";
  hard: 0 | 1 | 2;
  block: boolean;
  r: number; c: number;
  isNew?: boolean;
  dead?: boolean;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class Board {
  grid: (Gem | null)[][] = [];
  seq = 1;
  busy = false;
  // Gold is NOT in the base pool — gold coins only appear as spawned wild tokens.
  pool: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];
  fogUntil = 0;
  blockUntil = 0;
  // combos banked toward the next gold coin (2 combos = 1 coin)
  comboCount = 0;
  static COMBOS_PER_GOLD = 2;

  // callbacks (wired by game)
  onHarvest: (res: ResKey, amount: number) => void = () => {};
  onGold: (n: number) => void = () => {};
  onFx: (type: string, r: number, c: number, text?: string) => void = () => {};
  onChange: () => void = () => {};
  onPopup: (gains: Partial<Record<ResKey, number>>, label: string) => void = () => {};
  // fired when a combo is banked: (bankedNow, needed, grantedCoin)
  onCombo: (count: number, needed: number, granted: boolean) => void = () => {};

  constructor() {
    this.initFill();
  }

  private newGem(res: ResKey, r: number, c: number, isNew = false): Gem {
    return { id: this.seq++, res, tier: 0, special: null, hard: 0, block: false, r, c, isNew };
  }

  private randRes(): ResKey {
    return choice(this.pool.length ? this.pool : RES_KEYS.slice(0, 4));
  }

  initFill() {
    this.grid = [];
    for (let r = 0; r < H; r++) {
      this.grid[r] = [];
      for (let c = 0; c < W; c++) {
        let res = this.randRes();
        for (let tries = 0; tries < 25; tries++) {
          const bad =
            (c >= 2 && this.grid[r][c - 1]?.res === res && this.grid[r][c - 2]?.res === res) ||
            (r >= 2 && this.grid[r - 1][c]?.res === res && this.grid[r - 2][c]?.res === res);
          if (!bad) break;
          res = this.randRes();
        }
        this.grid[r][c] = this.newGem(res, r, c);
      }
    }
  }

  gems(): Gem[] {
    const out: Gem[] = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const g = this.grid[r][c]; if (g) out.push(g); }
    return out;
  }

  private matchable(g: Gem | null): g is Gem {
    return !!g && !g.block && g.special !== "bomb";
  }
  // Gold gems are WILD — they substitute for any colour to complete a match.
  private isWild(g: Gem | null): boolean {
    return !!g && g.res === "gold" && !g.block && g.special !== "bomb";
  }

  // scan one line (row or col) for runs of >=3, allowing gold wilds
  private lineRuns(cells: (Gem | null)[]): Gem[][] {
    const runs: Gem[][] = [];
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const g = cells[i];
      if (!this.matchable(g)) { i++; continue; }
      let color: ResKey | null = this.isWild(g) ? null : g!.res;
      const run: Gem[] = [g!];
      let j = i + 1;
      while (j < n) {
        const h = cells[j];
        if (!this.matchable(h)) break;
        if (this.isWild(h)) { run.push(h); j++; continue; }
        if (color === null) { color = h!.res; run.push(h!); j++; continue; }
        if (h!.res === color) { run.push(h!); j++; continue; }
        break;
      }
      const matched = run.length >= 3 && color !== null;
      if (matched) runs.push(run);
      // let trailing wilds be reusable by the next run
      let trailing = 0, k = run.length - 1;
      while (k >= 0 && this.isWild(run[k])) { trailing++; k--; }
      i = matched ? Math.max(i + 1, j - trailing) : i + 1;
    }
    return runs;
  }

  findGroups(): Gem[][] {
    const groups: Gem[][] = [];
    for (let r = 0; r < H; r++) groups.push(...this.lineRuns(this.grid[r]));
    for (let c = 0; c < W; c++) {
      const col: (Gem | null)[] = [];
      for (let r = 0; r < H; r++) col.push(this.grid[r][c]);
      groups.push(...this.lineRuns(col));
    }
    return groups;
  }

  // returns accumulated gains for popup
  private resolve(groups: Gem[][], gains: Partial<Record<ResKey, number>>) {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    const forge: { r: number; c: number; res: ResKey; tier: 1 | 2 }[] = [];
    const bombs: { r: number; c: number; res: ResKey }[] = [];

    for (const grp of groups) {
      const size = grp.length;
      // anchor colour = first non-gold in the group (gold is wild)
      const anchor = (grp.find((g) => g.res !== "gold") ?? grp[0]).res;
      const tokenPresent = grp.some((g) => g.tier > 0);
      const mult = size >= 4 ? 2 : 1;
      // pay each token by its OWN resource (gold wilds pay gold)
      for (const g of grp) {
        if (g.hard > 0) { crackIds.add(g.id); continue; }
        removeIds.add(g.id);
        if (g.tier > 0) {
          const amt = g.tier * mult;
          this.onHarvest(g.res, amt);
          gains[g.res] = (gains[g.res] ?? 0) + amt;
        }
      }
      const mid = grp[Math.floor(size / 2)];
      if (size === 4 && !tokenPresent) forge.push({ r: mid.r, c: mid.c, res: anchor, tier: 1 });
      if (size >= 5) {
        bombs.push({ r: mid.r, c: mid.c, res: anchor });
        if (!tokenPresent) forge.push({ r: grp[0].r, c: grp[0].c, res: anchor, tier: 2 });
      }
    }

    // apply
    const removedCells: { r: number; c: number }[] = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const g = this.grid[r][c];
      if (!g) continue;
      if (removeIds.has(g.id)) { g.dead = true; this.onFx("pop", r, c); this.grid[r][c] = null; removedCells.push({ r, c }); }
      else if (crackIds.has(g.id)) { g.hard = (g.hard - 1) as 0 | 1 | 2; this.onFx("crack", r, c); }
    }
    // a match adjacent to an iron block breaks it back into a normal gem
    for (const { r, c } of removedCells) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        const b = this.grid[nr][nc];
        if (b && b.block) { b.block = false; this.onFx("crack", nr, nc); }
      }
    }
    for (const f of forge) {
      const g = this.newGem(f.res, f.r, f.c);
      g.tier = f.tier;
      this.grid[f.r][f.c] = g;
      this.onFx("up", f.r, f.c);
    }
    for (const b of bombs) {
      const g = this.newGem(b.res, b.r, b.c);
      g.special = "bomb";
      this.grid[b.r][b.c] = g;
      this.onFx("boom", b.r, b.c);
    }
  }

  private gravity() {
    for (let c = 0; c < W; c++) {
      const stack: Gem[] = [];
      for (let r = H - 1; r >= 0; r--) { const g = this.grid[r][c]; if (g) stack.push(g); this.grid[r][c] = null; }
      let r = H - 1;
      for (const g of stack) { g.r = r; g.c = c; this.grid[r][c] = g; r--; }
      for (; r >= 0; r--) {
        const g = this.newGem(this.randRes(), r, c, true);
        this.grid[r][c] = g;
      }
    }
  }

  async settle(startCascade = 0) {
    this.busy = true;
    let chain = startCascade;
    const gains: Partial<Record<ResKey, number>> = {};
    let maxChain = startCascade;
    while (true) {
      const groups = this.findGroups();
      if (!groups.length) break;
      chain++; maxChain = Math.max(maxChain, chain);
      this.resolve(groups, gains);
      this.onChange();
      await sleep(190);
      this.gravity();
      this.onChange();
      await sleep(210);
      if (chain >= 2) {
        const mid = groups[0][0];
        this.onFx("chain", mid.r, mid.c, `CHAIN x${chain}`);
      }
    }
    if (Object.keys(gains).length) {
      const label = maxChain > 1 ? `COMBO x${maxChain}` : "";
      this.onPopup(gains, label);
    }
    // a cascade of two or more counts as a combo; every second one pays a coin
    if (maxChain >= 2) this.registerCombo();
    if (!this.hasMove()) await this.reshuffle();
    this.busy = false;
  }

  async trySwap(r1: number, c1: number, r2: number, c2: number, now: number) {
    if (this.busy || this.fogUntil > now) return;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    const g1 = this.grid[r1][c1], g2 = this.grid[r2][c2];
    if (!g1 || !g2 || g1.block || g2.block) return;
    this.busy = true;

    // swap positions
    this.grid[r1][c1] = g2; this.grid[r2][c2] = g1;
    g1.r = r2; g1.c = c2; g2.r = r1; g2.c = c1;
    this.onChange();

    if (g1.special === "bomb" || g2.special === "bomb") {
      await sleep(160);
      const bomb = g1.special === "bomb" ? g1 : g2;
      const other = g1.special === "bomb" ? g2 : g1;
      await this.detonate(bomb, other.res);
      return;
    }
    await sleep(160);
    const groups = this.findGroups();
    if (!groups.length) {
      // revert
      this.grid[r1][c1] = g1; this.grid[r2][c2] = g2;
      g1.r = r1; g1.c = c1; g2.r = r2; g2.c = c2;
      this.onFx("bad", r1, c1);
      this.onChange();
      await sleep(160);
      this.busy = false;
      return;
    }
    await this.settle(0);
  }

  async detonate(bomb: Gem, colorRes: ResKey) {
    this.busy = true;
    const gains: Partial<Record<ResKey, number>> = {};
    bomb.dead = true; this.grid[bomb.r][bomb.c] = null; this.onFx("boom", bomb.r, bomb.c);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const g = this.grid[r][c];
      if (!g || g.block || g.res !== colorRes) continue;
      if (g.hard > 0) { g.hard = (g.hard - 1) as 0 | 1 | 2; this.onFx("crack", r, c); continue; }
      if (g.tier > 0) { this.onHarvest(g.res, g.tier); gains[g.res] = (gains[g.res] ?? 0) + g.tier; }
      g.dead = true; this.grid[r][c] = null; this.onFx("pop", r, c); }
    if (Object.keys(gains).length) this.onPopup(gains, "COLOUR PURGE");
    this.onChange();
    await sleep(260);
    this.gravity();
    this.onChange();
    await sleep(230);
    await this.settle(2);
  }

  // 20s token spawn: pool = { res: accessTier }
  spawnTokens(pool: Partial<Record<ResKey, number>>) {
    for (const res of Object.keys(pool) as ResKey[]) {
      if (res === "gold") continue;   // gold never upgrades in place — see spawnGold
      const tier = pool[res] as 1 | 2;
      const eligible: Gem[] = [];
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const g = this.grid[r][c];
        if (g && g.res === res && g.tier === 0 && !g.special && !g.block && g.hard === 0) eligible.push(g);
      }
      if (eligible.length) {
        const g = choice(eligible);
        g.tier = tier;
        this.onFx("up", g.r, g.c);
      }
    }
    // Gold coins only appear if you actually have gold-mine access. Without a
    // building next to a goldmine there is no `pool.gold`, so no coin spawns —
    // the only other source is the combo reward (see registerCombo).
    if (pool.gold !== undefined) {
      const goldTier = (pool.gold as number) >= 2 ? 2 : 1;
      this.spawnGold(goldTier as 1 | 2);
    }
    this.onChange();
  }

  /**
   * Bank a combo. Every COMBOS_PER_GOLD combos converts one neutral gem into a
   * wild gold coin — this is the only way to earn gold without owning a mine.
   */
  registerCombo() {
    this.comboCount++;
    const need = Board.COMBOS_PER_GOLD;
    if (this.comboCount >= need) {
      this.comboCount -= need;
      this.spawnGold(1);
      this.onCombo(this.comboCount, need, true);
      this.onChange();
    } else {
      this.onCombo(this.comboCount, need, false);
    }
  }

  // convert ONE random neutral gem into a wild gold coin with a number
  spawnGold(tier: 1 | 2) {
    const eligible = this.gems().filter((g) =>
      g.res !== "gold" && g.tier === 0 && !g.special && !g.block && g.hard === 0);
    if (!eligible.length) return;
    const g = choice(eligible);
    g.res = "gold"; g.tier = tier;
    this.onFx("up", g.r, g.c);
  }

  harden(n = 7) {
    const eligible = this.gems().filter((g) => !g.block && !g.special);
    for (const g of shuffle(eligible).slice(0, n)) { g.hard = 2; this.onFx("crack", g.r, g.c); }
    this.onChange();
  }

  dropBlocks(n = 4, ms = 30000, now = performance.now()) {
    const cols = shuffle(Array.from({ length: W }, (_, i) => i)).slice(0, n);
    for (const c of cols) {
      const r = 2 + randInt(H - 3);
      const g = this.newGem(this.randRes(), r, c);
      g.block = true;
      this.grid[r][c] = g;
      this.onFx("boom", r, c);
    }
    this.blockUntil = now + ms;
    this.onChange();
  }

  fog(ms = 30000, now = performance.now()) { this.fogUntil = now + ms; }

  // Repair crew: remove all iron blocks AND thaw all frost tiles immediately
  smashBlocks(): number {
    let n = 0;
    let removed = false;
    this.blockUntil = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const g = this.grid[r][c];
      if (!g) continue;
      if (g.block) { g.dead = true; this.grid[r][c] = null; this.onFx("boom", r, c); n++; removed = true; }
      else if (g.hard > 0) { g.hard = 0; this.onFx("crack", r, c); n++; } // thaw ice
    }
    if (removed) this.gravity();
    if (n) this.onChange();
    return n;
  }

  tickEffects(now: number) {
    if (this.busy) return;
    // clear expired iron blocks
    if (this.blockUntil && now > this.blockUntil) {
      this.blockUntil = 0;
      let removed = false;
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const g = this.grid[r][c];
        if (g?.block) { g.dead = true; this.grid[r][c] = null; removed = true; }
      }
      if (removed) { this.gravity(); this.onChange(); }
    }
    // deadlock guard — reshuffle even when no player move triggered a settle
    if (!this.busy && !this.hasMove()) this.reshuffle();
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
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (c < W - 1 && test(r, c, r, c + 1)) return true;
      if (r < H - 1 && test(r, c, r + 1, c)) return true;
      // bombs always give a "move"
      const g = this.grid[r][c];
      if (g?.special === "bomb") return true;
    }
    return false;
  }

  async reshuffle() {
    this.busy = true;
    // try shuffles until the board has at least one move (avoid re-deadlock)
    const movable = this.gems().filter((g) => !g.block);
    for (let attempt = 0; attempt < 30; attempt++) {
      const resList = shuffle(movable.map((g) => g.res));
      movable.forEach((g, i) => { g.res = resList[i]; });
      if (this.hasMove() && this.findGroups().length === 0) break;
    }
    this.onFx("bad", 0, 0);
    this.onChange();
    await sleep(220);
    this.busy = false;
  }

  // Manual escape hatch: wipe the whole quarry to fresh NEUTRAL gems (no tokens).
  resetNeutral() {
    this.busy = true;
    this.blockUntil = 0; this.fogUntil = 0;
    this.initFill();                       // fresh gems, tier 0, no match at start
    this.onChange();
    this.busy = false;
  }
}