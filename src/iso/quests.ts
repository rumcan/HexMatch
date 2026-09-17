// ══════════════════════════════════════════════════════════════════════════
// L8 (#222) — optional quests, voiced by the match's cast.
//
// The Merge Gardens deconstruction gave the loop one more job: tell the player
// what they COULD do next, in a character's voice. HexMatch is a repeatable
// Catan-style strategy game, so a quest here is a SUGGESTION and never a
// requirement:
//
//   • 2–3 are offered at once, never two of the same strategy, so a breadth
//     plan, a depth plan and a network plan sit on the board together and the
//     player picks (or ignores) all of them;
//   • they are generated from the CURRENT map and state — which cargo is still
//     unclaimed, how many Depots the seat runs, what the city is worth — so
//     two games offer different plans, and one game's offers move as it is
//     played;
//   • NOTHING outside the HUD reads them. No depot tier, no upgrade, no rung,
//     no ★ and no win condition is gated by a quest, and a player who hides
//     the panel and finishes zero quests can still win the match. The reward
//     is small, paid once, and only on completion — quests are additive.
//
// Rewards are deliberately cargo and never ★: L13 (#228) owns the scoreboard
// and lists "control/quest ★" as post-MVP, so a quest must not move the win
// line. `QUEST_REWARDS` is the one table to retune when #228 gives it numbers;
// the values here are the "small, optional, capped" line from that ticket's
// doc (1–2 units of one cargo, once per quest).
//
// The texts are per SPEAKER — the match's rival, the guide (Mabel Quill in a
// contract), or the sandbox's neutral foreman. Which one speaks is
// `speakerFor()`: a story contract is voiced by its cast through
// `src/story/cast.ts` + `advisor.ts`; the sandbox has no cast, so the foreman
// talks the player through the same offers.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, CARGOES, type Cargo } from "./config";
import type { Purse } from "./track";

/** The plans a quest can push: claim ground, connect it, tune it, grow the
 *  city, or broaden the cargo mix. Distinct strategies are what makes the
 *  offer set a choice instead of a to-do list. */
export type QuestStrategy = "claim" | "link" | "tune" | "city" | "breadth";

/** Who says it. `rival`/`guide` resolve to the contract's cast; `foreman` is
 *  the sandbox's own voice (no portrait — it prints as a name and a line). */
export type QuestSpeaker = "rival" | "guide" | "foreman";

export type QuestKind = "claim-cargo" | "connect-depots" | "tune-depot" | "city-tier" | "run-types";

export type QuestRewardId = "ore-2" | "wood-stone-2" | "grain-2" | "oil-1" | "gold-1";

/** The sandbox foreman. No art, no sheet: a name and a voice, on purpose —
 *  the cast belongs to the campaign, and the sandbox is not a campaign. */
export const FOREMAN_NAME = "Foreman Pike";
export const GUIDE_NAME = "Mabel Quill";

// ── rewards ───────────────────────────────────────────────────────────────
export interface QuestReward {
  id: QuestRewardId;
  purse: Purse;
  /** What the chip prints, e.g. "2 ⛏️ Ore". */
  label: string;
}

const rewardLabel = (purse: Purse): string =>
  (Object.entries(purse) as [Cargo, number][])
    .map(([c, n]) => `${n} ${CARGO[c].icon} ${CARGO[c].name}`)
    .join(" · ");

const reward = (id: QuestRewardId, purse: Purse): QuestReward => ({ id, purse, label: rewardLabel(purse) });

/**
 * The reward table — SMALL and once-per-quest by construction. L13 (#228)
 * owns these values ("small, optional, capped"); the shapes below are one
 * cargo each, never enough to skip a rung or a city tier on their own.
 */
export const QUEST_REWARDS: Record<QuestRewardId, QuestReward> = {
  "ore-2": reward("ore-2", { ore: 2 }),
  "wood-stone-2": reward("wood-stone-2", { stone: 2 }),
  "grain-2": reward("grain-2", { grain: 2 }),
  "oil-1": reward("oil-1", { oil: 1 }),
  "gold-1": reward("gold-1", { gold: 1 }),
};

