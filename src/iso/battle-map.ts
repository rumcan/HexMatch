// ══════════════════════════════════════════════════════════════════════════
// B5 (#250) / #322 — battles on the map: territorial fights and fight-offs.
//
// The map's economy is a race for industries (`industryLocks` is first-come
// to a serviced depot). This module is the BATTLE layer over that race:
//
//   • CHALLENGE — unlocked when a cargo is a monopoly (every industry of that
//     cargo held by one player) or every town is taken. Cost 12 Gold. One
//     2-minute player cooldown. Decline is a forfeit (the challenger wins).
//     First win shares the site; a second consecutive win by the same
//     challenger closes the loser's Depot / plant.
//   • FIGHT-OFF — when a Blockade or Protest lands on you and Security
//     Forces are not up, you may fight it off instead of eating it.
//   • COMEBACK — last plant closed waives eligibility and cooldown; sell
//     assets for Gold (cheapest first). Nothing left + can't afford 12 Gold
//     + no open plant → lose.
//
// Everything here is pure bookkeeping (clocks, maps, verdicts) — no DOM, no
// timers, no RNG. The game layer (`game.ts`) owns the gold, the screens and
// the economy pause; `src/iso/snapshot.ts` + `savegame-runtime.ts` carry the
// state (the host owns it in MP).
// ══════════════════════════════════════════════════════════════════════════
import {
  industryLocks, industriesInCatchment, isServiced, lockedIndustryIds,
  buildAllComponents, heldIndustries, harvesterYield, ownerIdOf,
  type EconomyState, type Harvester, type SiteRights, type TownHold,
} from "./economy";
import type { Industry } from "./grid";
import { BATTLE_SALE, INDUSTRY_BY_KEY, MAP_W, VICTORY, type BattleRules, type Cargo } from "./config";
import { BATTLE_SKILLS } from "./battle-ai";
import type { SkillKey } from "./skill";
import { PRESENT, type Track } from "./track";

/** The cooldown/counter bookkeeping of a map's battle layer. */
export interface ChallengeState {
  /** `${playerId}:${industryId}` → leftover from B5; unused under #322. */
  readyAt: Map<string, number>;
  /** `${playerId}` → the moment that player may fight again (any target). */
  playerReadyAt: Map<string, number>;
  /** The rival's own challenge clock (skill-paced). */
  rivalReadyAt: number;
  /** How many battles this game has seen (the playtest note's count). */
  battles: number;
}

export const createChallengeState = (): ChallengeState => ({
  readyAt: new Map(),
  playerReadyAt: new Map(),
  rivalReadyAt: 0,
  battles: 0,
});

export type ChallengeRefusal =
  | "not-eligible" | "held-by-you" | "gold" | "cooldown" | "busy"
  // B5 aliases kept so older callers/tests still type-check.
  | "not-contested" | "industry-cooldown";

export type ChallengeCheck =
  | { ok: true; holder: Harvester | null; mine: Harvester | null; industry: Industry; cargo: Cargo }
  | { ok: false; reason: ChallengeRefusal };

export type TownChallengeCheck =
  | { ok: true; townId: number }
  | { ok: false; reason: ChallengeRefusal };

const pairKey = (playerId: string, indId: number) => `${playerId}:${indId}`;

/** Last open plant closed → eligibility and cooldown are waived. A seat that
 *  never planted is not in comeback — they still have to unlock fights. */
export function isComeback(eco: EconomyState, playerId: string): boolean {
  const mine = eco.factories.filter((f) => f.owner === playerId);
  return mine.length > 0 && mine.every((f) => f.closed);
}

/** Does this seat have at least one open plant? */
export function hasOpenPlant(eco: EconomyState, playerId: string): boolean {
  return eco.factories.some((f) => f.owner === playerId && !f.closed);
}

/**
 * Cargo monopolies: every industry of that cargo is held by the same player
 * (closed depots do not hold). Empty when nothing is locked.
 */
export function monopolizedCargos(eco: EconomyState): Map<Cargo, string> {
  const locks = industryLocks(eco);
  const byCargo = new Map<Cargo, { owner: string | null; total: number; held: number }>();
  for (const ind of eco.grid.industries) {
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const rec = byCargo.get(def.cargo) ?? { owner: null, total: 0, held: 0 };
    rec.total++;
    const holder = locks.get(ind.id);
    if (holder) {
      rec.held++;
      rec.owner = rec.owner === null || rec.owner === holder.owner ? holder.owner : "";
    } else {
      rec.owner = "";
    }
    byCargo.set(def.cargo, rec);
  }
  const out = new Map<Cargo, string>();
  for (const [cargo, rec] of byCargo) {
    if (rec.total > 0 && rec.held === rec.total && rec.owner) out.set(cargo, rec.owner);
  }
  return out;
}

