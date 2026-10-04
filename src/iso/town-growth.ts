// ══════════════════════════════════════════════════════════════════════════
// TOWN-2 (#470) — the TIER-UP MOMENT: growth you can SEE.
//
// A city upgrade used to change a number and — since #417/#425 — a draw list:
// the new district was simply THERE on the next frame. This module turns that
// into a moment. The camera eases to the town, scaffolds and cranes go up on
// the lots the tier just added, they "build" for two and a half seconds in
// waves from the old street plan outward, and a flag and bunting flourish
// plays over the town hall while the Feed says what happened.
//
// Two halves, split the way every cosmetic module here is split
// (`sabotage-anim`, `birds`, `clouds`) so the rules are testable with no
// canvas and no clock:
//
//   the pure functions    what a lot looks like `elapsed` ms into the build —
//                         `lotLookAt`, `flourishLookAt`, `growthLots` and the
//                         timings below. No DOM, no atlas, no `performance`.
//   createGrowthMoment    the controller the game drives: `start` on a
//                         tier-up, `tick` from the frame loop, `skip` from any
//                         click. It owns no clock either — every call is
//                         handed `now`, so a test walks the whole sequence by
//                         passing numbers.
//
// ── what it costs ────────────────────────────────────────────────────────
// Nothing per frame but a compare. `tick` re-derives a short key (one stage
// index per stagger band plus the flourish stage) and calls `apply()` — the
// game's `syncWorld` — only when that key moves, so a whole tier-up costs a
// handful of world syncs (what one build click costs) instead of one per
// frame. #417's "no frame-rate drop when a town grows" still holds, and the
// construction looks ride the draw list the town already had: a lot under
// construction is the SAME item at the SAME tile with a different sprite, so
// nothing is added to the depth sort and no district tile ever goes missing
// mid-build.
//
// ── art ──────────────────────────────────────────────────────────────────
// The lead generates the sprites in the building pipeline
// (assets/buildings/ + tools/make-building-pngs.mjs); `ART_NEEDED` is the
// list. Until they land every look FALLS BACK rather than punching a hole in
// the map: an unknown sprite draws nothing at all (`place()` in depth.ts
// returns null), so a lot under construction draws its FINISHED building at a
// low alpha that rises with the stage — the district still "builds in". The
// hall flourish simply does not draw while its art is missing, and the game
// floats 🚩 over the hall instead, so the beat is still visible.
//
// ── the rules this module enforces ───────────────────────────────────────
//   • ONCE PER TIER — the game only calls `start` when `setTownLevel` really
//     moved the tier, and a second growth inside a running moment lands the
//     first one at once rather than stacking two.
//   • SKIPPABLE — any click ends the sequence on the spot (`skip`), and the
//     click still does its normal job: nothing is swallowed, nothing is
//     prevented. The listener lives only while a moment runs.
//   • REDUCED MOTION — `prefers-reduced-motion: reduce` skips the animation
//     entirely: the district lands finished, no scaffolds, no flourish, and
//     the camera ease snaps (`flyCameraTo` already does that for a battle).
//     The Feed line and the sound are not motion, so they still happen.
//   • PRESENTATION ONLY — nothing here is saved and nothing goes on the wire.
//     A restored save re-lays the town wholesale and never starts a moment
//     (`growTownArt` is not called on that path); in a room each client plays
//     its own, exactly like the birds and the ambient cars.
//
// ── scope boundary (the ticket) ──────────────────────────────────────────
// Pedestrians and traffic lights stay in #392 (AMB-3), car density per tier
// stays in #433 (TRAFFIC-1), and empty lots are #437's gardens. This module
// only ever touches the lots a tier-up ADDED to the town draw list.
// ══════════════════════════════════════════════════════════════════════════

// ── the art the lead ships ────────────────────────────────────────────────
/** The two construction props a lot can draw. */
export type ConstructionArt = "scaffold" | "crane";

/** The flag raised over the town hall in the first half of the flourish. */
export const FLOURISH_FLAG = "town_flag_2x2";
/** The bunting that hangs over the hall for the second half. */
export const FLOURISH_BUNTING = "town_bunting_2x2";

/**
 * A construction prop's sprite name, per footprint — the grown districts draw
 * 1×1 and 2×2 lots today, and a `shapes` map adds 1×2/2×1 terraces, so the
 * name carries the footprint and a missing size falls back like any other.
 */
export const constructionSprite = (art: ConstructionArt, w: number, h: number): string =>
  `${art}_${w}x${h}`;

