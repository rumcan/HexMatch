// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the board engine, rebuilt.
//
// A synchronous, timer-free match-3 core. It owns the grid and the RULES —
// runs, L-shapes, the holy and broken crosses, frost that cracks, girders
// that break beside a removal, bombs that purge a colour, the deadlock
// reshuffle, the seeded obstacle placement — and it resolves a move as a
// GENERATOR of phases (`types.ts`): swap, clear, fall, clear, fall, … end.
//
// Why a generator: the engine mutates the grid and consumes the RNG in one
// fixed order however the phases are paced. Run it with no waits (the bot,
// the battle engine, a test) or with 80 ms beats (the game) or at a quarter
// speed (the 5★ finale) and the same seed gives the same board — which is
// the determinism promise `setRng` makes to the tests and the rooms.
//
// The engine never fires a callback. Everything a legacy listener wants
// (`onFx`, `onClear`, `onPass`, `onReward`…) is a FACT carried on the phase,
// and the adapter (`board.ts`) hands it out in the old order. The one
// synchronous question it must ask — "did this harvest actually pay?" — is
// the injected `credit` function, because the answer changes the readout.
// ══════════════════════════════════════════════════════════════════════════

import { getRng, type Rng } from "./rng";
import {
  BOARD_H,
  BOARD_W,
  BROKEN_CROSS_PICKS,
  HOLY_CROSS_PICKS,
  arcadeLabel,
  type BoardObstacles,
  type BoardPhase,
  type CellGem,
  type CellRef,
  type ClearPhase,
  type CrossHit,
  type CrossKind,
  type FallMove,
  type FallPhase,
  type FxEvent,
  type Gem,
  type PassReport,
  type ResKey,
  type RewardKind,
  type Special,
} from "./types";

/** The colours a board boots with — gold only joins once a mine is reached. */
export const BASE_POOL: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];

/** Where in the swap beat the two stones touch (see `SwapPhase.contactAt`). */
export const SWAP_CONTACT_AT = 0.5;

export interface EngineOptions {
  w?: number;
  h?: number;
  /** The stream to roll on; omitted, the module facade (`setRng`) is read on every roll. */
  rng?: Rng;
  pool?: ResKey[];
}

export type Move = [number, number, number, number];

/** The generator a move resolves through: yields phases, takes a cross pick. */
export type Resolution = Generator<BoardPhase, boolean, ResKey[] | undefined>;

export class Match3Engine {
  grid: (Gem | null)[][] = [];
  seq = 1;
  pool: ResKey[];
  paysScore = false;
  comboCount = 0;
  static COMBOS_PER_GOLD = 2;
  biasRes: ResKey | null = null;
  biasP = 0;
  /** What a harvest actually credited (the adapter wires `onHarvest` here). */
  credit: (res: ResKey, amount: number, forged: boolean) => number = (_r, amount) => amount;

  private readonly rngFn: Rng | null;
  private w0: number;
  private h0: number;

  constructor(opts: EngineOptions = {}) {
    this.w0 = opts.w ?? BOARD_W;
    this.h0 = opts.h ?? BOARD_H;
    this.pool = opts.pool ? [...opts.pool] : [...BASE_POOL];
    this.rngFn = opts.rng ?? null;
    this.initFill();
  }

  // ── rng ────────────────────────────────────────────────────────────────
  private rand(): number {
    return (this.rngFn ?? getRng())();
  }
  private randInt(n: number): number {
    return Math.floor(this.rand() * n);
  }
  private choice<T>(arr: T[]): T {
    return arr[this.randInt(arr.length)];
  }
  private shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ── size ───────────────────────────────────────────────────────────────
  get w(): number {
    return this.grid[0]?.length ?? this.w0;
  }
  get h(): number {
    return this.grid.length || this.h0;
  }

  /** MOBILE-02: resize in place; gems inside the new rectangle keep identity. */
  setSize(w: number, h: number): boolean {
    const W2 = Math.max(3, Math.min(24, Math.floor(w)));
    const H2 = Math.max(3, Math.min(24, Math.floor(h)));
    if (this.w === W2 && this.h === H2) return false;
    const old = this.grid;
    const next: (Gem | null)[][] = [];
    for (let r = 0; r < H2; r++) {
      const row: (Gem | null)[] = [];
      for (let c = 0; c < W2; c++) {
        const g = old[r]?.[c] ?? null;
        if (g) {
          g.r = r;
          g.c = c;
          row.push(g);
        } else row.push(this.newGem(this.randRes(), r, c, true));
      }
      next.push(row);
    }
    this.grid = next;
    this.w0 = W2;
    this.h0 = H2;
    return true;
  }