/** True once every town has at least one open plant beside it. */
export function allTownsTaken(eco: EconomyState): boolean {
  if (eco.grid.towns.length === 0) return false;
  const taken = new Set<number>();
  for (const f of eco.factories) {
    if (f.closed || f.townId == null) continue;
    taken.add(f.townId);
  }
  return taken.size >= eco.grid.towns.length;
}

export function cargoOfIndustry(eco: EconomyState, industryId: number): Cargo | null {
  const ind = eco.grid.industries[industryId];
  if (!ind) return null;
  return INDUSTRY_BY_KEY[ind.type]?.cargo ?? null;
}

/**
 * May `playerId` challenge `industryId` right now? Unlocked when the cargo is
 * a monopoly (or every town is taken, or this seat is in comeback). The
 * challenger does not need their own depot on the site — a first win is what
 * lets them build one.
 */
export function canChallenge(
  eco: EconomyState,
  s: ChallengeState,
  now: number,
  playerId: string,
  industryId: number,
  rules: BattleRules,
  gold: number,
): ChallengeCheck {
  const industry = eco.grid.industries[industryId];
  if (!industry) return { ok: false, reason: "not-eligible" };
  const cargo = INDUSTRY_BY_KEY[industry.type]?.cargo;
  if (!cargo) return { ok: false, reason: "not-eligible" };

  const locks = industryLocks(eco);
  const holder = locks.get(industryId) ?? null;
  // A platform-Depot serves `railIndustryId`, not the 2×2 at its origin — the
  // same catchment the economy pays. A closed platform reopens like a Depot.
  const mine = eco.harvesters.find((h) =>
    h.owner === playerId && industriesInCatchment(eco.grid, h).some((e) => e.id === industryId),
  ) ?? null;

  const rights = eco.siteRights?.get(industryId);
  const exclusiveMine = holder?.owner === playerId && !rights?.rights.some((id) => id !== playerId);
  // Reopening your own closed depot is always a challenge against the holder
  // (or an empty site), never "held-by-you".
  if (exclusiveMine && !mine?.closed) return { ok: false, reason: "held-by-you" };

  const comeback = isComeback(eco, playerId);
  if (!comeback) {
    const monos = monopolizedCargos(eco);
    const monopoly = monos.get(cargo);
    if (!monopoly && !allTownsTaken(eco)) return { ok: false, reason: "not-eligible" };
    // Monopoly-cargo industries only — unless every town is taken, in which
    // case any industry (and any town) is in play.
    if (monopoly && monopoly === playerId && !mine?.closed && !allTownsTaken(eco)) {
      return { ok: false, reason: "held-by-you" };
    }
    if (!monopoly && !allTownsTaken(eco)) return { ok: false, reason: "not-eligible" };
    if (monopoly && monopoly !== playerId && !allTownsTaken(eco) && !mine?.closed) {
      // Challenging a monopoly-cargo industry the opponent holds — ok.
    } else if (!monopoly && allTownsTaken(eco)) {
      // Towns-taken unlocks industry fights too.
    } else if (mine?.closed) {
      // Reopen is always eligible once fights are on.
    }
  }

  if (gold < rules.challengeGold) return { ok: false, reason: "gold" };
  if (!comeback && (s.playerReadyAt.get(playerId) ?? 0) > now) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true, holder, mine, industry, cargo };
}

/**
 * May `playerId` challenge `townId`? Towns unlock once every town is taken
 * (or the seat is in comeback). You cannot challenge a town you already
 * exclusively hold with an open plant.
 */
