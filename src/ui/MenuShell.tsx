import { useEffect, useRef, useState, type ReactNode } from "react";
import logoUrl from "../assets/poster/logo.webp";
import { showTutorialMenu } from "../iso/guide/menu";
import { loadProgress, resetProgress } from "../iso/guide/progress";
import { queueGuideSection } from "../iso/guide/menu";
import { showSettingsSheet } from "../iso/settings-sheet";
import { showStorePanel } from "../game/store-panel";
import { FREE_SETUP_TRACK } from "../iso/game";
import { RIVAL_SKILLS, resolveSkillKey } from "../iso/skill";
import { currentVersionLabel } from "./version";

// ══════════════════════════════════════════════════════════════════════════
// UI-3 (owner, 2026-09-27): the front-door shell from the UIX design.
//
// Every screen before a match (the main menu, the manager card, the lobby,
// the ladder, the join and matchmaking screens) stands in this one frame:
// the landscape behind everything (fixed, cover, never tiled), a header bar
// with the identity, the numbered scene tabs and the help and full-screen
// buttons, one card in the middle, and a footer line.
//
// The header tabs are real doors. Settings, Tutorial and Store raise the same
// projectors the in-game ☰ menu raises, so they work from every screen here.
// Home, Play and Ladder are handed in by the screen that owns the route.
//
// The header comes AFTER the card in the DOM (CSS puts it on top). Screen
// readers and the tests meet the card's own buttons first, and the card's
// "Play" is never shadowed by the tab of the same name.
// ══════════════════════════════════════════════════════════════════════════

export type ShellTab = "home" | "play" | "ladder";

export interface MenuShellProps {
  /** The scene this screen is, for the active tab underline. */
  tab: ShellTab | null;
  ariaLabel: string;
  className?: string;
  onHome?: () => void;
  onPlay?: () => void;
  onLadder?: () => void;
  /** FTUE-1 (#464): offered as a row in the Tutorial menu. */
  onStarterIsland?: () => void;
  children: ReactNode;
}

type Popup = "settings" | "tutorial" | "store" | "help" | null;

const HexMark = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7 16.5 9.5v5L12 17l-4.5-2.5v-5z" fill="currentColor" />
  </svg>
);

const canFullscreen = (): boolean =>
  typeof document !== "undefined" && !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;

export default function MenuShell({ tab, ariaLabel, className = "", onHome, onPlay, onLadder, onStarterIsland, children }: MenuShellProps) {
  const [popup, setPopup] = useState<Popup>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  // The three projectors mount the way they always have: React owns the host
  // div and the open flag, the projector owns its listeners and resolves its
  // promise on close. There is no live game here, so a Tutorial pick QUEUES
  // its section for the next boot.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || popup === null || popup === "help") return;
    const handle = popup === "settings"
      ? showSettingsSheet(host)
      : popup === "store"
        ? showStorePanel(host)
        : showTutorialMenu(host, {
          ctx: { vpTarget: RIVAL_SKILLS[resolveSkillKey()].winTarget, freeTrack: FREE_SETUP_TRACK },
          progress: loadProgress(),
          live: false,
          onRun: (id) => { queueGuideSection(id); return true; },
          onReset: () => { resetProgress(); },
          onStarterIsland,
        });
    void handle.promise.then(() => setPopup((p) => (p === popup ? null : p)));
    return () => { handle.destroy(); };
  }, [popup]);

  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (popup !== "help") return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPopup(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [popup]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const tabs: { id: string; n: string; label: string; on: boolean; go?: () => void }[] = [
    { id: "home", n: "01", label: "Home", on: tab === "home", go: onHome },
    { id: "play", n: "02", label: "Play", on: tab === "play", go: onPlay },
    { id: "ladder", n: "03", label: "Ladder", on: tab === "ladder", go: onLadder },
    { id: "settings", n: "04", label: "Settings", on: popup === "settings", go: () => setPopup("settings") },
    { id: "tutorial", n: "05", label: "Tutorial", on: popup === "tutorial", go: () => setPopup("tutorial") },
  ];
  // MON-1 (#367): the RUN Bits store stays a dev-only door.
  if (import.meta.env.DEV) tabs.push({ id: "store", n: "06", label: "Store", on: popup === "store", go: () => setPopup("store") });

  return (
    <main className={`start-screen px ${className}`.trim()} aria-label={ariaLabel}>
      <div className="px-scenery" aria-hidden="true" />
      {children}
      <header className="px-header">
        <div className="px-identity">
          <HexMark /> HEXMATCH <span className="px-slash">/</span> INDUSTRIES
          <span className="px-version">{currentVersionLabel()}</span>
        </div>
        <nav className="px-tabs" aria-label="Menu">
          {tabs.map((t) => (
            <button key={t.id} type="button" data-n={t.n} data-tab={t.id}
              className={t.on ? "active" : ""} aria-current={t.on ? "page" : undefined}
              disabled={!t.go && !t.on} data-sfx="tab" onClick={() => t.go?.()}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="px-actions">
          <button type="button" className="px-help" aria-label="How to play" data-sfx="open"
            onClick={() => setPopup("help")}>?</button>
          {canFullscreen() ? (
            <button type="button" className="px-paper" data-sfx="click" onClick={toggleFull}
              aria-label={full ? "Leave full screen" : "Full screen"}>
              <span>{full ? "WINDOW" : "FULL SCREEN"}</span>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d={full ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" : "M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"}
                  fill="none" stroke="currentColor" strokeWidth="2.4" />
              </svg>
            </button>
          ) : null}
        </div>
      </header>
      <footer className="px-footer">
        <span>1949 / A new empire begins</span>
        <span>The island is yours to build</span>
      </footer>
      {popup === "help" ? (
        <div className="px-backdrop" role="presentation" onClick={() => setPopup(null)}>
          <section className="px-dialog" role="dialog" aria-modal="true" aria-label="How to play"
            onClick={(e) => e.stopPropagation()}>
            <button type="button" className="px-close" aria-label="Close" data-sfx="close" onClick={() => setPopup(null)}>✕</button>
            <img className="px-dialog-logo" src={logoUrl} alt="" />
            <p className="px-kicker">FIELD NOTES / 1949</p>
            <h2>Move it first</h2>
            <p>Lay road and rail from your depots to the island's industries, keep the factories fed, and turn what they make into ★. First to the ★ line owns the island.</p>
            <button type="button" className="px-cta" data-sfx="open" onClick={() => setPopup("tutorial")}>
              Open the tutorial <span aria-hidden="true">→</span>
            </button>
          </section>
        </div>
      ) : null}
      {popup !== null && popup !== "help" ? <div className="menu-howto" ref={hostRef} /> : null}
    </main>
  );
}
