// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// BATTLE-1 (#468) — battles with stakes and drama.
//
// Three layers of the ticket, each pinned where it is pure:
//
//   • the STAKES CARD's live numbers (`battleStakeFacts` / `siteIncome`) —
//     the ★ and income/min a site fight is for, read off the SAME economy
//     reads the clock pays (a blockaded industry or a cut road reads 0, a
//     held one reads exactly the clock's per-minute figure);
//   • DECLINE STILL FORFEITS — the rule the card must say plainly, unchanged
//     (`settleMapBattle` speaks for the challenger; the card only stands
//     between the offer and the duel);
//   • the CARD ITSELF and the duel HUD (`openStakesCard`, `openBattleScreen`)
//     — the doors answer once, Escape never forfeits, the countdown shows,
//     and the HUD carries the turn counter, the big health bars and a mana
//     bar per side.
//
// No rule changes: the engine (`src/game/battle.ts`) is not touched here.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach } from "vitest";
import {
  battleStakeFacts, siteIncome, stakeSiteTile, settleMapBattle,
  type MapBattleStake,
} from "../../src/iso/battle-map";
import {
  buildAllComponents, harvesterYield, industryLocks,
  type EconomyState, type Harvester, type Factory,
} from "../../src/iso/economy";
import { createTrack, buildTile } from "../../src/iso/track";
import { BATTLE_RULES, VICTORY, MAP_W, MAP_H } from "../../src/iso/config";
import type { Grid } from "../../src/iso/grid";
import { openStakesCard, openBattleScreen, extraTurnRuleText, type StakesCardHandle } from "../../src/game/battle-screen";
import { createBattle } from "../../src/game/battle";

const TICK_MS = 3000; // the game's HARVEST_MS

// ── the fixture: ONE grain industry between two serviced depots ─────────────
// (the same shape as the #322 suite: farm at (12,10), depot A west, depot B east)
function fixture(): { eco: EconomyState; h1: Harvester; h2: Harvester } {
  const grid: Grid = {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H),
    industries: [{ id: 0, type: "farm", tx: 12, ty: 10, w: 2, h: 2, output: 1, banditUntil: 0 }],
    towns: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 1,
  };
  const track = createTrack();
  for (const [x, y] of [[10, 9], [11, 9]] as [number, number][]) buildTile(track, "road", x, y, 1);
  for (const [x, y] of [[16, 10], [16, 11]] as [number, number][]) buildTile(track, "road", x, y, 2);
  const h1: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 10, facing: "ne" };
  const h2: Harvester = { id: 2, owner: "p2", ownerId: 2, tx: 14, ty: 10, facing: "se" };
  return { eco: { grid, track, harvesters: [h1, h2], factories: [], dams: [] }, h1, h2 };
}

function withTowns(eco: EconomyState): EconomyState {
  eco.grid.towns = [
    { id: 0, tx: 4, ty: 4, houses: [], roads: [] },
    { id: 1, tx: 20, ty: 4, houses: [], roads: [] },
  ];
  const f1: Factory = { owner: "p1", ownerId: 1, tx: 4, ty: 5, id: 0, townId: 0 };
  const f2: Factory = { owner: "p2", ownerId: 2, tx: 20, ty: 5, id: 1, townId: 1 };
  eco.factories = [f1, f2];
  return eco;
}

const names = (id: string | null | undefined) => (id === "p1" ? "You" : id === "p2" ? "Vex" : "Unclaimed");

