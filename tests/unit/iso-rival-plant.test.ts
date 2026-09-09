// ══════════════════════════════════════════════════════════════════════════
// A1 — the rival's Processing Plant.
//
// The Black Market bug: Frost Tiles, Iron Girders and Smog Cloud fired into
// `quarry.board` — the buyer's OWN board. The fix gives the rival a plant and
// lands the sabotage on it, which is only half a fix: a board nobody scores
// off is a purchase that changes nothing. So the plant's state scales the
// rival's trickle income, and every effect expires so an unplayed board is not
// wrecked forever.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import {
  createRivalPlant, RIVAL_FROST_MS, RIVAL_GIRDER_MS, RIVAL_SMOG_MS,
  GIRDER_WEIGHT, SMOG_YIELD, MIN_HEALTH,
} from "../../src/iso/rival-plant";
import { BOARD_W, BOARD_H, setRng, mulberry32 } from "../../src/game/config";

const CELLS = BOARD_W * BOARD_H;

beforeEach(() => setRng(mulberry32(1234)));

describe("A1 the rival's plant", () => {
  it("starts healthy — an untouched plant costs the rival nothing", () => {
    const p = createRivalPlant();
    expect(p.health(0)).toBe(1);
    expect(p.status(0)).toEqual({ frozen: 0, girders: 0, smog: false });
  });

  it("freezes gems on the rival's board, and reports how many actually froze", () => {
    const p = createRivalPlant();
    const n = p.frost(0);
    expect(n).toBe(7);
    expect(p.status(0).frozen).toBe(7);
    // the damage is on the RIVAL's board — the player's board is untouched by
    // construction here (it is not even in this module), so what is asserted
    // is that the ice is real and countable.
    expect(p.board.gems().filter((g) => g.hard > 0)).toHaveLength(7);
  });

  it("drops girders, and smog hangs over the plant for its full duration", () => {
    const p = createRivalPlant();
    expect(p.girders(0)).toBe(4);
    expect(p.status(0).girders).toBe(4);

    p.smog(0);
    expect(p.status(0).smog).toBe(true);
    expect(p.status(RIVAL_SMOG_MS - 1).smog).toBe(true);
    expect(p.status(RIVAL_SMOG_MS).smog).toBe(false);
  });

  it("scales the rival's income by how wrecked the plant is", () => {
    const p = createRivalPlant();
    p.frost(0);                                     // 7 ice
    const iced = 1 - 7 / CELLS;
    expect(p.health(0)).toBeCloseTo(iced, 5);

    p.girders(0);                                   // + girders, at girder weight
    // measured, not assumed: a girder can land on a cell that was already
    // iced (it replaces that gem), so the two counts are not independent.
    const wrecked = p.status(0);
    expect(wrecked.girders).toBe(4);
    expect(p.health(0)).toBeCloseTo(
      1 - (wrecked.frozen + wrecked.girders * GIRDER_WEIGHT) / CELLS, 5,
    );

    const beforeSmog = p.health(0);
    p.smog(0);
    expect(p.health(0)).toBeCloseTo(beforeSmog * SMOG_YIELD, 5);
  });

  it("melts the ice and hauls the girders away on their own clocks", () => {
    const p = createRivalPlant();
    p.frost(0);
    p.girders(0);
    expect(p.health(0)).toBeLessThan(1);

    p.tick(RIVAL_FROST_MS);                         // ice melts
    expect(p.status(RIVAL_FROST_MS).frozen).toBe(0);
    expect(p.status(RIVAL_FROST_MS).girders).toBe(4);   // girders outlast it

    p.tick(RIVAL_GIRDER_MS);                        // girders hauled away
    expect(p.status(RIVAL_GIRDER_MS).girders).toBe(0);
    expect(p.health(RIVAL_GIRDER_MS)).toBe(1);      // good as new
  });

  it("never wrecks a plant past the floor — the rival always earns something", () => {
    const p = createRivalPlant();
    // every cell iced over, plus smog: the worst case a buy can produce
    for (let i = 0; i < 20; i++) p.frost(0, 7);
    p.smog(0);
    expect(p.board.gems().filter((g) => g.hard > 0 || g.block).length)
      .toBeLessThanOrEqual(CELLS);
    expect(p.health(0)).toBeGreaterThanOrEqual(MIN_HEALTH);
  });

  it("is a board of its own — sabotage here cannot touch the player's gems", () => {
    const a = createRivalPlant();
    const b = createRivalPlant();
    a.frost(0);
    expect(a.status(0).frozen).toBe(7);
    expect(b.status(0).frozen).toBe(0);             // separate plants, separate gems
  });
});
