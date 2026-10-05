/**
 * SETTINGS-1 (#701): the New Game settings page — one paper card, opened from
 * the Solo Play screen before a game boots. Every dial is the same preset-key
 * row as the Play screen's old map picker (`.ng-row` / `.ng-preset`), so the
 * page reads like the rest of the menu and works at phone width (rows wrap).
 *
 * The page edits a DRAFT: Back keeps the last saved settings, Reset puts the
 * draft back to today's game, Start game saves it and starts. The 3D switch is
 * a graphics preference, not a game setting: it applies at once and is never
 * part of the draft or the save.
 */
import { useState, type ReactNode } from "react";
import { RIVAL_SKILLS } from "../iso/skill";
import { setThreeSetting, threeSetting } from "../iso/three-pref";
import { TOWN_COUNT_CHOICES, type MoneyChoice, type TownLayout } from "../net/match-settings";
import { WIN_VP_PRESETS, describeNewGame, type NewGameSettings, type PlaySkill } from "./new-game-settings";

interface Props {
  initial: NewGameSettings;
  defaults: NewGameSettings;
  /** The seed of the last free-play game, for "replay that map". */
  lastSeed: number | null;
  onBack: () => void;
  onStart: (s: NewGameSettings, skillChosen: boolean) => void;
  /** Persist without starting (Reset, and every Back with changes kept). */
  onSave: (s: NewGameSettings, skillChosen: boolean) => void;
}

function Row(props: { name: string; note?: string; children: ReactNode }) {
  return (
    <div className="ng-row" role="group" aria-label={props.name}>
      <span className="ng-name">{props.name}</span>
      <div className="ng-presets">{props.children}</div>
      {props.note ? <p className="ng-note">{props.note}</p> : null}
    </div>
  );
}

function Preset(props: { on: boolean; onClick: () => void; label: string; small?: string; testId?: string }) {
  return (
    <button type="button" data-sfx="tab" data-testid={props.testId}
      className={`ng-preset${props.on ? " on" : ""}`} aria-pressed={props.on} onClick={props.onClick}>
      {props.label}{props.small ? <small>{props.small}</small> : null}
    </button>
  );
}

const SKILL_BLURB: Record<PlaySkill, string> = { easy: "relaxed rival", normal: "the shipped game", hard: "sharp rival" };
// TOWN-2b (#697): "organic" (the diagonal-avenue towns) is no longer offered for a NEW game;
// old organic saves and rooms still load as they were.
const LAYOUT_BLURB: Partial<Record<TownLayout, string>> = { planned: "avenues + plazas", grid: "city blocks" };
const MONEY_BLURB: Record<MoneyChoice, string> = { low: "½ cash", normal: "today", high: "2× cash" };

