import { useEffect, useRef, useState } from "react";
// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the front door: one engraved menu over a living plate.
//
// The menu is chrome, not game: three doors (Play, Settings, How to Play) on
// the theme's iron-and-brass language, standing over the docks-at-first-light
// plate while it breathes (one slow Ken Burns drift), the theme's seamless
// smoke crosses it, and a few embers rise from the lamp — all compositor-only
// transforms, all killed outright under prefers-reduced-motion, and none of
// it near a canvas, because there is no canvas yet.
//
// · PLAY leaves for the mode screen (StartScreen), which wears the same
//   animated plate, so the two read as one place and not two apps.
// · SETTINGS is deliberately UNWIRED: another crew is furnishing that room
//   (SETTINGS-01). The button says so in one manila line instead of dying
//   silently — replace `onSettingsNote` with the real sheet when it lands.
// · HOW TO PLAY raises the TUT-01 tour itself (`force: true` — a player who
//   asked "never show this again" at boot still gets to read the rules when
//   they ask for them by name), over a host inside the menu.
// ══════════════════════════════════════════════════════════════════════════
import { showTutorial, type TutorialHandle } from "../iso/tutorial";
import { FREE_SETUP_TRACK } from "../iso/game";
import { RIVAL_SKILLS, resolveSkillKey } from "../iso/skill";
import { loadStoryProgress } from "../story/progress";
import { CHAPTERS } from "../story/chapters";

export interface MainMenuProps {
  onPlay: () => void;
}

/** Deterministic embers: same sixteen every visit, no Math.random flicker. */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 61) % 100,
  delay: (i * 1.7) % 12,
  dur: 11 + ((i * 3) % 7),
  drift: ((i % 5) - 2) * 14,
  size: 2 + (i % 3),
}));

export default function MainMenu({ onPlay }: MainMenuProps) {
  const [settingsNote, setSettingsNote] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const howToRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef<TutorialHandle | null>(null);

  // The tour is a DOM projector beside this component, exactly as it is
  // beside game.ts: React owns the host div and the "is it standing" state,
  // the projector owns its own listeners and tears them down on close.
  useEffect(() => {
    if (!howTo || !howToRef.current) return;
    const handle = showTutorial(howToRef.current, {
      force: true,
      vpTarget: RIVAL_SKILLS[resolveSkillKey()].winTarget,
      freeTrack: FREE_SETUP_TRACK,
    });
    tourRef.current = handle;
    if (!handle) { setHowTo(false); return; }
    void handle.promise.then(() => { tourRef.current = null; setHowTo(false); });
    return () => { handle.destroy(); tourRef.current = null; };
  }, [howTo]);

  const progress = loadStoryProgress();
  const filed = CHAPTERS.filter((c) => progress.results[c.id] === "win").length;

  return (
    <main className="start-screen menu" aria-label="Hexmatch main menu">
      <div className="menu-embers" aria-hidden="true">
        {EMBERS.map((e, i) => (
          <span key={i} style={{
            left: `${e.x}%`,
            animationDelay: `${e.delay}s`,
            animationDuration: `${e.dur}s`,
            width: e.size, height: e.size,
            ["--drift" as string]: `${e.drift}px`,
          }} />
        ))}
      </div>
      <div className="menu-card">
        <span className="menu-emblem" aria-hidden="true" />
        <p className="start-kicker">EST. 1949 · THE ISLAND RUNS ON WHOEVER MOVES IT FIRST</p>
        <h1 className="menu-title">Hexmatch Industries</h1>
        <p className="menu-sub">The Foundry Syndicate · a campaign in five contracts</p>
        <nav className="menu-actions" aria-label="Main menu">
          <button type="button" className="menu-btn primary" data-sfx="open" onClick={onPlay}>
            Play<span className="mb-tag">campaign · sandbox · rooms</span>
          </button>
          <button type="button" className="menu-btn" data-sfx="click" onClick={() => setSettingsNote(true)}>
            Settings<span className="mb-tag">the room is being furnished</span>
          </button>
          <button type="button" className="menu-btn" data-sfx="open" onClick={() => setHowTo(true)}>
            How to Play<span className="mb-tag">eight cards, one loop</span>
          </button>
        </nav>
        {settingsNote ? (
          <p className="menu-note" role="status">
            Settings arrive with the next contract — another crew is furnishing that room.
          </p>
        ) : null}
        <p className="menu-campaign">
          {filed > 0
            ? `Campaign: ${filed} of ${CHAPTERS.length} contracts filed · ${progress.unlocked} open`
            : progress.introSeen
              ? "The reel is watched. The first contract is open."
              : "No contracts filed. The first one is open."}
        </p>
      </div>
      <p className="menu-foot">
        Graphics derived from OpenGFX (© the OpenGFX team, GPLv2) · type: Cinzel, Barlow, Special Elite (SIL OFL)
      </p>
      {howTo ? <div className="menu-howto" ref={howToRef} /> : null}
    </main>
  );
}
