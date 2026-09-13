// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the cast: who speaks, and the face they speak with.
//
// Every character in the campaign — the rivals, the guide, and the player's
// own two tycoons — lives here as one record: the name the wire and the
// dossier cards print, the accent colour their chapter card wears, and the
// portrait art. Portraits come in two shapes and the code never confuses
// them:
//
//   sheet  a painted 2×2 expression sheet (assets/story-src/sheet-<id>.png →
//          src/assets/story/face-<id>.webp). One quadrant per expression —
//          TL calm · TR smile · BL mad · BR shock — shown with
//          `background-size: 200% 200%` and a two-component position, i.e. a
//          uniform 2× scale and a crop. The theme's "no picture is scaled per
//          axis" rule holds because both components agree.
//   solo   a single painted portrait (the U1 mugshots in src/assets/ui/),
//          shown `cover`. A character with no sheet yet — or a player line,
//          which answers in its own mugshot — uses this, so a missing plate
//          degrades to a still face, never to a broken image.
//
// `faceOf` is the one seam the stage, the wire card and the chapter menu all
// read: it returns the url plus the quadrant position (or null for a solo
// portrait), so "show Torvin furious" is one call and cannot drift between
// the cutscene and the HUD.
// ══════════════════════════════════════════════════════════════════════════
import faceMabel from "../assets/story/face-mabel.webp";
import faceTorvin from "../assets/story/face-torvin.webp";
import faceKrag from "../assets/story/face-krag.webp";
import faceMarrow from "../assets/story/face-marrow.webp";
import faceRoque from "../assets/story/face-roque.webp";
import faceGriev from "../assets/story/face-griev.webp";

import soloVex from "../assets/ui/tycoon_vex.png";
import soloYou from "../assets/ui/tycoon_you.png";
import soloTorvin from "../assets/ui/tycoon_torvin.png";
import soloKrag from "../assets/ui/tycoon_krag.png";

/** The four moods a sheet paints, in quadrant order. */
export type Expression = "calm" | "smile" | "mad" | "shock";
export const EXPRESSIONS: readonly Expression[] = ["calm", "smile", "mad", "shock"];

/**
 * Quadrant positions for `background-position` under `background-size:
 * 200% 200%`: 0% pins the sheet's left/top edge to the box, 100% pins its
 * right/bottom edge — so the four combinations are exactly the four cells.
 */
export const FACE_POS: Record<Expression, readonly [number, number]> = {
  calm: [0, 0],
  smile: [100, 0],
  mad: [0, 100],
  shock: [100, 100],
};

export interface FaceSpec {
  url: string;
  /** Quadrant position for a sheet; null = solo portrait, drawn `cover`. */
  pos: readonly [number, number] | null;
}

export type CastId =
  | "torvin" | "krag" | "marrow" | "roque" | "griev"   // the rivals
  | "mabel"                                            // the guide
  | "vex" | "you";                                     // the player's tycoons

export interface CastMember {
  id: CastId;
  name: string;
  /** The dossier line under the name. */
  role: string;
  /** The accent their chapter card, nameplate and wire keyline wear. */
  colour: string;
  sheet: string | null;
  solo: string | null;
  /** Two sentences of voice direction — what every line of theirs obeys. */
  voice: string;
}

