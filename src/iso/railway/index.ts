// ══════════════════════════════════════════════════════════════════════════
// RAIL-01/02 — the railway module's public surface.
//
// One import for the placement UI (#179), the train simulation (#178), the
// multiplayer authority (#181) and the balance harness (#182):
//
//   import { createRailway, previewRailDrag, commitRailDrag, planPlatform,
//            buildPlatform, ... } from "./railway";
//
// The module is deliberately headless — no canvas, no DOM, no socket — so
// every rail rule can be tested (and hosted) without a browser. The scene it
// paints and the wire it travels are the callers' business.
// ══════════════════════════════════════════════════════════════════════════
export * from "./state";
export * from "./geometry";
export * from "./connectivity";
export * from "./placement";
