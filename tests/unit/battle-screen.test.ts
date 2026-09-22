// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// B2 (#247) — the battle screen: the 1v1 interface.
//
// Smoke coverage for the acceptance block's structural half:
//
//   • the screen mounts both seats with portraits, health and six mana bars,
//     the whose-turn banner and the (hidden) ability row B3 will fill;
//   • the shared board renders the battle's gems and takes the tap-tap swap;
//   • the opponent's turn locks the board;
//   • an already-decided battle opens straight on the result screen, and
//     Continue returns to the map with the screen gone (no leftover state).
//
// The playable-to-a-result half (`__iso.startBattle(seed)`) is the debug
// console's job and is exercised by hand / e2e, not re-derived here.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach } from "vitest";
import { createBattle, type Battle } from "../../src/game/battle";
import {
  openBattleScreen, randomLegalSwap, type BattleScreenHandle,
} from "../../src/game/battle-screen";
import { BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES, CARGOES, type Cargo } from "../../src/iso/config";

const contenders = [
  { id: "you", name: "You", portrait: null },
  { id: "rival", name: "Vex", portrait: null },
] as const;

let screen: BattleScreenHandle | null = null;
afterEach(() => {
  screen?.destroy();
  screen = null;
  document.body.innerHTML = "";
});

function freshBattle(seed: number, depots?: [Cargo[], Cargo[]]) {
  return createBattle({
    seed,
    players: [
      { id: "you", name: "You", depots: depots?.[0] },
      { id: "rival", name: "Vex", depots: depots?.[1] },
    ],
    rules: BATTLE_RULES,
    animate: false, // headless board: the screen still paints its own motion
  });
}

function paintFixture(b: Battle) {
  for (const g of b.board.gems()) g.res = (g.r + g.c) % 2 ? "ore" : "wheat";
  b.board.grid[0][0]!.res = "wood";
  b.board.grid[0][1]!.res = "wood";
  b.board.grid[1][2]!.res = "wood";
}

