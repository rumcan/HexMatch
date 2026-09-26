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
// · SETTINGS is furnished (SETTINGS-01 landed): it raises the same settings
//   sheet the in-game ☰ menu raises — `iso/settings-sheet.ts`, one projector,
//   two doors, so the front menu and a live match can never disagree about
//   which controls exist. Texture detail, miniature view, sound; everything
//   writes through its store and is remembered.
// · TUTORIAL raises the TUT-03 Tutorial MENU (`guide/menu.ts`) over a host
//   inside the menu: every section listed with a ✓ once it is done, each one
//   clickable. There is no game to run one in yet, so a pick QUEUES it and the
//   next boot opens on that section — the same door, the same list, whether
//   the player is standing on the front plate or in a match.
// ══════════════════════════════════════════════════════════════════════════
import { showTutorialMenu, type TutorialMenuHandle } from "../iso/guide/menu";
import { loadProgress, resetProgress } from "../iso/guide/progress";
import { queueGuideSection } from "../iso/guide/menu";
import { showSettingsSheet, type SettingsSheetHandle } from "../iso/settings-sheet";
// MON-1 (#367): the RUN Bits store — the same projector the in-game ☰ menu
// raises, so the door and a live match never quote a different price.
import { showStorePanel, type StorePanelHandle } from "../game/store-panel";
import { loadStore } from "../game/store";
import { FREE_SETUP_TRACK } from "../iso/game";
import { RIVAL_SKILLS, resolveSkillKey } from "../iso/skill";
import { loadStoryProgress } from "../story/progress";
import { CHAPTERS, EMPLOYER, currentJobTitle } from "../story/chapters";
import { STORY_MODE_ENABLED } from "../story/flag";
// CONTINUE-01 (#191): the front door names the save it can resume. Read once
// per mount — returning from a match mounts the menu afresh, so a slot just
// written or cleared is always re-read.
import { describeSave, mostRecentSave, saveForMode, type SoloSaveSummary } from "../iso/save-summary";
import { currentVersionLabel } from "./version";
import { rankStore } from "../net/rankstore";
import { badgeUrlFor } from "./rank-badge";
import { fmtRating, rankOf } from "../net/rating";

export interface MainMenuProps {
  onPlay: () => void;
  /**
   * CONTINUE-01 (#191): offered only while a resumable solo save exists. It
   * carries null for the sandbox or the contract id for a story slot — the
   * App turns that straight into the matching start choice, and the boot's
   * existing resume path does the rest.
   */
  onContinue?: (chapterId: string | null) => void;
}

/** Deterministic embers: same sixteen every visit, no Math.random flicker. */
const EMBERS = Array.from({ length: 14 }, (_, i) => ({
  x: (i * 61) % 100,
  delay: (i * 1.7) % 12,
  dur: 11 + ((i * 3) % 7),
  drift: ((i % 5) - 2) * 14,
  size: 2 + (i % 3),
}));

