// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the stage: the small DOM projector that turns a ScriptScene
// into a cutscene.
//
// The split is the repo's standing one (tutorial.ts, ending.ts): the script
// is data a test can read with no DOM; this file is the ~250-line projector
// beside it. What a scene looks like when it stands up:
//
//   · the backdrop plate `cover`s the window and breathes one slow Ken Burns
//     drift while it is on screen (killed under prefers-reduced-motion);
//     changing place cross-fades two stacked plates instead of cutting;
//   · a spoken line raises a dossier card — the character's expression
//     quadrant, their name engraved, their role in small caps — beside a
//     felt plate whose typewriter writes the line out, punctuation pausing
//     like a reader would;
//   · a narrator line drops the dossier and centers the plate; a title line
//     drops everything and engraves one Cinzel card alone;
//   · click / Enter / Space advances — mid-typing it completes the line
//     first, because "make me wait twice" is not pacing;
//   · Skip ▸▸ (and Esc) ends the scene NOW and says so: skipping is a
//     choice the campaign records as seen, never as a fault.
//
// Geometry follows the theme: the plates are drawn chrome (felt, brass
// keyline, inset shadow) and every bitmap here is `cover`ed or shown as a
// uniform 2× quadrant — nothing is stretched into a box it does not share.
// ══════════════════════════════════════════════════════════════════════════
import { BACKDROPS, BACKDROP_CAPTION, type BackdropKey } from "./backdrops";
import { CAST, faceOf, resolveSpeaker } from "./cast";
import type { ScriptLine, ScriptScene } from "./script";
import { sfx } from "../audio/sfx";

export interface SceneOptions {
  /** The tycoon the start screen chose — `player` lines resolve to this. */
  player?: "vex" | "you";
  skipLabel?: string;
}