export const CAST: Record<CastId, CastMember> = {
  torvin: {
    id: "torvin",
    name: "Torvin",
    role: "The Old Baron · Blackwood Freight",
    colour: "#e2704f",
    sheet: faceTorvin,
    solo: soloTorvin,
    voice: "An old industrial baron who desperately wants to sound dangerous and is catastrophically bad at comebacks. Every threat he makes collapses under its own wordplay, and he never notices.",
  },
  krag: {
    id: "krag",
    name: "Krag",
    role: "The Quarry King · Stone & Thunder Co.",
    colour: "#c07b34",
    sheet: faceKrag,
    solo: soloKrag,
    voice: "A mountain of a man of very few words. Speaks about stone, weather and load-bearing things with total sincerity; oddly tender about rocks. Never shouts — he doesn't need to.",
  },
  marrow: {
    id: "marrow",
    name: "Silas Marrow",
    role: "The Toll King · Meridian Rail Trust",
    colour: "#7cb6d8",
    sheet: faceMarrow,
    solo: null,
    voice: "Soft-spoken rail magnate who threatens in condolences and church euphemisms. Immaculate, patient, never raises his voice; every kindness is an invoice.",
  },
  roque: {
    id: "roque",
    name: "Delphine Roque",
    role: "The Oil Queen · Roque Black Gold",
    colour: "#ffd98a",
    sheet: faceRoque,
    solo: null,
    voice: "Glamorous, fast, laughing oil wildcatter. Calls everyone darling, flirts with danger and with you, treats sabotage as a party invitation. Always amused — even when losing.",
  },
  griev: {
    id: "griev",
    name: "Aldous Griev",
    role: "Chairman · The Foundry Syndicate",
    colour: "#b23a26",
    sheet: faceGriev,
    solo: null,
    voice: "The Chairman. Speaks in minutes, bylaws and adjournments; terrifyingly courteous, never angry, files everything. His politeness is the threat.",
  },
  mabel: {
    id: "mabel",
    name: "Mabel Quill",
    role: "Your bookkeeper · Hextall Freight",
    colour: "#63c08a",
    sheet: faceMabel,
    solo: null,
    voice: "The uncle's bookkeeper who stayed on: warm, sharp, numbers-minded. Hints arrive as bookkeeping — she never lectures, she reconciles. Calls the player 'boss' and means it.",
  },
  vex: {
    id: "vex",
    name: "Anne Hextall",
    role: "Hextall Freight · the inherited name",
    colour: "#5aa8ff",
    sheet: null,
    solo: soloVex,
    voice: "The player. Dry, unimpressed, punctures every rival's bit with one line — the same voice the rivalry wire has always answered in.",
  },
  you: {
    id: "you",
    name: "James Hextall",
    role: "Hextall Freight · the inherited name",
    colour: "#5aa8ff",
    sheet: null,
    solo: soloYou,
    voice: "The player. Dry, unimpressed, punctures every rival's bit with one line — the same voice the rivalry wire has always answered in.",
  },
};

export const CAST_IDS = Object.keys(CAST) as CastId[];

/** The rivals, in the order the campaign meets them. */
export const RIVALS: readonly CastId[] = ["torvin", "marrow", "roque", "krag", "griev"];

/** The guide is never a rival and never a player; the type says so loudly. */
export const GUIDE: CastId = "mabel";

export const isRival = (id: CastId): boolean => RIVALS.includes(id);
export const isPlayer = (id: CastId): boolean => id === "vex" || id === "you";

/**
 * The one seam for "show me this character looking this way". A sheet gives
 * the quadrant; a character without a sheet (or an expression their sheet
 * lacks) falls back to the solo mugshot drawn `cover`, so dialogue never
 * blocks on art.
 */
export function faceOf(id: CastId, expression: Expression = "calm"): FaceSpec {
  const member = CAST[id];
  if (member.sheet) return { url: member.sheet, pos: FACE_POS[expression] };
  if (member.solo) return { url: member.solo, pos: null };
  return { url: faceMabel, pos: FACE_POS.calm };
}

/**
 * Resolve a script speaker to a concrete cast member: `player` becomes the
 * tycoon the start screen chose, everyone else is themselves.
 */
export const resolveSpeaker = (
  who: CastId | "player", player: "vex" | "you",
): CastId => (who === "player" ? player : who);

/** The mood a rivalry direction plays — attacks land angry, thwarted reads shocked. */
export const FACE_FOR_DIRECTION: Record<"attack" | "retort" | "thwarted" | "banter", Expression> = {
  attack: "mad",
  retort: "smile",
  thwarted: "shock",
  banter: "smile",
};
