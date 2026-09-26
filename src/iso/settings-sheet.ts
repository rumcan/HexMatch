// ══════════════════════════════════════════════════════════════════════════
// GFX-01 / SETTINGS-01 — the settings sheet, one projector for every door.
//
// The story this module finishes: PR #103 built the front door (Play /
// Settings / How to Play) and left SETTINGS deliberately unwired — "another
// crew is furnishing that room". The room is furnished now. The same sheet
// answers the main-menu door AND the in-game ☰ menu, because both are one
// call to a projector that mounts a `.modal-root` plate over whatever host
// stands up and tears itself down on close — the `showTutorial` contract,
// reused verbatim so React (MainMenu) can own a host div and the imperative
// game (iso/game.ts) can own a handle, and neither re-implements a control.
//
// What the sheet owns (and nothing else):
//   · Texture detail — Low / Medium / High, capping which @0.5x/@1x/@2x art
//     is loaded at all (see graphics.ts + Atlas.detailCap);
//   · Miniature view — the tilt-shift tilt the island looks through
//     (see miniature.ts);
//   · Performance mode — PERF-01's cheaper rendering policy: hides grass
//     decals and single trees, caps backing DPR, and suppresses the miniature
//     pass for the duration (its own choice is preserved and restored);
//   · Clouds — AMB-1's drifting veil at the far zooms (see clouds.ts),
//     suppressed by performance mode exactly like miniature;
//   · Sound — the SFX-01 mix, reachable here too because the main menu has
//     no 🔊 plate of its own and a player muting from the door must be able
//     to.
// All four write through their stores (graphics.ts, the audio engine), so a
// change made here repaints every OTHER control of the same setting — the
// top-bar 🔊, the in-game modal a second tab could conjure — by the
// registration the stores already provide. The sheet never reads the store
// lazily at paint time after mount; subscribers keep it true.
// ══════════════════════════════════════════════════════════════════════════
import {
  currentGraphics, setGraphics, subscribeGraphics,
  QUALITY_KEYS, QUALITY_LABEL, QUALITY_NOTE, PERFORMANCE_NOTE, CLOUDS_NOTE, type GraphicsSettings,
} from "./graphics";
import { registerSoundPainter, sfx } from "../audio/sfx";
// VO-1: voice has its own mute and volume, and still bows to the Sound switch.
import { registerVoicePainter, voice } from "../game/voice";
// MUSIC-1 (#377): the radio's own switch, its own volume, and the switch that
// hides the player. Same storage shape as the voice pair right above it.
import { radio } from "../audio/radio";

/** The miniature row's copy, live: the full description, or the reason it is
 *  unreachable while performance mode stands (PERF-01). */
const MINIATURE_NOTE = "Tilt-shift — a sharp band across the middle, the rest softly blurred, colours popped. The island reads as a tiny model.";
// Shared by every look the performance policy suppresses (miniature, clouds).
const SUPPRESSED_BY_PERF = "Unavailable while Performance mode is on.";
/** MUSIC-1 (#377): the Radio row's copy, live — what off actually does. */
const RADIO_NOTE = "SomaFM Secret Agent, in the little player at the top right. Off stops the stream and releases the connection.";
const RADIO_OFF_NOTE = "Off — the stream is stopped and the player is disconnected. Your volume is remembered.";

export interface SettingsSheetHandle {
  readonly el: HTMLElement;
  /** Resolves when the sheet closes itself — Done, backdrop, or Escape. */
  readonly promise: Promise<void>;
  /** Tear it down from the outside (React unmount, game dispose). Idempotent. */
  destroy(): void;
}