export function canChallengeTown(
  eco: EconomyState,
  s: ChallengeState,
  now: number,
  playerId: string,
  townId: number,
  rules: BattleRules,
  gold: number,
): TownChallengeCheck {
  const town = eco.grid.towns[townId];
  if (!town) return { ok: false, reason: "not-eligible" };
  const comeback = isComeback(eco, playerId);
  if (!comeback && !allTownsTaken(eco)) return { ok: false, reason: "not-eligible" };

  const hold = eco.townHolds?.get(townId);
  const myOpen = eco.factories.some((f) => f.owner === playerId && !f.closed && f.townId === townId);
  const theirOpen = eco.factories.some((f) => f.owner !== playerId && !f.closed && f.townId === townId);
  if (myOpen && !theirOpen && hold?.holder === playerId && hold.wins >= 2) {
    return { ok: false, reason: "held-by-you" };
  }
  if (myOpen && !theirOpen && !hold) return { ok: false, reason: "held-by-you" };

  if (gold < rules.challengeGold) return { ok: false, reason: "gold" };
  if (!comeback && (s.playerReadyAt.get(playerId) ?? 0) > now) {
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true, townId };
}

const idOf = (eco: EconomyState, playerId: string): number =>
  eco.harvesters.find((h) => h.owner === playerId)?.ownerId
  ?? eco.factories.find((f) => f.owner === playerId)?.ownerId
  ?? -1;
void idOf;
void pairKey;
void lockedIndustryIds;
void isServiced;

/** Arm the player cooldown and count the fight. Called when a battle OPENS. */
// ── B7 (#252): legibility — what the map shows about battles ───────────────

/**
 * Industries someone has won a battle over: id → the standing winner (the
 * `siteRights` streak holder, who must still have rights there). The same
 * reading `victory.ts` pays Hold ★ from, so a ⚔ on the map is exactly a site
 * paying (or able to pay) ★.
 */
export function contestedIndustries(eco: EconomyState): Map<number, string> {
  const out = new Map<number, string>();
  for (const [id, rec] of eco.siteRights ?? new Map()) {
    const who = rec.streak?.playerId;
    if (who && rec.rights.includes(who)) out.set(id, who);
  }
  return out;
}

/** Towns someone has won a battle over: id → the standing holder. */
export function contestedTowns(eco: EconomyState): Map<number, string> {
  const out = new Map<number, string>();
  for (const [id, hold] of eco.townHolds ?? new Map()) if (hold.holder) out.set(id, hold.holder);
  return out;
}

/** ms until `playerId` may call another fight (0 = ready now). */
export function battleCooldownLeft(s: ChallengeState, now: number, playerId: string): number {
  return Math.max(0, (s.playerReadyAt.get(playerId) ?? 0) - now);
}

