import { useEffect, useState, type CSSProperties } from "react";
import logoUrl from "../assets/poster/logo.webp";
import menuDuo from "../assets/poster/menu-duo.webp";
// CAST-1 (docs/CAST.md): the five managers of Hexmatch Industries — faces,
// stories, perks and who is hired live in src/story/managers.ts.
import {
  CAST_KEY, MANAGERS, fullName, loadManagerRecord, saveManagerPick, unlockLabel,
} from "../story/managers";
import { isUnlocked } from "../iso/managers";

/** The roster, in menu order (owner, 2026-09-27). Presentation only. */
export const MENU_CAST = MANAGERS;
export { CAST_KEY };

// ══════════════════════════════════════════════════════════════════════════
// STORY-01 / UI-3 — the front door, in the UIX poster design.
//
// One card in the MenuShell frame: the key art on the left (the whole
// cut-out, never cropped), Continue and Play on the art's foot, and a paper
// panel on the right with the ladder (top 10) and the Managers (CAST-1).
// Settings, Tutorial and the dev Store live in the shell's header tabs, the
// same projectors the in-game ☰ menu raises.
// ══════════════════════════════════════════════════════════════════════════
// MON-1 (#367): warm the store's entitlement cache while the menu stands.
import { loadStore } from "../game/store";
import { loadStoryProgress } from "../story/progress";
import { CHAPTERS, EMPLOYER, currentJobTitle } from "../story/chapters";
// PROG-1 (#475): the Scenarios door — four tuned maps beyond the default
// island, unlocked by winning. It stands whether Story mode is hidden or not.
import { SCENARIOS, effectiveUnlocked, loadScenarioProgress } from "../story/scenarios";
import { STORY_MODE_ENABLED } from "../story/flag";
// CONTINUE-01 (#191): the front door names the save it can resume. Read once
// per mount — returning from a match mounts the menu afresh, so a slot just
// written or cleared is always re-read.
import { describeSave, mostRecentSave, saveForMode, type SoloSaveSummary } from "../iso/save-summary";
import { rankStore } from "../net/rankstore";
import { badgeUrlFor } from "./rank-badge";
import { fmtRating, rankOf } from "../net/rating";
import MenuShell from "./MenuShell";

export interface MainMenuProps {
  onPlay: () => void;
  /**
   * CONTINUE-01 (#191): offered only while a resumable solo save exists. It
   * carries null for the sandbox or the contract id for a story slot — the
   * App turns that straight into the matching start choice, and the boot's
   * existing resume path does the rest.
   */
  onContinue?: (chapterId: string | null) => void;
  /** UI-3: the header's Ladder tab and the panel's "Full board" — the full ladder screen. */
  onLadder?: () => void;
  /** FTUE-1 (#464): the Tutorial menu's "Play the Starter Island" replay door. */
  onStarterIsland?: () => void;
  /**
   * PROG-1 (#475): leave for the scenario list. Absent, the door is not
   * offered — a surface with nowhere to list scenarios shows no dead door.
   */
  onScenarios?: () => void;
}

type LadderRow = { rank: number; username: string; rating: number; profileId?: string };
type LadderView = { entries: LadderRow[]; mine: { rank: number; rating: number } | null; total?: number };