export function showSettingsSheet(host: HTMLElement = document.body): SettingsSheetHandle {
  let resolveClosed: () => void = () => {};
  const promise = new Promise<void>((res) => { resolveClosed = res; });
  let closed = false;

  const root = document.createElement("div");
  root.className = "modal-root settings-sheet";
  root.innerHTML = `
    <div class="modal-back" data-gfx-close></div>
    <div class="modal box small gfx-modal" role="dialog" aria-modal="true" aria-label="Settings">
      <h2>Settings</h2>
      <p class="sub">How the island looks and sounds. Everything applies at once and is remembered for the next game.</p>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Texture detail</h3><p class="gfx-note"></p></div>
        <div class="gfx-seg" role="radiogroup" aria-label="Texture detail"></div>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Miniature view</h3><p class="gfx-mini-note">${MINIATURE_NOTE}</p></div>
        <button type="button" class="gfx-switch" role="switch" aria-label="Miniature view" data-gfx="miniature" data-sfx="click">OFF</button>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Performance mode</h3><p>${PERFORMANCE_NOTE}</p></div>
        <button type="button" class="gfx-switch" role="switch" aria-label="Performance mode" data-gfx="performance" data-sfx="click">OFF</button>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Clouds</h3><p class="gfx-cloud-note">${CLOUDS_NOTE}</p></div>
        <button type="button" class="gfx-switch" role="switch" aria-label="Clouds" data-gfx="clouds" data-sfx="click">ON</button>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Sound</h3><p>Brass, felt and paper — every click, coin and cascade (the top bar&rsquo;s 🔊 keeps the same time).</p></div>
        <button type="button" class="gfx-switch" role="switch" data-gfx="sound" data-sfx="click">ON</button>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Voice</h3><p class="gfx-voice-note">Narrator, rival and your own lines. A missing recording still shows the subtitle.</p></div>
        <div class="gfx-voice-controls">
          <input type="range" class="gfx-voice-vol" min="0" max="1" step="0.05" value="0.85" data-gfx="voice-volume" aria-label="Voice volume" />
          <button type="button" class="gfx-switch" role="switch" aria-label="Voice" data-gfx="voice" data-sfx="click">ON</button>
        </div>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Radio</h3><p class="gfx-radio-note">${RADIO_NOTE}</p></div>
        <div class="gfx-voice-controls">
          <input type="range" class="gfx-voice-vol" min="0" max="1" step="0.05" value="0.5" data-gfx="radio-volume" aria-label="Radio volume" />
          <button type="button" class="gfx-switch" role="switch" aria-label="Radio" data-gfx="radio" data-sfx="click">ON</button>
        </div>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Show radio player</h3><p>Hide the player in the top-right corner. The music keeps playing.</p></div>
        <button type="button" class="gfx-switch" role="switch" aria-label="Show radio player" data-gfx="radio-show" data-sfx="click">ON</button>
      </div>
      <div class="confirm-row">
        <button type="button" class="big-btn" data-gfx-close data-sfx="close">Done</button>
      </div>
    </div>`;
  host.appendChild(root);

  const panel = root.querySelector(".modal.box") as HTMLElement;
  const seg = root.querySelector(".gfx-seg") as HTMLElement;
  const note = root.querySelector(".gfx-note") as HTMLElement;
  const miniBtn = root.querySelector("[data-gfx=\"miniature\"]") as HTMLButtonElement;
  const miniNote = root.querySelector(".gfx-mini-note") as HTMLElement;
  const perfBtn = root.querySelector("[data-gfx=\"performance\"]") as HTMLButtonElement;
  const cloudBtn = root.querySelector("[data-gfx=\"clouds\"]") as HTMLButtonElement;
  const cloudNote = root.querySelector(".gfx-cloud-note") as HTMLElement;
  const soundBtn = root.querySelector("[data-gfx=\"sound\"]") as HTMLButtonElement;
  const voiceBtn = root.querySelector("[data-gfx=\"voice\"]") as HTMLButtonElement;
  const voiceVol = root.querySelector("[data-gfx=\"voice-volume\"]") as HTMLInputElement;
  const voiceNote = root.querySelector(".gfx-voice-note") as HTMLElement;
  const radioBtn = root.querySelector("[data-gfx=\"radio\"]") as HTMLButtonElement;
  const radioVol = root.querySelector("[data-gfx=\"radio-volume\"]") as HTMLInputElement;
  const radioShow = root.querySelector("[data-gfx=\"radio-show\"]") as HTMLButtonElement;
  const radioNote = root.querySelector(".gfx-radio-note") as HTMLElement;

  for (const q of QUALITY_KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gfx-q";
    b.dataset.q = q;
    b.setAttribute("role", "radio");
    b.title = QUALITY_NOTE[q];
    b.textContent = QUALITY_LABEL[q];
    b.onclick = () => { setGraphics({ quality: q }); };
    seg.appendChild(b);
  }
  miniBtn.onclick = () => { setGraphics({ miniature: !currentGraphics().miniature }); };
  perfBtn.onclick = () => { setGraphics({ performance: !currentGraphics().performance }); };
  cloudBtn.onclick = () => { setGraphics({ clouds: !currentGraphics().clouds }); };
  soundBtn.onclick = () => { sfx.setEnabled(!sfx.isEnabled()); };
  voiceBtn.onclick = () => { voice.setEnabled(!voice.enabled); };
  voiceVol.oninput = () => { voice.setVolume(Number(voiceVol.value)); };
  // MUSIC-1 (#377): the same three shapes for the radio — a switch that stops
  // and disconnects, a switch that only hides the player, and its own volume.
  radioBtn.onclick = () => { radio.setEnabled(!radio.settings.enabled); };
  radioVol.oninput = () => { radio.setVolume(Number(radioVol.value)); };
  radioShow.onclick = () => { radio.setShow(!radio.settings.show); };

  const paint = (g: GraphicsSettings) => {
    note.textContent = QUALITY_NOTE[g.quality];
    for (const b of Array.from(seg.children) as HTMLButtonElement[]) {
      const on = b.dataset.q === g.quality;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    // PERF-01: performance mode SUPPRESSES the miniature pass without
    // touching the stored choice — the switch dims and its row says why,
    // and turning performance mode off restores the preference as it was.
    // AMB-1 (#390): the Clouds switch is suppressed the same way.
    const miniSuppressed = g.performance;
    miniBtn.textContent = g.miniature ? "ON" : "OFF";
    miniBtn.classList.toggle("on", g.miniature && !miniSuppressed);
    miniBtn.setAttribute("aria-checked", String(g.miniature));
    miniBtn.disabled = miniSuppressed;
    miniBtn.setAttribute("aria-disabled", String(miniSuppressed));
    miniNote.textContent = miniSuppressed ? SUPPRESSED_BY_PERF : MINIATURE_NOTE;
    perfBtn.textContent = g.performance ? "ON" : "OFF";
    perfBtn.classList.toggle("on", g.performance);
    perfBtn.setAttribute("aria-checked", String(g.performance));
    cloudBtn.textContent = g.clouds ? "ON" : "OFF";
    cloudBtn.classList.toggle("on", g.clouds && !miniSuppressed);
    cloudBtn.setAttribute("aria-checked", String(g.clouds));
    cloudBtn.disabled = miniSuppressed;
    cloudBtn.setAttribute("aria-disabled", String(miniSuppressed));
    cloudNote.textContent = miniSuppressed ? SUPPRESSED_BY_PERF : CLOUDS_NOTE;
  };
  const unsubGfx = subscribeGraphics(paint);
  const unsubSound = registerSoundPainter((enabled) => {
    soundBtn.textContent = enabled ? "ON" : "OFF";
    soundBtn.classList.toggle("on", enabled);
    soundBtn.setAttribute("aria-checked", String(enabled));
    voiceNote.textContent = enabled
      ? "Narrator, rival and your own lines. A missing recording still shows the subtitle."
      : "Held silent while Sound is off. Subtitles still show.";
  });
  const unsubVoice = registerVoicePainter((s) => {
    voiceBtn.textContent = s.enabled ? "ON" : "OFF";
    voiceBtn.classList.toggle("on", s.enabled);
    voiceBtn.setAttribute("aria-checked", String(s.enabled));
    // Don't fight a thumb that is still on the slider.
    if (document.activeElement !== voiceVol) voiceVol.value = String(s.volume);
    voiceVol.setAttribute("aria-valuenow", String(Math.round(s.volume * 100) / 100));
  });
  // MUSIC-1 (#377): the radio's two switches and its volume, painted from the
  // SAME store the pill and the top-bar player read — so a change here, a tap
  // on the pill, or `__iso.radio(...)` in the console all land as one state.
  const unsubRadio = radio.register((s) => {
    radioBtn.textContent = s.enabled ? "ON" : "OFF";
    radioBtn.classList.toggle("on", s.enabled);
    radioBtn.setAttribute("aria-checked", String(s.enabled));
    radioShow.textContent = s.show ? "ON" : "OFF";
    radioShow.classList.toggle("on", s.show);
    radioShow.setAttribute("aria-checked", String(s.show));
    if (document.activeElement !== radioVol) radioVol.value = String(s.volume);
    radioVol.setAttribute("aria-valuenow", String(Math.round(s.volume * 100) / 100));
    radioNote.textContent = s.enabled ? RADIO_NOTE : RADIO_OFF_NOTE;
  });
  paint(currentGraphics());

  const close = () => {
    if (closed) return;
    closed = true;
    unsubGfx();
    unsubSound();
    unsubVoice();
    unsubRadio();
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    resolveClosed();
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }
  document.addEventListener("keydown", onKey, true);
  for (const el of root.querySelectorAll<HTMLElement>("[data-gfx-close]")) el.onclick = close;

  try { sfx.play("open"); } catch { /* an un-armed engine stays silent */ }
  (panel.querySelector(".big-btn") as HTMLButtonElement | null)?.focus();

  return { el: root, promise, destroy: close };
}