/**
 * Every sprite #470 wants from the building pipeline. Nothing here is
 * required: `hasArt` decides per name and each look has a fallback.
 */
export const ART_NEEDED: readonly string[] = [
  "scaffold_1x1", "scaffold_2x2", "scaffold_1x2", "scaffold_2x1",
  "crane_1x1", "crane_2x2", "crane_1x2", "crane_2x1",
  FLOURISH_FLAG, FLOURISH_BUNTING,
];

/** What the hall floats while the flag/bunting art is still missing. */
export const FLOURISH_FLOAT = "🚩 🎊";

// ── timing ────────────────────────────────────────────────────────────────
/**
 * How long ONE lot spends under construction, ms (the ticket asks 2–3 s).
 *
 * The timings are ordered on purpose: the scaffolds are up the moment the
 * growth lands, but the first swap (to the cranes) is one `STAGE_MS` later —
 * 1200 ms, i.e. AFTER `flyCameraTo`'s 750 ms ease has finished, so the player
 * is looking at the town when it starts to build. The whole sequence, stagger
 * included, lands inside three seconds.
 */
export const BUILD_MS = 2400;
/** How many waves the new lots build in, from the old street plan outward. */
export const STAGGER_BANDS = 3;
/** Delay between two waves, ms. */
export const STAGGER_MS = 200;
/** How long the hall's flag + bunting flourish plays, ms. */
export const FLOURISH_MS = 3200;
/** The flag half of the flourish, ms; the bunting hangs for the rest. */
export const FLAG_MS = 1100;

/**
 * The build's sprite-swap sequence, in order. Each entry names the art it
 * wants (first hit wins) and the alpha the lot's FINISHED building draws at
 * when none of that art exists yet — a ramp, so a checkout without the
 * placeholders still reads as "going up" rather than "already there".
 */
interface BuildLook { readonly art: readonly ConstructionArt[]; readonly alpha: number }
const BUILD_LOOKS: readonly BuildLook[] = [
  { art: ["scaffold"], alpha: 0.25 },
  { art: ["crane", "scaffold"], alpha: 0.6 },
];

/** How many looks a lot passes through before it is finished. */
export const CONSTRUCTION_STAGES = BUILD_LOOKS.length;
/** How long one look lasts, ms (they are all the same length). */
export const STAGE_MS = BUILD_MS / BUILD_LOOKS.length;

// ── the pure looks ────────────────────────────────────────────────────────
/** One lot the tier-up added: where it is, what it draws when finished. */
export interface GrowthLot {
  tx: number;
  ty: number;
  /** The finished building's sprite — the fallback look draws it at alpha. */
  sprite: string;
  /** Footprint, for the prop's sprite name. */
  w: number;
  h: number;
  /** Stagger wave: 0 builds first. */
  band: number;
}

/** What a lot draws while it is going up. */
export interface ConstructionLook {
  sprite: string;
  /** 1 with the real art; the placeholder ramp without it. */
  alpha: number;
  /** Which look this is (0 scaffold, 1 crane). */
  stage: number;
  /** True when `sprite` is construction art rather than the fallback. */
  art: boolean;
}

/** The hall's flourish, when it has art to draw. */
export interface FlourishLook {
  sprite: string;
  tx: number;
  ty: number;
  alpha: number;
  /** 0 = the flag, 1 = the bunting. */
  stage: number;
  /** The town whose hall wears it — the draw item's ref. */
  townId: number;
}

const cheb = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** When a lot's own clock finishes, ms into the moment. */
export const lotDoneAt = (lot: Pick<GrowthLot, "band">): number =>
  BUILD_MS + lot.band * STAGGER_MS;

/**
 * Which look a lot is on `elapsed` ms into the moment — `CONSTRUCTION_STAGES`
 * once it is finished. A lot whose wave has not started yet reads as stage 0:
 * the scaffolds are all up together, they just come DOWN in waves, so a district
 * tile is never an empty hole waiting for its turn.
 */
export function lotStageAt(lot: Pick<GrowthLot, "band">, elapsed: number): number {
  const t = Math.max(0, elapsed - lot.band * STAGGER_MS);
  if (t >= BUILD_MS) return CONSTRUCTION_STAGES;
  return Math.min(CONSTRUCTION_STAGES - 1, Math.floor(t / STAGE_MS));
}

/**
 * The look a lot draws `elapsed` ms in, or null when it is finished (and so
 * draws its own sprite at full alpha, untouched).
 *
 * `hasArt` is the atlas question — the game passes `atlas.has`, so the very
 * sync after the lead's PNGs land starts drawing them with no code change.
 */
