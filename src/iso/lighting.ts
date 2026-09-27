// ══════════════════════════════════════════════════════════════════════════
// LIGHT-1 (#473) — a match-time lighting arc.
//
// The light is a function of the leader's progress toward the ★ line, never
// of the wall clock. Late morning at the start; golden hour as the leader
// passes 60%; dusk through the final stretch. The ending card is a separate
// night-blue wash (the map itself stops at dusk — readability first).
//
// Always day, performance mode and reduced motion all pin the identity grade
// so the extra tint pass and the window glow do not run. The UI is never
// graded; only the ground, the buildings and the roads are.
//
// Window masks: the lead generates one warm emissive mask per building
// sprite. Until those land, `windowMaskPixels` paints a procedural glow on
// the sprite's darker upper pixels. `renderer.setWindowMask` installs a
// real mask without another code change.
// ══════════════════════════════════════════════════════════════════════════
import { CLOUD_SHADOW_ALPHA, CLOUD_SHADOW_DX, CLOUD_SHADOW_DY } from "./clouds";
import { currentGraphics } from "./graphics";

/** Multiply grade never drops the ground below this share of white. */
export const MIN_GRADE_LUMA = 0.62;
/** Cloud shadows stay a whisper even at dusk. */
export const MAX_SHADOW_ALPHA = 0.42;
/** How far a cloud shadow may stretch (world px) as the sun drops. */
export const MAX_SHADOW_OFFSET = 280;

/**
 * The four looks the ticket names. The first three are `lightingFor`
 * samples; night is the ending card, not a map grade.
 */
export const STAGE_PROGRESS = {
  morning: 0,
  golden: 0.6,
  dusk: 0.9,
  finale: 1,
} as const;

/** Baked upper-left sun in the terrain shader (`LIGHT` in shaders.ts). */
export const MORNING_LIGHT = [-0.42, -0.5, 0.76] as const;
/** Same quadrant, lower: the dusk end of the swing. Still upper-left. */
export const DUSK_LIGHT = [-0.7, -0.24, 0.34] as const;

export type LightingStage = "morning" | "golden" | "dusk";
export type LightingChoice = "dynamic" | "day";

export interface Lighting {
  /** Clamped match progress. 0 = late morning, 1 = deepest dusk. */
  progress: number;
  stage: LightingStage;
  /** Normalised sun elevation (light.z). Non-increasing along the arc. */
  sunElev: number;
  /** 0 late morning .. 1 dusk. Non-decreasing. */
  sunDrop: number;
  /**
   * Toward the light. Stays in the upper-left quadrant (x < 0, y < 0, z > 0)
   * for the whole arc — the sun rule does not flip. [0, 0, 0] means "use the
   * shader's baked sun" (always-day).
   */
  light: readonly [number, number, number];
  /** Multiply tint before exposure. Each channel in (0, 1]. */
  tint: readonly [number, number, number];
  /** Exposure. Non-increasing, in (0, 1]. */
  exposure: number;
  /**
   * What the terrain grade and the 2D multiply actually apply (tint × exposure),
   * lifted so its luma never sits under `MIN_GRADE_LUMA`.
   */
  grade: readonly [number, number, number];
  /** Lit-window strength, 0..1, non-decreasing. Quiet until the light turns. */
  windows: number;
  /** Absolute cloud-shadow alpha. Non-decreasing, clamped. */
  shadowAlpha: number;
  /** Shadow strength relative to the noon alpha. Non-decreasing, ≥ 1. */
  shadowScale: number;
  /** Lower-right shadow offset (world px). Length non-decreasing. */
  shadowDx: number;
  shadowDy: number;
  /** Always-day / suppressed: no tint pass, shader identity, noon shadows. */
  identity: boolean;
}

interface Anchor {
  p: number;
  sunDrop: number;
  exposure: number;
  tint: readonly [number, number, number];
  windows: number;
  shadow: number;
}

/**
 * Keyframes. Channels that should move one way do, so a smoothstep between
 * them stays monotonic. Luma of tint × exposure stays above the floor at
 * every anchor, so the safety lift is a no-op on this curve.
 */
