// ══════════════════════════════════════════════════════════════════════════
// B7 (#252) — How to Play: battles, and the one-time first-battle hint.
//
// Two things a new player needs before their first fight, and nothing more:
//
//   • THE PAGE — five cards on the card projector (`showRefCards` in
//     guide/refcard.ts, the `.tut-*` CSS): turns, mana, extra turns,
//     abilities, the 20-turn limit and the stakes. It opens from the
//     ❔ help modal (beside "Replay the tour"), the ☰ menu, and the "?" on the
//     battle screen itself. Every number is read from the live tables
//     (`BATTLE_RULES`, `BATTLE_ABILITIES`, `VICTORY.loop`) — never retyped —
//     so a retune cannot leave the page quoting old rules. Its figures are
//     built from gems and ledger rows, so it needs no screenshots.
//
//   • THE HINT — a three-line strip on the FIRST battle's screen, then never
//     again (localStorage `hexmatch:battle-hint`). It does not block the
//     board — in multiplayer the turn clock is running — and its "How battles
//     work" link opens the page above the battle.
//
// The gate is pure (`takeFirstBattleHint(storage)`), so a unit test can prove
// "shows once" without a browser.
// ══════════════════════════════════════════════════════════════════════════
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES, CARGO, VICTORY,
  type BattleRules, type Cargo,
} from "./config";
import {
  showRefCards, type RefCardHandle, type RefCardStep, type RefCardStorage,
} from "./guide/refcard";

export const BATTLE_HINT_KEY = "hexmatch:battle-hint";
export const BATTLE_HINT_SEEN = "seen";
export const BATTLE_HOWTO_ID = "iso-battle-howto";

const liveStorage = (): RefCardStorage | null =>
  typeof localStorage !== "undefined" ? localStorage : null;

/** The first-battle hint's three lines — what the first fight needs. */
export function battleHintLines(rules: BattleRules = BATTLE_RULES): string[] {
  const chain = rules.extraTurnChain ?? 0;
  return [
    "Swap two gems to match 3 or more. Every matched gem hits your rival, and its colour charges your mana.",
    `Match ${rules.extraTurnMinMatch}+ or an L / T shape for an extra turn${chain > 0 ? ` (${chain === 1 ? "one" : `up to ${chain}`} in a row)` : ""}.`,
    `Mana casts the abilities your Depots unlock. After ${rules.turnLimit} turns the higher health wins.`,
  ];
}

/**
 * THE GATE: the hint's lines on the first battle ever, `null` after — and the
 * call that returns the lines marks them seen, so a crash or a closed tab
 * mid-battle cannot show it twice. No storage (private mode) = show it.
 */
export function takeFirstBattleHint(
  storage: RefCardStorage | null = liveStorage(),
  rules: BattleRules = BATTLE_RULES,
): string[] | null {
  try {
    if (storage?.getItem(BATTLE_HINT_KEY) === BATTLE_HINT_SEEN) return null;
    storage?.setItem(BATTLE_HINT_KEY, BATTLE_HINT_SEEN);
  } catch { /* storage refused: show it, like a first run */ }
  return battleHintLines(rules);
}

const costText = (cost: Partial<Record<Cargo, number>>): string =>
  (Object.entries(cost) as [Cargo, number][]).map(([c, n]) => `${CARGO[c].icon}${n}`).join(" ");

/** What one ability does, in the page's words (effect numbers from the row). */
const abilityLine = (id: (typeof BATTLE_ABILITY_ORDER)[number]): string => {
  const d = BATTLE_ABILITIES[id];
  const free = d.costsTurn === false;
  const gate = d.requires ? `needs a ${CARGO[d.requires].name} Depot` : "open to everyone";
  return `${d.name} — ${costText(d.cost)} · ${free ? "free action" : "uses your turn"} · ${gate}`;
};