export default function MainMenu({ onPlay, onContinue }: MainMenuProps) {
  const [settings, setSettings] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const howToRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<TutorialMenuHandle | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<SettingsSheetHandle | null>(null);
  // MON-1 (#367): the Store door. Same projector contract as the two above —
  // React owns the host div and the open flag, the panel owns its listeners
  // and resolves its promise on close.
  const [store, setStore] = useState(false);
  const storeRef = useRef<HTMLDivElement>(null);
  const storeHandleRef = useRef<StorePanelHandle | null>(null);

  // The Tutorial menu is a DOM projector beside this component, exactly as it
  // is beside game.ts: React owns the host div and the "is it standing" state,
  // the projector owns its own listeners and tears them down on close. No game
  // is live here, so `live: false` and a pick queues the section for the boot.
  useEffect(() => {
    if (!howTo || !howToRef.current) return;
    const handle = showTutorialMenu(howToRef.current, {
      ctx: {
        vpTarget: RIVAL_SKILLS[resolveSkillKey()].winTarget,
        freeTrack: FREE_SETUP_TRACK,
      },
      progress: loadProgress(),
      live: false,
      onRun: (id) => { queueGuideSection(id); return true; },
      onReset: () => { resetProgress(); },
    });
    menuRef.current = handle;
    void handle.promise.then(() => { menuRef.current = null; setHowTo(false); });
    return () => { handle.destroy(); menuRef.current = null; };
  }, [howTo]);

  // Settings is the same DOM projector mounted the same way: React owns the
  // host and the open flag, the sheet owns its listeners and resolves its
  // promise on close (Done, backdrop, Escape — all inside the projector).
  useEffect(() => {
    if (!settings || !settingsRef.current) return;
    const handle = showSettingsSheet(settingsRef.current);
    sheetRef.current = handle;
    void handle.promise.then(() => { sheetRef.current = null; setSettings(false); });
    return () => { handle.destroy(); sheetRef.current = null; };
  }, [settings]);

  // MON-1 (#367): warm the entitlement cache while the menu stands, so the
  // Store door opens already knowing what the player owns. Fire-and-forget —
  // an unreachable store is a line of panel copy, not a slower front door.
  useEffect(() => {
    void loadStore();
  }, []);

  // …and mount the panel the same way the sheet and the tour are mounted.
  useEffect(() => {
    if (!store || !storeRef.current) return;
    const handle = showStorePanel(storeRef.current);
    storeHandleRef.current = handle;
    void handle.promise.then(() => { storeHandleRef.current = null; setStore(false); });
    return () => { handle.destroy(); storeHandleRef.current = null; };
  }, [store]);

  const progress = loadStoryProgress();
  const filed = CHAPTERS.filter((c) => progress.results[c.id] === "win").length;
  // CONTINUE-01 (#191): the freshest resumable solo save, if any — it gets
  // the gold door, and Play drops to a plain door beneath it. A fresh player
  // sees no Continue button and Play keeps the primary styling it always had.
  // Story mode hidden: only the sandbox slot is offered (a campaign save stays
  // on disk, untouched, for when the flag comes back).
  const resume: SoloSaveSummary | null = !onContinue ? null
    : STORY_MODE_ENABLED ? mostRecentSave() : saveForMode(null);

  // ── leaderboard (top 10) — fetched once per mount, same ladder the
  //    StartScreen's RANK-01 panel reads, but limited to 10 so the front
  //    door answers "who's on top" without a second click.
  type LadderRow = { rank: number; username: string; rating: number; profileId?: string };
  type LadderView = { entries: LadderRow[]; mine: { rank: number; rating: number } | null; total?: number };
  const [ladder, setLadder] = useState<LadderView | null | "loading">("loading");

  useEffect(() => {
    let alive = true;
    rankStore()
      .loadLadder(10)
      .then((v) => {
        if (alive) setLadder(v);
      })
      .catch(() => {
        if (alive) setLadder(null);
      });
    return () => {
      alive = false;
    };
  }, []);

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
        {STORY_MODE_ENABLED ? (<>
          <p className="menu-sub">The Foundry Syndicate · a campaign in five contracts</p>
          {/* BACK TO WORK: the player's job, and it grows with the campaign. */}
          <p className="menu-sub menu-job">Your job: {currentJobTitle(progress.results)}, {EMPLOYER}</p>
        </>) : null}
        <nav className="menu-actions" aria-label="Main menu">
          {resume ? (
            <button type="button" className="menu-btn primary" data-sfx="open"
              aria-label={`Continue — ${describeSave(resume)}`}
              onClick={() => onContinue?.(resume.chapterId)}>
              Continue<span className="mb-tag">{describeSave(resume)}</span>
            </button>
          ) : null}
          <button type="button" className={`menu-btn${resume ? "" : " primary"}`} data-sfx="open" onClick={onPlay}>
            Play<span className="mb-tag">{resume ? "start a new game" : STORY_MODE_ENABLED ? "campaign · sandbox · rooms" : "sandbox · rooms"}</span>
          </button>
          <button type="button" className="menu-btn" data-sfx="click" onClick={() => setSettings(true)}>
            Settings<span className="mb-tag">graphics · miniature · performance · clouds · sound</span>
          </button>
          <button type="button" className="menu-btn" data-sfx="open" onClick={() => setHowTo(true)}>
            Tutorial<span className="mb-tag">ten sections · replay any of them</span>
          </button>
          {/* MON-1 (#367): the Store door — unlockables bought with RUN Bits. */}
          {import.meta.env.DEV ? (
          <button type="button" className="menu-btn" data-sfx="open" onClick={() => setStore(true)}>
            Store<span className="mb-tag">unlockables · RUN Bits</span>
          </button>
          ) : null}
        </nav>
        {STORY_MODE_ENABLED ? <p className="menu-campaign">
          {filed > 0
            ? `Campaign: ${filed} of ${CHAPTERS.length} contracts filed · ${progress.unlocked} open`
            : progress.introSeen
              ? "The reel is watched. The first contract is open."
              : "No contracts filed. The first one is open."}
        </p> : null}
      </div>
      <section className="menu-leaderboard" aria-label="The Ladder — Top 10" data-testid="main-menu-leaderboard">
        <p className="start-kicker">THE LADDER</p>
        <h2 className="menu-leaderboard-title">Top Rankings — Top 10</h2>
        <p className="menu-leaderboard-sub">Every rated quick match moves one number. The badge is the band it lands in.</p>
        {ladder === "loading" ? (
          <p className="ladder-note" aria-live="polite">Reading the board…</p>
        ) : ladder === null ? (
          <p className="ladder-note">The ladder is not reachable from this page — it needs a signed-in RUN.world player. Quick match still works; the rating is kept on your own file.</p>
        ) : ladder.entries.length === 0 ? (
          <p className="ladder-note">Nobody has filed a rating yet. Win a quick match and this board has a first name on it.</p>
        ) : (
          <ol className="ladder-list menu-leaderboard-list" aria-label="Top 10 players">
            {ladder.entries.slice(0, 10).map((row) => {
              const tier = rankOf(row.rating);
              const key = tier.key;
              return (
                <li key={String(row.rank) + row.username} data-rank={String(row.rank)}>
                  <span className="ladder-place" aria-label={`Rank ${row.rank}`}>#{row.rank}</span>
                  <span className="rank-chip" data-tier={key}>
                    <img className="rank-badge" src={badgeUrlFor(key)} alt="" aria-hidden="true" width={22} height={22} />
                    <span className="rank-chip-text">
                      <b>{tier.label}</b>
                    </span>
                  </span>
                  <span className="ladder-name">{row.username}</span>
                  <span className="ladder-rating">{fmtRating(row.rating)}</span>
                </li>
              );
            })}
          </ol>
        )}
        {ladder !== "loading" && ladder !== null && ladder.mine ? (
          <p className="ladder-mine">
            <small>Your best: #{ladder.mine.rank} · {fmtRating(ladder.mine.rating)}</small>
          </p>
        ) : null}
        <button type="button" className="menu-ladder-link" onClick={onPlay} aria-label="View the full ladder — top ratings">
          The ladder <small>top ratings — view full board</small>
        </button>
      </section>
      <p className="menu-foot">{currentVersionLabel()}</p>
      {howTo ? <div className="menu-howto" ref={howToRef} /> : null}
      {settings ? <div className="menu-howto" ref={settingsRef} /> : null}
      {store ? <div className="menu-howto" ref={storeRef} /> : null}
    </main>
  );
}
