// ══════════════════════════════════════════════════════════════════════════
// L8 (#222) — optional quests, voiced by the match's cast.
// CONTRACT-1 (#466) — town contracts replace Quests — deliveries with
// deadlines, and a public tender both seats race.
//
// This file evolves the old quest module: the old quest types/helpers are
// kept for backward compat (saves, old tests) but the game now uses the
// contract types/functions. Where #466 and an older ticket disagree, #466 wins.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, CARGOES, INDUSTRY_BY_KEY, type Cargo } from "./config";
import type { Purse } from "./track";

// ── shared speaker ──────────────────────────────────────────────────────
export type QuestSpeaker = "rival" | "guide" | "foreman";
export const FOREMAN_NAME = "Foreman Pike";
export const GUIDE_NAME = "Mabel Quill";

// ── CONTRACT-1 types ────────────────────────────────────────────────────
export type ContractKind = "private" | "tender";

export interface ContractDef {
  id: string;
  kind: ContractKind;
  cargo: Cargo;
  amount: number;
  townId: number;
  townName: string;
  rewardMoney: number;
  /** Town-growth progress (0..1) awarded on completion, plus the $ reward. */
  rewardTown: number;
  /** How long after acceptance the contract must be finished (ms). */
  deadlineMs: number;
  speaker: QuestSpeaker;
  text: Record<QuestSpeaker, string>;
}

export interface ContractView {
  seed: number;
  towns: { id: number; name: string; tx: number; ty: number }[];
  cargoesRunning: Cargo[];
  depotCount: number;
  connected: number;
  townLevel: number;
  townLevels: number;
  difficulty: "trainee" | "easy" | "normal" | "hard";
  /** 0..1 progress to win line (for phase scaling). */
  phase: number;
  money: number;
  unclaimed?: Partial<Record<Cargo, number>>;
  rivalCargoes?: Cargo[];
  /** Optional detailed depot cargo list for rival win check. */
  depotCargoes?: { cargo: Cargo; connected: boolean }[];
}

export interface ActiveContract {
  def: ContractDef;
  acceptedAt: number;
  expiresAt: number;
  delivered: number;
  owner: 0 | 1;
  status: "active" | "completed" | "expired" | "lost";
}

export const CONTRACT_OFFER_MAX = 3;
export const CONTRACT_PRIVATE_COUNT = 2;
export const CONTRACT_TENDER_COUNT = 1;
export const CONTRACT_BASE_DEADLINE_MS = 300_000; // 5 min
export const CONTRACT_TENDER_DEADLINE_MS = 360_000; // 6 min

const CONTRACT_BASE_AMOUNT: Record<Cargo, number> = {
  grain: 40,
  wood: 40,
  stone: 30,
  ore: 30,
  oil: 20,
  gold: 12,
};

const DIFFICULTY_AMOUNT_MULT: Record<ContractView["difficulty"], number> = {
  trainee: 0.7,
  easy: 0.8,
  normal: 1.0,
  hard: 1.3,
};
const DIFFICULTY_DEADLINE_MULT: Record<ContractView["difficulty"], number> = {
  trainee: 1.4,
  easy: 1.2,
  normal: 1.0,
  hard: 0.8,
};
const DIFFICULTY_REWARD_MULT: Record<ContractView["difficulty"], number> = {
  trainee: 0.9,
  easy: 1.0,
  normal: 1.2,
  hard: 1.5,
};

function contractAmountFor(cargo: Cargo, view: ContractView, rng: () => number): number {
  const base = CONTRACT_BASE_AMOUNT[cargo] ?? 30;
  const diff = DIFFICULTY_AMOUNT_MULT[view.difficulty] ?? 1;
  const phase = 0.8 + view.phase * 0.6;
  const jitter = 0.9 + rng() * 0.2;
  const raw = base * diff * phase * jitter;
  return Math.max(5, Math.round(raw / 5) * 5);
}