const ANCHORS: readonly Anchor[] = [
  // Late morning is already warm (not noon white) and the golden turn starts
  // at 0.3, so the first stars move the light instead of the arc sitting flat
  // (imperceptible) for the first half of the match.
  { p: 0, sunDrop: 0, exposure: 1, tint: [1, 0.95, 0.86], windows: 0, shadow: 1 },
  { p: 0.3, sunDrop: 0.22, exposure: 0.98, tint: [1, 0.9, 0.72], windows: 0, shadow: 1.15 },
  { p: 0.6, sunDrop: 0.45, exposure: 0.95, tint: [1, 0.82, 0.58], windows: 0.15, shadow: 1.35 },
  { p: 0.85, sunDrop: 0.78, exposure: 0.9, tint: [1, 0.74, 0.5], windows: 0.78, shadow: 1.75 },
  { p: 1, sunDrop: 1, exposure: 0.86, tint: [0.98, 0.68, 0.48], windows: 1, shadow: 2.05 },
];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export function lumaOf(rgb: readonly [number, number, number]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Mix toward white until the grade luma clears the readability floor. */
export function liftGrade(rgb: readonly [number, number, number]): [number, number, number] {
  const L = lumaOf(rgb);
  if (L >= MIN_GRADE_LUMA || L <= 0) return [rgb[0], rgb[1], rgb[2]];
  const t = (MIN_GRADE_LUMA - L) / (1 - L);
  return [
    rgb[0] + (1 - rgb[0]) * t,
    rgb[1] + (1 - rgb[1]) * t,
    rgb[2] + (1 - rgb[2]) * t,
  ];
}

function lightAt(sunDrop: number): [number, number, number] {
  const t = clamp01(sunDrop);
  return normalize([
    lerp(MORNING_LIGHT[0], DUSK_LIGHT[0], t),
    lerp(MORNING_LIGHT[1], DUSK_LIGHT[1], t),
    lerp(MORNING_LIGHT[2], DUSK_LIGHT[2], t),
  ]);
}

function sample(progress: number): Anchor {
  const x = clamp01(progress);
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i];
    const b = ANCHORS[i + 1];
    if (x <= b.p || i === ANCHORS.length - 2) {
      const t = b.p === a.p ? 1 : smooth((x - a.p) / (b.p - a.p));
      return {
        p: x,
        sunDrop: lerp(a.sunDrop, b.sunDrop, t),
        exposure: lerp(a.exposure, b.exposure, t),
        tint: [
          lerp(a.tint[0], b.tint[0], t),
          lerp(a.tint[1], b.tint[1], t),
          lerp(a.tint[2], b.tint[2], t),
        ],
        windows: lerp(a.windows, b.windows, t),
        shadow: lerp(a.shadow, b.shadow, t),
      };
    }
  }
  return ANCHORS[ANCHORS.length - 1];
}

export function stageFor(progress: number): LightingStage {
  const p = clamp01(progress);
  if (p < 0.45) return "morning";
  if (p < 0.78) return "golden";
  return "dusk";
}

/**
 * The arc. `progress` is the leader's ★ share of the line (unclamped in,
 * clamped out). Sun drop, window glow and shadow length rise; exposure and
 * the cool channel fall. Nothing leaves its clamp.
 */
export function lightingFor(progress: number): Lighting {
  const p = clamp01(Number.isFinite(progress) ? progress : 0);
  const s = sample(p);
  const light = lightAt(s.sunDrop);
  const raw: [number, number, number] = [
    clamp01(s.tint[0] * s.exposure),
    clamp01(s.tint[1] * s.exposure),
    clamp01(s.tint[2] * s.exposure),
  ];
  const grade = liftGrade(raw).map((c) => Math.min(1, Math.max(0, c))) as [number, number, number];
  const shadowScale = Math.max(1, s.shadow);
  const shadowAlpha = Math.min(MAX_SHADOW_ALPHA, CLOUD_SHADOW_ALPHA * shadowScale);
  const shadowDx = Math.min(MAX_SHADOW_OFFSET, CLOUD_SHADOW_DX * (1 + 1.1 * s.sunDrop));
  const shadowDy = Math.min(MAX_SHADOW_OFFSET, CLOUD_SHADOW_DY * (1 + 0.45 * s.sunDrop));
  return {
    progress: p,
    stage: stageFor(p),
    sunElev: light[2],
    sunDrop: clamp01(s.sunDrop),
    light,
    tint: [clamp01(s.tint[0]), clamp01(s.tint[1]), clamp01(s.tint[2])],
    exposure: clamp01(s.exposure),
    grade,
    windows: clamp01(s.windows),
    shadowAlpha,
    shadowScale,
    shadowDx,
    shadowDy,
    identity: false,
  };
}

