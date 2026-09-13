// ══════════════════════════════════════════════════════════════════════════
// HUD-ICONS — 1950s noir chrome + Match-3 gem cargo badges.
//
// Issue #166: OS emoji (cartoon wheat, blue oil drums, robot heads) clash
// with the brass-and-baize HUD. Cargo surfaces reuse the painted gem tokens
// in src/assets/gems/; utility keys are stroke SVGs in currentColor so they
// pick up the plate's brass and stay crisp at every button size.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, CARGOES, type Cargo } from "../iso/config";
import { DEPOT_COST } from "../iso/construction";
import { GEM_ART } from "./gem-art";
import type { Purse } from "../iso/track";

const svg = (body: string): string =>
  `<svg class="hud-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Vintage gramophone horn — sound on. */
export const ICON_SOUND_ON = svg(
  `<path d="M4.5 10.5v3c0 1.4 1 2.4 2.6 2.4H8"/>` +
  `<path d="M8 8.2v7.6"/>` +
  `<path d="M8 8.2c4.6-.8 7.4-4 9.8-7.2.4.8.6 2 .6 3.6v11c0 1.6-.2 2.8-.6 3.6C15.4 16 12.6 12.8 8 12"/>` +
  `<circle cx="5.4" cy="17.6" r="1.5"/>`,
);

/** The same horn, barred — sound off. */
export const ICON_SOUND_OFF = svg(
  `<path d="M4.5 10.5v3c0 1.4 1 2.4 2.6 2.4H8"/>` +
  `<path d="M8 8.2v7.6"/>` +
  `<path d="M8 8.2c4.6-.8 7.4-4 9.8-7.2.4.8.6 2 .6 3.6v11c0 1.6-.2 2.8-.6 3.6C15.4 16 12.6 12.8 8 12"/>` +
  `<path d="M4 5.5l16 13"/>`,
);

/** Brass surveyor's reticle — recenter / focus. */
export const ICON_RETICLE = svg(
  `<circle cx="12" cy="12" r="6.4"/>` +
  `<path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4"/>` +
  `<circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/>`,
);

/** Engraved question plaque — How to Play. */
export const ICON_HELP = svg(
  `<rect x="4.2" y="3.2" width="15.6" height="17.6" rx="1.4"/>` +
  `<path d="M9.4 9.1c0-1.55 1.2-2.6 2.65-2.6 1.5 0 2.6 1 2.6 2.4 0 1.35-1 1.9-2.05 2.45-.7.4-1.05.85-1.05 1.7"/>` +
  `<circle cx="12.05" cy="16.15" r=".85" fill="currentColor" stroke="none"/>`,
);

/** Vintage binoculars — rival plant peek. */
export const ICON_BINOCULARS = svg(
  `<circle cx="7.4" cy="14" r="4.3"/>` +
  `<circle cx="16.6" cy="14" r="4.3"/>` +
  `<path d="M11.2 12.6h1.6"/>` +
  `<path d="M5.4 10.4L7.3 5.6h2.6"/>` +
  `<path d="M18.6 10.4L16.7 5.6h-2.6"/>` +
  `<path d="M9.9 5.6h4.2"/>`,
);

/** Clockwork gear — rival difficulty. */
export const ICON_GEAR = svg(
  `<circle cx="12" cy="12" r="3.1"/>` +
  `<path d="M12 4.2v2.2M12 17.6v2.2M4.2 12h2.2M17.6 12h2.2M6.5 6.5l1.55 1.55M15.95 15.95l1.55 1.55M17.5 6.5l-1.55 1.55M8.05 15.95L6.5 17.5"/>` +
  `<circle cx="12" cy="12" r="6.4"/>`,
);

/** Art-deco vault door — Bank. */
export const ICON_BANK = svg(
  `<rect x="4" y="4.2" width="16" height="15.6" rx="1.2"/>` +
  `<circle cx="12" cy="12.2" r="4.1"/>` +
  `<circle cx="12" cy="12.2" r="1.2" fill="currentColor" stroke="none"/>` +
  `<path d="M12 8.1v8.2M8.1 12.2h7.8"/>`,
);

/** Brass balance scale — Market. */
export const ICON_MARKET = svg(
  `<path d="M12 4.2v13.4M8.2 19.4h7.6"/>` +
  `<path d="M12 6.4L5.6 12.2"/>` +
  `<path d="M12 6.4l6.4 5.8"/>` +
  `<path d="M5.6 12.2h0"/>` +
  `<ellipse cx="5.8" cy="14.4" rx="2.7" ry="1.5"/>` +
  `<ellipse cx="18.2" cy="14.4" rx="2.7" ry="1.5"/>`,
);

/** Brick factory + smokestacks — Processing Plant. */
export const ICON_PLANT = svg(
  `<path d="M3.6 19.4V11.2l4.2-2.4V11l3.4-2.2v10.6z"/>` +
  `<path d="M11.2 19.4V9.6h9.2v9.8z"/>` +
  `<path d="M13.4 9.6V4.6h1.7v5"/>` +
  `<path d="M17.2 9.6V6h1.7v3.6"/>` +
  `<path d="M5.4 15.4h1.6M5.4 17.4h1.6M13.6 13.2h1.8v2.4h-1.8zM17.2 13.2h1.8v2.4h-1.8z"/>`,
);

/** Folded dispatch / newsprint — Feed. */
export const ICON_FEED = svg(
  `<path d="M5 5.4h10.4l3.6 3.6V18.6H5z"/>` +
  `<path d="M15.2 5.4v3.8h3.8"/>` +
  `<path d="M8 11.4h8M8 14h8M8 16.5h5.2"/>`,
);

export const HUD_ICONS = {
  soundOn: ICON_SOUND_ON,
  soundOff: ICON_SOUND_OFF,
  reticle: ICON_RETICLE,
  help: ICON_HELP,
  binoculars: ICON_BINOCULARS,
  gear: ICON_GEAR,
  bank: ICON_BANK,
  market: ICON_MARKET,
  plant: ICON_PLANT,
  feed: ICON_FEED,
} as const;

export function soundIconHtml(enabled: boolean): string {
  return enabled ? ICON_SOUND_ON : ICON_SOUND_OFF;
}

/** Painted gem token for a cargo — the same PNG the match-3 board draws. */
export function cargoIconHtml(cargo: Cargo, cls = "cargo-ic"): string {
  const art = GEM_ART[cargo];
  const name = CARGO[cargo].name;
  return `<img class="${cls}" src="${art}" alt="${name}" draggable="false">`;
}

const entriesOf = (cost: Purse): Cargo[] =>
  CARGOES.filter((c) => (cost[c] ?? 0) > 0);

/** Compact cost with gem badges: `1` + wheat gem, … Empty cost → "free". */
export function costMarkup(cost: Purse): string {
  const parts = entriesOf(cost).map(
    (c) => `<span class="cost-chip"><b>${cost[c]}</b>${cargoIconHtml(c)}</span>`,
  );
  return parts.length ? parts.join(" ") : "free";
}

/** Depot Build-button sublabel, with gem badges once the allowance is spent. */
export function depotButtonMarkup(freeDepots: number): string {
  return freeDepots > 0
    ? `free setup · then ${costMarkup(DEPOT_COST)}`
    : `${costMarkup(DEPOT_COST)} · on industry`;
}
