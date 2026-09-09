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
  /**
   * PP-13: this gem's token was FORGED by the player's own long match (4 in a
   * row mints a tier-1 token of that colour, 5+ mints a tier-2 one) instead of
   * being dropped by the network's token spawner (`spawnTokens`).
   *
   * The distinction is what makes the quarry gate correct: a network token
   * only exists because a depot reaches that cargo's industry, so refusing it
   * when the line is cut is right — but a forged token was PAID FOR by the
   * match that created it. Matching a forged wood token next to a wood industry
   * you have no depot on must still hand you the wood; before this flag the
   * gate refused it and the 4-match reward was silently worthless.
   */
  forged?: boolean;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ── A1: the arcade callouts ────────────────────────────────────────────────
/**
 * Every visual the board can ask the UI to draw. `chain` is the ordinary
 * callout (a plain MATCH!, or a MATCH 5 / L-SHAPE); `combo` is the louder
 * cascade tier (COMBO x2, CHAIN x3!!) — same float, hotter styling.
 */
export type FxType = "pop" | "crack" | "up" | "boom" | "bad" | "chain" | "combo";

/**
 * The word a cascade pass shouts, by how deep in the cascade it is.
 *
 * This is the mapping the arcade feedback hung on and never used: cascade
 * step 1 is a plain `MATCH!` — before A1 the board only spoke at step 2, so
 * an ordinary 3-match cleared in total silence even with `onFx` wired.
 * Step 2 is the first real `COMBO x2`, and everything deeper escalates to
 * `CHAIN xN!!`.
 */
export function arcadeLabel(chain: number): string {
  if (chain <= 1) return "MATCH!";
  if (chain === 2) return "COMBO x2";
  return `CHAIN x${chain}!!`;
}

/**
 * PP-09: the five gem colours that always populate and refill the board.
 * Gold is deliberately absent — gold gems only drop once a depot sits beside
 * a gold mine, and the quarry flips them on via `setGoldEnabled`.
 */
const BASE_POOL: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];

export class Board {
  grid: (Gem | null)[][] = [];
  seq = 1;
  busy = false;
  // Gold is NOT in the base pool at boot — gold gems only drop (join the
  // gravity pool) once a depot sits beside a gold mine. See setGoldEnabled.
  pool: ResKey[] = [...BASE_POOL];
  fogUntil = 0;
  blockUntil = 0;
  // combos banked toward the next gold coin (2 combos = 1 coin)
  comboCount = 0;
  static COMBOS_PER_GOLD = 2;

  // callbacks (wired by game)
  /**
   * A tokened gem was matched. `forged` is true when the token came from the
   * player's own long match rather than from the network spawner.
   *
   * Return `false` to REFUSE the payout: the board then keeps that amount out
   * of the match's gain popup, so the readout can only ever show what
   * actually reached the purse. Return a NUMBER to say what was actually
   * credited when it differs from `amount` — the quarry pays a depot-fed
   * token at double face value, and a readout that showed the face value
   * would be advertising a different number than the purse received.
   *
   * Any other return — including `undefined`, for a handler that does not
   * care — counts as paid at face value, which keeps every existing
   * fire-and-forget listener working unchanged.
   */
  onHarvest: (res: ResKey, amount: number, forged: boolean) => boolean | number | void = () => true;

  onGold: (n: number) => void = () => {};
  onFx: (type: FxType, r: number, c: number, text?: string) => void = () => {};
  onChange: () => void = () => {};
  onPopup: (gains: Partial<Record<ResKey, number>>, label: string) => void = () => {};
  // fired when a combo is banked: (bankedNow, needed, grantedCoin)
  onCombo: (count: number, needed: number, granted: boolean) => void = () => {};
  /** Arcade bonus (match-5 / L / chain) — always pays, not network-gated. */
  onBonus: (res: ResKey, amount: number, reason: string) => void = () => {};

  /**
   * What a harvest actually credited, from `onHarvest`'s answer — 0 when the
   * listener refused it. The board never guesses the amount: the quarry knows
   * what it put in the purse, and the readout has to show that number.
   */
  private credited(res: ResKey, amount: number, forged: boolean): number {
    const r = this.onHarvest(res, amount, forged);
    if (r === false) return 0;
    return typeof r === "number" ? r : amount;
  }

  constructor() {
    this.initFill();
  }

  private newGem(res: ResKey, r: number, c: number, isNew = false): Gem {
    return { id: this.seq++, res, tier: 0, special: null, hard: 0, block: false, r, c, isNew };
  }

  private randRes(): ResKey {
    return choice(this.pool.length ? this.pool : RES_KEYS.slice(0, 4));
  }

