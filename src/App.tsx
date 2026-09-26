import { useEffect, useRef, useState } from "react";
import "./game/styles.css";
import "./game/theme-space-age.css";
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
import { STORY_MODE_ENABLED } from "./story/flag";
// RANK-01 (#147): the rating store is built HERE, once per page, and handed to
// the game. `iso/game.ts` may not import it — `rankstore.ts` reaches the RUN SDK
// and `window` at load — and a single instance is also what keeps one match's
// once-only guard in one place.
import { rankStore } from "./net/rankstore";
// #186: the ladder's gate on custom rules — a match that is not the shipped
// game does not feed the rating, whatever door it was started from.
import { isDefaultMatchSettings } from "./net/match-settings";
// #164: the "match in progress" memo lives in player storage so a page the
// platform kicked can offer the walk back on its next boot. Only the layer
// that mounts a networked match knows when that memo stops being true — a
// quit to menu or a decided match — so the drop is wired here, not in game.ts.
import { writeActiveMatch } from "./net/transport";
import { mostRecentSave } from "./iso/save-summary";

/**
 * run.world feedback (2026-09): the first launch skips the menu and the mode
 * screen and drops the player straight into a solo game, where the coach
 * teaches the loop one step at a time. Mode choices come after (the menu
 * stands normally from the second launch, and ☰ → Quit to main menu).
 */
export const ONBOARDED_KEY = "hexmatch:onboarded";
/** `?fresh=1`: play as a brand-new player — saves are neither read nor written. */
export const isFreshLink = (): boolean => {
  try { return new URLSearchParams(location.search).get("fresh") === "1"; } catch { return false; }
};
export function isFirstLaunch(): boolean {
  try {
    if (isFreshLink()) return true;
    if (localStorage.getItem(ONBOARDED_KEY)) return false;
    // A player with a save is not new, whatever the flag says.
    if (mostRecentSave()) return false;
    // Links that ask for something specific (a room, a contract, a seed) are
    // not a first launch either.
    const q = new URLSearchParams(location.search);
    for (const k of ["room", "chapter", "seed", "join"]) if (q.has(k)) return false;
    return true;
  } catch { return false; }
}

/**
 * FTUE-1 (#464): onboarding is DONE. Written when the player wins the
 * Starter Island or skips it ("Skip to the real game") — not at launch — so
 * the island is what a fresh browser plays, and a win or a skip is what
 * opens the normal game. Later launches read it and go straight to the main
 * menu. `?fresh=1` writes nothing (a brand-new player every time).
 */
export function markOnboarded(): void {
  try {
    if (!isFreshLink()) localStorage.setItem(ONBOARDED_KEY, "1");
  } catch { /* private mode */ }
}

/**
 * Multiplayer is opt-in: keeping the start screen outside the game means the
 * AI match remains playable without an account or a realtime connection.
 */