describe("#468 — the stakes card's live numbers", () => {
  it("an industry fight reads the holder, the site, the ★ table and the holder's income/min", () => {
    const { eco } = fixture();
    // the holder's plant, a road-tile's reach past the depot's gate — so the
    // site's income is a number the clock would actually pay
    eco.factories = [{ owner: "p1", ownerId: 1, tx: 12, ty: 8, id: 0 }];
    const stake: MapBattleStake = {
      kind: "industry", industryId: 0, challengerId: "p1",
      challengerHarvesterId: 1, holderHarvesterId: 2, holderId: "p2",
    };
    const facts = battleStakeFacts(eco, stake, { nameOf: names, tickMs: TICK_MS, now: 0 });
    expect(facts).not.toBeNull();
    expect(facts!.kind).toBe("industry");
    expect(facts!.site).toBe("Farm");
    // first-come: the fixture's depot A (p1) holds it initially
    expect(facts!.holder).toBe("You");
    // the ★ at stake is the LIVE table, cap and all — never a hardcoded 1
    expect(facts!.holdStars).toBe(VICTORY.loop.hold);
    expect(facts!.holdCap).toBe(VICTORY.loop.holdCap);
    expect(facts!.cityStarsPerTier).toBe(0);
    // income: the holder's depot draws the farm — the SAME per-tick figure the
    // clock pays, scaled to a minute
    const comp = buildAllComponents(eco.track, 1);
    const y = harvesterYield(eco, comp, industryLocks(eco), eco.harvesters[0], 0);
    const perTick = Object.entries(y.yields).reduce((s, [, v]) => s + (v ?? 0), 0);
    expect(y.serviced).toBe(true);
    expect(facts!.holderIncomePerMin).toBe(Math.round((perTick * 60_000) / TICK_MS));
    expect(facts!.holderIncomePerMin).toBeGreaterThan(0);
    expect(facts!.holderIncomeCargo).toBe("grain");
  });

  it("an unclaimed industry reads Unclaimed and promises no income", () => {
    const { eco } = fixture();
    eco.harvesters = []; // nobody services anything
    const stake: MapBattleStake = {
      kind: "industry", industryId: 0, challengerId: "p1",
      challengerHarvesterId: null, holderHarvesterId: null, holderId: null,
    };
    const facts = battleStakeFacts(eco, stake, { nameOf: names, tickMs: TICK_MS, now: 0 });
    expect(facts!.holder).toBe("Unclaimed");
    expect(facts!.holderIncomePerMin).toBe(0);
  });

  it("a town fight adds the city ★ and reads the income routed through the plant", () => {
    const eco = withTowns(fixture().eco);
    const stake: MapBattleStake = { kind: "town", townId: 0, challengerId: "p2", holderId: "p1" };
    const facts = battleStakeFacts(eco, stake, { nameOf: names, tickMs: TICK_MS, now: 0 });
    expect(facts!.kind).toBe("town");
    expect(facts!.site).toBe("Town 1");
    expect(facts!.holder).toBe("You");
    expect(facts!.cityStarsPerTier).toBe(VICTORY.loop.city);
    // no depots anywhere yet: the town's income reads 0, never a promise
    expect(facts!.holderIncomePerMin).toBe(0);
  });

  it("a blockaded industry pays nothing while the bandits sit at the gate", () => {
    const { eco } = fixture();
    eco.grid.industries[0]!.banditUntil = 999_999;
    const inc = siteIncome(eco, { kind: "industry", industryId: 0 }, "p2", TICK_MS, 0);
    expect(inc.perMin).toBe(0);
    expect(inc.cargo).toBe("grain");
  });

  it("a fight-off has no site stakes — the card stays a fight-off card", () => {
    const { eco } = fixture();
    const facts = battleStakeFacts(eco, { kind: "fightoff", pending: {
      kind: "blockade", attackerId: "p2", industryId: 0, until: 1, offerUntil: 1,
    } }, { nameOf: names });
    expect(facts).toBeNull();
  });

  it("the aftermath tile is the site's centre — industry, town, or nowhere", () => {
    const eco = withTowns(fixture().eco);
    expect(stakeSiteTile(eco, { kind: "industry", industryId: 0, challengerId: "p1", challengerHarvesterId: 1, holderHarvesterId: 2 }))
      .toEqual({ tx: 13, ty: 11 });
    expect(stakeSiteTile(eco, { kind: "town", townId: 1, challengerId: "p1" })).toEqual({ tx: 20, ty: 4 });
    expect(stakeSiteTile(eco, { kind: "fightoff", pending: { kind: "protest", attackerId: "p2", tile: 5 * MAP_W + 7, until: 1, offerUntil: 1 } }))
      .toEqual({ tx: 7, ty: 5 });
  });
});

