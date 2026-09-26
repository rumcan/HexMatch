import { useEffect, useState } from "react";
import logoUrl from "../assets/poster/logo.webp";
import heroJames from "../assets/poster/hero-james.webp";
import heroAnne from "../assets/poster/hero-anne.webp";
import menuDuo from "../assets/poster/menu-duo.webp";
import thumbJames from "../assets/poster/thumb-james.webp";
import thumbAnne from "../assets/poster/thumb-anne.webp";

/** The two Hextalls (owner, 2026-09-26; copy from the UIX design). Presentation only. */
export const MENU_CAST = [
  { id: "james", first: "James", last: "Hextall", hero: heroJames, thumb: thumbJames, accent: "orange",
    quote: "Build it first. Build it bigger. Then build the road to it.",
    bio: "Founder of Hextall Freight. Came home from the war with one lorry and a plan to own every road on the island.",
    history: [
      ["1945", "The return", "One lorry, no depot, and no favors owed."],
      ["1947", "Hextall Freight", "His first road contract changed the island."],
      ["1949", "The race", "Every new mile puts a rival on notice."],
    ],
    rivalry: "He will outbuild anyone who thinks the island is already spoken for." },
  { id: "anne", first: "Anne", last: "Hextall", hero: heroAnne, thumb: thumbAnne, accent: "aqua",
    quote: "Anyone can build a factory. I read the ledger.",
    bio: "Runs the books and the backroom deals. Knows the price of every ton of ore on the island before the market does.",
    history: [
      ["1944", "The ledger", "She learned what the numbers never said aloud."],
      ["1947", "A quiet partner", "Every deal Hextall made crossed her desk."],
      ["1949", "Her move", "The island's markets are hers to read."],
    ],
    rivalry: "The rival can keep the factory. Anne already knows where its cargo is going." },
] as const;
export const CAST_KEY = "hexmatch:menu-character";

// ══════════════════════════════════════════════════════════════════════════
// STORY-01 / UI-3 — the front door, in the UIX poster design.
//
// One card in the MenuShell frame: the two Hextalls back to back on the left
// (the whole cut-out, never cropped), Continue and Play on the art's foot,
// and a paper panel on the right with the ladder (top 10) and the Hextalls.
// Settings, Tutorial and the dev Store live in the shell's header tabs, the
// same projectors the in-game ☰ menu raises.
// ══════════════════════════════════════════════════════════════════════════
// MON-1 (#367): warm the store's entitlement cache while the menu stands.
import { loadStore } from "../game/store";
import { loadStoryProgress } from "../story/progress";
import { CHAPTERS, EMPLOYER, currentJobTitle } from "../story/chapters";
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
}

type LadderRow = { rank: number; username: string; rating: number; profileId?: string };
type LadderView = { entries: LadderRow[]; mine: { rank: number; rating: number } | null; total?: number };

export default function MainMenu({ onPlay, onContinue, onLadder, onStarterIsland }: MainMenuProps) {
  const [panel, setPanel] = useState<"ladder" | "hextalls">("ladder");
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
  // CONTINUE-01 (#191): the freshest resumable solo save, if any, takes the
  // primary button and Play steps down beside it. Story mode hidden: only the
  // sandbox slot is offered.
  const resume: SoloSaveSummary | null = !onContinue ? null
    : STORY_MODE_ENABLED ? mostRecentSave() : saveForMode(null);
  const toLadder = onLadder ?? onPlay;
  const pickCast = (id: string) => {
    try { localStorage.setItem(CAST_KEY, id); } catch { /* private mode */ }
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
                  Continue<span className="mb-tag">{describeSave(resume)}</span><span className="px-arrow" aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <button type="button" className="px-btn-primary menu-btn primary" data-sfx="open" onClick={onPlay}>
                Play<span className="mb-tag">{STORY_MODE_ENABLED ? "campaign · sandbox · rooms" : "sandbox · rooms"}</span><span className="px-arrow" aria-hidden="true">→</span>
              </button>
            )}
          </nav>
        </div>
        <section className="px-detail" aria-label="The ladder and the Hextalls">
          <div className="px-detail-head">
            <div className="px-subtabs" role="tablist" aria-label="Panel">
              <button type="button" role="tab" aria-selected={panel === "ladder"} className={panel === "ladder" ? "active" : ""}
                data-sfx="tab" onClick={() => setPanel("ladder")}>The ladder</button>
              <span className="px-divider" aria-hidden="true" />
              <button type="button" role="tab" aria-selected={panel === "hextalls"} className={panel === "hextalls" ? "active" : ""}
                data-sfx="tab" onClick={() => setPanel("hextalls")}>The Hextalls</button>
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
              <p className="px-kicker">The Hextall files</p>
              <h2 className="px-title">Pick your<br />manager</h2>
              <span className="px-rule" aria-hidden="true" />
              <div className="px-cast-list">
                {MENU_CAST.map((c) => (
                  <button key={c.id} type="button" className="px-cast" data-accent={c.accent} data-sfx="open"
                    onClick={() => pickCast(c.id)} aria-label={`Play as ${c.first} ${c.last}`}>
                    <img src={c.thumb} alt="" draggable={false} />
                    <span><b>{c.first} {c.last}</b><i>“{c.quote}”</i></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </MenuShell>
  );
}