export function lotLookAt(
  lot: GrowthLot, elapsed: number, hasArt: (name: string) => boolean,
): ConstructionLook | null {
  const stage = lotStageAt(lot, elapsed);
  if (stage >= CONSTRUCTION_STAGES) return null;
  const look = BUILD_LOOKS[stage];
  for (const art of look.art) {
    const name = constructionSprite(art, lot.w, lot.h);
    if (hasArt(name)) return { sprite: name, alpha: 1, stage, art: true };
  }
  return { sprite: lot.sprite, alpha: look.alpha, stage, art: false };
}

/** 0 = the flag, 1 = the bunting, 2 = the flourish is over. */
export function flourishStageAt(elapsed: number): number {
  if (elapsed >= FLOURISH_MS) return 2;
  return elapsed < FLAG_MS ? 0 : 1;
}

/**
 * The flourish item to stack over the town hall, or null — over, or still no
 * art (the game floats `FLOURISH_FLOAT` instead, so the beat is not silent).
 */
export function flourishLookAt(
  hall: { tx: number; ty: number; id?: number }, elapsed: number, hasArt: (name: string) => boolean,
): FlourishLook | null {
  const stage = flourishStageAt(elapsed);
  if (stage > 1) return null;
  const sprite = stage === 0 ? FLOURISH_FLAG : FLOURISH_BUNTING;
  if (!hasArt(sprite)) return null;
  return { sprite, tx: hall.tx, ty: hall.ty, alpha: 1, stage, townId: hall.id ?? -1 };
}

/**
 * Split the new lots into stagger waves by how far they sit from the hall, so
 * the district builds OUTWARD from the town that was already there. Pure and
 * deterministic: the same lots always band the same way, which is what keeps a
 * re-sync (or another client) from re-shuffling the waves mid-build.
 *
 * TOWN-4.4 (#680): a PLANNED town's tier-up hands this the lots of the newly
 * revealed district instead of the L17 ring's, and needs nothing else — its
 * `hall` is `Town.tx/ty`, which TOWN-4.3 makes the square's avenue-facing
 * centre tile, so the bands already run outward from the SQUARE. The item list
 * comes from the same `syncWorld` diff as ever; only what the diff contains
 * changed (see `plannedReveal`/`plannedGrownTiles` in grid.ts).
 */
export function growthLots(
  items: readonly { tx: number; ty: number; sprite: string; w: number; h: number }[],
  hall: { tx: number; ty: number },
  bands = STAGGER_BANDS,
): GrowthLot[] {
  if (!items.length) return [];
  const dist = items.map((it) => cheb(it.tx, it.ty, hall.tx, hall.ty));
  const min = Math.min(...dist);
  const max = Math.max(...dist);
  const span = Math.max(1, max - min);
  const n = Math.max(1, Math.floor(bands));
  // Row-major, so the list (and anything logged from it) is stable.
  return items
    .map((it, i) => ({ it, d: dist[i] }))
    .sort((a, b) => (a.it.ty - b.it.ty) || (a.it.tx - b.it.tx))
    .map(({ it, d }) => ({
      tx: it.tx, ty: it.ty, sprite: it.sprite, w: it.w, h: it.h,
      band: Math.max(0, Math.min(n - 1, Math.floor(((d - min) / span) * n))),
    }));
}

/** How long the whole moment runs, ms — the last lot and the flourish. */
export function growthMomentMs(lots: readonly GrowthLot[]): number {
  let build = 0;
  for (const l of lots) build = Math.max(build, lotDoneAt(l));
  return Math.max(FLOURISH_MS, build);
}

/** The Feed line the moment posts (the ticket's "and a Feed line"). */
export function growthFeedLine(label: string, lots: number): string {
  const name = label || "town";
  return lots > 0
    ? `🏗️ New ${name} district under construction — scaffolds and cranes up on the new lots.`
    : `🏗️ ${name.charAt(0).toUpperCase()}${name.slice(1)} works — the town hall is rebuilding.`;
}

// ── the controller ────────────────────────────────────────────────────────
/** The town a moment plays on. */
export interface GrowthTown {
  id: number;
  /** The town hall's tile — the flourish anchors here, the camera centres here. */
  tx: number;
  ty: number;
  /** The tier it just reached. */
  tier: number;
  /** What that tier is called (`townTierLabel`), for the Feed line. */
  label?: string;
}