  // ── gems ───────────────────────────────────────────────────────────────
  newGem(res: ResKey, r: number, c: number, isNew = false): Gem {
    return { id: this.seq++, res, tier: 0, special: null, hard: 0, block: false, r, c, isNew };
  }

  randRes(): ResKey {
    if (this.biasRes && this.biasP > 0 && this.rand() < this.biasP) return this.biasRes;
    return this.choice(this.pool);
  }

  setBias(res: ResKey | null, p: number): void {
    this.biasRes = res;
    this.biasP = res ? Math.max(0, Math.min(1, p)) : 0;
  }

  setGoldEnabled(on: boolean): void {
    if (on && !this.pool.includes("gold")) this.pool.push("gold");
    if (!on) this.pool = this.pool.filter((r) => r !== "gold");
  }

  /** A fresh board with no match on it (and the previous rectangle kept). */
  initFill(): void {
    const W = this.w;
    const H = this.h;
    this.grid = [];
    for (let r = 0; r < H; r++) {
      this.grid.push(new Array<Gem | null>(W).fill(null));
      for (let c = 0; c < W; c++) {
        let res = this.randRes();
        for (let guard = 0; guard < 40; guard++) {
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
    for (const row of this.grid) for (const g of row) if (g) out.push(g);
    return out;
  }

  /** Can this cell take part in a run? Girders and bombs break a line. */
  matchable(g: Gem | null | undefined): g is Gem {
    return !!g && !g.block && g.special !== "bomb" && g.special !== "disco";
  }

  // ── runs and shapes ────────────────────────────────────────────────────
  private lineRuns(cells: (Gem | null)[]): Gem[][] {
    const runs: Gem[][] = [];
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const g = cells[i];
      if (!this.matchable(g)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n && this.matchable(cells[j]) && cells[j]!.res === g.res) j++;
      if (j - i >= 3) runs.push(cells.slice(i, j) as Gem[]);
      i = j;
    }
    return runs;
  }

  /** Every run of ≥3 on the board, rows first then columns (not merged). */
  findGroups(): Gem[][] {
    const groups: Gem[][] = [];
    for (let r = 0; r < this.h; r++) groups.push(...this.lineRuns(this.grid[r]));
    for (let c = 0; c < this.w; c++) groups.push(...this.lineRuns(this.grid.map((row) => row[c])));
    return groups;
  }

  private lShapes(groups: Gem[][]): Gem[][] {
    const out: Gem[][] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
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

  private crossPair(a: Gem[], b: Gem[]): { kind: CrossKind; mid: Gem } | null {
    if (a[0].res !== b[0].res) return null;
    const la = a.length;
    const lb = b.length;
    const aRow = a.every((g) => g.r === a[0].r);
    const bRow = b.every((g) => g.r === b[0].r);
    if (aRow === bRow) return null;
    const ids = new Set(a.map((g) => g.id));
    const shared = b.filter((g) => ids.has(g.id));
    if (shared.length !== 1) return null;
    const s = shared[0];
    const aEnd = s.id === a[0].id || s.id === a[la - 1].id;
    const bEnd = s.id === b[0].id || s.id === b[lb - 1].id;
    if (aEnd !== bEnd) return { kind: "broken", mid: s };
    if (la === 3 && lb === 3) {
      if (s.id !== a[1].id || s.id !== b[1].id) return null;
      return { kind: "broken", mid: s };
    }
    if (!((la === 3 && lb === 4) || (la === 4 && lb === 3))) return null;
    const three = la === 3 ? a : b;
    const four = la === 3 ? b : a;
    if (s.id !== three[1].id) return null;
    const idx = four.findIndex((g) => g.id === s.id);
    if (idx <= 0 || idx >= four.length - 1) return null;
    return { kind: "holy", mid: s };
  }

  private crosses(groups: Gem[][]): CrossHit[] {
    const out: CrossHit[] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const hit = this.crossPair(groups[i], groups[j]);
        if (!hit) continue;
        const ids = new Set(groups[i].map((g) => g.id));
        const gems = [...groups[i], ...groups[j].filter((g) => !ids.has(g.id))];
        out.push({ gems, mid: hit.mid, kind: hit.kind });
      }
    }
    return out;
  }

  // ── one pass ───────────────────────────────────────────────────────────
  private grantRandom(n: number, reason: string, gains: Partial<Record<ResKey, number>>, bonus: ClearPhase["bonus"]): void {
    for (let i = 0; i < n; i++) {
      const res = this.choice(BASE_POOL);
      const paid = this.credit(res, 1, true);
      if (paid > 0) gains[res] = (gains[res] ?? 0) + paid;
      bonus.push({ res, amount: 1, reason });
    }
  }

  /** Resolve `groups`: remove, crack, forge, mint — and report what happened. */
  /** The gems a line gem at (r, c) sweeps: its row, its column, or both. */
  lineCells(r: number, c: number, axis: "row" | "col" | "both" | "all"): Gem[] {
    if (axis === "all") return this.gems();
    const out: Gem[] = [];
    if (axis !== "col") for (let x = 0; x < this.w; x++) { const g = this.grid[r][x]; if (g) out.push(g); }
    if (axis !== "row") for (let y = 0; y < this.h; y++) { const g = this.grid[y][c]; if (g && y !== r) out.push(g); }
    return out;
  }

  /**
   * Grow a removal set through the line gems in it: each fires its row and
   * column once (girders stand, frost cracks instead). Returns where each
   * line fired, for the blast fx.
   */
  private expandLines(removeIds: Set<number>, crackIds: Set<number>, first?: { gem: Gem; axis: "row" | "col" | "both" | "all" }): CellRef[] {
    const fired = new Set<number>();
    const at: CellRef[] = [];
    const fire = (g: Gem, axis: "row" | "col" | "both" | "all") => {
      fired.add(g.id);
      at.push({ r: g.r, c: g.c });
      for (const o of this.lineCells(g.r, g.c, axis)) {
        if (o.block || o.id === g.id) continue;
        if (o.hard > 0) { crackIds.add(o.id); continue; }
        removeIds.add(o.id);
      }
    };
    if (first) { removeIds.add(first.gem.id); fire(first.gem, first.axis); }
    for (let grew = true; grew;) {
      grew = false;
      for (const g of this.gems()) {
        if (!removeIds.has(g.id) || fired.has(g.id)) continue;
        if (g.special === "line") { fire(g, "both"); grew = true; }
        else if (g.special === "disco") { fire(g, "all"); grew = true; }
      }
    }
    return at;
  }

  /**
   * A line gem SWAPPED: it clears just its row (a left/right swap) or just its
   * column (up/down), then the board settles as after any clear.
   */
  *lineBlast(line: Gem, axis: "row" | "col" | "all"): Resolution {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    const at = this.expandLines(removeIds, crackIds, { gem: line, axis });
    const gains: Partial<Record<ResKey, number>> = {};
    const removed: CellGem[] = [];
    const cracked: ClearPhase["cracked"] = [];
    const fx: FxEvent[] = at.map((b) => ({ type: "boom" as const, r: b.r, c: b.c }));
    const rewards: RewardKind[] = [];
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const g = this.grid[r][c];
        if (!g) continue;
        if (crackIds.has(g.id)) {
          g.hard = (g.hard - 1) as 0 | 1 | 2;
          cracked.push({ r, c, kind: "frost", left: g.hard });
          fx.push({ type: "crack", r, c });
          if (this.paysScore) rewards.push("frost");
        } else if (removeIds.has(g.id)) {
          if (g.tier > 0) {
            const paid = this.credit(g.res, g.tier, g.forged === true);
            if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
          }
          g.dead = true;
          this.grid[r][c] = null;
          removed.push({ r, c, id: g.id, res: g.res });
          fx.push({ type: "pop", r, c });
        }
      }
    }
    const purged = removed.length;
    if (axis === "all" && this.paysScore) rewards.push("disco");
    yield {
      type: "bombClear", chain: 1, removed, cracked, minted: [], fx, rewards, bonus: [], crosses: [],
      cleared: purged, pass: { cleared: {}, biggest: 0, shaped: false, chain: 1, purged },
      bombAt: { r: line.r, c: line.c }, label: axis === "all" ? "DISCO!" : "LINE BLAST",
      ...(axis === "all" || removed.length >= this.w * this.h - 2 ? { wipe: true } : {}),
    };
    yield { type: "end", gains, label: axis === "all" ? "DISCO!" : "LINE BLAST", maxChain: 0 };
    const fall = this.gravity(2);
    yield { ...fall, type: "bombFall" };
    yield* this.settle(2);
    return true;
  }

  resolve(groups: Gem[][], gains: Partial<Record<ResKey, number>>, chain = 1): ClearPhase {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    const forge: { r: number; c: number; res: ResKey; tier: 1 | 2 }[] = [];
    const bombs: { r: number; c: number; res: ResKey }[] = [];
    const lines: { r: number; c: number; res: ResKey }[] = [];
    const discos: { r: number; c: number; res: ResKey }[] = [];
    const fx: FxEvent[] = [];
    const rewards: RewardKind[] = [];
    const bonus: ClearPhase["bonus"] = [];

    for (const grp of groups) {
      const size = grp.length;
      const anchor = grp[0].res;
      const tokenPresent = grp.some((g) => g.tier > 0);
      const mult = size >= 4 ? 2 : 1;
      for (const g of grp) {
        if (g.hard > 0) {
          crackIds.add(g.id);
          continue;
        }
        if (removeIds.has(g.id)) continue;
        removeIds.add(g.id);
        if (g.tier > 0) {
          const paid = this.credit(g.res, g.tier * mult, g.forged === true);
          if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
        }
      }
      const mid = grp[Math.floor(size / 2)];
      // Owner (2026-09-28): a match of 4 leaves a LINE gem of its colour behind.
      if (size === 4) lines.push({ r: mid.r, c: mid.c, res: anchor });
      // Owner (2026-09-28): a match of 5 is the DISCO BALL now (wipes the board).
      if (size >= 5) {
        discos.push({ r: mid.r, c: mid.c, res: anchor });
        if (!tokenPresent && !this.paysScore) forge.push({ r: grp[0].r, c: grp[0].c, res: anchor, tier: 2 });
      }
    }

    // …and the BOMB is minted by the shapes: an L's corner, a cross's middle.
    const shapeCrosses = this.crosses(groups);
    for (const x of shapeCrosses) bombs.push({ r: x.mid.r, c: x.mid.c, res: x.mid.res });
    for (const ell of this.lShapes(groups)) {
      const corner = ell.find((g) => ell.some((o) => o !== g && o.r === g.r) && ell.some((o) => o !== g && o.c === g.c));
      if (corner && !bombs.some((b) => b.r === corner.r && b.c === corner.c)) bombs.push({ r: corner.r, c: corner.c, res: corner.res });
    }

    // A line gem caught in a match clears its whole row and column; a line gem
    // those clear takes its own cross with it.
    const blasts = this.expandLines(removeIds, crackIds);
    for (const b of blasts) fx.push({ type: "boom", r: b.r, c: b.c });

    // apply
    const removed: CellGem[] = [];
    const cracked: ClearPhase["cracked"] = [];
    const cleared: Partial<Record<ResKey, number>> = {};
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const g = this.grid[r][c];
        if (!g) continue;
        if (crackIds.has(g.id)) {
          g.hard = (g.hard - 1) as 0 | 1 | 2;
          cracked.push({ r, c, kind: "frost", left: g.hard });
          fx.push({ type: "crack", r, c });
          if (this.paysScore) rewards.push("frost");
        } else if (removeIds.has(g.id)) {
          g.dead = true;
          this.grid[r][c] = null;
          removed.push({ r, c, id: g.id, res: g.res });
          cleared[g.res] = (cleared[g.res] ?? 0) + 1;
          fx.push({ type: "pop", r, c });
        }
      }
    }
    // a removal beside a girder breaks it back into an ordinary gem
    for (const cell of removed) {
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const nr = cell.r + dr;
        const nc = cell.c + dc;
        if (nr < 0 || nr >= this.h || nc < 0 || nc >= this.w) continue;
        const b = this.grid[nr][nc];
        if (b && b.block) {
          b.block = false;
          cracked.push({ r: nr, c: nc, kind: "girder", left: 0 });
          fx.push({ type: "crack", r: nr, c: nc });
          if (this.paysScore) rewards.push("girder");
        }
      }
    }
    const minted: ClearPhase["minted"] = [];
    for (const f of forge) {
      const g = this.newGem(f.res, f.r, f.c);
      g.tier = f.tier;
      g.forged = true;
      this.grid[f.r][f.c] = g;
      minted.push({ r: f.r, c: f.c, what: "token" });
      fx.push({ type: "up", r: f.r, c: f.c });
    }
    for (const d of discos) {
      if (this.grid[d.r][d.c]) continue;
      const g = this.newGem(d.res, d.r, d.c);
      g.special = "disco";
      this.grid[d.r][d.c] = g;
      minted.push({ r: d.r, c: d.c, what: "disco" });
      fx.push({ type: "boom", r: d.r, c: d.c });
    }
    for (const l of lines) {
      if (this.grid[l.r][l.c]) continue;
      const g = this.newGem(l.res, l.r, l.c);
      g.special = "line";
      this.grid[l.r][l.c] = g;
      minted.push({ r: l.r, c: l.c, what: "line" });
      fx.push({ type: "up", r: l.r, c: l.c });
    }
    for (const b of bombs) {
      if (this.grid[b.r][b.c]) continue;
      const g = this.newGem(b.res, b.r, b.c);
      g.special = "bomb";
      this.grid[b.r][b.c] = g;
      minted.push({ r: b.r, c: b.c, what: "bomb" });
      fx.push({ type: "boom", r: b.r, c: b.c });
    }

    const fives = groups.filter((g) => g.length >= 5);
    const crosses = this.crosses(groups);
    const ells = this.lShapes(groups);
    const hasHoly = crosses.some((x) => x.kind === "holy");
    const why = fives.length
      ? "MATCH 5"
      : hasHoly
        ? "HOLY CROSS"
        : crosses.length
          ? "BROKEN CROSS"
          : ells.length
            ? "L-SHAPE"
            : null;
    if (why && why !== "HOLY CROSS" && why !== "BROKEN CROSS") {
      if (this.paysScore) rewards.push("shape");
      else this.grantRandom(2, why, gains, bonus);
    }
    for (const x of crosses) fx.push({ type: x.kind === "broken" ? "bcross" : "cross", r: x.mid.r, c: x.mid.c });

    const biggest = groups.reduce((a, g) => (g.length > a.length ? g : a), groups[0]);
    const cross = fives.length ? undefined : crosses[0];
    const target = fives[0] ?? cross?.gems ?? ells[0] ?? biggest;
    const mid = cross ? cross.mid : target[Math.floor(target.length / 2)];
    const label = arcadeLabel(chain);
    const text = why ? (chain > 1 ? `${why} · ${label}` : why) : label;
    fx.push({ type: chain > 1 ? "combo" : "chain", r: mid.r, c: mid.c, text });

    const pass: PassReport = {
      cleared,
      biggest: groups.reduce((m, g) => Math.max(m, g.length), 0),
      shaped: why !== null,
      chain,
      purged: 0,
    };
    return {
      type: "clear",
      chain,
      removed,
      cracked,
      minted,
      fx,
      rewards,
      bonus,
      crosses,
      cleared: removed.length,
      pass,
      label: text,
    };
  }

  /** Compact every column and drop fresh gems in from above. */
  gravity(chain = 1): FallPhase {
    const moves: FallMove[] = [];
    for (let c = 0; c < this.w; c++) {
      const stack: Gem[] = [];
      for (let r = this.h - 1; r >= 0; r--) {
        const g = this.grid[r][c];
        if (g) stack.push(g);
        this.grid[r][c] = null;
      }
      let r = this.h - 1;
      for (const g of stack) {
        if (g.r !== r) moves.push({ id: g.id, res: g.res, c, fromR: g.r, toR: r, spawned: false });
        g.r = r;
        g.c = c;
        this.grid[r][c] = g;
        r--;
      }
      const empty = r + 1;
      for (; r >= 0; r--) {
        const g = this.newGem(this.randRes(), r, c, true);
        this.grid[r][c] = g;
        moves.push({ id: g.id, res: g.res, c, fromR: r - empty, toR: r, spawned: true });
      }
    }
    return { type: "fall", moves, chain };
  }

  // ── moves ──────────────────────────────────────────────────────────────
  private wouldMatch(r1: number, c1: number, r2: number, c2: number): boolean {
    const g1 = this.grid[r1]?.[c1];
    const g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2) return false;
    this.grid[r1][c1] = g2;
    this.grid[r2][c2] = g1;
    const hit = this.findGroups().length > 0;
    this.grid[r1][c1] = g1;
    this.grid[r2][c2] = g2;
    return hit;
  }

  /** Dry-run a swap: how many gems its groups hold (0 = a dud). Grid untouched. */
  swapGain(r1: number, c1: number, r2: number, c2: number): number {
    const g1 = this.grid[r1]?.[c1];
    const g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return 0;
    if (g1.special === "disco" || g2.special === "disco") return this.gems().filter((g) => !g.block).length;
    if (g1.special === "line" || g2.special === "line") {
      const l = g1.special === "line" ? g1 : g2;
      return this.lineCells(l.r, l.c, r1 === r2 ? "row" : "col").filter((g) => !g.block).length;
    }
    if (g1.special === "bomb" || g2.special === "bomb") {
      const colour = g1.special === "bomb" ? g2.res : g1.res;
      return this.gems().filter((g) => g.res === colour && !g.block && g.special !== "bomb").length;
    }
    this.grid[r1][c1] = g2;
    this.grid[r2][c2] = g1;
    const ids = new Set<number>();
    for (const grp of this.findGroups()) for (const g of grp) ids.add(g.id);
    this.grid[r1][c1] = g1;
    this.grid[r2][c2] = g2;
    return ids.size;
  }

  /** Every swap the board would carry out, with its immediate gain. */
  legalMoves(): { move: Move; gain: number }[] {
    const out: { move: Move; gain: number }[] = [];
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 >= this.h || c2 >= this.w) continue;
          const gain = this.swapGain(r, c, r2, c2);
          if (gain > 0) out.push({ move: [r, c, r2, c2], gain });
        }
      }
    }
    return out;
  }

  /** AI-03: one swap the board will actually carry out (seeking with `score`). */
  findMove(score?: (g: Gem) => number): Move | null {
    let best: Move | null = null;
    let bestScore = -Infinity;
    let bombMove: Move | null = null;
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const a = this.grid[r][c];
        if (!a || a.block) continue;
        for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 >= this.h || c2 >= this.w) continue;
          const b = this.grid[r2][c2];
          if (!b || b.block) continue;
          if (a.special === "bomb" || b.special === "bomb") {
            if (!(a.special === "bomb" && b.special === "bomb") && !bombMove) bombMove = [r, c, r2, c2];
            continue;
          }
          if ((a.special === "line" || b.special === "line" || a.special === "disco" || b.special === "disco") && !bombMove) bombMove = [r, c, r2, c2];
          if (!this.wouldMatch(r, c, r2, c2)) continue;
          const mv: Move = [r, c, r2, c2];
          if (!score) return mv;
          const w = (score(a) ?? 0) + (score(b) ?? 0);
          if (w > bestScore) {
            bestScore = w;
            best = mv;
          }
        }
      }
    }
    return best ?? bombMove;
  }

  hasMove(): boolean {
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const a = this.grid[r][c];
        if (!a || a.block) continue;
        if (a.special === "bomb" || a.special === "line" || a.special === "disco") {
          const free = ([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).some(([dr, dc]) => {
            const n = this.grid[r + dr]?.[c + dc];
            return !!n && !n.block;
          });
          if (free) return true;
          continue;
        }
        for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (r2 >= this.h || c2 >= this.w) continue;
          const b = this.grid[r2][c2];
          if (!b || b.block || b.special === "bomb") continue;
          if (this.wouldMatch(r, c, r2, c2)) return true;
        }
      }
    }
    return false;
  }

  /** Re-deal the movable gems until the board has a move and no match. */
  reshuffleGrid(): void {
    const movable = this.gems().filter((g) => !g.block);
    for (let attempt = 0; attempt < 60; attempt++) {
      const resList = this.shuffle(movable.map((g) => g.res));
      movable.forEach((g, i) => {
        g.res = resList[i];
      });
      if (this.hasMove() && this.findGroups().length === 0) return;
    }
    // a hopeless deal (two colours, a girder-choked board): re-roll the
    // movable colours under the no-match rule, row-major like `initFill`
    for (let attempt = 0; attempt < 20; attempt++) {
      for (const g of movable) {
        let res = this.randRes();
        for (let guard = 0; guard < 40; guard++) {
          const { r, c } = g;
          const bad =
            (c >= 2 && this.grid[r][c - 1]?.res === res && this.grid[r][c - 2]?.res === res) ||
            (r >= 2 && this.grid[r - 1][c]?.res === res && this.grid[r - 2][c]?.res === res);
          if (!bad) break;
          res = this.randRes();
        }
        g.res = res;
      }
      if (this.hasMove() && this.findGroups().length === 0) return;
    }
  }

  // ── the move, as phases ────────────────────────────────────────────────
  private cellGem(g: Gem): CellGem {
    return { r: g.r, c: g.c, id: g.id, res: g.res };
  }

  *resolveSwap(r1: number, c1: number, r2: number, c2: number): Resolution {
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    const g1 = this.grid[r1]?.[c1];
    const g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return false;
    const before = { a: this.cellGem(g1), b: this.cellGem(g2) };
    this.grid[r1][c1] = g2;
    this.grid[r2][c2] = g1;
    g1.r = r2;
    g1.c = c2;
    g2.r = r1;
    g2.c = c1;
    const bomb = g1.special === "bomb" || g2.special === "bomb";
    yield { type: "swap", a: before.a, b: before.b, contactAt: SWAP_CONTACT_AT, bomb };
    if (g1.special === "disco" || g2.special === "disco") {
      yield* this.lineBlast(g1.special === "disco" ? g1 : g2, "all");
      return true;
    }
    if (bomb) {
      const b = g1.special === "bomb" ? g1 : g2;
      const other = g1.special === "bomb" ? g2 : g1;
      yield* this.detonate(b, other.res);
      return true;
    }
    if (g1.special === "line" || g2.special === "line") {
      yield* this.lineBlast(g1.special === "line" ? g1 : g2, r1 === r2 ? "row" : "col");
      return true;
    }
    if (!this.findGroups().length) {
      // the revert names where the stones ARE (swapped) so the same "a goes
      // to b's cell" tween slides them home
      const cur = { a: this.cellGem(g1), b: this.cellGem(g2) };
      this.grid[r1][c1] = g1;
      this.grid[r2][c2] = g2;
      g1.r = r1;
      g1.c = c1;
      g2.r = r2;
      g2.c = c2;
      yield { type: "revert", a: cur.a, b: cur.b, contactAt: SWAP_CONTACT_AT, bomb: false };
      return true;
    }
    yield* this.settle(0);
    return true;
  }

  *detonate(bomb: Gem, colorRes: ResKey): Resolution {
    const gains: Partial<Record<ResKey, number>> = {};
    const removed: CellGem[] = [];
    const cracked: ClearPhase["cracked"] = [];
    const fx: FxEvent[] = [];
    const rewards: RewardKind[] = [];
    bomb.dead = true;
    this.grid[bomb.r][bomb.c] = null;
    fx.push({ type: "boom", r: bomb.r, c: bomb.c });
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const g = this.grid[r][c];
        if (!g || g.res !== colorRes || g.block || g.special === "bomb") continue;
        if (g.hard > 0) {
          g.hard = (g.hard - 1) as 0 | 1 | 2;
          cracked.push({ r, c, kind: "frost", left: g.hard });
          fx.push({ type: "crack", r, c });
          if (this.paysScore) rewards.push("frost");
          continue;
        }
        if (g.tier > 0) {
          const paid = this.credit(g.res, g.tier, g.forged === true);
          if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
        }
        g.dead = true;
        this.grid[r][c] = null;
        removed.push({ r, c, id: g.id, res: g.res });
        fx.push({ type: "pop", r, c });
      }
    }
    const purged = removed.length;
    yield {
      type: "bombClear",
      chain: 1,
      removed,
      cracked,
      minted: [],
      fx,
      rewards,
      bonus: [],
      crosses: [],
      cleared: purged,
      pass: { cleared: {}, biggest: 0, shaped: false, chain: 1, purged },
      bombAt: { r: bomb.r, c: bomb.c },
      label: "COLOUR PURGE",
    };
    // the blast's own readout (score boards count it at depth 2)
    yield { type: "end", gains, label: "COLOUR PURGE", maxChain: 0 };
    const fall = this.gravity(2);
    yield { ...fall, type: "bombFall" };
    yield* this.settle(2);
    return true;
  }

  *settle(startCascade = 0): Resolution {
    const gains: Partial<Record<ResKey, number>> = {};
    let chain = startCascade;
    let maxChain = startCascade;
    for (;;) {
      const groups = this.findGroups();
      if (!groups.length) break;
      chain++;
      maxChain = Math.max(maxChain, chain);
      const phase = this.resolve(groups, gains, chain);
      yield phase;
      for (const x of phase.crosses) {
        if (this.paysScore) continue; // scored on the phase itself (rewards)
        const picks = x.kind === "broken" ? BROKEN_CROSS_PICKS : HOLY_CROSS_PICKS;
        const reason = x.kind === "broken" ? "BROKEN CROSS" : "HOLY CROSS";
        const chosen = (yield { type: "crossChoice", kind: x.kind, picks }) ?? [];
        const list = chosen.slice(0, picks);
        while (list.length < picks) list.push(this.choice(BASE_POOL));
        for (const res of list) {
          const paid = this.credit(res, 1, true);
          if (paid > 0) gains[res] = (gains[res] ?? 0) + paid;
        }
        const bonus = list.map((res) => ({ res, amount: 1, reason }));
        phase.bonus.push(...bonus);
        // The clear phase was already paid out before the chooser answered.
        yield { type: "crossBonus", bonus };
      }
      yield this.gravity(chain);
    }
    yield { type: "end", gains, label: maxChain > 1 ? `COMBO x${maxChain}` : "", maxChain };
    if (!this.hasMove()) {
      this.reshuffleGrid();
      yield { type: "shuffle" };
    }
    return true;
  }

  /** Drain a resolution with no pacing at all — the bot and the tests. */
  drain(gen: Resolution, onPhase?: (p: BoardPhase) => void): boolean {
    let input: ResKey[] | undefined;
    for (;;) {
      const step = gen.next(input);
      input = undefined;
      if (step.done) return step.value;
      onPhase?.(step.value);
    }
  }

  // ── obstacles ──────────────────────────────────────────────────────────
  /** L10 (#225): seeded, and never takes the board's last legal move. */
  seedObstacles(frost = 0, girders = 0, frostHard: 1 | 2 = 2): BoardObstacles {
    const cells = this.shuffle(this.gems().filter((g) => !g.block && !g.special && g.hard === 0));
    const placed: BoardObstacles = { frost: 0, girders: 0, frostHard };
    let i = 0;
    const next = (): Gem | null => {
      while (i < cells.length) {
        const g = cells[i++];
        if (!g.block && !g.special && g.hard === 0) return g;
      }
      return null;
    };
    while (placed.girders < girders) {
      const g = next();
      if (!g) break;
      g.block = true;
      if (this.hasMove()) placed.girders++;
      else g.block = false;
    }
    while (placed.frost < frost) {
      const g = next();
      if (!g) break;
      g.hard = frostHard;
      if (this.hasMove()) placed.frost++;
      else g.hard = 0;
    }
    return placed;
  }

  /** Thaw every frosted gem; returns how many were freed. */
  clearFrost(): number {
    let n = 0;
    for (const g of this.gems()) if (g.hard > 0) {
      g.hard = 0;
      n++;
    }
    return n;
  }

  /** Break every girder; returns how many were freed. */
  clearGirders(): number {
    let n = 0;
    for (const g of this.gems()) if (g.block) {
      g.block = false;
      n++;
    }
    return n;
  }

  obstacleCounts(): BoardObstacles {
    let frost = 0;
    let blocked = 0;
    let hard: 1 | 2 = 1;
    for (const g of this.gems()) {
      if (g.block) blocked++;
      else if (g.hard > 0) {
        frost++;
        hard = g.hard as 1 | 2;
      }
    }
    return { frost, girders: blocked, frostHard: hard };
  }

  // ── tokens ─────────────────────────────────────────────────────────────
  spawnTokens(pool: Partial<Record<ResKey, number>>): number {
    if (this.paysScore) return 0;
    let minted = 0;
    for (const res of Object.keys(pool) as ResKey[]) {
      const tier = pool[res] as 1 | 2 | undefined;
      if (!tier) continue;
      const eligible = this.gems().filter((g) => g.res === res && !g.block && !g.special && g.hard === 0 && g.tier < tier);
      if (!eligible.length) continue;
      const g = this.choice(eligible);
      g.tier = tier;
      g.forged = false;
      minted++;
    }
    return minted;
  }

  // ── wire ───────────────────────────────────────────────────────────────
  snapshot(): {
    grid: ({ id: number; res: ResKey; tier: number; special: Special; hard: number; block: boolean; forged: 0 | 1 } | null)[][];
    seq: number;
    pool: ResKey[];
    comboCount: number;
  } {
    return {
      grid: this.grid.map((row) =>
        row.map((g) =>
          g && { id: g.id, res: g.res, tier: g.tier, special: g.special, hard: g.hard, block: g.block, forged: g.forged ? 1 : 0 },
        ),
      ),
      seq: this.seq,
      pool: this.pool,
      comboCount: this.comboCount,
    };
  }

  restore(d: unknown): void {
    const data = d as { grid?: unknown[][]; seq?: number; pool?: ResKey[]; comboCount?: number } | null;
    if (!data?.grid) return;
    let maxId = 1;
    this.grid = data.grid.map((row, ri) =>
      row.map((cell, ci) => {
        if (!cell) return null;
        const c = cell as Partial<Gem> & { forged?: number | boolean };
        const id = typeof c.id === "number" && Number.isInteger(c.id) && c.id > 0 ? c.id : this.seq++;
        maxId = Math.max(maxId, id);
        return {
          id,
          res: c.res ?? "wood",
          tier: (c.tier ?? 0) as 0 | 1 | 2,
          special: c.special ?? null,
          hard: (c.hard ?? 0) as 0 | 1 | 2,
          block: !!c.block,
          forged: !!c.forged,
          r: ri,
          c: ci,
        } as Gem;
      }),
    );
    this.seq = Math.max(this.seq, maxId + 1, data.seq ?? 1);
    if (Array.isArray(data.pool) && data.pool.length) this.pool = [...data.pool];
    if (typeof data.comboCount === "number") this.comboCount = data.comboCount;
  }
}