describe("#468 — declining still forfeits, as it always did", () => {
  it("a declined defence hands the challenger the win (first win = shared rights)", () => {
    const { eco } = fixture();
    const stake: MapBattleStake = {
      kind: "industry", industryId: 0, challengerId: "p1",
      challengerHarvesterId: 1, holderHarvesterId: 2, holderId: "p2",
    };
    // the player (holder p2) declines: `won` speaks for the CHALLENGER, so true
    const verdict = settleMapBattle(eco, stake, true);
    expect(verdict).toBe("rights");
    const rights = eco.siteRights?.get(0);
    expect(rights?.rights).toContain("p1");
    expect(rights?.streak?.playerId).toBe("p1");
  });

  it("a declined fight-off lands the sabotage exactly as bought", () => {
    const { eco } = fixture();
    const pending = { kind: "blockade" as const, attackerId: "p2", industryId: 0, until: 99, offerUntil: 1 };
    expect(settleMapBattle(eco, { kind: "fightoff", pending }, false)).toBe("lands");
    expect(settleMapBattle(eco, { kind: "fightoff", pending }, true)).toBe("cancelled");
  });
});

// ── the card itself (jsdom) ──────────────────────────────────────────────────

let card: StakesCardHandle | null = null;
afterEach(() => {
  card?.destroy();
  card = null;
  document.body.innerHTML = "";
});

