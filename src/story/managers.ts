// ══════════════════════════════════════════════════════════════════════════
// CAST-1 — the managers of Hexmatch Industries, as the menus show them
// (docs/CAST.md). The RULES live in `src/iso/managers.ts` (pure); this file is
// the faces, the stories and the one localStorage record of who is hired.
//
// Art comes from `tools/cast/slice-avatars.py`: hero (the stage cut-out),
// thumb (a flat-colour square face), and for the new cast the bust / think /
// ghost poses. James and Anne keep the hero/thumb pair they shipped with.
// ══════════════════════════════════════════════════════════════════════════
import heroJames from "../assets/poster/hero-james.webp";
import heroAnne from "../assets/poster/hero-anne.webp";
import heroRafael from "../assets/poster/hero-rafael.webp";
import heroDolores from "../assets/poster/hero-dolores.webp";
import heroKenji from "../assets/poster/hero-kenji.webp";
import thumbJames from "../assets/poster/thumb-james.webp";
import thumbAnne from "../assets/poster/thumb-anne.webp";
import thumbRafael from "../assets/poster/thumb-rafael.webp";
import thumbDolores from "../assets/poster/thumb-dolores.webp";
import thumbKenji from "../assets/poster/thumb-kenji.webp";
import thumbGraves from "../assets/poster/thumb-graves.webp";
import bustGraves from "../assets/poster/bust-graves.webp";
import heroGraves from "../assets/poster/hero-graves.webp";
import {
  DEFAULT_MANAGER, FRESH_RECORD, MANAGER_IDS, UNLOCKS, isUnlocked, normalizeManager, readRecord, recordOutcome,
  type ManagerId, type ManagerRecord, type MatchOutcome,
} from "../iso/managers";

export type { ManagerId };

export interface ManagerProfile {
  id: ManagerId;
  first: string;
  last: string;
  /** "The Road Man" — the line under the name. */
  title: string;
  hero: string;
  thumb: string;
  /** UI accent (kicker, tabs, rule) — dark enough to read on paper. */
  accent: string;
  /** The flat stage colour the hero stands on (UIX: no gradients). */
  stage: string;
  quote: string;
  /** The 1949 story, two or three sentences. */
  bio: string;
  history: readonly (readonly [string, string, string])[];
  rivalry: string;
  perk: string;
  quirk: string;
}

export const MANAGERS: readonly ManagerProfile[] = [
  {
    id: "james", first: "James", last: "Calloway", title: "The Road Man",
    hero: heroJames, thumb: thumbJames, accent: "#d9600a", stage: "#f07d12",
    quote: "Build it first. Build it bigger. Then build the road to it.",
    bio: "Drove supply convoys across three countries in the war and came home certain the island only needed better roads. Bought a surplus army lorry in '46, graded his first mile by hand, and hasn't stopped since.",
    history: [
      ["1944", "The convoys", "Three countries, one lorry, no maps worth the paper."],
      ["1946", "The first mile", "Graded by hand outside the fourth town."],
      ["1949", "Hexmatch Industries", "Every new mile puts a rival on notice."],
    ],
    rivalry: "Graves owns the docks. James intends to own every road that reaches them.",
    perk: "Road Ways cost 25% less — dirt, street, road and highway.",
    quirk: "Rail Ways cost 10% more. He never trusted a train he couldn't overtake.",
  },
  {
    id: "anne", first: "Anne", last: "Whitmore", title: "The Rail Baroness",
    hero: heroAnne, thumb: thumbAnne, accent: "#00848c", stage: "#04b9c1",
    quote: "Anyone can lay track. I know when the train is due.",
    bio: "A signalman's daughter who ran the wartime freight timetables for the whole northern line. When the railways went up for sale in '48 she bought the timetables first and the track second.",
    history: [
      ["1943", "The timetables", "Every freight train in the north ran on her clock."],
      ["1948", "The sale", "She bought the schedules before anyone priced the rails."],
      ["1949", "Her move", "The island's cargo runs on time — her time."],
    ],
    rivalry: "Graves can keep his lorries. Anne already knows where his cargo is going.",
    perk: "Rail Ways cost 25% less — rail track, platforms and train depots.",
    quirk: "Road Ways cost 10% more. A lorry is a train that lost its nerve.",
  },
  {
    id: "rafael", first: "Rafael", last: "Duarte", title: "The Fixer",
    hero: heroRafael, thumb: thumbRafael, accent: "#9a6500", stage: "#e8a317",
    quote: "Everything on this island has a price. I just know who's selling.",
    bio: "Ran cargo through three blockaded ports and never filed the same manifest twice. He's legitimate now — mostly — and every dock foreman on the island owes him a favour he hasn't called in yet.",
    history: [
      ["1942", "The blockade", "Three ports shut, and his ships still came in."],
      ["1947", "Going straight", "One honest ledger, and one he keeps in his head."],
      ["1949", "The favours", "Time to call a few of them in."],
    ],
    rivalry: "Graves bought the magistrates. Rafael knows what they had for breakfast.",
    perk: "3 free Black Market sabotage cards (Blockade or Protest) every 5 minutes.",
    quirk: "Security Forces cost 50% more. He knows what guards can be paid to overlook.",
  },
  {
    id: "dolores", first: "Dolores", last: "Vance", title: "The Magnate",
    hero: heroDolores, thumb: thumbDolores, accent: "#4b7a46", stage: "#7fb07a",
    quote: "I don't do business with trouble. I simply own its landlord.",
    bio: "Old mill money from the mainland, she came to the island to buy it quietly, one parcel at a time. The police chief dines at her table on Thursdays, and nobody touches a Vance depot.",
    history: [
      ["1938", "The mills", "Inherited three, sold two, bought the town around the third."],
      ["1948", "The crossing", "Came to the island with a chequebook and no hurry."],
      ["1949", "The parcels", "One at a time, and every one of them guarded."],
    ],
    rivalry: "Graves plays rough. Dolores has never had to — and never will.",
    perk: "Security Forces are free.",
    quirk: "Black Market sabotage costs 20% more Gold. She pays extra so nobody can say she was there.",
  },
  {
    id: "kenji", first: "Kenji", last: "Arata", title: "The Prodigy",
    hero: heroKenji, thumb: thumbKenji, accent: "#2f6fa8", stage: "#3d86c6",
    quote: "There is always a faster line. I just haven't drawn it yet.",
    bio: "Top of his engineering class at twenty, he rebuilt a failing cannery's line with a slide rule and a stopwatch and tripled its output. To him every depot is a puzzle with a better answer.",
    history: [
      ["1947", "The slide rule", "Top of the class, and bored by it."],
      ["1948", "The cannery", "One line, one stopwatch, three times the output."],
      ["1949", "The island", "A hundred depots, each with a better answer."],
    ],
    rivalry: "Graves builds big. Kenji builds right, and lets the numbers do the shouting.",
    perk: "Tuning sessions score 10% more — a better yield from every Depot you tune.",
    quirk: "Level Ground costs 25% more. He'd rather redraw the plan than move the hill.",
  },
];