  /**
   * PP-09: add or remove gold from the gravity pool. Gold gems must "drop
   * like the other resource types" — appearing in the normal refill path
   * (`randRes` → `initFill` / `gravity`) — but only while a depot sits beside
   * a gold mine. The quarry recomputes this on every refresh (build /
   * demolish), so building the depot turns gold drops on and demolishing it
   * turns them off. Gold gems never overwrite an existing gem in place: the
   * only way a gold gem reaches the board is by falling in from the top. A
   * plain gold gem pays nothing, a tokened one pays gold.
   */
  setGoldEnabled(enabled: boolean) {
    const has = this.pool.includes("gold");
    if (enabled === has) return;
    this.pool = enabled ? [...this.pool, "gold"] : this.pool.filter((r) => r !== "gold");
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

  // scan one line (row or col) for runs of >=3 of one colour.
  // N3: gold is NOT wild any more — it is its own colour and matches only
  // itself, so this scan needs no wild branching at all.
  private lineRuns(cells: (Gem | null)[]): Gem[][] {
    const runs: Gem[][] = [];
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const g = cells[i];
      if (!this.matchable(g)) { i++; continue; }
      const color: ResKey = g!.res;
      const run: Gem[] = [g!];
      let j = i + 1;
      while (j < n) {
        const h = cells[j];
        if (!this.matchable(h) || h!.res !== color) break;
        run.push(h!);
        j++;
      }
      const matched = run.length >= 3;
      if (matched) runs.push(run);
      i = matched ? j : i + 1;
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

  /** Two orthogonal runs of 3+ that share one corner gem = a 5-gem L. */
  private lShapes(groups: Gem[][]): Gem[][] {
    const out: Gem[][] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (a[0].res !== b[0].res) continue;
        const ids = new Set(a.map((g) => g.id));
        const shared = b.filter((g) => ids.has(g.id));
        if (shared.length !== 1) continue;
        const union = [...a];
        for (const g of b) if (!ids.has(g.id)) union.push(g);
        if (union.length < 5) continue;
        const sameRow = a.every((g) => g.r === a[0].r);
        const otherCol = b.every((g) => g.c === b[0].c);
        const sameCol = a.every((g) => g.c === a[0].c);
        const otherRow = b.every((g) => g.r === b[0].r);
        if ((sameRow && otherCol) || (sameCol && otherRow)) out.push(union);
      }
    }
    return out;
  }

  private grantRandom(n: number, reason: string, gains: Partial<Record<ResKey, number>>) {
    for (let i = 0; i < n; i++) {
      const res = choice(BASE_POOL);
      gains[res] = (gains[res] ?? 0) + 1;
      this.onBonus(res, 1, reason);
      this.onHarvest(res, 1, true);
    }
  }

