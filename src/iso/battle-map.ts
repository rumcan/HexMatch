// ══════════════════════════════════════════════════════════════════════════
// B5 (#250) — battles on the map: contested industries and fight-offs.
//
// The map's economy is a race for industries (`industryLocks` is first-come
// to a serviced depot). This module is the BATTLE layer over that race:
//
//   • CHALLENGE — a player whose depot also covers an opponent-held industry
//     may call a fight for it (Gold bill + cooldowns in `BATTLE_RULES`). The
//     winner's depot draws from the industry afterwards — a conquest that
//     stands until the next successful challenge (documented decision: a
//     conquest has no timed expiry; the cooldowns pace the fights).
//   • DECLINE — the defender may refuse the fight: the challenger takes the
//     prize and pays `declineGold` on top for the privilege.
//   • FIGHT-OFF — when a Blockade or Protest lands on you and Security
//     Forces are not up, you may fight it off instead of eating it. Win and
//     the sabotage never lands (the attacker's Gold stays spent — the hire
//     is paid at purchase, win or lose); lose or decline and it lands as
//     bought. Security Forces still turn sabotage away without any battle.
//   • PACE — per-player and per-industry cooldowns plus the rival's own
//     challenge clock (`BATTLE_SKILLS[].challengeEveryMs`, by skill) keep a
//     whole game's battle count sensible (the playtest note's count lives in
//     `ChallengeState.battles`).
//
// Everything here is pure bookkeeping (clocks, maps, verdicts) — no DOM, no
// timers, no RNG. The game layer (`game.ts`) owns the gold, the screens and
// the economy pause; `src/iso/snapshot.ts` + `savegame-runtime.ts` carry the
// state (the host owns it in MP).
// ══════════════════════════════════════════════════════════════════════════
import { industryLocks, isServiced, type EconomyState, type Harvester } from "./economy";
import type { Industry } from "./grid";
import { industriesTouchingDepot } from "./depot";
import type { BattleRules } from "./config";
import { BATTLE_SKILLS } from "./battle-ai";
import type { SkillKey } from "./skill";

/** The cooldown/counter bookkeeping of a map's battle layer. */
export interface ChallengeState {
  /** `${playerId}:${industryId}` → the moment that pair may fight again. */
  readyAt: Map<string, number>;
  /** `${playerId}` → the moment that player may fight again (any industry). */
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
  | "not-contested" | "held-by-you" | "gold" | "cooldown" | "industry-cooldown";

export type ChallengeCheck =
  | { ok: true; holder: Harvester; mine: Harvester; industry: Industry }
  | { ok: false; reason: ChallengeRefusal };

const pairKey = (playerId: string, indId: number) => `${playerId}:${indId}`;

/**
 * May `playerId` challenge `industryId` right now? Contested means: the
 * industry is held by someone else AND one of the challenger's OWN serviced
 * depots reaches it (the same reach `heldIndustries` pays by).
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
  const locks = industryLocks(eco);
  const holder = locks.get(industryId);
  const industry = eco.grid.industries[industryId];
  if (!holder || !industry) return { ok: false, reason: "not-contested" };
  if (holder.owner === playerId || holder.ownerId === idOf(eco, playerId))
    return { ok: false, reason: "held-by-you" };
  const mine = eco.harvesters.find((h) =>
    h.owner === playerId
    && isServiced(eco.track, h, eco.rail)
    && industriesTouchingDepot(eco.grid, h.tx, h.ty).some((e) => e.industry.id === industryId));
  if (!mine) return { ok: false, reason: "not-contested" };
  if (gold < rules.challengeGold) return { ok: false, reason: "gold" };
  if ((s.playerReadyAt.get(playerId) ?? 0) > now) return { ok: false, reason: "cooldown" };
  if ((s.readyAt.get(pairKey(playerId, industryId)) ?? 0) > now)
    return { ok: false, reason: "industry-cooldown" };
  return { ok: true, holder, mine, industry };
}

const idOf = (eco: EconomyState, playerId: string): number =>
  eco.harvesters.find((h) => h.owner === playerId)?.ownerId ?? -1;

/** Arm the cooldowns and count the fight. Called when a battle OPENS. */
export function markChallenge(
  s: ChallengeState, now: number, playerId: string, industryId: number, rules: BattleRules,
): void {
  s.readyAt.set(pairKey(playerId, industryId), now + rules.challengeIndustryCooldownMs);
  s.playerReadyAt.set(playerId, now + rules.challengePlayerCooldownMs);
  s.battles++;
}

/**
 * The verdict: the WINNER's depot holds the industry — a conquest on the
 * economy's `battleLocks` map (industryLocks reads it over first-come),
 * standing until the next successful challenge. A draw changes nothing.
 */
export function applyBattleResult(
  eco: EconomyState, industryId: number, winnerHarvesterId: number | null,
): void {
  if (winnerHarvesterId === null) return;
  if (!eco.battleLocks) eco.battleLocks = new Map();
  eco.battleLocks.set(industryId, winnerHarvesterId);
}

/**
 * Decline the challenge: the challenger takes the prize and pays
 * `rules.declineGold` on top (the cost of a fight nobody had). The CALLER
 * charges that Gold and counts the fight (`markChallenge`) — this only
 * decides the map.
 */
export function declineTakesPrize(
  eco: EconomyState, industryId: number, challengerHarvesterId: number,
): void {
  applyBattleResult(eco, industryId, challengerHarvesterId);
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
    challengerHarvesterId: number;
    holderHarvesterId: number;
  }
  | { kind: "fightoff"; pending: PendingFightOff };

/**
 * Settle a finished map battle. `won` is from the CHALLENGER's / DEFENDER's
 * seat (fight-offs: the player who was offered the fight):
 *   industry  — win: the challenger CONQUERS; lose: the holder holds (an
 *               explicit hold, so a lapsed conquest cannot linger); draw: the
 *               map is unchanged.
 *   fightoff  — win: the sabotage is cancelled (`resolveFightOff(true)` — the
 *               attacker's Gold stays spent); lose/decline: it lands as bought.
 */
export function settleMapBattle(
  eco: EconomyState,
  stake: MapBattleStake,
  won: boolean | null,
): "conquest" | "held" | "draw" | "cancelled" | "lands" {
  if (stake.kind === "industry") {
    if (won === true) {
      applyBattleResult(eco, stake.industryId, stake.challengerHarvesterId);
      return "conquest";
    }
    if (won === false) {
      applyBattleResult(eco, stake.industryId, stake.holderHarvesterId);
      return "held";
    }
    return "draw";
  }
  const lands = resolveFightOff(won === true ? true : false);
  return lands ? "lands" : "cancelled";
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
