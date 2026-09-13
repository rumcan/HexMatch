// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the dialogue model: scenes, lines, and the rules they obey.
//
// A scene is data, exactly like the tutorial's steps and the ending's reels:
// `ScriptScene` is readable by a test with no DOM, and `src/story/stage.ts` is
// the ~250-line projector beside it. Three kinds of line, one union, so the
// projector stays exhaustive:
//
//   who: CastId   a spoken line — the dossier face appears with the mood in
//                 `face`, the nameplate wears the cast colour, and the wire
//                 typewriter writes the words out.
//   who: "narrator"  no face: a centered ledger line in the body face, for
//                 stage direction and the uncle's letters.
//   who: "title"  the plate and face drop away entirely and one engraved
//                 Cinzel card stands alone — chapter titles, the campaign
//                 title, "THE YEARS THAT FOLLOWED".
//
// `bg` on a line cross-fades the backdrop before the line is read; a scene
// also carries a default so its first line always stands somewhere.
//
// The validators at the bottom are what `tests/unit/story-script.test.ts`
// runs over every scene in the campaign: a line with no speaker, a mood a
// sheet cannot paint, or a backdrop key that does not exist is a build
// failure, not a blank card at 2am.
// ══════════════════════════════════════════════════════════════════════════
import { CAST, EXPRESSIONS, type CastId, type Expression } from "./cast";
import { BACKDROP_KEYS, type BackdropKey } from "./backdrops";

export interface ScriptLine {
  /** `player` is whoever the start screen chose (Anne or James Hextall); the
   *  stage resolves it to the live portrait before the first beat paints. */
  who: CastId | "player" | "narrator" | "title";
  /** The mood the face wears (cast sheets only; ignored on a solo portrait). */
  face?: Expression;
  /** Cross-fade to this place before the line is read. */
  bg?: BackdropKey;
  text: string;
}

export interface ScriptScene {
  /** Stable id: what tests, the feed and `?scene=` previews read. */
  id: string;
  /** Where the scene stands until a line moves it. */
  bg: BackdropKey;
  lines: readonly ScriptLine[];
}

/** Spoken-line shorthand — the shape almost every line in the campaign has.
 *  `player` is the start screen's tycoon, resolved by the stage. */
export const say = (
  who: CastId | "player", text: string, face?: Expression, bg?: BackdropKey,
): ScriptLine =>
  ({ who, text, ...(face ? { face } : {}), ...(bg ? { bg } : {}) });

/** A stage-direction line: no face, centered, read like a caption. */
export const narrate = (text: string, bg?: BackdropKey): ScriptLine =>
  ({ who: "narrator", text, ...(bg ? { bg } : {}) });

/** An engraved card standing alone. */
export const title = (text: string, bg?: BackdropKey): ScriptLine =>
  ({ who: "title", text, ...(bg ? { bg } : {}) });

export const isSpoken = (line: ScriptLine): line is ScriptLine & { who: CastId | "player" } =>
  line.who !== "narrator" && line.who !== "title";

/**
 * Every way a scene can be wrong, as strings a test can print. Empty on a
 * healthy scene. Deliberately a list and not a throw: one run reports every
 * defect in the campaign, so fixing copy is one pass and not a loop.
 */
export function sceneIssues(scene: ScriptScene): string[] {
  const issues: string[] = [];
  if (!scene.id.trim()) issues.push("scene has no id");
  if (!(BACKDROP_KEYS as string[]).includes(scene.bg)) issues.push(`${scene.id}: unknown backdrop "${scene.bg}"`);
  if (!scene.lines.length) issues.push(`${scene.id}: no lines`);
  scene.lines.forEach((line, i) => {
    const at = `${scene.id}[${i}]`;
    if (!line.text.trim()) issues.push(`${at}: empty text`);
    if (/\s{2,}/.test(line.text)) issues.push(`${at}: double space in "${line.text.slice(0, 40)}…"`);
    if (line.who !== "narrator" && line.who !== "title" && line.who !== "player" && !CAST[line.who]) {
      issues.push(`${at}: unknown speaker "${line.who}"`);
    }
    if (line.face && !(EXPRESSIONS as string[]).includes(line.face)) {
      issues.push(`${at}: unknown expression "${line.face}"`);
    }
    if (line.bg && !(BACKDROP_KEYS as string[]).includes(line.bg)) {
      issues.push(`${at}: unknown backdrop "${line.bg}"`);
    }
    if ((line.who === "title") && line.text.length > 96) {
      issues.push(`${at}: title card too long to engrave`);
    }
  });
  return issues;
}
