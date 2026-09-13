// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the painted backdrops the cutscenes stand in.
//
// Six plates, painted wide (masters in `assets/story-src/bg-*.png`, derived to
// webp by `tools/make-story-art.mjs`). The stage only ever `cover`s them — a
// backdrop is a place, not a texture, so it is scaled uniformly and cropped,
// never squashed into the window — and drifts one slow Ken Burns breath while
// a scene stands on it (killed outright under prefers-reduced-motion).
//
// A scene names its place by key; changing the key mid-scene cross-fades the
// two plates behind the dialogue instead of cutting, which is the whole
// difference between a slideshow and a film.
// ══════════════════════════════════════════════════════════════════════════
import bgHarbor from "../assets/story/bg-harbor.webp";
import bgBoardroom from "../assets/story/bg-boardroom.webp";
import bgRailyard from "../assets/story/bg-railyard.webp";
import bgOilfield from "../assets/story/bg-oilfield.webp";
import bgQuarry from "../assets/story/bg-quarry.webp";
import bgSkyline from "../assets/story/bg-skyline.webp";
import bgTown from "../assets/story/bg-town.webp";
import bgOffice from "../assets/story/bg-office.webp";

export type BackdropKey =
  | "harbor"     // dawn over the freight docks — the opening reel
  | "boardroom"  // the Syndicate's boardroom, one amber lamp, smoke in the beam
  | "railyard"   // rain on the marshalling yard at night, signal lamps
  | "oilfield"   // derricks at dusk, flare stacks burning
  | "quarry"     // the gold quarry by lantern light
  | "skyline"   // the empire at full height — finales and title cards
  | "town"      // main street under Marrow's toll gates
  | "office";   // Hextall Freight's office above the dock — Mabel's room

export const BACKDROPS: Record<BackdropKey, string> = {
  harbor: bgHarbor,
  boardroom: bgBoardroom,
  railyard: bgRailyard,
  oilfield: bgOilfield,
  quarry: bgQuarry,
  skyline: bgSkyline,
  town: bgTown,
  office: bgOffice,
};

export const BACKDROP_KEYS = Object.keys(BACKDROPS) as BackdropKey[];

/** The one-line place caption the stage prints under a backdrop change. */
export const BACKDROP_CAPTION: Record<BackdropKey, string> = {
  harbor: "Hextall Freight docks · first light",
  boardroom: "The Foundry Syndicate boardroom",
  railyard: "Meridian marshalling yard · rain",
  oilfield: "The Roque field · dusk",
  quarry: "Blackwood gold quarry · lantern light",
  skyline: "The city · the years that followed",
  town: "Main Street · under the toll gates",
  office: "Hextall Freight · the office above the dock",
};
