// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the guide's CONTENT: ten sections, each replayable on its
// own from the Tutorial menu.
//
// Every number here is READ from the table the rule lives in (`config.ts`,
// `construction.ts`, `victory.ts`), never typed: a retune moves the lesson
// with the rule. That is the one thing the old card tour got right and this
// keeps.
//
// Every caption is plain words, at most two sentences, and carries no
// identifier and no ticket number — the copy guard
// (`tests/unit/ui-copy-guard.test.ts`) fails the build otherwise.
//
// Voice: a step names a line id from `assets/voice/lines.json`. Where an
// existing narrator line already says the right thing (the coach lines VO-1
// wrote for the first game) the step points at THAT id rather than at a
// second recording of the same sentence — the coach lines are merged into
// this guide, not duplicated. Everything else is a new `guide:*` line.
// ══════════════════════════════════════════════════════════════════════════
import {
  BATTLE_RULES, ROAD_TIERS, TUNING, TRANSPORT, VICTORY,
} from "../config";
import { DEPOT_COST, costLabel } from "../construction";
import { moneyValueOf } from "../config";
import { fmtVp } from "../victory";
import type { GuideSection } from "./types";

/** The two numbers the guide cannot read for itself: the ★ line the live
 *  difficulty is racing, and the free dirt tiles the setup allowance pays. */
export interface GuideContext {
  vpTarget: number;
  freeTrack: number;
}

const star = (n: number): string => `${fmtVp(n)}★`;
const roadThroughput = TRANSPORT.road.throughput;
const highwayThroughput = ROAD_TIERS.highway.throughput;
/** Read, not typed: dirt is free under the shipped loop, and the guide says
 *  whatever the table says. */
const dirtPrice = costLabel(TRANSPORT.dirt.cost);

