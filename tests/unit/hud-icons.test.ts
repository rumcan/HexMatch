// @vitest-environment jsdom
//
// #166 — HUD chrome uses painted gem tokens + stroke SVGs, not OS emoji.
import { describe, expect, it } from "vitest";
import { CARGO, CARGOES, type Cargo } from "../../src/iso/config";
import { DEPOT_COST } from "../../src/iso/construction";
import { GEM_ART } from "../../src/game/gem-art";
import {
  HUD_ICONS, cargoIconHtml, costMarkup, depotButtonMarkup, soundIconHtml,
} from "../../src/game/hud-icons";

const EMOJI = /[\u{1F300}-\u{1FAFF}]/u;

describe("#166 HUD icons", () => {
  it("cargo badges reuse GEM_ART for every resource, with the cargo's name as alt", () => {
    for (const cargo of CARGOES) {
      const html = cargoIconHtml(cargo as Cargo);
      expect(html).toContain(`src="${GEM_ART[cargo]}"`);
      expect(html).toContain(`alt="${CARGO[cargo].name}"`);
      expect(html).toContain('class="cargo-ic"');
      expect(html).not.toMatch(EMOJI);
    }
  });

  it("costMarkup is gem chips (or the word free), never concatenated OS emoji", () => {
    expect(costMarkup({})).toBe("free");
    const html = costMarkup(DEPOT_COST);
    expect(html).toContain('class="cost-chip"');
    expect(html).toContain('alt="Grain"');
    expect(html).toContain('alt="Wood"');
    expect(html).toContain('alt="Stone"');
    expect(html).toContain('alt="Oil"');
    expect(html).toMatch(/<b>1<\/b>/);
    expect(html).not.toMatch(EMOJI);
  });

  it("depotButtonMarkup keeps the setup copy and names Oil with a gem", () => {
    expect(depotButtonMarkup(1)).toMatch(/free setup/);
    expect(depotButtonMarkup(1)).toContain('alt="Oil"');
    expect(depotButtonMarkup(0)).toMatch(/on industry/);
    expect(depotButtonMarkup(0)).not.toMatch(EMOJI);
  });

  it("chrome SVGs are currentColor strokes, no Unicode glyphs", () => {
    for (const [name, svg] of Object.entries(HUD_ICONS)) {
      expect(svg, name).toContain('class="hud-ic"');
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).not.toMatch(EMOJI);
    }
    expect(soundIconHtml(true)).toBe(HUD_ICONS.soundOn);
    expect(soundIconHtml(false)).toBe(HUD_ICONS.soundOff);
    expect(soundIconHtml(true)).not.toBe(soundIconHtml(false));
  });
});