/** The five cards. `rules` defaults to the shipped table. */
export function buildBattleHowtoSteps(rules: BattleRules = BATTLE_RULES): RefCardStep[] {
  const chain = rules.extraTurnChain ?? 0;
  const second = rules.secondSeatHealth ?? 0;
  const matchDmg = rules.matchDamagePerGem ?? 0;
  const secs = Math.round(rules.turnMs / 1000);
  const holdCap = VICTORY.loop.holdCap;
  const hold = VICTORY.loop.hold;
  return [
    {
      id: "battle-turns",
      kicker: "BATTLES · 1 / 5",
      title: "One board, two players, turn by turn",
      lede: "A battle is a match-3 duel on ONE shared board. You swap, then your rival swaps — like Puzzle Quest.",
      figure: {
        kind: "chain",
        nodes: [
          { icon: "↔", label: "Swap two gems" },
          { icon: "💥", label: "Match 3+" },
          { icon: "❤", label: `−${matchDmg} health per gem` },
          { icon: "⏭", label: "Rival's turn" },
        ],
        caption: `Both sides open at ${rules.startHealth} health. First to 0 loses.`,
      },
      points: [
        `Every gem you match takes <b>${matchDmg} health</b> off your rival. A <b>bomb</b> (match 5 in a row) blasts a whole colour and hits for every gem it clears.`,
        `Cascades that fall into place after your swap count for you too. Against a human the bar under the banner is your turn clock — <b>${secs} seconds</b>.`,
        second > 0
          ? `Whoever moves <b>second</b> starts with <b>+${second} health</b> (${rules.startHealth + second}) — moving first is worth about that much.`
          : "Seat one moves first.",
      ],
      tip: "The bar under each portrait is health; the six small bars are mana, one per cargo.",
    },
    {
      id: "battle-mana",
      kicker: "BATTLES · 2 / 5",
      title: "Gems charge mana",
      lede: "Each gem colour is a cargo. Matching it banks that cargo's mana — the currency abilities are paid in.",
      figure: {
        kind: "board",
        cells: [
          [{ cargo: "grain" }, { cargo: "wood" }, { cargo: "oil" }, { cargo: "gold" }, { cargo: "stone" }],
          [{ cargo: "ore", hit: true }, { cargo: "ore", hit: true }, { cargo: "ore", hit: true }, { cargo: "wood" }, { cargo: "grain" }],
          [{ cargo: "stone" }, { cargo: "oil" }, { cargo: "gold" }, { cargo: "grain" }, { cargo: "oil" }],
        ],
        caption: `Three Ore matched: +${3 * rules.manaPerGem} Ore mana, −${3 * matchDmg} rival health.`,
      },
      points: [
        `<b>${rules.manaPerGem} mana</b> per matched gem, up to <b>${rules.manaCap}</b> of each colour.`,
        "Mana does nothing on its own — it pays for abilities (card 4). Aim for the colours your spells cost.",
      ],
      tip: `Six colours: ${(Object.keys(CARGO) as Cargo[]).map((c) => `${CARGO[c].icon} ${CARGO[c].name}`).join(" · ")}.`,
    },
    {
      id: "battle-extra",
      kicker: "BATTLES · 3 / 5",
      title: "Big matches earn an extra turn",
      lede: "Some moves keep the turn with you — the swap after is yours as well.",
      figure: {
        kind: "chain",
        nodes: [
          { icon: "4", label: `Match ${rules.extraTurnMinMatch}+` },
          ...(rules.extraTurnOnShape ? [{ icon: "⌐", label: "L / T shape" }] : []),
          ...(rules.extraTurnOnCascade > 0 ? [{ icon: "⤵", label: `${rules.extraTurnOnCascade}-step cascade` }] : []),
          { icon: "↻", label: "Extra turn" },
        ],
        caption: chain > 0
          ? `At most ${chain === 1 ? "one extra turn" : `${chain} extra turns`} in a row — then the turn passes, however big the move.`
          : "Extra turns can chain.",
      },
      points: [
        "Look for a <b>four in a row</b> or two lines crossing — they are worth more than their gems.",
        chain > 0
          ? "The chain limit means nobody can win on the opening move: your rival always gets to answer."
          : "A long chain can end a battle before the other side moves.",
      ],
      tip: "The turn banner says EXTRA TURN when it is still yours.",
    },
    {
      id: "battle-abilities",
      kicker: "BATTLES · 4 / 5",
      title: "Abilities come from your map",
      lede: "The row under the board is your spell book. A spell is only open if you own the Depot it needs on the map — battling rewards building.",
      figure: {
        kind: "ledger",
        rows: BATTLE_ABILITY_ORDER.map((id) => ({
          icon: (() => { const r = BATTLE_ABILITIES[id].requires; return r ? CARGO[r].icon : "✦"; })(),
          label: abilityLine(id),
          vp: `⟳${BATTLE_ABILITIES[id].cooldown}`,
        })),
        caption: "⟳ = turns before you can cast it again. A locked button says why (no Depot, not enough mana, cooling down).",
      },
      points: [
        `<b>Free actions</b> (${BATTLE_ABILITY_ORDER.filter((id) => BATTLE_ABILITIES[id].costsTurn === false).map((id) => BATTLE_ABILITIES[id].name).join(", ")}) leave you your swap. Girders and Frost land on the board when your turn ends, so they only get in your rival's way.`,
        `<b>${BATTLE_ABILITIES.dynamite.name}</b> hits for ${BATTLE_ABILITIES.dynamite.damage} and <b>${BATTLE_ABILITIES.repair.name}</b> heals ${BATTLE_ABILITIES.repair.heal} — each uses your turn instead of a swap.`,
      ],
      tip: "No Depots, no spells: a player with none can still win on swaps alone — it is just harder.",
    },
    {
      id: "battle-stakes",
      kicker: "BATTLES · 5 / 5",
      title: "The limit, and what is at stake",
      lede: `After <b>${rules.turnLimit} turns</b> (both players' moves count) the battle stops and the higher health wins. Equal health is a draw.`,
      figure: {
        kind: "ledger",
        rows: [
          { icon: "⚔", label: `Challenge an industry or city — costs ${rules.challengeGold} Gold`, vp: `🪙${rules.challengeGold}` },
          { icon: "1", label: "First win: you both operate the site", vp: "share" },
          { icon: "2", label: "Second win in a row: the loser's site closes", vp: "close" },
          { icon: "★", label: `Hold a contested site (you won its last battle): +${hold}★ each, at most ${holdCap}★`, vp: `≤${holdCap}★` },
        ],
        caption: "A draw leaves the map as it was. Declining a challenge is a forfeit — the challenger wins.",
      },
      points: [
        `Your ★ from battles is <b>capped at ${holdCap}★</b> of the ${VICTORY.loop.target}★ line — Depots, paved routes and city upgrades still win the game. Battling is one route, not the only one.`,
        "Lose the next battle over a site and its ★ goes to the winner.",
        "The map marks contested sites with ⚔ and shows when you can challenge again.",
      ],
      tip: "Open this page any time from ❔ Help, the ☰ menu, or the ? on the battle screen.",
    },
  ];
}

export interface ShowBattleHowtoOptions {
  rules?: BattleRules;
  onClose?: () => void;
  /** Where the overlay hangs — default `document.body` (above the battle screen). */
  mount?: HTMLElement;
}

/** Open the battle How to Play. Always opens (it is a page asked for). */
export function showBattleHowto(opts: ShowBattleHowtoOptions = {}): RefCardHandle | null {
  return showRefCards(document.body, {
    steps: buildBattleHowtoSteps(opts.rules ?? BATTLE_RULES),
    overlayId: BATTLE_HOWTO_ID,
    doneLabel: "To battle →",
    onClose: () => opts.onClose?.(),
    mount: opts.mount,
  });
}