// ── the view: what the map and the seat say right now ─────────────────────
export interface QuestView {
  /** Unclaimed industries per cargo — ground still on the table. */
  unclaimed: Partial<Record<Cargo, number>>;
  /** The cargos the RIVAL's network already runs (the race's context). */
  rivalCargoes: Cargo[];
  /** This seat's Depots, and how many are on the clock. */
  depotCount: number;
  connected: number;
  /** How many Depots hold a tuned yield, and the best of those yields. */
  tunedDepots: number;
  bestYield: number;
  /** The cargos this seat's connected Depots run. */
  cargoesRunning: Cargo[];
  townLevel: number;
  townLevels: number;
}

// ── a quest, as data ──────────────────────────────────────────────────────
export interface QuestDef {
  /** Stable within a game: the save's handle for "paid" / "dismissed". */
  id: string;
  kind: QuestKind;
  strategy: QuestStrategy;
  /** The cargo the quest names, when it names one. */
  cargo: Cargo | null;
  /** How many (or which yield threshold) completes it. */
  need: number;
  /** `tune-depot`: the yield level a Depot must hold. */
  threshold?: number;
  reward: QuestRewardId;
  /** The line, per speaker. */
  text: Record<QuestSpeaker, string>;
}

/** A recipe as data: one per strategy, asked what it can offer on this map. */
export interface QuestRecipe {
  kind: QuestKind;
  strategy: QuestStrategy;
  /** Every concrete offer this recipe supports right now (often one). */
  offers: (v: QuestView) => QuestDef[];
}

/** How many quests are offered at once. The ticket says 2–3. */
export const QUEST_OFFER_MAX = 3;
export const QUEST_OFFER_MIN = 2;

const cargoName = (c: Cargo): string => CARGO[c].name;

/** How many distinct cargos a seat runs — the breadth number, one rule. */
export const typesRunning = (cargos: readonly Cargo[]): number => new Set(cargos).size;

