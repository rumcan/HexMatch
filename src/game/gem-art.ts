// ── V5: the restored gem art, shared ────────────────────────────────────────
// One painted token per cargo in src/assets/gems/, keyed by CARGO name — the
// board (ui.ts) and the tour's board figure (tutorial.ts) both read this map,
// so one set of tokens shows everywhere.
//
// MATCH-2 (#566): the tokens are the owner's painted cargo icons (wheat sheaf,
// oil barrel, stone and pickaxe, logs, ore crystals, gold coins), compiled by
// tools/make-gem-sprites.mjs from assets/gems-src/v3/. The board canvas draws
// the 256 px copies (`GEM_ART_2X`) on a dense screen; everything else reads
// the 128 px set.
//
// Explicit imports rather than a `*.png` glob: the glob also swept in the
// authoring sheet (`gems_spritesheet.png`, ~148 KB) that nothing draws, and
// bundled it twice over. Replacing a PNG of the same name still just works.
import gold from "../assets/gems/gold.png";
import grain from "../assets/gems/grain.png";
import oil from "../assets/gems/oil.png";
import ore from "../assets/gems/ore.png";
import stone from "../assets/gems/stone.png";
import wood from "../assets/gems/wood.png";
import gold2x from "../assets/gems/gold@2x.png";
import grain2x from "../assets/gems/grain@2x.png";
import oil2x from "../assets/gems/oil@2x.png";
import ore2x from "../assets/gems/ore@2x.png";
import stone2x from "../assets/gems/stone@2x.png";
import wood2x from "../assets/gems/wood@2x.png";
import type { Cargo } from "../iso/config";

export const GEM_ART: Record<Cargo, string> = { gold, grain, oil, ore, stone, wood };
export const GEM_ART_2X: Record<Cargo, string> = {
  gold: gold2x, grain: grain2x, oil: oil2x, ore: ore2x, stone: stone2x, wood: wood2x,
};