/** Noon. No tint pass, no window glow, the shader's own sun. */
export const DAY_LIGHTING: Lighting = {
  progress: 0,
  stage: "morning",
  sunElev: 1,
  sunDrop: 0,
  light: [0, 0, 0],
  tint: [1, 1, 1],
  exposure: 1,
  grade: [1, 1, 1],
  windows: 0,
  shadowAlpha: CLOUD_SHADOW_ALPHA,
  shadowScale: 1,
  shadowDx: CLOUD_SHADOW_DX,
  shadowDy: CLOUD_SHADOW_DY,
  identity: true,
};

export interface LightingGates {
  choice: LightingChoice;
  progress: number;
  performance?: boolean;
  reducedMotion?: boolean;
}

/** Dynamic unless the player, performance mode, or reduced motion says otherwise. */
export function effectiveLighting(gates: LightingGates): Lighting {
  // Reduced motion does NOT turn the grade off: a slow colour change is not
  // motion, and Windows "animation effects: off" silently killed the feature.
  if (gates.choice !== "dynamic" || gates.performance) return DAY_LIGHTING;
  return lightingFor(gates.progress);
}

/** Leader's ★ / the line. A missing line (conquest) stays at morning. */
export function leaderProgress(scores: readonly number[], target: number): number {
  if (!(target > 0)) return 0;
  let best = 0;
  for (const s of scores) if (s > best) best = s;
  return best / target;
}

/**
 * Ease the shown progress toward the score so a ★ landing does not pop the
 * light. `dtMs` is the frame delta (callers cap it; this caps it again).
 */
export function smoothMatchProgress(shown: number, target: number, dtMs: number): number {
  const cur = clamp01(Number.isFinite(shown) ? shown : 0);
  const goal = clamp01(Number.isFinite(target) ? target : 0);
  const dt = Math.max(0, Math.min(100, dtMs));
  if (dt === 0 || cur === goal) return cur;
  const k = 1 - Math.exp(-dt / 7000);
  return cur + (goal - cur) * k;
}

export function gradeCss(grade: readonly [number, number, number]): string {
  const ch = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)));
  return `rgb(${ch(grade[0])},${ch(grade[1])},${ch(grade[2])})`;
}

// ── lit windows (procedural, until the lead's masks land) ──────────────────

const WINDOW_SKIP = /^(road_|dirt_|rail_|tree_|forest_|highlight|node_mark|shadow)/;

/** Buildings and depots, not roads, track, trees or moving traffic. */
export function isLitBuilding(sprite: string, decor = false, moving = false): boolean {
  if (decor || moving) return false;
  return !WINDOW_SKIP.test(sprite);
}

/**
 * Warm glow on a sprite's darker upper pixels — the placeholder for the
 * lead's per-building emissive mask. Returns RGBA of the same size.
 * A pixel lights only when it is darker than its neighbours, so a flat roof
 * stays dark and a window hole glows.
 */
export function windowMaskPixels(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  if (w < 3 || h < 3) return out;
  const yCut = Math.max(1, Math.floor(h * 0.62));
  const lum = (i: number): number => 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  const at = (x: number, y: number): number => (y * w + x) * 4;
  for (let y = 1; y < yCut; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = at(x, y);
      if (src[i + 3] < 48) continue;
      const L = lum(i);
      if (L < 18 || L > 112) continue;
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const up = at(x, y - 1);
      if (src[left + 3] < 40 || src[right + 3] < 40) continue;
      const neigh = (lum(left) + lum(right) + (src[up + 3] > 40 ? lum(up) : L)) / 3;
      if (neigh - L < 16) continue;
      const glow = Math.min(1, (neigh - L) / 70) * (1 - y / yCut * 0.35);
      if (glow < 0.2) continue;
      out[i] = 255;
      out[i + 1] = 168;
      out[i + 2] = 64;
      out[i + 3] = Math.min(220, Math.round(src[i + 3] * glow * 0.9));
    }
  }
  return out;
}