describe("#468 — the stakes card's doors", () => {
  const opts = () => ({
    title: "Challenge — Farm",
    subtitle: "Call a duel for Farm.",
    rows: [
      { label: "Site", value: "Farm" },
      { label: "Held by", value: "Vex" },
      { label: "Income here", value: "32/min grain — Vex" },
    ],
    declineNote: "Declining forfeits: Vex wins the fight.",
    acceptLabel: "Accept — pay 12 Gold",
    declineLabel: "Decline — forfeit",
    until: null as number | null,
  });

  it("renders the ledger as text and Accept answers exactly once", () => {
    let accepted = 0, declined = 0, closed = 0;
    card = openStakesCard(document.body, {
      ...opts(),
      onAccept: () => { accepted++; },
      onDecline: () => { declined++; },
      onClose: () => { closed++; },
    });
    expect(document.body.contains(card.root)).toBe(true);
    expect(card.root.querySelector("h2")?.textContent).toBe("Challenge — Farm");
    const rows = [...card.root.querySelectorAll(".stakes-row")];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toBe("SiteFarm");
    expect(rows[2]!.querySelector(".stakes-value")?.textContent).toBe("32/min grain — Vex");
    (card.root.querySelector("[data-stakes-accept]") as HTMLButtonElement).click();
    expect(accepted).toBe(1);
    expect(declined).toBe(0);
    expect(closed).toBe(0);
    expect(document.body.contains(card.root)).toBe(false);
  });

  it("Decline answers onDecline — the forfeit is a pressed button", () => {
    let accepted = 0, declined = 0;
    card = openStakesCard(document.body, {
      ...opts(),
      onAccept: () => { accepted++; },
      onDecline: () => { declined++; },
    });
    (card.root.querySelector("[data-stakes-decline]") as HTMLButtonElement).click();
    expect(declined).toBe(1);
    expect(accepted).toBe(0);
  });

  it("Escape and the backdrop only CLOSE — never an accidental forfeit", () => {
    let accepted = 0, declined = 0, closed = 0;
    card = openStakesCard(document.body, {
      ...opts(),
      onAccept: () => { accepted++; },
      onDecline: () => { declined++; },
      onClose: () => { closed++; },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closed).toBe(1);
    expect(accepted).toBe(0);
    expect(declined).toBe(0);
    expect(document.body.contains(card.root)).toBe(false);
    // and the backdrop (a fresh card) does the same
    card = openStakesCard(document.body, { ...opts(), onClose: () => { closed++; } });
    (card.root.querySelector(".modal-back") as HTMLElement).click();
    expect(closed).toBe(2);
    expect(declined).toBe(0);
  });

  it("shows the offer's countdown when the card answers a challenge", () => {
    card = openStakesCard(document.body, { ...opts(), until: performance.now() + 65_000 });
    const count = card.root.querySelector(".battle-stakes-count") as HTMLElement;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toMatch(/Answer within 1:0\d/);
  });

  it("destroy() takes the card down and answers nothing", () => {
    let any = 0;
    card = openStakesCard(document.body, {
      ...opts(),
      onAccept: () => { any++; },
      onDecline: () => { any++; },
      onClose: () => { any++; },
    });
    card.destroy();
    expect(any).toBe(0);
    expect(document.body.contains(card.root)).toBe(false);
  });
});

describe("#468 — the duel HUD", () => {
  const contenders = [
    { id: "you", name: "You", portrait: null },
    { id: "rival", name: "Vex", portrait: null },
  ] as const;
  let screen: ReturnType<typeof openBattleScreen> | null = null;
  afterEach(() => {
    screen?.destroy();
    screen = null;
    document.body.innerHTML = "";
  });

  function mount() {
    const battle = createBattle({
      seed: 7,
      players: [{ id: "you", name: "You" }, { id: "rival", name: "Vex" }],
      rules: BATTLE_RULES,
      animate: false,
    });
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000, // the rival never moves during the test
      onClose: () => {},
    });
    return screen;
  }

  it("shows the turn counter, big health reads and a mana bar per side", () => {
    const s = mount();
    const root = s.root;
    // "Turn 1/20" — the counter the whole HUD hangs on
    const turns = root.querySelector(".battle-turns") as HTMLElement;
    expect(turns.textContent).toBe(`Turn 1/${BATTLE_RULES.turnLimit}`);
    // health: the big number and its cap, per side (the second seat opens +10)
    const nums = [...root.querySelectorAll(".battle-health-num")];
    const maxes = [...root.querySelectorAll(".battle-health-max")];
    expect(nums[0]!.textContent).toBe(String(BATTLE_RULES.startHealth));
    expect(maxes[0]!.textContent).toBe(`/ ${BATTLE_RULES.startHealth}`);
    expect(maxes[1]!.textContent).toBe(`/ ${BATTLE_RULES.startHealth + BATTLE_RULES.secondSeatHealth}`);
    // one mana bar per side over the six chips, at 0 of the full bank
    const totals = [...root.querySelectorAll(".battle-mana-total")];
    expect(totals).toHaveLength(2);
    for (const t of totals) {
      expect((t.querySelector(".battle-mana-total-num") as HTMLElement).textContent)
        .toBe(`0/${BATTLE_RULES.manaCap * 6}`);
    }
    // the extra-turn banner is reserved (hidden) until a 4+ run earns it
    const flash = root.querySelector(".battle-flash") as HTMLElement;
    expect(flash.hidden).toBe(true);
  });

  it("the flashed extra-turn rule is the LIVE rules in words", () => {
    expect(extraTurnRuleText(BATTLE_RULES))
      .toBe(`EXTRA TURN — a ${BATTLE_RULES.extraTurnMinMatch}+ run, a special shape, a ${BATTLE_RULES.extraTurnOnCascade}-pass cascade keeps the turn (max ${BATTLE_RULES.extraTurnChain} in a row)`);
    const silent = extraTurnRuleText({
      ...BATTLE_RULES, extraTurnMinMatch: 0, extraTurnOnShape: false, extraTurnOnCascade: 0, extraTurnChain: 0,
    });
    expect(silent).toBe("EXTRA TURN");
  });
});