export interface GrowthMomentDeps {
  /** Does this sprite exist? (the game passes the atlas question) */
  hasArt(name: string): boolean;
  /** Re-lay and repaint the world — the game's `syncWorld`. Called on a
   *  stage change only, never per frame. */
  apply(): void;
  /** Ease the camera to the town (the game's `flyCameraTo`, which snaps under
   *  reduced motion and yields to a pointer-down of its own). */
  camera?(tx: number, ty: number): void;
  /** One Feed line. */
  feed?(text: string): void;
  /** The city-upgrade sound — SFX-1 (#463): the recorded sample, falling back
   *  to its synth recipe while the file is missing or loading. */
  sound?(tier: number): void;
  /** A world float, for the flourish's placeholder. */
  float?(text: string, tx: number, ty: number): void;
  /** The OS "reduce motion" setting, read live. */
  reducedMotion?(): boolean;
  /** Arm the "any click skips" listener; returns the way to disarm it. */
  onSkip?(handler: () => void): () => void;
}

/** What `__iso.townGrowth` reports — the whole moment, read-only. */
export interface GrowthMomentState {
  active: boolean;
  townId: number | null;
  tier: number;
  label: string;
  /** ms since `start`. */
  elapsed: number;
  /** ms until the moment ends by itself. */
  durationMs: number;
  /** How many lots are going up. */
  lots: number;
  /** The stage the FIRST wave is on (`CONSTRUCTION_STAGES` when all are done). */
  stage: number;
  /** 0 flag · 1 bunting · 2 over. */
  flourishStage: number;
  /** True when the looks drew the lead's art rather than the alpha fallback. */
  art: boolean;
  /** True when a click ended it early. */
  skipped: boolean;
  /** True when reduced motion collapsed the moment to its end state. */
  reduced: boolean;
}

const IDLE: GrowthMomentState = {
  active: false, townId: null, tier: 0, label: "", elapsed: 0, durationMs: 0,
  lots: 0, stage: CONSTRUCTION_STAGES, flourishStage: 2, art: false,
  skipped: false, reduced: false,
};

export interface GrowthMoment {
  /**
   * Begin the moment for a town that just changed tier. `items` are the draw
   * items the tier ADDED (the game diffs the town's draw list). Returns false
   * — and animates nothing — under reduced motion, where the district is
   * already standing by the time this is called.
   */
  start(
    town: GrowthTown,
    items: readonly { tx: number; ty: number; sprite: string; w: number; h: number }[],
    now: number,
  ): boolean;
  /** Advance from the frame loop. Repaints only when a look changed. */
  tick(now: number): void;
  /** Any click: land the end state at once. False when nothing was running. */
  skip(): boolean;
  /** Land the end state (the sequence finished, or a new growth superseded it). */
  finish(): void;
  /** The look a town draw item wears right now, or null for "as laid". */
  lookFor(townId: number, tx: number, ty: number): ConstructionLook | null;
  /** The flourish item to stack over the hall, or null. */
  flourish(): FlourishLook | null;
  readonly state: GrowthMomentState;
  readonly active: boolean;
  /** Drop the listener without repainting (the game is being disposed). */
  dispose(): void;
}

interface Live {
  town: GrowthTown;
  label: string;
  lots: GrowthLot[];
  byTile: Map<string, GrowthLot>;
  startedAt: number;
  durationMs: number;
  elapsed: number;
  skipped: boolean;
  art: boolean;
}

const tileKey = (tx: number, ty: number): string => `${tx},${ty}`;