/** The section table. `ctx` carries the live race, so the ★ line is honest. */
export function buildGuideSections(ctx: GuideContext): GuideSection[] {
  return [
    // ── 1 ────────────────────────────────────────────────────────────────
    {
      id: "getting-started",
      title: "Getting started",
      blurb: "The map, the camera and the top bar",
      steps: [
        {
          id: "map",
          title: "The island",
          caption: "This island is yours. Every industry on it is cargo waiting for a road.",
          hint: "Drag the map with the left button to look around.",
          voice: "g-getting-started-map",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "camera",
          title: "Moving the camera",
          caption: "Roll the wheel to zoom, and the target key in the menu brings you home.",
          hint: "WASD moves the camera too, and the menu holds the same recenter key.",
          voice: "g-getting-started-camera",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "topbar",
          title: "The top bar",
          caption: `Along the top: your money and materials, the race to ${star(ctx.vpTarget)}, the menu, and the radio.`,
          hint: "The menu holds difficulty, sound, the camera keys and this tutorial.",
          voice: "g-getting-started-topbar",
          target: { kind: "ui", selector: ".topbar" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 2 ────────────────────────────────────────────────────────────────
    {
      id: "factory",
      title: "Your Factory",
      blurb: "Where every road and rail comes home",
      steps: [
        {
          id: "place",
          title: "Raise it beside a town",
          caption: "Touch the flat ground beside a town and raise your factory.",
          hint: "The shaded square is its footprint — it must touch the town and sit on flat land.",
          // VO-1's coach line already says this; it is merged, not re-recorded.
          voice: "n-factory",
          target: { kind: "anchor", what: "town" },
          complete: { kind: "build", what: "factory" },
        },
        {
          id: "rotate",
          title: "Turning it",
          caption: "R turns the building before you set it down. Right-click puts the tool away.",
          hint: "A factory has to touch the town it serves, so turn it until the ground is legal.",
          voice: "g-factory-rotate",
          target: { kind: "anchor", what: "factory" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 3 ────────────────────────────────────────────────────────────────
    {
      id: "depots",
      title: "Depots and tuning",
      blurb: "Collecting cargo, and what the match-3 session pays",
      steps: [
        {
          id: "place",
          title: "A Depot by an industry",
          caption: "Now a depot. Set it beside a farm, a forest, a mine or a quarry.",
          hint: "Its 4×4 catchment must hold the industry — hover shows the tiles it would take.",
          voice: "n-depot",
          target: { kind: "anchor", what: "industry" },
          complete: { kind: "build", what: "depot" },
        },
        {
          id: "one-each",
          title: "One Depot per industry",
          caption: "One Depot per industry, and the first to connect keeps it.",
          hint: `Your first Depot rides on the setup allowance. Every one after it costs $${moneyValueOf(DEPOT_COST)}.`,
          voice: "g-depots-one-each",
          target: { kind: "anchor", what: "depot" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "session",
          title: "The tuning session",
          caption: "Building a Depot opens a short match-3 session. Your score sets how much it yields.",
          hint: `A session is bounded — ${TUNING.moves} moves, then the board closes.`,
          voice: "n-tuning",
          target: { kind: "ui", selector: "#iso-session, #iso-tuning-retune" },
          complete: { kind: "next" },
        },
        {
          id: "score",
          title: "Matching",
          caption: "Clear what you can. A high score pays on every tick.",
          hint: `Five in a row forges a bomb — swap it to blow that whole colour. Score ×${TUNING.minYield} at zero, ×${TUNING.maxYield} at ${TUNING.targetScore} gems, and no ceiling above that.`,
          voice: "n-tuning-score",
          target: { kind: "ui", selector: "#iso-session, #iso-tuning-retune" },
          complete: { kind: "event", name: "session-finished" },
          next: true,
        },
        {
          id: "results",
          title: "The result",
          caption: "Finish keeps the score you have. The results card shows what the Depot now ticks.",
          hint: "Abandoning leaves the Depot on its default yield — a better session always pays more.",
          voice: "g-depots-results",
          target: { kind: "ui", selector: "#iso-tuning-results, #iso-plant" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 4 ────────────────────────────────────────────────────────────────
    {
      id: "logistics",
      title: "Logistics",
      blurb: "Tiers, ramps, overpasses, bridges and slopes",
      steps: [
        {
          id: "tiers",
          title: "Road tiers",
          caption: `Dirt Road is ${dirtPrice}. Street, Road and Highway haul faster and cost money.`,
          hint: `Hauling: Dirt ×${TRANSPORT.dirt.throughput}, Street ×${ROAD_TIERS.street.throughput}, Road ×${roadThroughput}, Highway ×${highwayThroughput}. The setup allowance pays for your first ${ctx.freeTrack} tiles.`,
          voice: "g-logistics-tiers",
          target: { kind: "ui", selector: '[data-tool="dirt"], [data-tool="street"], [data-tool="road"], [data-tool="highway"]' },
          complete: { kind: "tool", tool: "dirt" },
          assist: { kind: "sheet", view: "build" },
        },
        {
          id: "highway",
          title: "Highways, ramps, overpasses",
          caption: "A Highway only joins your roads through a Ramp, and a Road dragged across it becomes an overpass.",
          hint: "Traffic jumps straight over an overpass — the road underneath keeps running.",
          voice: "g-logistics-highway",
          target: { kind: "ui", selector: '[data-tool="highway"], [data-tool="ramp"]' },
          complete: { kind: "tool", tool: "ramp" },
          next: true,
          assist: { kind: "sheet", view: "build" },
        },
        {
          id: "slopes",
          title: "Bridges and slopes",
          caption: "Bridges cross the water and slopes climb the hills. Nothing builds through a steep face.",
          hint: "Watch the preview: a refused tile says why before you spend anything.",
          voice: "g-logistics-slopes",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "connect",
          title: "Join Depot to Factory",
          caption: "Drag a road from the Depot back to your factory. Nothing ticks until the two are joined.",
          hint: "One continuous run is all it takes — the longer the line, the less each tick pays.",
          voice: "n-road",
          target: { kind: "ui", selector: '[data-tool="dirt"]' },
          complete: { kind: "build", what: "road" },
          assist: { kind: "tool", tool: "dirt" },
        },
        {
          id: "income",
          title: "The first tick",
          caption: "Hear that? The first cargo has ticked into the purse.",
          hint: "Every tick is yield × distance × transport, paid for as long as the road holds.",
          voice: "n-income",
          target: { kind: "ui", selector: "#iso-res, .chipbar" },
          complete: { kind: "event", name: "first-income" },
        },
      ],
    },

    // ── 5 ────────────────────────────────────────────────────────────────
    {
      id: "rail",
      title: "Rail",
      blurb: "Track, the forty-five degree rule, platforms, trains",
      steps: [
        {
          id: "track",
          title: "Laying track",
          caption: "Rail hauls faster than a road. Lay track from an industry to your plant.",
          hint: "Track costs stone a tile, and a platform at each end is what makes it a railway.",
          voice: "n-rail",
          target: { kind: "ui", selector: '[data-tool="rail"]' },
          complete: { kind: "tool", tool: "rail" },
          assist: { kind: "sheet", view: "build" },
        },
        {
          id: "diagonal",
          title: "The forty-five degree rule",
          caption: "Keep the run gentle. A train takes a forty-five degree turn, never a sharp corner.",
          hint: "Track also refuses to run diagonally across a slope.",
          voice: "n-rail-straight",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "platform",
          title: "Platforms",
          caption: "Raise a platform at each end. That is where the train stops.",
          hint: "A platform at an industry works exactly like a Depot — it picks that cargo up.",
          voice: "n-platform",
          target: { kind: "ui", selector: '[data-tool="platform"]' },
          complete: { kind: "build", what: "platform" },
          assist: { kind: "sheet", view: "build" },
        },
        {
          id: "train",
          title: "The train",
          caption: "One train runs a network, and it hauls on its own once both platforms stand.",
          hint: "Cut the line and the train stops with it.",
          voice: "g-rail-train",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 6 ────────────────────────────────────────────────────────────────
    {
      id: "upgrades",
      title: "Upgrades",
      blurb: "Retuning, city tiers and the depot tree",
      steps: [
        {
          id: "retune",
          title: "Retune",
          caption: "The Plant card holds Retune — another session raises a Depot's yield.",
          hint: "Retune is offered on the weakest Depot first, and it is never free.",
          voice: "g-upgrades-retune",
          target: { kind: "ui", selector: "#iso-tuning-retune, #iso-plant" },
          complete: { kind: "click", selector: "#iso-tuning-retune" },
          next: true,
        },
        {
          id: "city",
          title: "Upgrade City",
          caption: "Upgrade City spends cargo to raise the town. Every Depot there ticks faster.",
          hint: `Each tier is worth ${star(VICTORY.loop.city)} on the scoreboard.`,
          voice: "n-city",
          target: { kind: "ui", selector: '[data-act="city-upgrade"]' },
          complete: { kind: "build", what: "city" },
          assist: { kind: "sheet", view: "build" },
        },
        {
          id: "rungs",
          title: "The depot tree",
          caption: "A played session opens the next rung of the depot tree, and new Depot types with it.",
          hint: "The rungs decide which cargos a Depot may collect at all.",
          voice: "g-upgrades-rungs",
          target: { kind: "ui", selector: "#iso-plant" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "depot",
          title: "Upgrading a Depot",
          caption: "Click a Depot on the map to upgrade it. Its yield cap doubles at every level.",
          hint: `A Depot at the top level is worth ${star(VICTORY.loop.maxDepot)}.`,
          voice: "g-upgrades-depot",
          target: { kind: "anchor", what: "depot" },
          complete: { kind: "event", name: "depot-upgraded" },
        },
      ],
    },

    // ── 7 ────────────────────────────────────────────────────────────────
    {
      id: "drawer",
      title: "The drawer",
      blurb: "Bank, Market, Black Market, Feed and Quests",
      steps: [
        {
          id: "open",
          title: "Five bays",
          caption: "The drawer along the bottom holds Bank, Market, Black Market, Feed and Quests.",
          hint: "On a phone the same five live under the Economy sheet.",
          voice: "g-drawer-open",
          target: { kind: "ui", selector: '[data-tab="bank"], .mnav-btn[data-view="trade"]' },
          complete: { kind: "tab", tab: "bank" },
          assist: { kind: "tab", tab: "bank" },
        },
        {
          id: "bank",
          title: "Bank",
          caption: "The Bank exchanges one cargo for another, once the depot tree has opened the rung.",
          hint: "It is a rebalancing tool, not a shop — nothing here builds anything.",
          voice: "g-drawer-bank",
          target: { kind: "ui", selector: '.bank-pane, [data-tab="bank"]' },
          complete: { kind: "tab", tab: "bank" },
          next: true,
          assist: { kind: "tab", tab: "bank" },
        },
        {
          id: "market",
          title: "Market",
          // ECON-1 (#421): the Market is the exchange - sell materials for the
          // money every build costs. Prices drift, and big sales push them down.
          caption: "The Market is where you sell materials for money. Prices move, so sell high.",
          hint: "Every build is paid in money. A big sale pushes the price down for a while, and demand events swing it.",
          voice: "g-drawer-market",
          target: { kind: "ui", selector: '.market-pane, [data-tab="market"]' },
          complete: { kind: "tab", tab: "market" },
          next: true,
          assist: { kind: "tab", tab: "market" },
        },
        {
          id: "black",
          title: "Black Market",
          caption: "Gold buys Black Market work: a blockade on an industry, or a protest on a public road.",
          hint: "Security Forces, hired with ordinary materials, turn both away.",
          voice: "g-drawer-black",
          target: { kind: "ui", selector: '.black-pane, [data-tab="black"]' },
          complete: { kind: "tab", tab: "black" },
          next: true,
          assist: { kind: "tab", tab: "black" },
        },
        {
          id: "feed",
          title: "Feed",
          caption: "The Feed logs everything that happened — yours and your rival's.",
          hint: "A line you cannot explain is usually in here.",
          voice: "g-drawer-feed",
          target: { kind: "ui", selector: '.feed-pane, [data-tab="feed"]' },
          complete: { kind: "tab", tab: "feed" },
          next: true,
          assist: { kind: "tab", tab: "feed" },
        },
        {
          id: "quests",
          title: "Quests",
          caption: "Quests are optional. Each one suggests a job and pays when it is done.",
          hint: "A badge counts the ones you have not looked at yet.",
          voice: "g-drawer-quests",
          target: { kind: "ui", selector: '.quests-pane, [data-tab="quests"]' },
          complete: { kind: "tab", tab: "quests" },
          next: true,
          assist: { kind: "tab", tab: "quests" },
        },
      ],
    },

    // ── 8 ────────────────────────────────────────────────────────────────
    {
      id: "rivals",
      title: "Rivals and battles",
      blurb: "Contested industries, challenges and holds",
      steps: [
        {
          id: "rival",
          title: "The other firm",
          caption: "Your rival runs the same loop you do. Watch its roads grow across the map.",
          hint: "The badge at the top counts both seats — you are racing a number, not a ghost.",
          voice: "g-rivals-rival",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "challenge",
          title: "Challenge",
          caption: "Click an industry with Select to Challenge it. It costs Gold and opens a battle.",
          hint: `A challenge costs ${BATTLE_RULES.challengeGold} Gold, and declining one is a forfeit.`,
          voice: "g-rivals-challenge",
          target: { kind: "anchor", what: "industry" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "battle",
          title: "The battle",
          caption: "A battle is a match-3 duel on one board. Every gem you match hits your rival.",
          hint: `Match ${BATTLE_RULES.extraTurnMinMatch} or more for an extra turn. After ${BATTLE_RULES.turnLimit} turns the higher health wins.`,
          voice: "g-rivals-battle",
          target: { kind: "screen" },
          complete: { kind: "event", name: "battle-finished" },
          next: true,
        },
        {
          id: "hold",
          title: "Holds",
          caption: "Win a contested site and you hold it. Holds pay stars, up to a cap.",
          hint: `A hold is worth ${star(VICTORY.loop.hold)}, and no more than ${star(VICTORY.loop.holdCap)} of the line ever comes from them.`,
          voice: "g-rivals-hold",
          target: { kind: "screen" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 9 ────────────────────────────────────────────────────────────────
    {
      id: "winning",
      title: "Winning",
      blurb: "The star line and where every star comes from",
      steps: [
        {
          id: "line",
          title: "The line",
          caption: `First to ${star(ctx.vpTarget)} wins. The badge at the top counts the race.`,
          hint: "The line follows the difficulty you picked — an easier rival races a shorter one.",
          voice: "g-winning-line",
          target: { kind: "ui", selector: "#iso-vp, .vp-badge" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "sources",
          title: "Where stars come from",
          caption: "Stars come from running Depots, fully paved routes, city tiers, top-level Depots and holds.",
          hint: `Each running Depot type is ${star(VICTORY.loop.type)}, a fully paved route ${star(VICTORY.loop.route)}, a city tier ${star(VICTORY.loop.city)}. Cut a road and the star it paid goes with it.`,
          voice: "g-winning-sources",
          target: { kind: "ui", selector: "#iso-vp, .vp-badge" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },

    // ── 10 ───────────────────────────────────────────────────────────────
    {
      id: "settings",
      title: "Settings and help",
      blurb: "The menu, the radio and this tutorial",
      steps: [
        {
          id: "menu",
          title: "The menu",
          caption: "The menu holds difficulty, sound, the camera keys and this tutorial.",
          hint: "Sound and voice have their own switches, and both are remembered.",
          voice: "g-settings-menu",
          target: { kind: "ui", selector: "#iso-menu-btn" },
          complete: { kind: "click", selector: "#iso-menu-btn" },
          next: true,
        },
        {
          id: "radio",
          title: "The radio",
          caption: "The radio plays while you build. Its own switch lives in the settings sheet.",
          hint: "It ducks under a spoken line by itself.",
          voice: "g-settings-radio",
          target: { kind: "ui", selector: "#iso-radio-dock" },
          complete: { kind: "next" },
          next: true,
        },
        {
          id: "tutorial",
          title: "This tutorial",
          caption: "The Tutorial menu replays any section, and marks the ones you have finished.",
          hint: "Reset tutorial clears the marks and starts the first game over.",
          voice: "g-settings-tutorial",
          target: { kind: "ui", selector: "#iso-menu-btn" },
          complete: { kind: "next" },
          next: true,
        },
      ],
    },
  ];
}

/** Every step of every section, flattened — the copy guard and the voice-id
 *  test both walk this. */
export function allGuideSteps(ctx: GuideContext): { section: GuideSection; step: GuideSection["steps"][number] }[] {
  const out: { section: GuideSection; step: GuideSection["steps"][number] }[] = [];
  for (const section of buildGuideSections(ctx)) {
    for (const step of section.steps) out.push({ section, step });
  }
  return out;
}