export interface SceneHandle {
  /** Resolves "done" when the last line is advanced past, "skipped" on skip. */
  promise: Promise<"done" | "skipped">;
  skip: () => void;
  /** Tears the stage down; an unsettled promise resolves "skipped". */
  destroy: () => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const reducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Typewriter pace: one glyph per tick, punctuation breathing like a reader. */
const CHAR_MS = 22;
const pauseAfter = (ch: string): number =>
  ".!?…".includes(ch) ? 240 : ",;:".includes(ch) ? 120 : 0;

export function showScene(
  host: HTMLElement, scene: ScriptScene, opts: SceneOptions = {},
): SceneHandle {
  const player = opts.player ?? "vex";
  const quiet = reducedMotion();

  const stage = el("div", "story-stage");
  stage.dataset.scene = scene.id;
  stage.setAttribute("role", "dialog");
  stage.setAttribute("aria-label", `Story scene: ${scene.id}`);

  // Two stacked plates: the live one and the one a cross-fade arrives on.
  const bgA = el("div", "story-bg a");
  const bgB = el("div", "story-bg b");
  let activeBg: BackdropKey | null = null;

  const grain = el("div", "story-grain");
  const caption = el("div", "story-caption");
  const skip = el("button", "story-skip", opts.skipLabel ?? "Skip ▸▸");
  skip.type = "button";
  skip.dataset.sfx = "close";

  const dossier = el("div", "story-dossier hidden");
  const face = el("span", "story-face");
  face.setAttribute("aria-hidden", "true");
  const name = el("b", "story-name");
  const role = el("i", "story-role");
  dossier.append(face, name, role);

  const plate = el("div", "story-plate hidden");
  const text = el("p", "story-text");
  text.setAttribute("aria-live", "polite");
  const next = el("span", "story-next", "▾");
  plate.append(text, next);

  const titleCard = el("div", "story-titlecard hidden");
  const titleText = el("h2");
  titleCard.appendChild(titleText);

  stage.append(bgA, bgB, grain, caption, skip, dossier, plate, titleCard);
  host.appendChild(stage);

  const layers = [bgA, bgB] as const;
  let onIndex = -1;
  const setBackdrop = (key: BackdropKey) => {
    if (key === activeBg) return;
    activeBg = key;
    const nextIndex = onIndex === 0 ? 1 : 0;
    layers[nextIndex].style.backgroundImage = `url(${BACKDROPS[key]})`;
    caption.textContent = BACKDROP_CAPTION[key];
    if (onIndex === -1 || quiet) {
      // No fade for the opening plate (nothing to fade from) or for a
      // reduced-motion reader: the place simply IS.
      layers[nextIndex].classList.add("on");
      if (onIndex >= 0) layers[onIndex].classList.remove("on");
      onIndex = nextIndex;
      return;
    }
    // Cross-fade: the incoming plate rises over the live one, and the live
    // one is released only once the new plate is opaque enough to miss it.
    void layers[nextIndex].offsetWidth;
    layers[nextIndex].classList.add("on");
    const prev = onIndex;
    onIndex = nextIndex;
    window.setTimeout(() => layers[prev].classList.remove("on"), 950);
  };

  let line = -1;
  let typeTimer: number | null = null;
  /** True from the moment a line STARTS typing until its last glyph lands —
   *  a click inside that window completes the line instead of advancing it,
   *  including the first CHAR_MS before the first glyph exists. */
  let isTyping = false;
  let settled = false;
  let resolvePromise: (how: "done" | "skipped") => void = () => {};
  const promise = new Promise<"done" | "skipped">((resolve) => { resolvePromise = resolve; });

  const stopTyping = () => {
    if (typeTimer !== null) { window.clearTimeout(typeTimer); typeTimer = null; }
    isTyping = false;
  };

  const finishLine = () => {
    stopTyping();
    if (line >= 0 && line < scene.lines.length) text.textContent = scene.lines[line].text;
    next.classList.remove("hidden");
  };

  const typeOut = (value: string) => {
    stopTyping();
    next.classList.add("hidden");
    if (quiet) { text.textContent = value; next.classList.remove("hidden"); return; }
    isTyping = true;
    let i = 0;
    text.textContent = "";
    const step = () => {
      i += 1;
      text.textContent = value.slice(0, i);
      if (i >= value.length) { isTyping = false; next.classList.remove("hidden"); return; }
      typeTimer = window.setTimeout(step, CHAR_MS + pauseAfter(value[i - 1]));
    };
    typeTimer = window.setTimeout(step, CHAR_MS);
  };

  const showLine = (index: number) => {
    line = index;
    const current: ScriptLine = scene.lines[index];
    if (current.bg) setBackdrop(current.bg);
    if (current.who === "title") {
      dossier.classList.add("hidden");
      plate.classList.add("hidden");
      titleText.textContent = current.text;
      titleCard.classList.remove("hidden");
      void titleCard.offsetWidth;
      titleCard.classList.add("on");
      next.classList.add("hidden");
      return;
    }
    titleCard.classList.remove("on");
    titleCard.classList.add("hidden");
    if (current.who === "narrator") {
      dossier.classList.add("hidden");
      plate.classList.remove("hidden");
      plate.classList.add("narrator");
      plate.style.removeProperty("--accent");
      typeOut(current.text);
      return;
    }
    const castId = resolveSpeaker(current.who, player);
    const member = CAST[castId];
    const spec = faceOf(castId, current.face ?? "calm");
    dossier.classList.remove("hidden");
    face.style.backgroundImage = `url(${spec.url})`;
    if (spec.pos) {
      face.style.backgroundSize = "200% 200%";
      face.style.backgroundPosition = `${spec.pos[0]}% ${spec.pos[1]}%`;
    } else {
      face.style.backgroundSize = "cover";
      face.style.backgroundPosition = "center 20%";
    }
    name.textContent = member.name;
    role.textContent = member.role;
    stage.style.setProperty("--accent", member.colour);
    plate.classList.remove("hidden", "narrator");
    // Re-trigger the dossier's rise on every speaker change: a new face or a
    // new mood should arrive, not merely appear.
    dossier.classList.remove("on");
    void dossier.offsetWidth;
    dossier.classList.add("on");
    typeOut(current.text);
  };

  const settle = (how: "done" | "skipped") => {
    if (settled) return;
    settled = true;
    stopTyping();
    stage.classList.add("leaving");
    sfx.play("close");
    window.setTimeout(() => {
      stage.remove();
      resolvePromise(how);
    }, quiet ? 0 : 260);
  };

  const advance = () => {
    if (settled) return;
    if (isTyping) { finishLine(); return; }
    sfx.play("click");
    if (line + 1 >= scene.lines.length) { settle("done"); return; }
    showLine(line + 1);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); settle("skipped"); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); advance(); }
  };
  const onClick = (e: MouseEvent) => {
    if (e.target === skip || skip.contains(e.target as Node)) return;
    advance();
  };
  const onSkip = () => settle("skipped");

  stage.addEventListener("click", onClick);
  skip.addEventListener("click", onSkip);
  document.addEventListener("keydown", onKey);

  // Curtain up: first backdrop, then the first line, then the reel's sound.
  setBackdrop(scene.bg);
  sfx.play("open");
  requestAnimationFrame(() => {
    stage.classList.add("on");
    showLine(0);
  });

  return {
    promise,
    skip: () => settle("skipped"),
    destroy: () => {
      document.removeEventListener("keydown", onKey);
      stage.removeEventListener("click", onClick);
      skip.removeEventListener("click", onSkip);
      stopTyping();
      stage.remove();
      if (!settled) { settled = true; resolvePromise("skipped"); }
    },
  };
}
