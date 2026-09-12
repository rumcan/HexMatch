// ── V5: the restored gem art, shared ────────────────────────────────────────
// One painted token per cargo in src/assets/gems/, keyed by CARGO name — the
// board (ui.ts) and the tour's board figure (tutorial.ts) both read this map,
// so one set of tokens shows everywhere.
//
// Six explicit imports rather than a `*.png` glob: the glob also swept in the
// authoring sheet (`gems_spritesheet.png`, ~148 KB) that nothing draws, and
// bundled it twice over. The sheet stays in the folder for regeneration; only
// these six ship. Replacing a PNG of the same name still just works.
import gold from "../assets/gems/gold.png";
import grain from "../assets/gems/grain.png";
import oil from "../assets/gems/oil.png";
import ore from "../assets/gems/ore.png";
import stone from "../assets/gems/stone.png";
import wood from "../assets/gems/wood.png";
import type { Cargo } from "../iso/config";

export const GEM_ART: Record<Cargo, string> = { gold, grain, oil, ore, stone, wood };