export function NewGameSettingsPage({ initial, defaults, lastSeed, onBack, onStart, onSave }: Props) {
  const [d, setD] = useState<NewGameSettings>(initial);
  const [skillChosen, setSkillChosen] = useState(false);
  const [three, setThree] = useState(() => threeSetting());
  const [seedText, setSeedText] = useState(initial.seed === null ? "" : String(initial.seed));
  const set = (patch: Partial<NewGameSettings>) => setD((prev) => ({ ...prev, ...patch }));
  const setSeed = (text: string) => {
    setSeedText(text);
    const n = Number(text);
    set({ seed: text.trim() === "" || !Number.isInteger(n) || n < 0 || n > 0xffffffff ? null : n });
  };
  const flag = (key: "rivers" | "hills" | "rings" | "diag", label: string, small: string) => (
    <Preset on={d[key]} onClick={() => set({ [key]: !d[key] } as Partial<NewGameSettings>)}
      label={`${label} ${d[key] ? "on" : "off"}`} small={small} testId={`ng-flag-${key}`} />
  );

  return (
    <div className="start-panel px-dialog-card ng-page">
      <p className="start-kicker">SOLO · NEW GAME</p>
      <h1>Game settings</h1>
      <p className="start-subtitle">Everything here starts at today's game. Change what you like; the Play screen remembers it for the next new game.</p>

      <Row name="Rival difficulty">
        {(["easy", "normal", "hard"] as const).map((k) => (
          <Preset key={k} on={d.skill === k} label={RIVAL_SKILLS[k].label} small={SKILL_BLURB[k]} testId={`ng-skill-${k}`}
            onClick={() => { set({ skill: k }); setSkillChosen(true); }} />
        ))}
      </Row>

      <Row name="Map size">
        {(["standard", "large"] as const).map((size) => (
          <Preset key={size} on={d.size === size} onClick={() => set({ size })} testId={`ng-size-${size}`}
            label={size === "large" ? "Large" : "Standard"} small={size === "large" ? "216×216" : "144×144"} />
        ))}
      </Row>

      <Row name="Town style">
        {(Object.keys(LAYOUT_BLURB) as TownLayout[]).map((layout) => (
          <Preset key={layout} on={d.layout === layout} onClick={() => set({ layout })} testId={`ng-layout-${layout}`}
            label={`${layout.charAt(0).toUpperCase()}${layout.slice(1)}`} small={LAYOUT_BLURB[layout]} />
        ))}
      </Row>

      <Row name="Towns">
        {TOWN_COUNT_CHOICES.map((n) => (
          <Preset key={n} on={d.towns === n} onClick={() => set({ towns: n })} testId={`ng-towns-${n}`}
            label={String(n)} small={n === defaults.towns ? "today" : n < defaults.towns ? "fewer" : "more"} />
        ))}
      </Row>

      <Row name="Win target" note={`The first seat to ${d.winVp}★ wins. Stars come from running Depots, paved routes, city upgrades and held sites.`}>
        {WIN_VP_PRESETS.map((p) => (
          <Preset key={p.vp} on={d.winVp === p.vp} onClick={() => set({ winVp: p.vp })} testId={`ng-win-${p.vp}`}
            label={`${p.vp}★`} small={p.label} />
        ))}
      </Row>

      <Row name="Starting money">
        {(["low", "normal", "high"] as const).map((m) => (
          <Preset key={m} on={d.money === m} onClick={() => set({ money: m })} testId={`ng-money-${m}`}
            label={m === "low" ? "Low" : m === "high" ? "High" : "Normal"} small={MONEY_BLURB[m]} />
        ))}
      </Row>

      <Row name="Map features">
        {flag("rivers", "Rivers", "dams + bridges")}
        {flag("hills", "Hills", "elevation")}
        {flag("rings", "Ring roads", "around towns")}
        {flag("diag", "Diagonals", "45° roads")}
      </Row>

      <Row name="Map seed" note={d.seed === null ? "A fresh map every game." : `Every new game is map ${d.seed} until you clear it.`}>
        <Preset on={d.seed === null} onClick={() => setSeed("")} label="Random" small="new map" testId="ng-seed-random" />
        <input className="ng-seed" inputMode="numeric" aria-label="Map seed number" placeholder="seed number"
          value={seedText} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} />
        {lastSeed !== null ? (
          <Preset on={d.seed === lastSeed} onClick={() => setSeed(String(lastSeed))}
            label="Last map" small={`seed ${lastSeed}`} testId="ng-seed-last" />
        ) : null}
      </Row>

      <Row name="Graphics" note="Applies from the next game; not part of the match.">
        <Preset on={three} testId="ng-three"
          onClick={() => { setThreeSetting(!three); setThree(!three); }}
          label={`3D buildings ${three ? "on" : "off"}`} small="turnable view" />
      </Row>

      <p className="ng-summary" data-testid="ng-page-summary">{describeNewGame(d)}</p>
      <div className="ng-actions">
        <button type="button" className="start-primary" data-sfx="open" data-testid="ng-start"
          onClick={() => onStart(d, skillChosen)}>Start game</button>
        <button type="button" data-sfx="tab" data-testid="ng-reset"
          onClick={() => { setD(defaults); setSeedText(""); onSave(defaults, false); }}>Reset to defaults</button>
        <button type="button" className="start-back" data-sfx="close" data-testid="ng-back"
          onClick={() => { onSave(d, skillChosen); onBack(); }}>Back</button>
      </div>
    </div>
  );
}
