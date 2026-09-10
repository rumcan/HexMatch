// ══════════════════════════════════════════════════════════════════════════
// VP-01 — Victory Points: what the scoreboard actually pays for.
//
// The rule, in one line: **you score for what you UPGRADE, never for what you
// merely connect.**
//
//   Dirt Road tile paved into a Road (in place)   +0.25★   (4 paves = 1★)
//   Processing plant raised after setup           +1★
//   First to 10★ wins
//
// What is deliberately worth nothing:
//
//   * a Dirt Road, or a connection over one. Gravel is plumbing. The old game
//     paid 1★ per dirt connection and 3★ per paved one, which made the
//     scoreboard a census of depots and rewarded whoever sprayed the cheapest
//     links around, instead of whoever improved their network;
//   * a paved Road laid on virgin ground. Laid new it costs 1 Wood + 1 Stone +
//     4 Ore and scores nothing; laid as a pave over your own gravel it costs
//     4 Ore and scores 0.25★. Same money, better road, actual points — the
//     upgrade is the only path, and `track.ts`'s `upgraded` provenance layer is
//     what tells the two apart.
//
// Two properties fall out of that, and both are the point:
//
//   1. **Ore is the score.** A pave is 4 Ore, and Ore only comes out of an ore
//      mine that is IN PRODUCTION — serviced by a depot, on a road, feeding a
//      plant. So the race to 10★ is a race to build a working economy, and the
//      connection mechanic (throughput ×1.0 dirt / ×1.6 paved) is what feeds
//      it, just without paying points twice.
//   2. **Points are revocable, so losing a road hurts.** Tear up a paved tile
//      and its 0.25★ goes with it; demolish a plant and its 1★ does. The
//      scoreboard is a live view of the network, not a history of everything
//      you ever built — which is why the DIFF, not a running total, is what
//      this module computes.
//
// `rescore` runs on every build and demolish (never on a timer) and returns the
// events the UI must surface: an unexplained VP drop is the single most
// confusing thing this system can do, so every event carries the tile it
// happened at and `game.ts` floats it on the map.
//
// Scoring is owner-scoped the way W2 made the whole economy: a tile scores for
// the player whose `owner` byte it carries, so the map's public highways and
// town rings (`PUBLIC_OWNER`) — and anything your rival paved — can never land
// on your total, or vice-versa.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { PRESENT, PUBLIC_OWNER, type Track } from "./track";
import { VICTORY } from "./config";
import type { EconomyState } from "./economy";

/**
 * The plant id of a player's opening Factory. It is placed during setup for
 * free, so it is NOT a victory point; every plant with a higher id was raised
 * by the player and pays `VICTORY.plant`. (`plants.ts` mints the ids.)
 */
export const OPENING_PLANT_ID = 0;

export type VpSource = "upgrade" | "plant";
export type VpChange = "awarded" | "revoked";

/**
 * One scored change. `tx`/`ty` locate it on the map (a plant's tile is its
 * footprint origin) so the float lands on the thing the player just paved
 * rather than somewhere on the scoreboard.
 */
export interface VpEvent {
  source: VpSource;
  type: VpChange;
  owner: string;
  delta: number;
  tx: number;
  ty: number;
  /** `plant` events: the town the plant was raised beside, when known. */
  townId?: number | null;
  /** `plant` events: 1-based plant number, for the toast. */
  plantNo?: number;
}

/** Where a scored thing is and who it paid. Kept so a removal can be debited
 *  from the right player after the structure itself is gone. */
export interface PavedLedger {
  owner: string;
}
export interface PlantLedger {
  owner: string;
  tx: number;
  ty: number;
  townId: number | null;
  no: number;
}

export interface ScoreState {
  /** tile index → who it scored for. */
  paved: Map<number, PavedLedger>;
  /** `${owner}#${plantId}` → what it scored. */
  plants: Map<string, PlantLedger>;
  /** Per-owner VP total. */
  vp: Map<string, number>;
}

export const createScoreState = (): ScoreState => ({
  paved: new Map(), plants: new Map(), vp: new Map(),
});

/** VP as the HUD prints it: whole when it is whole, 2dp at most otherwise. */
export const fmtVp = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** `n` paved tiles, in VP. One function so the modebar, the toast and the
 *  scoreboard all convert the tile count the same way. */
export const paveVp = (n: number): number => n * VICTORY.upgrade;

/** The signed VP text for a float/toast: "+0.25★" / "−0.25★". */
export const vpDeltaText = (delta: number): string =>
  `${delta >= 0 ? "+" : "−"}${fmtVp(Math.abs(delta))}★`;

/**
 * The owner string a track-owner id belongs to, built from the structures that
 * carry both identities (the track layer only knows numbers). Public ground is
 * removed outright: a highway is every player's to drive and nobody's to score.
 */
export function ownerIdsByNumber(state: EconomyState): Map<number, string> {
  const out = new Map<number, string>();
  for (const f of state.factories) out.set(f.ownerId, f.owner);
  for (const h of state.harvesters) if (!out.has(h.ownerId)) out.set(h.ownerId, h.owner);
  out.delete(PUBLIC_OWNER);
  return out;
}