function contractRewardFor(cargo: Cargo, amount: number, view: ContractView): { money: number; town: number } {
  const priceMap: Record<Cargo, number> = { grain: 6, wood: 5, stone: 5, ore: 8, oil: 12, gold: 40 };
  const price = priceMap[cargo] ?? 5;
  const mult = DIFFICULTY_REWARD_MULT[view.difficulty] ?? 1;
  const money = Math.max(20, Math.round(amount * price * 1.2 * mult));
  const town = 0.15;
  return { money, town };
}

function contractDeadlineFor(kind: ContractKind, view: ContractView): number {
  const base = kind === "tender" ? CONTRACT_TENDER_DEADLINE_MS : CONTRACT_BASE_DEADLINE_MS;
  const mult = DIFFICULTY_DEADLINE_MULT[view.difficulty] ?? 1;
  return Math.round(base * mult);
}

// TOWN-3 (#561): this module never sees the grid, only `ContractView.towns`,
// which the game already fills with each town's generated name
// (`grid.towns[i].name`). This placeholder is a defensive fallback only —
// an empty `view.towns` (should never happen on a real map) or an old save's
// wire contract missing `townName` (`contractsFromWire` below) — so it never
// shows on a live game's contracts/tenders.
function townNameFor(id: number): string {
  return `Town ${id + 1}`;
}

function contractTextFor(def: Omit<ContractDef, "text" | "speaker"> & { speaker: QuestSpeaker }): Record<QuestSpeaker, string> {
  const cargoName = CARGO[def.cargo].name;
  const town = def.townName;
  const amt = def.amount;
  const kind = def.kind;
  if (kind === "tender") {
    return {
      rival: `Public tender: ${amt} ${cargoName} to ${town}. First to deliver takes the purse — I intend to be first.`,
      guide: `Tender open, boss: ${amt} ${cargoName} to ${town}. The rival's already loading — beat them to it.`,
      foreman: `Tender: ${amt} ${cargoName} to ${town}. Both seats race — first load wins.`,
    };
  }
  return {
    rival: `You have ${Math.round(def.deadlineMs / 60000)} minutes to get ${amt} ${cargoName} to ${town}. I doubt you have the line for it.`,
    guide: `Boss, ${town} needs ${amt} ${cargoName} in ${Math.round(def.deadlineMs / 60000)} minutes. Deliver it to the Factory and the town grows with us.`,
    foreman: `Contract: ${amt} ${cargoName} to ${town} in ${Math.round(def.deadlineMs / 60000)} min. Cargo arriving at the Factory counts after acceptance.`,
  };
}

export function speakerForContract(kind: ContractKind, story: boolean): QuestSpeaker {
  if (!story) return "foreman";
  return kind === "tender" ? "rival" : "guide";
}