// ══════════════════════════════════════════════════════════════════════════
// THE TABLE — one recipe per strategy. Everything a quest says or wants lives
// here; the module below only ranks, offers and pays them.
// ══════════════════════════════════════════════════════════════════════════
export const QUESTS: readonly QuestRecipe[] = [
  {
    kind: "claim-cargo",
    strategy: "claim",
    offers: (v) => (Object.keys(v.unclaimed) as Cargo[])
      // Contested cargoes first (the rival runs one already), then CARGOES
      // order — deterministic on a given map, different between maps.
      .filter((c) => (v.unclaimed[c] ?? 0) > 0)
      .sort((a, b) => {
        const ra = v.rivalCargoes.includes(a) ? 0 : 1;
        const rb = v.rivalCargoes.includes(b) ? 0 : 1;
        return ra - rb || CARGOES.indexOf(a) - CARGOES.indexOf(b);
      })
      .map((cargo) => {
        const contested = v.rivalCargoes.includes(cargo);
        return {
          id: `claim-${cargo}`,
          kind: "claim-cargo" as const,
          strategy: "claim" as const,
          cargo,
          need: 1,
          reward: "ore-2" as const,
          text: {
            rival: contested
              ? `My crews are already surveying that ${cargoName(cargo)}. Put a Depot in its catchment before I finish, if you can.`
              : `There is ${cargoName(cargo)} on this map nobody has claimed. One Depot in its catchment and it is yours — I would have said the same thing last week.`,
            guide: `Boss, ${cargoName(cargo)} is still unclaimed on the map. The first Depot in an industry's catchment holds it — I would rather that Depot was ours.`,
            foreman: contested
              ? `The rival's lorries are already working that ${cargoName(cargo)}, boss. One Depot in its catchment and it's ours instead.`
              : `There's ${cargoName(cargo)} sitting unclaimed. One Depot in its catchment and it pays us, not nobody.`,
          },
        };
      }),
  },
  {
    kind: "connect-depots",
    strategy: "link",
    // "Connect three depots" — the network plan. The ask grows with what the
    // seat already runs, so the quest is never already-done the moment it is
    // offered, and two Depots is reachable from a fresh map.
    offers: (v) => {
      const need = Math.min(4, Math.max(2, v.connected + 1));
      return [{
        id: `link-${need}`,
        kind: "connect-depots" as const,
        strategy: "link" as const,
        cargo: null,
        need,
        reward: "wood-stone-2" as const,
        text: {
          rival: `One road is a hobby. Run ${need} Depots on the clock at once and I will believe you have a company.`,
          guide: `Two lines make a business, boss: put ${need} Depots on the clock at the same time and the clock does the rest.`,
          foreman: `${need} Depots ticking at once, boss — that's a network. Everything short of that is a shed with views.`,
        },
      }];
    },
  },
  {
    kind: "tune-depot",
    strategy: "tune",
    // The depth plan: a matched Depot at or above a level. The bar rises once
    // the seat has already shown it can clear ×2, so the offer keeps meaning
    // something instead of repeating itself.
    offers: (v) => {
      const threshold = v.bestYield >= 2 ? 2.5 : 2;
      return [{
        id: `tune-${threshold}`,
        kind: "tune-depot" as const,
        strategy: "tune" as const,
        cargo: null,
        need: 1,
        threshold,
        reward: "oil-1" as const,
        text: {
          rival: `Your Depots tick like a clock that needs winding. Match one past ×${threshold} and I might notice.`,
          guide: `A better match is a better payslip, boss — tune one Depot up past ×${threshold} and the whole line earns more.`,
          foreman: `Get one Depot past ×${threshold} on the plant floor. Yield is the first thing the clock multiplies, before distance or paving.`,
        },
      }];
    },
  },
  {
    kind: "city-tier",
    strategy: "city",
    offers: (v) => (v.townLevel >= v.townLevels ? [] : [{
      id: `city-${v.townLevel + 1}`,
      kind: "city-tier" as const,
      strategy: "city" as const,
      cargo: null,
      need: v.townLevel + 1,
      reward: "grain-2" as const,
      text: {
        rival: `Still one town hall and a handshake, I see. Raise your city a tier — then we can talk as equals.`,
        guide: `The city sets the pace for every Depot you run, boss. Raise it a tier and every connected line ticks faster.`,
        foreman: `A city tier lifts every Depot you've connected, and it raises what your yard can hold. Worth the cargo.`,
      },
    }]),
  },
  {
    kind: "run-types",
    strategy: "breadth",
    offers: (v) => {
      const need = Math.min(4, Math.max(2, typesRunning(v.cargoesRunning) + 1));
      return [{
        id: `breadth-${need}`,
        kind: "run-types" as const,
        strategy: "breadth" as const,
        cargo: null,
        need,
        reward: "gold-1" as const,
        text: {
          rival: `One cargo. One trick. Run ${need} types at once or stay a footnote in my ledger.`,
          guide: `${need} different cargoes on the clock at once, boss — breadth is what the ★ line pays for, and it is what survives a bad map.`,
          foreman: `${need} cargo types running at once. That's a freight concern; one line is a hobby.`,
        },
      }];
    },
  },
];

/** Every quest this map and seat support right now, in table order. */
export function questOffers(v: QuestView): QuestDef[] {
  return QUESTS.flatMap((r) => r.offers(v));
}

// ── the offer set: 2–3 at once, never two of the same strategy ────────────
export interface SelectQuestsOptions {
  /** Up to this many (default 3). */
  max?: number;
  /** Ids to skip — the active, dismissed and already-paid quests. */
  exclude?: Iterable<string>;
  /** Strategies already on the panel: prefer something else. */
  avoid?: Iterable<QuestStrategy>;
}

/**
 * Pick the offers: a deterministic shuffle of the candidates, then one per
 * strategy, up to `max`. One per strategy is the whole point ("quests offer
 * different strategies at the same time" is an acceptance line), so the
 * shuffle only decides WHICH breadth/depth/network variant leads.
 *
 * `rng` is the game's seeded one (`mulberry32`), never `Math.random` — the
 * same seed offers the same quests, and a re-offer after a completion is
 * deterministic too.
 */