export default function App() {
  // FTUE-1 (#464): the first launch boots the STARTER ISLAND (a `starter: true`
  // ai choice — the guided scenario) and never again once onboarding is done
  // (won the island, or skipped it). `firstRun` rides along for the launch
  // extras (the camera opens on the town).
  const [firstRun, setFirstRun] = useState(isFirstLaunch);
  const [choice, setChoice] = useState<StartChoice | null>(
    firstRun ? { mode: "ai", portrait: "vex", starter: true } : null,
  );
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
    const pin = STORY_MODE_ENABLED ? pinnedChapter() : null;
    if (!pin || !chapterById(pin)) return;
    begin({ mode: "story", chapter: pin, portrait: "vex" });
  }, []); // boot-only: a playtest link is read once, like every other boot flag

  // SETTINGS-01/GFX-01: the in-game ☰ menu's "Quit to main menu" walks out
  // through here — unmount the match exactly as a navigation would (the save
  // is left alone; Play resumes what the pagehide autosave keeps), and stand
  // the front door back up. Rooms use the same door, and `startIsoGame` turns
  // it into "Leave room" wording with a confirm of its own.
  // FTUE-1 (#464): onboarding is NO LONGER marked at launch — it is marked
  // when the Starter Island is WON (its ledger's "Build another empire") or
  // SKIPPED ("Skip to the real game"), both of which run `goToNormalGame`
  // below. Until then the island survives reloads, exactly as the ticket
  // asks.
  const quitToMenu = () => {
    setChoice(null);
    setBackToCampaign(false);
    setAtMenu(true);
  };
  // FTUE-1 (#464): the Starter Island's exit — "Skip to the real game" (the
  // first screen's chip) or the won ledger's "Build another empire", both of
  // which land here: onboarding marked done, and the NORMAL game boots (the
  // real map, a real rival, no guided chain).
  const goToNormalGame = () => {
    markOnboarded();
    setFirstRun(false);
    setBackToCampaign(false);
    setAtMenu(false);
    setChoice({ mode: "ai", portrait: "vex", starter: false });
  };
  // FTUE-1 (#464): the Tutorial menu's "Play the Starter Island" — the
  // scenario again (fixed island, trainee, guided chain), on demand.
  const playStarterIsland = () => {
    setBackToCampaign(false);
    setAtMenu(false);
    setChoice({ mode: "ai", portrait: "vex", starter: true });
  };

  /**
   * #164: a NETWORKED seat walks out through the same door, but it also drops
   * the "match in progress" memo on the way: the player has answered the
   * question the memo exists to ask (they left), so a later boot must not
   * offer a walk back into a room they deliberately quit. The write is
   * fire-and-forget — storage refusing must never trap the player in a match
   * they are leaving.
   */
  const quitNetToMenu = () => {
    void writeActiveMatch(null).catch(() => { /* the memo is best-effort */ });
    quitToMenu();
  };

  useEffect(() => {
    if (!choice || !ref.current) return;
    const cleanup = choice.mode === "ai"
      ? startIsoGame(ref.current, {
        role: "solo", portrait: choice.portrait, onQuitToMenu: quitToMenu,
        conquest: choice.conquest === true,
        // run.world feedback: the very first game is coached, not toured.
        firstRun,
        // FTUE-1 (#464): the Starter Island — the fixed preset map, the
        // trainee rival, the 6★ line and the guided chain; its exit doors
        // open the normal game (skip chip, won ledger) and its WIN marks
        // onboarding done (a loss leaves it open: "Demand a rematch" runs
        // the island again).
        starterIsland: choice.starter === true || firstRun,
        onPlayNormalGame: goToNormalGame,
        onMatchEnded: choice.starter === true || firstRun
          ? (won) => { if (won) markOnboarded(); }
          : undefined,
      })
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
          : startIsoGame(ref.current, {
            seed: choice.seed,
            role: choice.mode,
            net: choice.net,
            portrait: choice.portrait,
            // #186: the room's rules — ★ line, opening purse, AI seats. The
            // session carries them too; passing them explicitly means a room
            // whose echo is still in flight plays the rules the lobby showed.
            settings: choice.settings ?? null,
            // RANK-01: only a quick match is rated (#147). `rank` is always
            // supplied so a future ranked door needs no plumbing; `ranked`
            // is what decides.
            // #186 (RANK-01): …and only a DEFAULT-RULES one. A match the host
            // customised — a shorter ★ line, a richer purse, a machine in the
            // other seat — is not a ladder match, so the settings are the
            // second gate on the flag: the queue cannot pair a rated game into
            // custom rules, and this makes sure nothing else can either.
            ranked: choice.ranked === true && isDefaultMatchSettings(choice.settings ?? null),
            rank: rankStore(),
            onQuitToMenu: quitNetToMenu,
            // #164: a decided match is nothing to rejoin — drop the memo the
            // start screen wrote when this seat was taken, so the next boot
            // offers the walk back only while a match is genuinely live.
            onMatchEnded: () => {
              void writeActiveMatch(null).catch(() => { /* best-effort */ });
            },
          });
    return () => { cleanup?.(); };
  }, [choice]);

  if (reel) return <div ref={reelRef} className="reel-host" />;
  if (choice) return <div ref={ref} className="game-root" />;
  if (atMenu) return (
      <MainMenu
        onPlay={() => { setBackToCampaign(false); setAtMenu(false); }}
        onStarterIsland={playStarterIsland}
      // CONTINUE-01 (#191): the front door's gold button jumps straight into
      // the freshest resumable solo save — sandbox slot or a contract — by
      // handing `begin` the same choice the mode screen would. The boot finds
      // the slot and resumes it; no slot is cleared on this path.
      onContinue={(chapterId) => begin(chapterId === null
        ? { mode: "ai", portrait: "vex" }
        : { mode: "story", chapter: chapterId, portrait: "vex" })}
    />
  );
  return (
    <StartScreen
      onStart={begin}
      onBack={() => setAtMenu(true)}
      initial={backToCampaign ? "story" : "choose"}
    />
  );
}