export const MANAGER_BY_ID: Record<ManagerId, ManagerProfile> =
  Object.fromEntries(MANAGERS.map((m) => [m.id, m])) as Record<ManagerId, ManagerProfile>;

export const fullName = (id: ManagerId): string => `${MANAGER_BY_ID[id].first} ${MANAGER_BY_ID[id].last}`;
export const managerThumb = (id: ManagerId): string => MANAGER_BY_ID[id].thumb;

/** The Rival — the face of the AI opponent. Not playable. */
export const RIVAL = {
  id: "graves",
  first: "Cornelius",
  last: "Graves",
  name: "Cornelius Graves",
  title: "Chairman · Graves Consolidated",
  thumb: thumbGraves,
  bust: bustGraves,
  hero: heroGraves,
  accent: "#8a2a1e",
  bio: "Owned the docks, the mines and half the magistrates before the war, and means to own them after it. Calls every newcomer \"son\", lights a cigar he never finishes, and has buried four rival firms without once raising his voice.",
} as const;

// ── who is hired: one localStorage key ──────────────────────────────────────
export const MANAGERS_STORAGE_KEY = "hexmatch:managers";

type Store = Pick<Storage, "getItem" | "setItem">;
const liveStorage = (): Store | null => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};

export function loadManagerRecord(storage: Store | null = liveStorage()): ManagerRecord {
  if (!storage) return { ...FRESH_RECORD, unlocked: [...FRESH_RECORD.unlocked] };
  try {
    const raw = storage.getItem(MANAGERS_STORAGE_KEY);
    return readRecord(raw ? JSON.parse(raw) : null);
  } catch {
    return readRecord(null);
  }
}

export function saveManagerRecord(record: ManagerRecord, storage: Store | null = liveStorage()): void {
  if (!storage) return;
  try { storage.setItem(MANAGERS_STORAGE_KEY, JSON.stringify(record)); } catch { /* private mode */ }
}

/**
 * File one finished match. Returns the managers it hired (the ending card
 * says "New manager unlocked!" for each). Never throws — a match's ending must
 * not fail because storage did.
 */
export function recordManagerMatch(outcome: MatchOutcome, storage: Store | null = liveStorage()): ManagerId[] {
  try {
    const { record, hired } = recordOutcome(loadManagerRecord(storage), outcome);
    if (outcome.won && !outcome.tutorial) saveManagerRecord(record, storage);
    return hired;
  } catch {
    return [];
  }
}

export const managerUnlocked = (id: ManagerId, record: ManagerRecord = loadManagerRecord()): boolean =>
  isUnlocked(record, id);

export const unlockLabel = (id: ManagerId): string => UNLOCKS[id].label;

export { MANAGER_IDS };

/** The menu's saved pick (was "james"/"anne"; legacy portraits map). */
export const CAST_KEY = "hexmatch:menu-character";

/**
 * The manager the next match plays as: the saved pick (legacy "vex"/"you"
 * mapped), as long as it is hired — a pick that is somehow locked (a cleared
 * record, a hand-edited key) falls back to the default rather than handing
 * out a perk that was never earned.
 */
export function savedManager(storage: Store | null = liveStorage()): ManagerId {
  let raw: string | null = null;
  try { raw = storage?.getItem(CAST_KEY) ?? null; } catch { raw = null; }
  const id = normalizeManager(raw);
  return isUnlocked(loadManagerRecord(storage), id) ? id : DEFAULT_MANAGER;
}

export function saveManagerPick(id: ManagerId, storage: Store | null = liveStorage()): void {
  try { storage?.setItem(CAST_KEY, id); } catch { /* private mode */ }
}