  /**
   * Clear one cascade pass. `chain` is this pass's 1-based depth, so the
   * callout can name it (`MATCH!` / `COMBO x2` / `CHAIN x3!!`).
   *
   * Returns accumulated gains for the popup.
   */
  private resolve(
    groups: Gem[][], gains: Partial<Record<ResKey, number>>, chain = 1,
  ) {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    const forge: { r: number; c: number; res: ResKey; tier: 1 | 2 }[] = [];
    const bombs: { r: number; c: number; res: ResKey }[] = [];

    for (const grp of groups) {
      const size = grp.length;
      // runs are single-colour (no wilds since N3) — the anchor is the colour
      const anchor = grp[0].res;
      const tokenPresent = grp.some((g) => g.tier > 0);
      const mult = size >= 4 ? 2 : 1;
      // pay each token by its OWN resource (a matched gold token pays gold)
      for (const g of grp) {
        if (g.hard > 0) { crackIds.add(g.id); continue; }
        removeIds.add(g.id);
        if (g.tier > 0) {
          const amt = g.tier * mult;
          // PP-13: the listener decides whether this token pays (the quarry
          // gate refuses a NETWORK token whose line is cut, but always pays a
          // FORGED one). A1: it also decides HOW MUCH it paid — `gains`
          // accumulates exactly what reached the purse, so the floating
          // "+2 🪵" can never advertise a number the purse did not receive.
          const paid = this.credited(g.res, amt, g.forged === true);
          if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
        }
      }
      const mid = grp[Math.floor(size / 2)];
      // A long match MINTS a token of its own colour: 4 in a row leaves a
      // tier-1 token behind, 5+ leaves a tier-2 one plus a bomb. These are the
      // board's own reward, and they carry `forged` (see the forge loop below)
      // so the quarry pays them even where no depot reaches that cargo.
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
      // PP-13: this token was minted by the match itself, so it pays even
      // where the network reaches nothing — mark it for the quarry gate.
      g.forged = true;
      this.grid[f.r][f.c] = g;
      this.onFx("up", f.r, f.c);
    }
    for (const b of bombs) {
      const g = this.newGem(b.res, b.r, b.c);
      g.special = "bomb";
      this.grid[b.r][b.c] = g;
      this.onFx("boom", b.r, b.c);
    }

    // Arcade: match-5 in a line, or a 5-gem L, grants two random materials.
    const fives = groups.filter((g) => g.length >= 5);
    const ells = this.lShapes(groups);
    const why = fives.length ? "MATCH 5" : ells.length ? "L-SHAPE" : null;
    if (why) this.grantRandom(2, why, gains);

    // ── A1: the callout, fired HERE — the instant the pass resolves ──
    // Two bugs died here. (1) The old text only fired for `chain >= 2`, so a
    // plain 3-match cleared in silence. (2) It fired AFTER `gravity` and its
    // 400ms of sleeps, so `CHAIN x2` appeared ~400ms after the match it was
    // describing had already been swept off the board. One callout per pass,
    // now, at the centre of the group the player just matched — the biggest
    // one, or the special shape when there is one.
    const biggest = groups.reduce((a, g) => (g.length > a.length ? g : a), groups[0]);
    const target = fives[0] ?? ells[0] ?? biggest;
    const mid = target[Math.floor(target.length / 2)];
    const label = arcadeLabel(chain);
    // A special shape keeps its own name (it is strictly more informative
    // than "MATCH!"), but a deep cascade still gets its chain count.
    const text = why ? (chain > 1 ? `${why} · ${label}` : why) : label;
    this.onFx(chain > 1 ? "combo" : "chain", mid.r, mid.c, text);
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
      this.resolve(groups, gains, chain);
      this.onChange();
      await sleep(190);
      this.gravity();
      this.onChange();
      await sleep(210);
    }
    const label = maxChain > 1 ? `COMBO x${maxChain}` : "";
    // A1: the readout fires on the LABEL as well as the gains. A tokenless
    // cascade accumulates an empty `gains`, and gating the popup on that hid
    // the only feedback such a match had — a two-deep combo of plain gems
    // cleared, rang up a combo, and told the player nothing at all.
    if (Object.keys(gains).length || label) this.onPopup(gains, label);
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
      if (g.tier > 0) {
        const paid = this.credited(g.res, g.tier, g.forged === true);
        if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
      }
      g.dead = true; this.grid[r][c] = null; this.onFx("pop", r, c); }
    if (Object.keys(gains).length) this.onPopup(gains, "COLOUR PURGE");
    this.onChange();
    await sleep(260);
    this.gravity();
    this.onChange();
    await sleep(230);
    await this.settle(2);
  }

  // 20s token spawn: pool = { res: accessTier }. Every reachable colour,
  // INCLUDING gold, upgrades an existing gem of that colour in place. Gold is
  // never minted by converting a different-colour gem — gold gems reach the
  // board only by dropping in from the top via the gravity pool (see
  // setGoldEnabled). A tokened gold gem pays gold when matched; a plain one
  // pays nothing.
  spawnTokens(pool: Partial<Record<ResKey, number>>): number {
    let minted = 0;
    for (const res of Object.keys(pool) as ResKey[]) {
      const tier = pool[res] as 1 | 2;
      const eligible: Gem[] = [];
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const g = this.grid[r][c];
        if (g && g.res === res && g.tier === 0 && !g.special && !g.block && g.hard === 0) eligible.push(g);
      }
      if (eligible.length) {
        const g = choice(eligible);
        g.tier = tier;
        // PP-13: this token came from the network, so it is network-gated —
        // clear any stale forge mark (a forged token can reach tier 0 again
        // if it was ever stripped) so the two kinds never get confused.
        g.forged = false;
        this.onFx("up", g.r, g.c);
        minted++;
      }
    }
    this.onChange();
    // A1: the caller (the lorry delivery) needs to know whether a token
    // actually landed — a board with every gem of that colour already
    // tokened mints nothing, and the "+N" at the factory must not promise a
    // gem the board never got.
    return minted;
  }

  /**
   * Bank a combo. Every COMBOS_PER_GOLD combos pays one gold into the purse.
   *
   * W5: the coin reaches the player's PURSE directly via `onGold(1)` — that
   * is what makes "2 combos = 1 gold" actually pay out (and what makes the
   * Black Market affordable).
   */
  registerCombo() {
    this.comboCount++;
    const need = Board.COMBOS_PER_GOLD;
    if (this.comboCount >= need) {
      this.comboCount -= need;
      this.onGold(1);
      this.onCombo(this.comboCount, need, true);
      this.onChange();
    } else {
      this.onCombo(this.comboCount, need, false);
    }
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