// ── the setting ─────────────────────────────────────────────────────────────

export const LIGHTING_STORAGE_KEY = "hexmatch:lighting";
export const DEFAULT_LIGHTING_CHOICE: LightingChoice = "dynamic";

export const LIGHTING_NOTE = "The island's light follows the match: late morning, golden hour, then dusk. Always day keeps the noon light.";
export const LIGHTING_DAY_NOTE = "Noon light for the whole match. The stored choice is remembered.";
export const LIGHTING_MOTION_NOTE = "Unavailable while reduced motion is on.";

export function parseLightingChoice(v: unknown): LightingChoice | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (s === "dynamic" || s === "1" || s === "on") return "dynamic";
  if (s === "day" || s === "always" || s === "0" || s === "off") return "day";
  return null;
}

/**
 * `?light=0.6` pins the shown progress (the four stage shots: 0, 0.6, 0.9, 1).
 * Absent or garbage → null, and the scoreboard drives the arc. Not persisted.
 */
export function urlLightingProgress(search: string | undefined): number | null {
  if (!search) return null;
  try {
    const raw = new URLSearchParams(search).get("light");
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** `?lighting=day|dynamic`. Absent or garbage → null (the stored choice stands). */
export function urlLightingOverride(search: string | undefined): LightingChoice | null {
  if (!search) return null;
  try {
    return parseLightingChoice(new URLSearchParams(search).get("lighting"));
  } catch {
    return null;
  }
}

const lightingStorage = (): Storage | null =>
  (typeof localStorage !== "undefined" ? localStorage : null);

const lightingSearch = (): string | undefined =>
  (typeof location !== "undefined" && typeof location.search === "string" ? location.search : undefined);

export function parseLightingSettings(raw: string | null, override: LightingChoice | null): LightingChoice {
  let choice = DEFAULT_LIGHTING_CHOICE;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { choice?: unknown };
      const c = parseLightingChoice(parsed.choice);
      if (c) choice = c;
    } catch { /* unreadable blob: the default stands */ }
  }
  return override ?? choice;
}

let choiceMemo: LightingChoice | null = null;
const choiceListeners = new Set<(c: LightingChoice) => void>();

function readChoice(): LightingChoice {
  choiceMemo ??= parseLightingSettings(
    lightingStorage()?.getItem(LIGHTING_STORAGE_KEY) ?? null,
    urlLightingOverride(lightingSearch()),
  );
  return choiceMemo;
}

function persistChoice(): void {
  try { lightingStorage()?.setItem(LIGHTING_STORAGE_KEY, JSON.stringify({ choice: readChoice() })); }
  catch { /* private mode: the choice does not survive the reload */ }
}

export function currentLightingChoice(): LightingChoice {
  return readChoice();
}

export function setLightingChoice(next: LightingChoice): LightingChoice {
  const c = parseLightingChoice(next) ?? readChoice();
  if (c === readChoice()) return c;
  choiceMemo = c;
  persistChoice();
  for (const fn of [...choiceListeners]) fn(c);
  return c;
}

export function subscribeLighting(fn: (c: LightingChoice) => void): () => void {
  choiceListeners.add(fn);
  return () => { choiceListeners.delete(fn); };
}

export function resetLightingForTests(): void {
  choiceMemo = null;
  choiceListeners.clear();
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Night blue on the ending card. Off with always-day, performance, or reduced motion. */
export function endingNightActive(opts?: { performance?: boolean; reducedMotion?: boolean }): boolean {
  if (currentLightingChoice() !== "dynamic") return false;
  if (opts?.performance ?? currentGraphics().performance) return false;
  return true;
}

/** CSS class the ending screen wears when the card should go night blue. */
export const ENDING_NIGHT_CLASS = "lighting-night";
/** Flat night-blue veil. The card text is not recoloured. */
export const ENDING_NIGHT_VEIL = "rgba(7, 22, 40, 0.62)";
export const ENDING_NIGHT_BLUE = "#071628";
