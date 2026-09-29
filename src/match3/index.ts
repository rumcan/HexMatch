// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the public API of the rebuilt match-3 board.
//
//   Board            the drop-in (src/game/board.ts's surface) — board.ts
//   Match3Engine     the timer-free core, as phases            — engine.ts
//   stars            the 5★ table, thresholds, migration        — stars.ts
//   session          moves, reward points, difficulty, outcome  — session.ts
//   SessionRunner    one session: scoring, finale, cues         — game.ts
//   finale           slow-mo / push-in / music plan + clock     — finale.ts
//   audio            the ASMR cue catalogue (asset contract)    — audio.ts
//   bot              the scripted player + the balance sweep    — bot.ts
//
// In the game the board is drawn by the chrome's DOM (src/game/ui.ts) with the
// painted gems made solid (src/game/stone-fx.ts, src/assets/stones/).
//   rng              setRng / mulberry32 facade                 — rng.ts
// ══════════════════════════════════════════════════════════════════════════

export * from "./types";
export * from "./rng";
export { Match3Engine, BASE_POOL, SHORTCUT_LINE_CAP, SWAP_CONTACT_AT, type EngineOptions, type Move, type Resolution } from "./engine";
export { Board } from "./board";
export * from "./stars";
export * from "./session";
export * from "./finale";
export * from "./audio";
export {
  DEFAULT_VOLUME,
  MAX_VOICES,
  audioStats,
  isAudioEnabled,
  isArmed,
  setAudioEnabled,
  setAudioVolume,
  audioVolume,
  toggleAudio,
  unlock,
  liveVoices,
} from "../audio/engine";
export * from "./bot";
export { SessionRunner, type RunnerHooks, type RunnerOptions, type SessionResult } from "./game";