export function createGrowthMoment(deps: GrowthMomentDeps): GrowthMoment {
  let live: Live | null = null;
  /** The moment that last ran, kept for the console and the tests after it ends. */
  let last: GrowthMomentState = IDLE;
  /** The key the last `apply()` painted — the per-frame compare. */
  let painted = "";
  let unskip: (() => void) | null = null;

  const disarm = (): void => {
    unskip?.();
    unskip = null;
  };

  /** The cheap per-frame key: one stage per wave, plus the flourish's. */
  const keyOf = (elapsed: number): string => {
    let k = "";
    for (let band = 0; band < STAGGER_BANDS; band++) {
      const t = Math.max(0, elapsed - band * STAGGER_MS);
      k += `${t >= BUILD_MS ? CONSTRUCTION_STAGES : Math.floor(t / STAGE_MS)}.`;
    }
    return `${k}|${flourishStageAt(elapsed)}`;
  };

  /** Repaint if (and only if) some lot's look or the flourish changed. */
  const applyIfChanged = (elapsed: number): void => {
    if (!live) return;
    live.elapsed = elapsed;
    const key = keyOf(elapsed);
    if (key === painted) return;
    painted = key;
    deps.apply();
  };

  /** The end state, as the read-back reports it once the moment is over. */
  const endedState = (l: Live, elapsed: number, extra: Partial<GrowthMomentState> = {}): GrowthMomentState => ({
    active: false,
    townId: l.town.id,
    tier: l.town.tier,
    label: l.label,
    elapsed,
    durationMs: l.durationMs,
    lots: l.lots.length,
    stage: CONSTRUCTION_STAGES,
    flourishStage: 2,
    art: l.art,
    skipped: l.skipped,
    reduced: false,
    ...extra,
  });

  const finish = (): void => {
    if (!live) return;
    const l = live;
    live = null;
    painted = "";
    disarm();
    last = endedState(l, l.durationMs);
    // The last paint may have been a construction look: re-lay the town so the
    // finished district is what stands there.
    deps.apply();
  };

  /** Any click: land the end state at once. False when nothing was running. */
  const skip = (): boolean => {
    if (!live) return false;
    live.skipped = true;
    finish();
    return true;
  };

  const start = (
    town: GrowthTown,
    items: readonly { tx: number; ty: number; sprite: string; w: number; h: number }[],
    now: number,
  ): boolean => {
    // A growth inside a growth: the running moment's district lands at once
    // (no `apply` here — the new moment repaints on the same beat).
    if (live) { last = endedState(live, live.elapsed); live = null; painted = ""; disarm(); }
    const reduced = deps.reducedMotion?.() ?? false;
    const label = town.label ?? "";
    const lots = growthLots(items, town);
    // The sound and the Feed line are not motion: they happen either way.
    deps.sound?.(town.tier);
    deps.feed?.(growthFeedLine(label, lots.length));
    // `flyCameraTo` snaps to the town under reduced motion and cancels on a
    // pointer-down of its own, so this is safe to ask for unconditionally.
    deps.camera?.(town.tx, town.ty);
    const fresh: Live = {
      town, label, lots,
      byTile: new Map(lots.map((l) => [tileKey(l.tx, l.ty), l])),
      startedAt: now,
      durationMs: growthMomentMs(lots),
      elapsed: 0,
      skipped: false,
      art: false,
    };
    if (reduced) {
      // No scaffolds, no flourish, no animation: the district the game just
      // laid is already the end state, so there is nothing to repaint either.
      last = endedState(fresh, 0, { reduced: true });
      return false;
    }
    live = fresh;
    painted = "";
    // The flag/bunting art may not exist yet — float the beat over the hall so
    // a checkout without the placeholders still shows a celebration.
    if (!flourishLookAt(town, 0, deps.hasArt)) {
      deps.float?.(FLOURISH_FLOAT, town.tx, town.ty - 1);
    }
    unskip = deps.onSkip?.(skip) ?? null;
    applyIfChanged(0);
    return true;
  };

  const tick = (now: number): void => {
    if (!live) return;
    const elapsed = Math.max(0, now - live.startedAt);
    if (elapsed >= live.durationMs) { finish(); return; }
    applyIfChanged(elapsed);
  };

  const lookFor = (townId: number, tx: number, ty: number): ConstructionLook | null => {
    if (!live || live.town.id !== townId) return null;
    const lot = live.byTile.get(tileKey(tx, ty));
    if (!lot) return null;
    const look = lotLookAt(lot, live.elapsed, deps.hasArt);
    if (look?.art) live.art = true;
    return look;
  };

  const flourish = (): FlourishLook | null => {
    if (!live) return null;
    const look = flourishLookAt(live.town, live.elapsed, deps.hasArt);
    if (look) live.art = true;
    return look;
  };

  const state = (): GrowthMomentState => {
    if (!live) return last;
    return {
      active: true,
      townId: live.town.id,
      tier: live.town.tier,
      label: live.label,
      elapsed: live.elapsed,
      durationMs: live.durationMs,
      lots: live.lots.length,
      // The first wave's stage — the one a player watching the town sees move.
      stage: lotStageAt({ band: 0 }, live.elapsed),
      flourishStage: flourishStageAt(live.elapsed),
      art: live.art,
      skipped: live.skipped,
      reduced: false,
    };
  };

  return {
    start,
    tick,
    skip,
    finish,
    lookFor,
    flourish,
    get state() { return state(); },
    get active() { return live !== null; },
    dispose() { live = null; painted = ""; disarm(); },
  };
}