/** "1:05" — the map's challenge-clock format (whole seconds, rounded up). */
export function fmtBattleCooldown(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function markChallenge(
  s: ChallengeState, now: number, playerId: string, _industryId: number, rules: BattleRules,
): void {
  s.playerReadyAt.set(playerId, now + rules.challengePlayerCooldownMs);
  s.battles++;
}

export type IndustryWinKind = "rights" | "closed" | "reopened" | "held";

/**
 * Apply an industry fight's winner. First win by a new challenger shares the
 * site (`siteRights`); a second consecutive win by the same challenger closes
 * the loser's Depot. The owner reopening their closed Depot clears `closed`.
 */
export function grantIndustryWin(
  eco: EconomyState,
  industryId: number,
  winnerId: string,
  loserId: string | null,
): IndustryWinKind {
  if (!eco.siteRights) eco.siteRights = new Map();
  const prev = eco.siteRights.get(industryId);
  // #400: a platform is a Depot for the contest too — a second win closes it,
  // a reopen clears it. `industriesInCatchment` is the one read that sees a
  // platform's anchor as well as a truck lot's edge.
  const winnerDepot = eco.harvesters.find((h) =>
    h.owner === winnerId && industriesInCatchment(eco.grid, h).some((e) => e.id === industryId),
  );
  const loserDepot = loserId
    ? eco.harvesters.find((h) =>
      h.owner === loserId && industriesInCatchment(eco.grid, h).some((e) => e.id === industryId),
    )
    : undefined;

  if (winnerDepot?.closed) {
    winnerDepot.closed = false;
    const rights = new Set(prev?.rights ?? []);
    rights.add(winnerId);
    if (loserId) rights.add(loserId);
    eco.siteRights.set(industryId, {
      rights: [...rights],
      streak: { playerId: winnerId, wins: 1 },
    });
    if (!eco.battleLocks) eco.battleLocks = new Map();
    eco.battleLocks.set(industryId, winnerDepot.id);
    return "reopened";
  }

  const streak = prev?.streak?.playerId === winnerId ? prev.streak.wins + 1 : 1;
  const rights = new Set(prev?.rights ?? []);
  rights.add(winnerId);
  if (loserId) rights.add(loserId);

  if (streak >= 2 && loserDepot && !loserDepot.closed) {
    loserDepot.closed = true;
    rights.delete(loserId!);
    eco.siteRights.set(industryId, {
      rights: [...rights],
      streak: { playerId: winnerId, wins: streak },
    });
    if (winnerDepot) {
      if (!eco.battleLocks) eco.battleLocks = new Map();
      eco.battleLocks.set(industryId, winnerDepot.id);
    }
    return "closed";
  }

  eco.siteRights.set(industryId, {
    rights: [...rights],
    streak: { playerId: winnerId, wins: streak },
  });
  if (winnerDepot) {
    if (!eco.battleLocks) eco.battleLocks = new Map();
    eco.battleLocks.set(industryId, winnerDepot.id);
  }
  return streak === 1 && loserId ? "rights" : "held";
}

export type TownWinKind = "shared" | "closed" | "reopened" | "held";

/**
 * Apply a town fight's winner. First win: both may operate, city upgrades
 * lock, winner may plant. Second consecutive: loser's plant at that town
 * closes. Returns what changed so the caller can debit city ★ / reopen.
 */
export function grantTownWin(
  eco: EconomyState,
  townId: number,
  winnerId: string,
  loserId: string | null,
): TownWinKind {
  if (!eco.townHolds) eco.townHolds = new Map();
  const prev = eco.townHolds.get(townId);
  const winnerPlant = eco.factories.find((f) => f.owner === winnerId && f.townId === townId);
  const loserPlant = loserId
    ? eco.factories.find((f) => f.owner === loserId && f.townId === townId)
    : undefined;

  if (winnerPlant?.closed) {
    winnerPlant.closed = false;
    eco.townHolds.set(townId, { holder: winnerId, wins: 1, locked: true });
    return "reopened";
  }

  const streak = prev?.holder === winnerId ? prev.wins + 1 : 1;
  if (streak >= 2 && loserPlant && !loserPlant.closed) {
    loserPlant.closed = true;
    eco.townHolds.set(townId, { holder: winnerId, wins: streak, locked: true });
    return "closed";
  }
  eco.townHolds.set(townId, { holder: winnerId, wins: streak, locked: true });
  return streak === 1 && loserId ? "shared" : "held";
}

/** Unlock city upgrades after the holder re-wins a locked town. */
export function unlockTownHold(eco: EconomyState, townId: number): void {
  const hold = eco.townHolds?.get(townId);
  if (hold) hold.locked = false;
}

/**
 * The verdict: the WINNER's depot holds the industry. Kept for B5 callers;
 * #322 prefers `grantIndustryWin` (player ids, shared rights, closed).
 */
export function applyBattleResult(
  eco: EconomyState, industryId: number, winnerHarvesterId: number | null,
): void {
  if (winnerHarvesterId === null) return;
  if (!eco.battleLocks) eco.battleLocks = new Map();
  eco.battleLocks.set(industryId, winnerHarvesterId);
}

/**
 * Decline is a forfeit: the challenger wins the fight. The CALLER still
 * counts it (`markChallenge`) — this only decides the map.
 */
export function declineTakesPrize(
  eco: EconomyState,
  industryId: number,
  challengerId: string,
  loserId: string | null,
): IndustryWinKind {
  return grantIndustryWin(eco, industryId, challengerId, loserId);
}

/**
 * What a live map battle is FOR — the stake its verdict settles. Settling is
 * pure (`settleMapBattle`) so the rule reads the same in tests and in the
 * game's on-close hook.
 */
export type MapBattleStake =
  | {
    kind: "industry";
    industryId: number;
    /** Who called the fight — the seat `settleMapBattle`'s `won` speaks for. */
    challengerId: string;
    challengerHarvesterId: number | null;
    holderHarvesterId: number | null;
    holderId?: string | null;
  }
  | {
    kind: "town";
    townId: number;
    challengerId: string;
    holderId?: string | null;
  }
  | { kind: "fightoff"; pending: PendingFightOff };

/**
 * Settle a finished map battle. `won` is from the CHALLENGER's / DEFENDER's
 * seat (fight-offs: the player who was offered the fight):
 *   industry  — win: grantIndustryWin for the challenger; lose: for the holder;
 *               draw: unchanged. Decline is a forfeit (won=true for challenger).
 *   town      — same shape against townHolds.
 *   fightoff  — win: the sabotage is cancelled; lose/decline: it lands as bought.
 */
export function settleMapBattle(
  eco: EconomyState,
  stake: MapBattleStake,
  won: boolean | null,
): "conquest" | "held" | "draw" | "cancelled" | "lands" | "rights" | "closed" | "reopened" | "shared" {
  if (stake.kind === "industry") {
    if (won === null) return "draw";
    const winnerId = won ? stake.challengerId : (stake.holderId ?? ownerOfHarvester(eco, stake.holderHarvesterId));
    const loserId = won ? (stake.holderId ?? ownerOfHarvester(eco, stake.holderHarvesterId)) : stake.challengerId;
    if (!winnerId) return "draw";
    const kind = grantIndustryWin(eco, stake.industryId, winnerId, loserId);
    if (kind === "rights") return "rights";
    if (kind === "closed") return "closed";
    if (kind === "reopened") return "reopened";
    return won ? "conquest" : "held";
  }
  if (stake.kind === "town") {
    if (won === null) return "draw";
    const winnerId = won ? stake.challengerId : (stake.holderId ?? null);
    const loserId = won ? (stake.holderId ?? null) : stake.challengerId;
    if (!winnerId) return "draw";
    const kind = grantTownWin(eco, stake.townId, winnerId, loserId);
    if (kind === "shared") return "shared";
    if (kind === "closed") return "closed";
    if (kind === "reopened") return "reopened";
    return won ? "conquest" : "held";
  }
  const lands = resolveFightOff(won === true ? true : false);
  return lands ? "lands" : "cancelled";
}

function ownerOfHarvester(eco: EconomyState, id: number | null | undefined): string | null {
  if (id == null || id < 0) return null;
  return eco.harvesters.find((h) => h.id === id)?.owner ?? null;
}

// ── fight-offs (Blockade / Protest) ─────────────────────────────────────────

export type SabotageKind = "blockade" | "protest";

/** A bought, spent sabotage held at the door — fight it off or eat it. */
export interface PendingFightOff {
  kind: SabotageKind;
  /** Who bought it (their Gold is already spent — the hire rule). */
  attackerId: string;
  /** Blockade: the industry it would hit. */
  industryId?: number;
  /** Protest: the tile the crowd would sit on. */
  tile?: number;
  /** When it would expire once applied. */
  until: number;
  /** The offer itself expires (auto-decline) this long after it was made. */
  offerUntil: number;
}

/**
 * The fight's verdict for the DEFENDER: win and the sabotage never lands
 * (attacker's Gold stays spent); lose (or decline — `win = false`) and it
 * lands exactly as bought. Returns whether it lands.
 */
export const resolveFightOff = (win: boolean): boolean => !win;

// ── the rival's own pace ────────────────────────────────────────────────────

/** May the rival CALL a challenge now? (Its skill armed the clock —
 *  `markRivalChallenge` — with `BATTLE_SKILLS[].challengeEveryMs`.) */
export function rivalChallengeDue(s: ChallengeState, now: number): boolean {
  return now >= s.rivalReadyAt;
}

/** The rival called one: arm its skill-pacing clock (the fight is counted by
 *  `markChallenge` — the same one-count rule every caller keeps). */
export function markRivalChallenge(s: ChallengeState, now: number, skill: SkillKey): void {
  s.rivalReadyAt = now + BATTLE_SKILLS[skill].challengeEveryMs;
}

// ── rival targeting (#322) ──────────────────────────────────────────────────

export type ChallengeTarget =
  | { kind: "industry"; id: number }
  | { kind: "town"; id: number };

/**
 * The rival's challenge target, in ticket order:
 *   1. own closed depot's industry
 *   2. player-held monopoly-cargo industry
 *   3. player's town
 *
 * Returns null when nothing is unlocked / affordable / off cooldown.
 */
export function pickRivalChallengeTarget(
  eco: EconomyState,
  s: ChallengeState,
  now: number,
  rivalId: string,
  playerId: string,
  rules: BattleRules,
  gold: number,
): ChallengeTarget | null {
  const tryIndustry = (id: number): ChallengeTarget | null => {
    const chk = canChallenge(eco, s, now, rivalId, id, rules, gold);
    return chk.ok ? { kind: "industry", id } : null;
  };
  const tryTown = (id: number): ChallengeTarget | null => {
    const chk = canChallengeTown(eco, s, now, rivalId, id, rules, gold);
    return chk.ok ? { kind: "town", id } : null;
  };

  for (const h of eco.harvesters) {
    if (h.owner !== rivalId || !h.closed) continue;
    for (const industry of industriesInCatchment(eco.grid, h)) {
      const hit = tryIndustry(industry.id);
      if (hit) return hit;
    }
  }

  const monos = monopolizedCargos(eco);
  for (const [cargo, who] of monos) {
    if (who !== playerId) continue;
    for (const ind of eco.grid.industries) {
      if (INDUSTRY_BY_KEY[ind.type]?.cargo !== cargo) continue;
      const hit = tryIndustry(ind.id);
      if (hit) return hit;
    }
  }

  if (allTownsTaken(eco) || isComeback(eco, rivalId)) {
    for (const f of eco.factories) {
      if (f.owner !== playerId || f.closed || f.townId == null) continue;
      const hit = tryTown(f.townId);
      if (hit) return hit;
    }
  }
  return null;
}

// ── comeback sales (#322) ───────────────────────────────────────────────────

export type SaleKind = "pave" | "depot" | "city" | "plant";

export interface SaleOption {
  kind: SaleKind;
  gold: number;
  /** Depot / plant id when the sale names one. */
  id?: number;
}

/**
 * Cheapest-first list of what `owner` can sell for Gold. Pave needs at least
 * `BATTLE_SALE.pavedTiles` of the seat's own paved tiles.
 */
export function listSales(
  eco: EconomyState,
  owner: string,
  pavedCount: number,
  townLevel: number,
): SaleOption[] {
  const out: SaleOption[] = [];
  if (pavedCount >= BATTLE_SALE.pavedTiles) {
    out.push({ kind: "pave", gold: BATTLE_SALE.pavedGold });
  }
  for (const h of eco.harvesters) {
    if (h.owner === owner && !h.closed) out.push({ kind: "depot", gold: BATTLE_SALE.depot, id: h.id });
  }
  if (townLevel > 0) out.push({ kind: "city", gold: BATTLE_SALE.city });
  for (const f of eco.factories) {
    if (f.owner === owner && !f.closed) out.push({ kind: "plant", gold: BATTLE_SALE.plant, id: f.id ?? 0 });
  }
  const rank: Record<SaleKind, number> = { pave: 0, depot: 1, city: 2, plant: 3 };
  out.sort((a, b) => a.gold - b.gold || rank[a.kind] - rank[b.kind]);
  return out;
}

export function cheapestSale(
  eco: EconomyState,
  owner: string,
  pavedCount: number,
  townLevel: number,
): SaleOption | null {
  return listSales(eco, owner, pavedCount, townLevel)[0] ?? null;
}

/**
 * Apply one sale. Returns Gold gained, or 0 if the option is gone.
 *   pave  — strip `BATTLE_SALE.pavedTiles` of the seat's paved tiles back to dirt.
 *   depot — remove the Depot (the lot stays empty).
 *   city  — the CALLER decrements `townLevel`; this is a no-op on eco.
 *   plant — close (then remove) the named plant.
 */
export function applySale(
  eco: EconomyState,
  owner: string,
  sale: SaleOption,
  track?: Track,
  ownerId?: number,
): number {
  if (sale.kind === "pave") {
    if (!track || ownerId == null) return 0;
    let n = 0;
    for (let i = 0; i < track.road.length && n < BATTLE_SALE.pavedTiles; i++) {
      if (track.owner[i] !== ownerId) continue;
      if ((track.road[i] & PRESENT) === 0) continue;
      track.road[i] = 0;
      track.dirt[i] = PRESENT;
      n++;
    }
    return n >= BATTLE_SALE.pavedTiles ? BATTLE_SALE.pavedGold : 0;
  }
  if (sale.kind === "depot") {
    const i = eco.harvesters.findIndex((h) => h.owner === owner && h.id === sale.id && !h.closed);
    if (i < 0) return 0;
    eco.harvesters.splice(i, 1);
    return BATTLE_SALE.depot;
  }
  if (sale.kind === "city") {
    return BATTLE_SALE.city;
  }
  if (sale.kind === "plant") {
    const i = eco.factories.findIndex((f) => f.owner === owner && (f.id ?? 0) === (sale.id ?? 0) && !f.closed);
    if (i < 0) return 0;
    eco.factories.splice(i, 1);
    return BATTLE_SALE.plant;
  }
  return 0;
}

export type { SiteRights, TownHold };

/** One-line reason the Challenge button is disabled. */
export function challengeRefusalText(reason: ChallengeRefusal, goldNeed = 12): string {
  switch (reason) {
    case "gold": return `A challenge costs ${goldNeed} Gold.`;
    case "cooldown": return "Challenge cooling down.";
    case "held-by-you": return "You already hold this.";
    case "busy": return "A fight is already on.";
    case "industry-cooldown":
    case "not-contested":
    case "not-eligible":
    default: return "Challenges unlock when a cargo is a monopoly, or every town is taken.";
  }
}

// ── BATTLE-1 (#468) — the stakes card: the live numbers a duel is for ────────
//
// Before a duel the player sees WHAT the fight moves: the site, who holds it,
// the ★ and the income riding on it, the Gold the fight costs, the difficulty
// of the seat across the board. Everything here is a PURE READ of the live
// economy — no clocks, no DOM — so the card can never promise a number the
// settle will not pay (the same honesty rule the depot readout keeps).
//
// `siteIncome` reuses the clock's own maths (`harvesterYield` over the owner's
// components), so "income/min here" is exactly what `economyTick` pays, per
// minute, at the moment the card is opened.

/** The economy's harvest beat (`HARVEST_MS` in game.ts) — income/min divides by it. */
export const BATTLE_TICK_MS = 3000;

export interface SiteIncome {
  /** Whole units per minute the owner draws at this site right now. */
  perMin: number;
  /** The cargo that income pays in (industries); null for a town's mix. */
  cargo: Cargo | null;
}

/** Per-tick income one owner draws AT an industry (its holder's depot(s)). */
function industryTick(eco: EconomyState, industryId: number, owner: string, now: number): number {
  const ind = eco.grid.industries[industryId];
  const def = ind ? INDUSTRY_BY_KEY[ind.type] : undefined;
  if (!ind || !def) return 0;
  const ownerId = ownerIdOf(eco, owner);
  if (ownerId === 0) return 0;
  const locks = industryLocks(eco);
  const comp = buildAllComponents(eco.track, ownerId);
  let acc = 0;
  for (const h of eco.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(eco, comp, locks, h, now);
    if (!y.serviced || y.connection.kind === null) continue;
    for (const held of heldIndustries(eco, h, locks)) {
      if (held.id !== industryId) continue;
      acc += (held.output ?? def.output) * y.connection.multiplier;
    }
  }
  return acc;
}

/** Per-tick income one owner draws THROUGH a town (its open plant's depots). */
function townTick(eco: EconomyState, townId: number, owner: string, now: number): number {
  const plants = eco.factories.filter((f) => f.owner === owner && !f.closed && f.townId === townId);
  if (!plants.length) return 0;
  const ownerId = ownerIdOf(eco, owner);
  if (ownerId === 0) return 0;
  const locks = industryLocks(eco);
  const comp = buildAllComponents(eco.track, ownerId);
  let acc = 0;
  for (const h of eco.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(eco, comp, locks, h, now);
    if (!y.serviced || y.connection.kind === null) continue;
    const via = y.connection.factory;
    if (!via || !plants.some((f) => (f.id ?? 0) === (via.id ?? 0))) continue;
    for (const v of Object.values(y.yields)) acc += v ?? 0;
  }
  return acc;
}

/**
 * Per-minute income `owner` draws at/through a contested site right now — the
 * same yields `harvesterYield` pays the clock, scaled to a minute. A blockaded
 * industry, a cut road or a closed plant reads as 0, never as a promise.
 */
export function siteIncome(
  eco: EconomyState,
  site: { kind: "industry"; industryId: number } | { kind: "town"; townId: number },
  owner: string,
  tickMs: number = BATTLE_TICK_MS,
  now = 0,
): SiteIncome {
  const perTick = site.kind === "industry"
    ? industryTick(eco, site.industryId, owner, now)
    : townTick(eco, site.townId, owner, now);
  return {
    perMin: Math.round((perTick * 60_000) / Math.max(1, tickMs)),
    cargo: site.kind === "industry"
      ? INDUSTRY_BY_KEY[eco.grid.industries[site.industryId]?.type ?? ""]?.cargo ?? null
      : null,
  };
}

/** What the stakes card prints, all read live off the economy. */
export interface BattleStakeFacts {
  kind: "industry" | "town";
  /** The site's display name ("Farm", "Town 2"). */
  site: string;
  /** Who holds it now ("You", a rival's name, or "Unclaimed"). */
  holder: string;
  /** Hold ★ the standing winner is paid while they hold it (the live ★ table). */
  holdStars: number;
  /** The per-seat cap on that ★ — the card says "cap N★" so the number is honest. */
  holdCap: number;
  /** City ★ one closed plant gives up per tier (towns only; 0 for industries). */
  cityStarsPerTier: number;
  /** Income/min the holder draws at (industries) or through (towns) the site. */
  holderIncomePerMin: number;
  /** The cargo that income pays in, when it is one cargo. */
  holderIncomeCargo: Cargo | null;
}

/**
 * Read a stake's live facts for the stakes card. Null for fight-offs (they
 * are not fights OVER a site — their offer card says what lands) and for a
 * site id the map does not have.
 */
export function battleStakeFacts(
  eco: EconomyState,
  stake: MapBattleStake,
  opts: {
    /** Player id → display name ("You" / the rival's name / "Unclaimed"). */
    nameOf: (playerId: string | null | undefined) => string;
    tickMs?: number;
    now?: number;
  },
): BattleStakeFacts | null {
  if (stake.kind === "fightoff") return null;
  const tickMs = opts.tickMs ?? BATTLE_TICK_MS;
  const now = opts.now ?? 0;
  if (stake.kind === "industry") {
    const ind = eco.grid.industries[stake.industryId];
    const def = ind ? INDUSTRY_BY_KEY[ind.type] : undefined;
    if (!ind || !def) return null;
    const holderId = industryLocks(eco).get(stake.industryId)?.owner ?? null;
    const inc = holderId
      ? siteIncome(eco, { kind: "industry", industryId: stake.industryId }, holderId, tickMs, now)
      : { perMin: 0, cargo: def.cargo as Cargo | null };
    return {
      kind: "industry",
      site: def.name,
      holder: holderId ? opts.nameOf(holderId) : "Unclaimed",
      holdStars: VICTORY.loop.hold,
      holdCap: VICTORY.loop.holdCap,
      cityStarsPerTier: 0,
      holderIncomePerMin: inc.perMin,
      holderIncomeCargo: inc.cargo,
    };
  }
  const townId = stake.townId;
  // The same read the town card prints: an open plant beside the town is the
  // holder; a town's battle hold is the fallback; else unclaimed.
  const owners = [...new Set(eco.factories
    .filter((f) => !f.closed && f.townId === townId)
    .map((f) => f.owner))];
  const hold = eco.townHolds?.get(townId);
  let perMin = 0;
  for (const o of owners) perMin += siteIncome(eco, { kind: "town", townId }, o, tickMs, now).perMin;
  return {
    kind: "town",
    site: `Town ${townId + 1}`,
    holder: owners.length
      ? owners.map((o) => opts.nameOf(o)).join(" & ")
      : hold ? opts.nameOf(hold.holder) : "Unclaimed",
    holdStars: VICTORY.loop.hold,
    holdCap: VICTORY.loop.holdCap,
    cityStarsPerTier: VICTORY.loop.city,
    holderIncomePerMin: perMin,
    holderIncomeCargo: null,
  };
}

/**
 * Where a stake's aftermath plays on the map: the site's centre tile, or null
 * when the stake has no place to fly to (a protest with no tile, say).
 */
export function stakeSiteTile(
  eco: EconomyState, stake: MapBattleStake,
): { tx: number; ty: number } | null {
  const centre = (i: Industry | undefined) =>
    i ? { tx: i.tx + Math.floor(i.w / 2), ty: i.ty + Math.floor(i.h / 2) } : null;
  if (stake.kind === "industry") return centre(eco.grid.industries[stake.industryId]);
  if (stake.kind === "town") {
    const t = eco.grid.towns[stake.townId];
    return t ? { tx: t.tx, ty: t.ty } : null;
  }
  if (stake.pending.industryId !== undefined) return centre(eco.grid.industries[stake.pending.industryId]);
  if (stake.pending.tile !== undefined) {
    return { tx: stake.pending.tile % MAP_W, ty: Math.floor(stake.pending.tile / MAP_W) };
  }
  return null;
}