export function selectQuests(
  pool: readonly QuestDef[], rng: () => number, opts: SelectQuestsOptions = {},
): QuestDef[] {
  const max = Math.max(1, opts.max ?? QUEST_OFFER_MAX);
  const excluded = new Set(opts.exclude ?? []);
  const avoid = new Set(opts.avoid ?? []);
  const candidates = pool.filter((q) => !excluded.has(q.id));
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const preferred = shuffled.filter((q) => !avoid.has(q.strategy));
  // A panel with nothing fresh would be worse than a repeat: fall back.
  const order = preferred.length ? preferred : shuffled;
  const seen = new Set<QuestStrategy>();
  const picked: QuestDef[] = [];
  for (const q of order) {
    if (picked.length >= max) break;
    if (seen.has(q.strategy)) continue;
    seen.add(q.strategy);
    picked.push(q);
  }
  // Fewer strategies than the panel holds: top up with the rest rather than
  // showing one quest where the ticket asks for 2–3.
  if (picked.length < Math.min(max, QUEST_OFFER_MIN)) {
    for (const q of order) {
      if (picked.length >= Math.min(max, QUEST_OFFER_MIN)) break;
      if (!picked.includes(q)) picked.push(q);
    }
  }
  return picked;
}

// ── progress, completion, payment ─────────────────────────────────────────
/** What the player has done toward this quest, in the quest's own units. */
export function questHave(def: QuestDef, v: QuestView): number {
  switch (def.kind) {
    case "claim-cargo":
      return def.cargo && v.cargoesRunning.includes(def.cargo) ? 1 : 0;
    case "connect-depots":
      return v.connected;
    case "tune-depot":
      return v.bestYield >= (def.threshold ?? 2) ? 1 : 0;
    case "city-tier":
      return v.townLevel;
    case "run-types":
      return typesRunning(v.cargoesRunning);
    default:
      return 0;
  }
}

export const questDone = (def: QuestDef, v: QuestView): boolean => questHave(def, v) >= def.need;

/** What a completed quest pays. Pure: the CALLER does the earning. */
export const questReward = (def: QuestDef): QuestReward => QUEST_REWARDS[def.reward];

/** The line in a given voice (the UI resolves the name and face). */
export const questText = (def: QuestDef, speaker: QuestSpeaker): string => def.text[speaker];

/**
 * Which voice speaks for a strategy. In a contract the rival pushes the
 * aggressive lines (claims, networks, a jab at the city) while the guide
 * carries the how-to ones; the sandbox has only the foreman, and he carries
 * all five.
 */
export const speakerFor = (strategy: QuestStrategy, story: boolean): QuestSpeaker => {
  if (!story) return "foreman";
  return strategy === "claim" || strategy === "link" || strategy === "breadth" ? "rival" : "guide";
};

/** The name to print beside a quest line. */
export const speakerName = (speaker: QuestSpeaker, rivalName?: string | null): string => {
  if (speaker === "foreman") return FOREMAN_NAME;
  if (speaker === "guide") return GUIDE_NAME;
  return rivalName ?? "The rival";
};

/**
 * The progress line the panel prints ("1/3", "×2.4 of ×2"). Kept pure so the
 * chrome never recomputes the rule it is showing.
 */
export function questProgressText(def: QuestDef, v: QuestView): string {
  const have = questHave(def, v);
  if (def.kind === "tune-depot") return `best ${fmt2(v.bestYield)} · need ${fmt2(def.threshold ?? 2)}`;
  return `${Math.min(have, def.need)}/${def.need}`;
}

const fmt2 = (n: number): string => `×${Number(n.toFixed(2))}`;

/** A quest's one-line summary for the Feed/toast: "2 ★-free lines" — the
 *  panel reuses the text, so this stays tiny. */
export const questLine = (def: QuestDef, speaker: QuestSpeaker): string =>
  `${speakerName(speaker)}: ${questText(def, speaker)}`;