/** Every scored paved upgrade on the map: tile index → who owns it. */
export function scoredPaves(track: Track, owners: Map<number, string>): Map<number, string> {
  const out = new Map<number, string>();
  for (let y = 0; y < MAP_H; y++) {
    const row = y * MAP_W;
    for (let x = 0; x < MAP_W; x++) {
      const i = row + x;
      // BOTH bits, always: provenance without pavement (torn up and re-laid as
      // gravel) is worth nothing, and pavement without provenance is a Road
      // laid on virgin ground — the case this whole module exists to exclude.
      if ((track.upgraded[i] & PRESENT) === 0) continue;
      if ((track.road[i] & PRESENT) === 0) continue;
      const owner = owners.get(track.owner[i]);
      if (owner === undefined) continue;
      out.set(i, owner);
    }
  }
  return out;
}

/** Every scored plant: `${owner}#${id}` → where it stands. */
export function scoredPlants(state: EconomyState): Map<string, PlantLedger> {
  const out = new Map<string, PlantLedger>();
  for (const f of state.factories) {
    const id = f.id ?? OPENING_PLANT_ID;
    if (id <= OPENING_PLANT_ID) continue;              // the setup Factory is free
    out.set(`${f.owner}#${id}`, {
      owner: f.owner, tx: f.tx, ty: f.ty, townId: f.townId ?? null, no: id,
    });
  }
  return out;
}

/**
 * Diff the board against the last scoring and return what changed. Called from
 * every build and demolish path (`rescoreNow` in game.ts), which is what keeps
 * a pave and the point it buys one atomic moment.
 */
export function rescore(state: EconomyState, score: ScoreState): VpEvent[] {
  const events: VpEvent[] = [];
  const owners = ownerIdsByNumber(state);
  const paves = scoredPaves(state.track, owners);
  const plants = scoredPlants(state);
  const add = (owner: string, delta: number) =>
    score.vp.set(owner, (score.vp.get(owner) ?? 0) + delta);

  // ── paved upgrades: awarded, revoked, or moved to a new owner ────────────
  for (const [i, owner] of paves) {
    const from = score.paved.get(i)?.owner;
    if (from === owner) continue;
    if (from !== undefined) {
      // The tile still counts — just for somebody else: the rival paved a
      // stretch of your gravel and took the ground with it. Emit both halves so
      // each player's counter animates.
      events.push({
        source: "upgrade", type: "revoked", owner: from, delta: -VICTORY.upgrade,
        tx: i % MAP_W, ty: (i / MAP_W) | 0,
      });
      add(from, -VICTORY.upgrade);
    }
    score.paved.set(i, { owner });
    add(owner, VICTORY.upgrade);
    events.push({
      source: "upgrade", type: "awarded", owner, delta: VICTORY.upgrade,
      tx: i % MAP_W, ty: (i / MAP_W) | 0,
    });
  }
  for (const [i, ledger] of [...score.paved]) {
    if (paves.has(i)) continue;
    score.paved.delete(i);
    add(ledger.owner, -VICTORY.upgrade);
    events.push({
      source: "upgrade", type: "revoked", owner: ledger.owner, delta: -VICTORY.upgrade,
      tx: i % MAP_W, ty: (i / MAP_W) | 0,
    });
  }

  // ── plants ───────────────────────────────────────────────────────────────
  for (const [key, p] of plants) {
    if (score.plants.has(key)) continue;
    score.plants.set(key, p);
    add(p.owner, VICTORY.plant);
    events.push({
      source: "plant", type: "awarded", owner: p.owner, delta: VICTORY.plant,
      tx: p.tx, ty: p.ty, townId: p.townId, plantNo: p.no + 1,
    });
  }
  for (const [key, p] of [...score.plants]) {
    if (plants.has(key)) continue;
    score.plants.delete(key);
    add(p.owner, -VICTORY.plant);
    events.push({
      source: "plant", type: "revoked", owner: p.owner, delta: -VICTORY.plant,
      tx: p.tx, ty: p.ty, townId: p.townId, plantNo: p.no + 1,
    });
  }
  return events;
}

export const vpFor = (score: ScoreState, owner: string) => score.vp.get(owner) ?? 0;

/**
 * The two numbers behind a player's total — tiles paved and plants raised —
 * for the HUD, the inspector and the tests. Recomputed from the board rather
 * than accumulated, so it can never drift from the network it describes.
 */
export function victoryBreakdown(state: EconomyState, owner: string) {
  const owners = ownerIdsByNumber(state);
  let paved = 0;
  for (const o of scoredPaves(state.track, owners).values()) if (o === owner) paved++;
  let plants = 0;
  for (const p of scoredPlants(state).values()) if (p.owner === owner) plants++;
  return {
    paved,
    plants,
    pavedVp: paveVp(paved),
    plantVp: plants * VICTORY.plant,
  };
}

/**
 * Has this player reached the winning total? One predicate for the win check,
 * the HUD's "ready to win" glow and the AI's race assessment, so nobody
 * re-derives `>= VP_TARGET` and rounds it differently.
 */
export const hasWon = (score: ScoreState, owner: string): boolean =>
  vpFor(score, owner) >= VICTORY.target;