export default function MainMenu({ onPlay, onContinue, onLadder, onStarterIsland, onScenarios }: MainMenuProps) {
  const [panel, setPanel] = useState<"ladder" | "managers">("ladder");
  const [ladder, setLadder] = useState<LadderView | null | "loading">("loading");

  useEffect(() => { void loadStore(); }, []);

  // The top 10, fetched once per mount: the same board the full ladder
  // screen reads, cut to ten so the front door answers "who's on top".
  useEffect(() => {
    let alive = true;
    rankStore().loadLadder(10)
      .then((v) => { if (alive) setLadder(v); })
      .catch(() => { if (alive) setLadder(null); });
    return () => { alive = false; };
  }, []);

  const progress = loadStoryProgress();
  const filed = CHAPTERS.filter((c) => progress.results[c.id] === "win").length;
  // PROG-1 (#475): the scenario shelf — how many maps are open, and the best
  // margin anywhere on it. Read once per mount, like the campaign line.
  const scenProgress = loadScenarioProgress();
  const scenOpen = effectiveUnlocked(scenProgress, progress);
  const scenPlayed = SCENARIOS.filter((s) => (scenProgress.results[s.id]?.wins ?? 0) > 0);
  const scenBest = scenPlayed
    .map((s) => scenProgress.results[s.id]!.bestMargin)
    .filter((m): m is number => m !== null && m !== undefined);
  // CONTINUE-01 (#191): the freshest resumable solo save, if any, takes the
  // primary button and Play steps down beside it. Story mode hidden: only the
  // sandbox slot is offered.
  const resume: SoloSaveSummary | null = !onContinue ? null
    : STORY_MODE_ENABLED ? mostRecentSave() : saveForMode(null);
  const toLadder = onLadder ?? onPlay;
  // CAST-1: who is hired — read once per mount (a win lands a new hire on
  // the next visit to the menu).
  const record = loadManagerRecord();
  const pickCast = (id: (typeof MANAGERS)[number]["id"]) => {
    if (!isUnlocked(record, id)) return;
    saveManagerPick(id);
    onPlay();
  };

  return (
    <MenuShell tab="home" ariaLabel="Hexmatch main menu" className="menu"
      onHome={() => setPanel("ladder")} onPlay={onPlay} onLadder={toLadder} onStarterIsland={onStarterIsland}>
      <div className="menu-embers" aria-hidden="true" />
      <div className="px-card px-home">
        <div className="px-home-stage">
          <img className="px-duo" src={menuDuo} alt="" aria-hidden="true" draggable={false} />
          <h1 className="menu-title menu-logo px-home-logo"><img src={logoUrl} alt="Hexmatch Industries" draggable={false} /></h1>
          <p className="px-topline">1949 / A new empire begins</p>
          <nav className="px-title-actions" aria-label="Main menu">
            {resume ? (
              <>
                <button type="button" className="px-btn-secondary menu-btn" data-sfx="open" onClick={onPlay}>
                  Play<span className="mb-tag">start a new game</span>
                </button>
                <button type="button" className="px-btn-primary menu-btn primary" data-sfx="open"
                  aria-label={`Continue — ${describeSave(resume)}`}
                  onClick={() => onContinue?.(resume.chapterId)}>
                  Continue<span className="px-arrow" aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <button type="button" className="px-btn-primary menu-btn primary" data-sfx="open" onClick={onPlay}>
                Play<span className="mb-tag">{STORY_MODE_ENABLED ? "campaign · sandbox · rooms" : "scenarios · sandbox · rooms"}</span><span className="px-arrow" aria-hidden="true">→</span>
              </button>
            )}
            {onScenarios ? (
              <button type="button" className="px-btn-secondary menu-btn" data-sfx="open" onClick={onScenarios}>
                Scenarios<span className="mb-tag">four maps · unlock by winning</span>
              </button>
            ) : null}
          </nav>
          <p className="menu-scenarios">
            {scenPlayed.length > 0 && scenBest.length > 0
              ? `Scenarios: ${scenOpen} of ${SCENARIOS.length} open · best +${Math.max(...scenBest)}★`
              : `Scenarios: ${scenOpen} of ${SCENARIOS.length} open`}
          </p>
        </div>
        <section className="px-detail" aria-label="The ladder and the Managers">
          <div className="px-detail-head">
            <div className="px-subtabs" role="tablist" aria-label="Panel">
              <button type="button" role="tab" aria-selected={panel === "ladder"} className={panel === "ladder" ? "active" : ""}
                data-sfx="tab" onClick={() => setPanel("ladder")}>The ladder</button>
              <span className="px-divider" aria-hidden="true" />
              <button type="button" role="tab" aria-selected={panel === "managers"} className={panel === "managers" ? "active" : ""}
                data-sfx="tab" onClick={() => setPanel("managers")}>The Managers</button>
            </div>
            <button type="button" className="px-select" data-sfx="open" onClick={panel === "ladder" ? toLadder : onPlay}
              aria-label={panel === "ladder" ? "View the full ladder — top ratings" : "Choose your manager"}>
              {panel === "ladder" ? "Full board" : "Choose"} <span aria-hidden="true">→</span>
            </button>
          </div>
          {STORY_MODE_ENABLED ? (
            <div className="px-campaign">
              <p className="menu-sub">The Foundry Syndicate · a campaign in five contracts</p>
              <p className="menu-sub menu-job">Your job: {currentJobTitle(progress.results)}, {EMPLOYER}</p>
              <p className="menu-campaign">
                {filed > 0
                  ? `Campaign: ${filed} of ${CHAPTERS.length} contracts filed · ${progress.unlocked} open`
                  : progress.introSeen
                    ? "The reel is watched. The first contract is open."
                    : "No contracts filed. The first one is open."}
              </p>
            </div>
          ) : null}
          {panel === "ladder" ? (
            <div className="menu-leaderboard px-body" aria-label="The Ladder — Top 10" data-testid="main-menu-leaderboard">
              <p className="px-kicker">Top 10 / rated quick matches</p>
              <h2 className="px-title">Who owns<br />the island</h2>
              <span className="px-rule" aria-hidden="true" />
              {ladder === "loading" ? (
                <p className="ladder-note" aria-live="polite">Reading the board…</p>
              ) : ladder === null ? (
                <p className="ladder-note">The ladder needs a signed-in RUN.world player. Quick match still works; your rating is kept on your own file.</p>
              ) : ladder.entries.length === 0 ? (
                <p className="ladder-note">Nobody has filed a rating yet. Win a quick match and this board has a first name on it.</p>
              ) : (
                <ol className="px-ladder" aria-label="Top 10 players">
                  {ladder.entries.slice(0, 10).map((row) => {
                    const tier = rankOf(row.rating);
                    return (
                      <li key={String(row.rank) + row.username} data-rank={String(row.rank)}>
                        <span className="px-ladder-place" aria-label={`Rank ${row.rank}`}>{String(row.rank).padStart(2, "0")}</span>
                        <img className="rank-badge" src={badgeUrlFor(tier.key)} alt="" aria-hidden="true" width={24} height={24} />
                        <span className="px-ladder-name">{row.username}<small>{tier.label}</small></span>
                        <span className="px-ladder-rating">{fmtRating(row.rating)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {ladder !== "loading" && ladder !== null && ladder.mine ? (
                <p className="px-ladder-mine">Your best: #{ladder.mine.rank} · {fmtRating(ladder.mine.rating)}</p>
              ) : null}
            </div>
          ) : (
            <div className="px-body">
              <p className="px-kicker">Hexmatch Industries · the managers</p>
              <h2 className="px-title">Pick your<br />manager</h2>
              <span className="px-rule" aria-hidden="true" />
              <div className="px-cast-list">
                {MENU_CAST.map((c) => {
                  const hired = isUnlocked(record, c.id);
                  return (
                    <button key={c.id} type="button" className={`px-cast${hired ? "" : " locked"}`} data-manager={c.id}
                      data-sfx={hired ? "open" : undefined} aria-disabled={!hired}
                      style={{ "--thumb": c.stage } as CSSProperties}
                      onClick={() => pickCast(c.id)}
                      aria-label={hired ? `Play as ${fullName(c.id)}` : `${fullName(c.id)} — locked: ${unlockLabel(c.id)}`}>
                      <img src={c.thumb} alt="" draggable={false} />
                      <span>
                        <b>{c.first} {c.last}</b>
                        <em className="px-cast-title">{c.title}</em>
                        {hired
                          ? <i className="px-cast-perk">{c.perk}</i>
                          : <i className="px-cast-lock">Locked · {unlockLabel(c.id)}</i>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </MenuShell>
  );
}
