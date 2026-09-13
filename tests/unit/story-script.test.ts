// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the campaign's copy, welded to its cast, its places and its
// rules. Every scene in the game (five contracts × three scenes, plus the
// opening reel) is read here as DATA with no DOM, and every way a scene can
// be wrong — a speaker the cast does not know, a mood no sheet paints, a
// backdrop key with no plate, an empty line — is a failing test rather than
// a blank card in front of a player.
//
// The chapter table gets the same treatment the skill table gets elsewhere:
// ids unique, indices contiguous, seeds distinct (a contract is a place),
// the rival order is the cast order, and the ★ line only ever rises.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { CHAPTERS, allChapterScenes, chapterById } from "../../src/story/chapters";
import { INTRO_SCENE } from "../../src/story/intro";
import { sceneIssues } from "../../src/story/script";
import { CAST, RIVALS, GUIDE, isPlayer, isRival } from "../../src/story/cast";
import { SKILL_KEYS } from "../../src/iso/skill";
import { advisorBeats, ADVISOR_EVENTS } from "../../src/story/advisor";
import { STORY_VOICES } from "../../src/story/voices";
import type { RivalryScene } from "../../src/iso/rivalry";

describe("STORY-01 every scene in the campaign is well-formed", () => {
  const scenes = [...allChapterScenes(), INTRO_SCENE];
  it.each(scenes.map((s) => [s.id, s] as const))("%s has no defects", (_id, scene) => {
    expect(sceneIssues(scene), sceneIssues(scene).join("; ")).toEqual([]);
  });

  it("opens every contract briefing with an engraved card", () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.pre.lines[0].who, `${chapter.id} briefing opens cold`).toBe("title");
    }
  });

  it("gives every spoken line a face the cast can wear, and the reel a player voice", () => {
    for (const scene of scenes) {
      const spoken = scene.lines.filter((l) => l.who !== "narrator" && l.who !== "title");
      expect(spoken.length, `${scene.id} has nobody in it`).toBeGreaterThan(0);
      for (const line of spoken) {
        if (line.who !== "player") expect(CAST[line.who]).toBeTruthy();
      }
      // a cutscene without the player in it is a lecture, not a scene —
      // except the reel's title-bookended casts, which the player attends
      expect(scene.lines.some((l) => l.who === "player"), `${scene.id} never hears you`).toBe(true);
    }
  });
});

describe("STORY-01 the chapter table", () => {
  it("is five contiguous contracts with unique ids and distinct places", () => {
    expect(CHAPTERS.length).toBe(5);
    CHAPTERS.forEach((chapter, i) => {
      expect(chapter.index).toBe(i);
      expect(chapterById(chapter.id)).toBe(chapter);
    });
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length);
    expect(new Set(CHAPTERS.map((c) => c.seed)).size).toBe(CHAPTERS.length);
  });

  it("meets the cast in cast order, at a difficulty the game knows", () => {
    CHAPTERS.forEach((chapter, i) => {
      expect(chapter.rival, `${chapter.id} breaks the rival order`).toBe(RIVALS[i]);
      expect(isRival(chapter.rival)).toBe(true);
      expect(isPlayer(chapter.rival)).toBe(false);
      expect(chapter.rival).not.toBe(GUIDE);
      expect((SKILL_KEYS as string[]).includes(chapter.skill)).toBe(true);
    });
  });

  it("races to a ★ line that only rises", () => {
    const targets = CHAPTERS.map((c) => c.target);
    targets.forEach((t, i) => {
      if (i > 0) expect(t, "the campaign eases off").toBeGreaterThanOrEqual(targets[i - 1]);
      expect(t).toBeGreaterThan(0);
    });
    // the finale is the shipped full line
    expect(CHAPTERS[CHAPTERS.length - 1].target).toBeGreaterThanOrEqual(8);
  });

  it("gives every contract an objective the banner can pin", () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.objective.length).toBeGreaterThan(12);
      expect(chapter.objective).toContain(`${chapter.target}★`);
    }
  });
});

describe("STORY-01 the rivals' voices", () => {
  const deckScenes = (id: string): RivalryScene[] => {
    const voice = STORY_VOICES[id as keyof typeof STORY_VOICES];
    return voice ? [...voice.attack, ...voice.retort, ...voice.thwarted, ...voice.banter] : [];
  };

  it("casts a voice for every campaign rival except Torvin, who keeps his own", () => {
    for (const rival of RIVALS) {
      if (rival === "torvin") continue;
      expect(STORY_VOICES[rival], `${rival} has no deck`).toBeTruthy();
      for (const scene of deckScenes(rival)) expect(scene.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("starts every scene with the rival and ends it with the player", () => {
    for (const rival of RIVALS) {
      for (const scene of deckScenes(rival)) {
        expect(scene[0].speaker, `${rival} opens his own scene`).toBe("rival");
        expect(scene[scene.length - 1].speaker, `${rival} gets the last word`).toBe("you");
        scene.forEach((beat, i) => {
          expect(beat.speaker).toBe(i % 2 === 0 ? "rival" : "you");
          expect(beat.text.trim().length).toBeGreaterThan(0);
        });
      }
    }
  });
});

describe("STORY-01 the guide", () => {
  it("has something to say at every moment, and a tactic per contract", () => {
    for (const event of ADVISOR_EVENTS) {
      for (const chapter of CHAPTERS) {
        const beats = advisorBeats(event, chapter);
        expect(beats.length, `${event}/${chapter.id} is silent`).toBeGreaterThan(0);
        expect(beats[0].speaker, `${event} must open in Mabel's voice`).toBe("guide");
        beats.forEach((b) => expect(b.text.trim().length).toBeGreaterThan(0));
      }
    }
  });

  it("briefs each contract in its own words", () => {
    const welcomes = CHAPTERS.map((c) => advisorBeats("welcome", c)[0].text);
    expect(new Set(welcomes).size).toBe(CHAPTERS.length);
  });

  it("is the guide, not a rival and not a player", () => {
    expect(isRival(GUIDE)).toBe(false);
    expect(isPlayer(GUIDE)).toBe(false);
    expect(CAST[GUIDE].name).toBe("Mabel Quill");
  });
});