describe("B2 battle screen", () => {
  it("mounts both seats (portrait, health, six mana bars), the turn banner and a locked ability row", () => {
    const battle = freshBattle(7);
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000, // the opponent never moves during the test
      onClose: () => {},
    });
    const root = screen.root;
    expect(document.body.contains(root)).toBe(true);
    expect(root.querySelectorAll(".battle-side")).toHaveLength(2);
    expect(root.querySelectorAll(".battle-portrait")).toHaveLength(2);
    expect(root.querySelectorAll(".battle-health")).toHaveLength(2);
    expect(root.querySelectorAll(".battle-health-num")[0].textContent).toBe(String(BATTLE_RULES.startHealth));
    // 6 mana bars per seat — one per cargo
    expect(root.querySelectorAll(".battle-mana-chip").length).toBe(2 * CARGOES.length);
    const turn = root.querySelector(".battle-turn") as HTMLElement;
    expect(turn.textContent).toBe("YOUR TURN");
    expect(turn.dataset.turn).toBe("you");
    expect(root.querySelector(".battle-timer-fill")).toBeTruthy();
    // B3's row: one button per table entry, painted from the table
    const abilities = root.querySelectorAll(".battle-ability");
    expect(abilities).toHaveLength(BATTLE_ABILITY_ORDER.length);
    for (const id of BATTLE_ABILITY_ORDER) {
      expect(root.querySelector(`.battle-ability[data-ability="${id}"]`)).toBeTruthy();
    }
    // the whole board is up
    expect(root.querySelectorAll(".gem").length).toBe(battle.board.w * battle.board.h);
  });

  it("takes a tap-tap swap and hands the turn to the opponent (board locks)", async () => {
    const battle = freshBattle(2);
    paintFixture(battle);
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000,
      onClose: () => {},
    });
    const root = screen.root;
    const grid = root.querySelector(".grid") as HTMLElement;
    expect(grid.classList.contains("locked")).toBe(false);

    // the fixture's legal swap: (1,2) up into the hole at (0,2)
    (root.querySelector('.gem[data-r="1"][data-c="2"]') as HTMLElement).click();
    expect(root.querySelector(".gem.sel")).toBeTruthy();
    (root.querySelector('.gem[data-r="0"][data-c="2"]') as HTMLElement).click();
    await Promise.resolve(); // let playSwap's microtasks land
    await new Promise((r) => setTimeout(r, 5));

    expect(battle.state.turn).toBe(1); // the swap resolved and passed
    const turn = root.querySelector(".battle-turn") as HTMLElement;
    expect(turn.dataset.turn).toBe("them");
    expect(turn.textContent).toContain("VEX");
    expect(grid.classList.contains("locked")).toBe(true);
    // the mana the swap banked is on the HUD already
    const woodChip = root.querySelector('.battle-side.s-0 .battle-mana-chip[data-cargo="wood"]') as HTMLElement;
    expect(woodChip.querySelector(".battle-mana-num")!.textContent).toBe("3");
  });

  it("a decided battle opens on the result screen; Continue returns to the map", () => {
    const battle = freshBattle(7);
    battle.state.over = true;
    battle.state.winner = 0;
    let closed: unknown = null;
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      stake: "the ore yards",
      opponentDelayMs: 60_000,
      onClose: (r) => { closed = r; },
    });
    const root = screen.root;
    const result = root.querySelector(".battle-result") as HTMLElement;
    expect(result.classList.contains("hidden")).toBe(false);
    expect(root.querySelector(".battle-verdict")!.textContent).toBe("VICTORY");
    expect(root.querySelector(".battle-stake")!.textContent).toContain("the ore yards");
    (root.querySelector(".battle-continue") as HTMLButtonElement).click();
    expect(closed).toEqual({ winner: 0, over: true, verdict: "win" });
    expect(document.body.contains(root)).toBe(false); // no leftover screen
  });

  it("destroy() leaves nothing behind", () => {
    const battle = freshBattle(7);
    const s = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000,
      onClose: () => {},
    });
    expect(document.body.querySelectorAll(".battle-root")).toHaveLength(1);
    s.destroy();
    expect(document.body.querySelectorAll(".battle-root")).toHaveLength(0);
  });

  it("randomLegalSwap proposes a swap the engine accepts (placeholder opponent)", async () => {
    const battle = freshBattle(11);
    const mv = randomLegalSwap(battle);
    expect(mv).not.toBeNull();
    const out = await battle.playSwap(mv![0], mv![1], mv![2], mv![3], 0);
    expect(out.ok).toBe(true);
  });

  it("an oracle can play the screen all the way to a result card (e2e loop, headless)", async () => {
    const battle = freshBattle(5);
    let closedWith: { winner: number | null } | null = null;
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentSwap: (b) => randomLegalSwap(b),
      opponentDelayMs: 0,
      onClose: (r) => { closedWith = r; },
    });
    const root = screen.root;
    document.body.appendChild(root);

    // play it out: click the oracle's two gems whenever the board is ours;
    // the stub opponent fires on its 0ms flip
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 300 && !battle.state.over; i++) {
      const grid = root.querySelector(".grid");
      if (grid && !grid.classList.contains("locked")) {
        const mv = battle.board.findMove();
        if (mv) {
          for (const [r, c] of [[mv[0], mv[1]], [mv[2], mv[3]]] as const) {
            (root.querySelector(`.gem[data-r="${r}"][data-c="${c}"]`) as HTMLElement).click();
          }
        }
      }
      await sleep(4);
    }
    expect(battle.state.over).toBe(true);
    await sleep(750); // the result card lands 700ms after the last callout

    const result = root.querySelector(".battle-result");
    expect(result).not.toBeNull();
    const verdict = root.querySelector(".battle-verdict")?.textContent ?? "";
    expect(verdict).toMatch(/VICTORY|DEFEAT|DRAW/);
    (root.querySelector(".battle-continue") as HTMLElement).click();
    expect(closedWith).not.toBeNull();
    expect(document.querySelector(".battle-root")).toBeNull();
  });

  it("shows abilities locked with the reason when the depot is missing", () => {
    const battle = freshBattle(7, [
      ["grain", "wood", "stone", "ore"], // no Oil depot, no Gold depot
      [],
    ]);
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000,
      onClose: () => {},
    });
    const root = screen.root;
    const smog = root.querySelector('.battle-ability[data-ability="smog"]') as HTMLButtonElement;
    expect(smog.classList.contains("locked")).toBe(true);
    expect(smog.querySelector(".ba-reason")!.textContent).toBe("Needs the Oil depot");
    expect(smog.disabled).toBe(true);
    const bribe = root.querySelector('.battle-ability[data-ability="bribe"]') as HTMLButtonElement;
    expect(bribe.classList.contains("locked")).toBe(true);
    expect(bribe.querySelector(".ba-reason")!.textContent).toBe("Needs the Gold depot");
    // an owned-but-broke ability says THAT instead (the bill, not the depot)
    const girders = root.querySelector('.battle-ability[data-ability="girders"]') as HTMLButtonElement;
    expect(girders.classList.contains("poor")).toBe(true);
    expect(girders.querySelector(".ba-reason")!.textContent).toContain("Short");
  });

  it("a ready ability casts on click; the free one keeps your turn", async () => {
    const all: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];
    const battle = freshBattle(7, [all, all]);
    // fund the Gold Bribe before the screen paints its first read
    battle.state.players[0].mana.gold = BATTLE_ABILITIES.bribe.cost.gold!;
    battle.state.players[1].mana.oil = 4;
    screen = openBattleScreen({
      battle,
      contenders: [contenders[0], contenders[1]],
      opponentDelayMs: 60_000,
      onClose: () => {},
    });
    const root = screen.root;
    const bribe = root.querySelector('.battle-ability[data-ability="bribe"]') as HTMLButtonElement;
    expect(bribe.classList.contains("ready")).toBe(true);
    expect(bribe.disabled).toBe(false);

    bribe.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));

    // effect: 2 mana of each cargo the opponent holds came over
    expect(battle.state.players[1].mana.oil).toBe(2);
    expect(battle.state.players[0].mana.oil).toBe(2);
    expect(battle.state.players[0].mana.gold).toBe(0); // 3 − 3 bill
    // the table said costsTurn:false — still your turn, board still live
    expect(battle.state.turn).toBe(0);
    const grid = root.querySelector(".grid") as HTMLElement;
    expect(grid.classList.contains("locked")).toBe(false);
    // …and the button now reads its cooldown
    expect(bribe.classList.contains("cooling")).toBe(true);
    expect(bribe.querySelector(".ba-reason")!.textContent).toBe("Ready in 2 turns");
  });
});
