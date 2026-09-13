import { useEffect, useRef, useState } from "react";
import "./game/styles.css";
import { startIsoGame } from "./iso/game";
import StartScreen, { type StartChoice } from "./ui/StartScreen";
// STORY-01: the front door — Play / Settings / How to Play over a living
// plate. Play leads to the mode screen; the menu never mounts the game.
import MainMenu from "./ui/MainMenu";
// STORY-01: the opening reel stands between the menu and the first contract —
// one skippable cinematic, played once (watched or skipped both count), and
// replayable from the campaign menu. It is a DOM projector over an empty
// host, exactly like the tour and the ledger, so React only owns the seam:
// "the reel is standing" is one piece of state with a host div under it.
import { INTRO_SCENE } from "./story/intro";
import { showScene, type SceneHandle } from "./story/stage";
import {
  introSuppressed, loadStoryProgress, markIntroSeen, pinnedChapter,
} from "./story/progress";
import { chapterById } from "./story/chapters";

/**
 * Multiplayer is opt-in: keeping the start screen outside the game means the
 * AI match remains playable without an account or a realtime connection.
 */
export default function App() {
  const [choice, setChoice] = useState<StartChoice | null>(null);
  /** STORY-01: the front door stands until Play is pressed (or a playtest
   *  link pins a contract, which walks straight past it). */
  const [atMenu, setAtMenu] = useState(true);
  /** STORY-01: leaving a contract through the ledger's third door reopens the
   *  mode screen ON the campaign list, seals and all. */
  const [backToCampaign, setBackToCampaign] = useState(false);
  /** STORY-01: the reel, and what starts when it settles (null = the menu). */
  const [reel, setReel] = useState<{ next: StartChoice | null } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const reelHandle = useRef<SceneHandle | null>(null);

  // STORY-01: a story choice opens with the reel the FIRST time — watched or
  // skipped both mark it seen — unless a playtest link suppresses it. The
  // reel never blocks a sandbox match or a networked seat.
  const begin = (next: StartChoice) => {
    if (next.mode === "story-intro") {
      // the reel unmounts the mode screen; when it settles the player should
      // be standing where they were — the campaign list, not the mode pick.
      setBackToCampaign(true);
      setReel({ next: null });
      return;
    }
    // any other door forgets the campaign-list return — the mode screen
    // reopens where the player is actually heading from.
    if (next.mode !== "story") setBackToCampaign(false);
    const progress = loadStoryProgress();
    // The reel is the campaign's opening, not chapter one's: it stands before
    // whichever contract comes first for a player who has not seen it, and
    // never twice (`?storyintro=0` keeps it out of a playtest link's way).
    if (next.mode === "story" && !progress.introSeen && !introSuppressed()) {
      setReel({ next });
      return;
    }
    setChoice(next);
  };

  useEffect(() => {
    if (!reel || !reelRef.current) return;
    const handle = showScene(reelRef.current, INTRO_SCENE, { skipLabel: "Skip reel ▸▸" });
    reelHandle.current = handle;
    void handle.promise.then(() => {
      reelHandle.current = null;
      markIntroSeen();
      setReel(null);
      if (reel.next) setChoice(reel.next);
    });
    return () => { handle.destroy(); reelHandle.current = null; };
  }, [reel]);

  // STORY-01: `?chapter=<id>` is a playtest link straight into a contract —
  // the same shape as `?rival=` or `?seed=`. It steps over the menu lock and
  // (with `?storyintro=0`) over the reel, and records nothing: the campaign
  // record only ever moves through a finished match.
  useEffect(() => {
    const pin = pinnedChapter();
    if (!pin || !chapterById(pin)) return;
    begin({ mode: "story", chapter: pin, portrait: "vex" });
  }, []); // boot-only: a playtest link is read once, like every other boot flag

  // SETTINGS-01/GFX-01: the in-game ☰ menu's "Quit to main menu" walks out
  // through here — unmount the match exactly as a navigation would (the save
  // is left alone; Play resumes what the pagehide autosave keeps), and stand
  // the front door back up. Rooms use the same door, and `startIsoGame` turns
  // it into "Leave room" wording with a confirm of its own.
  const quitToMenu = () => {
    setChoice(null);
    setBackToCampaign(false);
    setAtMenu(true);
  };

  useEffect(() => {
    if (!choice || !ref.current) return;
    const cleanup = choice.mode === "ai"
      ? startIsoGame(ref.current, { role: "solo", portrait: choice.portrait, onQuitToMenu: quitToMenu })
      : choice.mode === "story"
        // STORY-01: the contract rides in on the options — rival, voice, ★
        // line, seed and the three scenes — and the ledger's third door
        // returns to the campaign menu through `onStoryExit`.
        ? startIsoGame(ref.current, {
          role: "solo",
          portrait: choice.portrait,
          story: choice.chapter,
          onQuitToMenu: quitToMenu,
          onStoryExit: () => {
            setChoice(null);
            setBackToCampaign(true);
            setAtMenu(false);
          },
        })
        // The reel is never a mounted game: `begin` intercepts it, and this
        // branch exists only so the union stays exhaustive.
        : choice.mode === "story-intro"
          ? undefined
          : startIsoGame(ref.current, { seed: choice.seed, role: choice.mode, net: choice.net, portrait: choice.portrait, onQuitToMenu: quitToMenu });
    return () => { cleanup?.(); };
  }, [choice]);

  if (reel) return <div ref={reelRef} className="reel-host" />;
  if (choice) return <div ref={ref} className="game-root" />;
  if (atMenu) return <MainMenu onPlay={() => { setBackToCampaign(false); setAtMenu(false); }} />;
  return (
    <StartScreen
      onStart={begin}
      onBack={() => setAtMenu(true)}
      initial={backToCampaign ? "story" : "choose"}
    />
  );
}