export function contractOffers(view: ContractView, rng: () => number): ContractDef[] {
  const towns = view.towns.length ? view.towns : [{ id: 0, name: townNameFor(0), tx: 0, ty: 0 }];
  const cargos = (Object.keys(CONTRACT_BASE_AMOUNT) as Cargo[]).filter((c) => c !== "gold" || view.phase > 0.3);
  const pool: ContractDef[] = [];
  let seq = 0;
  for (const town of towns) {
    for (const cargo of cargos) {
      const kinds: ContractKind[] = ["private", "tender"];
      for (const kind of kinds) {
        const amount = contractAmountFor(cargo, view, rng);
        const reward = contractRewardFor(cargo, amount, view);
        const deadline = contractDeadlineFor(kind, view);
        const id = `${kind}-${cargo}-${town.id}-${seq++}`;
        const base = {
          id,
          kind,
          cargo,
          amount,
          townId: town.id,
          townName: town.name,
          rewardMoney: reward.money,
          rewardTown: reward.town,
          deadlineMs: deadline,
        };
        const speaker = speakerForContract(kind, true);
        const def: ContractDef = {
          ...base,
          speaker,
          text: contractTextFor({ ...base, speaker }),
        };
        pool.push(def);
      }
    }
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export interface SelectContractsOptions {
  max?: number;
  exclude?: Iterable<string>;
  avoidCargoTown?: Set<string>;
}

function cargoTownKey(cargo: Cargo, townId: number): string {
  return `${cargo}:${townId}`;
}

export function selectContracts(
  pool: readonly ContractDef[],
  rng: () => number,
  opts: SelectContractsOptions = {},
): ContractDef[] {
  const max = opts.max ?? CONTRACT_OFFER_MAX;
  const excluded = new Set(opts.exclude ?? []);
  const avoid = opts.avoidCargoTown ?? new Set<string>();
  const filtered = pool.filter((c) => !excluded.has(c.id) && !avoid.has(cargoTownKey(c.cargo, c.townId)));
  const privates = filtered.filter((c) => c.kind === "private");
  const tenders = filtered.filter((c) => c.kind === "tender");
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const sPriv = shuffle(privates);
  const sTend = shuffle(tenders);
  const picked: ContractDef[] = [];
  const seen = new Set<string>(avoid);
  for (const c of sPriv) {
    if (picked.length >= CONTRACT_PRIVATE_COUNT) break;
    const key = cargoTownKey(c.cargo, c.townId);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
  }
  for (const c of sTend) {
    if (picked.length >= max) break;
    const key = cargoTownKey(c.cargo, c.townId);
    if (seen.has(key)) continue;
    picked.push(c);
    break;
  }
  if (picked.length < max) {
    for (const c of filtered) {
      if (picked.length >= max) break;
      if (picked.some((p) => p.id === c.id)) continue;
      picked.push(c);
    }
  }
  return picked.slice(0, max);
}

export function contractProgressText(active: ActiveContract): string {
  return `${Math.min(active.delivered, active.def.amount)}/${active.def.amount}`;
}

export function contractTimeLeft(active: ActiveContract, now: number): number {
  return Math.max(0, active.expiresAt - now);
}

export function contractTimeLeftText(active: ActiveContract, now: number): string {
  const left = contractTimeLeft(active, now);
  const s = Math.ceil(left / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function isContractExpired(active: ActiveContract, now: number): boolean {
  return now >= active.expiresAt && active.status === "active";
}

export function isContractCompleted(active: ActiveContract): boolean {
  return active.delivered >= active.def.amount;
}

export function addContractDelivery(
  active: ActiveContract,
  cargo: Cargo,
  amount: number,
): ActiveContract {
  if (active.status !== "active") return active;
  if (active.def.cargo !== cargo) return active;
  const delivered = active.delivered + amount;
  const completed = delivered >= active.def.amount;
  return {
    ...active,
    delivered,
    status: completed ? "completed" : "active",
  };
}

export function resolveTenderRace(
  actives: ActiveContract[],
  _now: number,
): { actives: ActiveContract[]; winner?: ActiveContract; losers: ActiveContract[] } {
  const completed = actives.filter((a) => a.def.kind === "tender" && a.status === "completed");
  if (completed.length === 0) return { actives, losers: [] };
  // Earliest acceptedAt wins, tie-break owner 0 then first in array
  const winner = [...completed].sort((a, b) => {
    if (a.acceptedAt !== b.acceptedAt) return a.acceptedAt - b.acceptedAt;
    if (a.owner !== b.owner) return a.owner - b.owner;
    return 0;
  })[0];
  const losers: ActiveContract[] = [];
  const next = actives.map((a) => {
    if (a.def.kind !== "tender") return a;
    if (a.def.id !== winner.def.id) return a;
    if (a.owner === winner.owner && a.def.id === winner.def.id && a.acceptedAt === winner.acceptedAt && a.delivered === winner.delivered) {
      // This is the winner itself (reference equality not reliable, use owner+id)
      // Keep winner as is
      if (a.owner === winner.owner) return a;
    }
    if (a.owner !== winner.owner || (a.owner === winner.owner && a !== winner)) {
      // Any other contract for same tender id loses, whether active or also completed
      if (a.def.id === winner.def.id) {
        const lost = { ...a, status: "lost" as const };
        // Only count if not already lost/expired
        if (a.status !== "lost" && a.status !== "expired") losers.push(lost);
        return lost;
      }
    }
    return a;
  });
  // Ensure winner stays completed
  const finalActives = next.map((a) => {
    if (a.def.id === winner.def.id && a.owner === winner.owner) return winner;
    return a;
  });
  return { actives: finalActives, winner, losers };
}

export function rivalCanWinTender(
  view: ContractView,
  def: ContractDef,
): boolean {
  if (def.kind !== "tender") return false;
  if (view.depotCargoes) {
    return view.depotCargoes.some((d) => d.cargo === def.cargo && d.connected);
  }
  if (view.rivalCargoes?.includes(def.cargo)) return true;
  return view.depotCount > 0;
}

export interface ContractWire {
  id: string;
  kind: ContractKind;
  cargo: Cargo;
  amount: number;
  townId: number;
  townName: string;
  rewardMoney: number;
  rewardTown: number;
  deadlineMs: number;
  speaker: QuestSpeaker;
  acceptedAt?: number;
  expiresAt?: number;
  delivered?: number;
  owner?: 0 | 1;
  status?: ActiveContract["status"] | "offer";
  leftMs?: number;
}

export function contractsToWire(offers: ContractDef[], actives: ActiveContract[], now: number): ContractWire[] {
  const out: ContractWire[] = [];
  for (const o of offers) {
    out.push({
      id: o.id,
      kind: o.kind,
      cargo: o.cargo,
      amount: o.amount,
      townId: o.townId,
      townName: o.townName,
      rewardMoney: o.rewardMoney,
      rewardTown: o.rewardTown,
      deadlineMs: o.deadlineMs,
      speaker: o.speaker,
      status: "offer",
      leftMs: o.deadlineMs,
    });
  }
  for (const a of actives) {
    out.push({
      id: a.def.id,
      kind: a.def.kind,
      cargo: a.def.cargo,
      amount: a.def.amount,
      townId: a.def.townId,
      townName: a.def.townName,
      rewardMoney: a.def.rewardMoney,
      rewardTown: a.def.rewardTown,
      deadlineMs: a.def.deadlineMs,
      speaker: a.def.speaker,
      acceptedAt: a.acceptedAt,
      expiresAt: a.expiresAt,
      delivered: a.delivered,
      owner: a.owner,
      status: a.status,
      leftMs: Math.max(0, a.expiresAt - now),
    });
  }
  return out;
}

export function contractsFromWire(wire: unknown, now: number): { offers: ContractDef[]; actives: ActiveContract[] } {
  const offers: ContractDef[] = [];
  const actives: ActiveContract[] = [];
  if (!Array.isArray(wire)) return { offers, actives };
  for (const x of wire as Partial<ContractWire>[]) {
    if (!x || typeof x.id !== "string" || !x.cargo || typeof x.amount !== "number") continue;
    const kind = x.kind === "tender" ? "tender" : "private";
    const def: ContractDef = {
      id: x.id,
      kind,
      cargo: x.cargo as Cargo,
      amount: x.amount,
      townId: typeof x.townId === "number" ? x.townId : 0,
      townName: typeof x.townName === "string" ? x.townName : townNameFor(typeof x.townId === "number" ? x.townId : 0),
      rewardMoney: typeof x.rewardMoney === "number" ? x.rewardMoney : 50,
      rewardTown: typeof x.rewardTown === "number" ? x.rewardTown : 0.15,
      deadlineMs: typeof x.deadlineMs === "number" ? x.deadlineMs : CONTRACT_BASE_DEADLINE_MS,
      speaker: (x.speaker as QuestSpeaker) ?? "foreman",
      text: {
        rival: "",
        guide: "",
        foreman: "",
      },
    };
    // rebuild text
    def.text = contractTextFor({ ...def, speaker: def.speaker });
    if (x.status === "offer" || x.status === undefined) {
      offers.push(def);
    } else {
      const acceptedAt = typeof x.acceptedAt === "number" ? x.acceptedAt : now;
      const expiresAt = typeof x.expiresAt === "number" ? x.expiresAt : now + def.deadlineMs;
      actives.push({
        def,
        acceptedAt,
        expiresAt,
        delivered: typeof x.delivered === "number" ? x.delivered : 0,
        owner: x.owner === 1 ? 1 : 0,
        status: (x.status as ActiveContract["status"]) ?? "active",
      });
    }
  }
  return { offers, actives };
}

// ── Legacy quest compat (L8 #222) ─────────────────────────────────────────
export type QuestStrategy = "claim" | "link" | "tune" | "city" | "breadth";
export type QuestKind = "claim-cargo" | "connect-depots" | "tune-depot" | "city-tier" | "run-types";
export type QuestRewardId = "ore-2" | "stone-2" | "grain-2" | "oil-1" | "gold-1";

export interface QuestReward {
  id: QuestRewardId;
  purse: Purse;
  label: string;
}

const reward = (id: QuestRewardId, purse: Purse): QuestReward => ({
  id,
  purse,
  label: (Object.entries(purse) as [Cargo, number][])
    .map(([c, n]) => `${n}${CARGO[c].icon} ${CARGO[c].name}`).join(" + "),
});

export const QUEST_REWARDS: Record<QuestRewardId, QuestReward> = {
  "ore-2": reward("ore-2", { ore: 2 }),
  "stone-2": reward("stone-2", { stone: 2 }),
  "grain-2": reward("grain-2", { grain: 2 }),
  "oil-1": reward("oil-1", { oil: 1 }),
  "gold-1": reward("gold-1", { gold: 1 }),
};

export interface QuestView {
  unclaimed: Partial<Record<Cargo, number>>;
  rivalCargoes: Cargo[];
  depotCount: number;
  connected: number;
  tunedDepots: number;
  bestYield: number;
  cargoesRunning: Cargo[];
  townLevel: number;
  townLevels: number;
}

export interface QuestDef {
  id: string;
  kind: QuestKind;
  strategy: QuestStrategy;
  cargo: Cargo | null;
  need: number;
  threshold?: number;
  reward: QuestRewardId;
  text: Record<QuestSpeaker, string>;
}

export interface QuestRecipe {
  kind: QuestKind;
  strategy: QuestStrategy;
  offers: (v: QuestView) => QuestOption[];
}

export type QuestOption = Omit<QuestDef, "kind" | "strategy">;

export const QUEST_OFFER_MAX = 3;
export const QUEST_OFFER_MIN = 2;

const cargoName = (c: Cargo): string => CARGO[c].name;
export const typesRunning = (cargos: readonly Cargo[]): number => new Set(cargos).size;

export const QUESTS: readonly QuestRecipe[] = [
  {
    kind: "claim-cargo",
    strategy: "claim",
    offers: (v) => (Object.keys(v.unclaimed) as Cargo[])
      .filter((c) => (v.unclaimed[c] ?? 0) > 0)
      .sort((a, b) => {
        const ra = v.rivalCargoes.includes(a) ? 0 : 1;
        const rb = v.rivalCargoes.includes(b) ? 0 : 1;
        return ra - rb || CARGOES.indexOf(a) - CARGOES.indexOf(b);
      })
      .slice(0, 3)
      .map((cargo) => {
        const contested = v.rivalCargoes.includes(cargo);
        const name = cargoName(cargo);
        return {
          id: `claim-${cargo}`,
          cargo,
          need: 1,
          reward: cargo === "stone" ? "stone-2" as QuestRewardId : "ore-2" as QuestRewardId,
          text: {
            rival: contested
              ? `My crews are already working that ${name}. Put a Depot in its catchment before I finish, if you can.`
              : `There is ${name} on this map nobody has claimed. One Depot in its catchment and it is yours — I would have said the same thing last week.`,
            guide: `Boss, ${name} is still unclaimed on the map. The first Depot in an industry's catchment holds it — I would rather that Depot was ours.`,
            foreman: contested
              ? `The rival's lorries are already working that ${name}, boss. One Depot in its catchment and it's ours instead.`
              : `There's ${name} sitting unclaimed. One Depot in its catchment and it pays us, not nobody.`,
          },
        };
      }),
  },
  {
    kind: "connect-depots",
    strategy: "link",
    offers: (v) => {
      const need = Math.min(4, Math.max(2, v.connected + 1));
      return [{
        id: `link-${need}`,
        cargo: null,
        need,
        reward: "stone-2" as QuestRewardId,
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
    offers: (v) => {
      const threshold = v.bestYield >= 2 ? 2.5 : 2;
      return [{
        id: `tune-${threshold}`,
        cargo: null,
        need: 1,
        threshold,
        reward: "oil-1" as QuestRewardId,
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
      cargo: null,
      need: 1,
      reward: "grain-2" as QuestRewardId,
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
        cargo: null,
        need,
        reward: "gold-1" as QuestRewardId,
        text: {
          rival: `One cargo. One trick. Run ${need} types at once or stay a footnote in my ledger.`,
          guide: `${need} different cargoes on the clock at once, boss — breadth is what the ★ line pays for, and it is what survives a bad map.`,
          foreman: `${need} cargo types running at once. That's a freight concern; one line is a hobby.`,
        },
      }];
    },
  },
];

export function questOffers(v: QuestView): QuestDef[] {
  return QUESTS.flatMap((r) => r.offers(v).map((o) => ({ ...o, kind: r.kind, strategy: r.strategy })));
}

export interface SelectQuestsOptions {
  max?: number;
  exclude?: Iterable<string>;
  avoid?: Iterable<QuestStrategy>;
}

export function selectQuests(
  pool: readonly QuestDef[], rng: () => number, opts: SelectQuestsOptions = {},
): QuestDef[] {
  const max = Math.max(1, opts.max ?? QUEST_OFFER_MAX);
  const excluded = new Set(opts.exclude ?? []);
  const avoid = new Set(opts.avoid ?? []);
  const shuffled = pool.filter((q) => !excluded.has(q.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const preferred = shuffled.filter((q) => !avoid.has(q.strategy));
  const order = preferred.length ? preferred : shuffled;
  const seen = new Set<QuestStrategy>();
  const picked: QuestDef[] = [];
  for (const q of order) {
    if (picked.length >= max) break;
    if (seen.has(q.strategy)) continue;
    seen.add(q.strategy);
    picked.push(q);
  }
  return picked;
}

export function questHave(def: QuestDef, v: QuestView): number {
  switch (def.kind) {
    case "claim-cargo":
      return def.cargo && v.cargoesRunning.includes(def.cargo) ? 1 : 0;
    case "connect-depots":
      return v.connected;
    case "tune-depot":
      return v.tunedDepots > 0 && v.bestYield >= (def.threshold ?? 2) ? 1 : 0;
    case "city-tier":
      return v.townLevel;
    case "run-types":
      return typesRunning(v.cargoesRunning);
    default:
      return 0;
  }
}

export const questDone = (def: QuestDef, v: QuestView): boolean => questHave(def, v) >= def.need;
export const questReward = (def: QuestDef): QuestReward => QUEST_REWARDS[def.reward];
export const questText = (def: QuestDef, speaker: QuestSpeaker): string => def.text[speaker];

export const speakerFor = (strategy: QuestStrategy, story: boolean): QuestSpeaker => {
  if (!story) return "foreman";
  return strategy === "claim" || strategy === "link" ? "rival" : "guide";
};

export const speakerName = (speaker: QuestSpeaker, rivalName?: string | null): string => {
  if (speaker === "foreman") return FOREMAN_NAME;
  if (speaker === "guide") return GUIDE_NAME;
  return rivalName ?? "The rival";
};

export function questProgressText(def: QuestDef, v: QuestView): string {
  if (def.kind === "tune-depot") return `×${v.bestYield.toFixed(1)} of ×${def.threshold ?? 2}`;
  return `${Math.min(questHave(def, v), def.need)}/${def.need}`;
}

export const questLine = (def: QuestDef, speaker: QuestSpeaker, rivalName?: string | null): string =>
  `${speakerName(speaker, rivalName)}: ${questText(def, speaker)}`;

export const cargoOfIndustry = (type: string): Cargo | null =>
  INDUSTRY_BY_KEY[type]?.cargo ?? null;
