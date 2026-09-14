// ══════════════════════════════════════════════════════════════════════════
// #132 — the scaffolding both multiplayer specs drive.
//
// Everything here is about ONE thing: two independent browser contexts in ONE
// live room, entered the way a player enters it (Play → Host a game → note the
// code → the other window's Play → Join with a code → Start game), with every
// wait answering a real readiness signal instead of a sleep.
//
// Two rules the rest of this file obeys, both inherited from the browser suite:
//
//   * Anything passed to `page.evaluate` is a SELF-CONTAINED function.
//     Playwright ships the source into the page, so a closure over a Node
//     variable would arrive undefined. The probes below are all top-level.
//   * A wait is a predicate on live state (`expect.poll`, `waitForFunction`),
//     never `waitForTimeout`. The room is a network round trip; the machine is
//     a shared runner; only the state can say whether it arrived.
// ══════════════════════════════════════════════════════════════════════════
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { MP_BASE, MP_ORIGIN } from "../../playwright.multiplayer.config";

/** Where both seats live: the dev server's own origin. `openSide` creates its
 *  contexts by hand (`browser.newContext`, so each one gets its own
 *  sessionStorage identity), and a hand-made context does NOT inherit the
 *  runner's `baseURL` — the URL has to be absolute here.
 *
 *  `?quality=low` is the game-only flag the browser suite also boots with: the
 *  cheap art tier, which is the difference between a ~60s boot and a ~3min one
 *  in software rasterization. The `__iso` hook is always present under
 *  `vite dev`. */
export const MP_URL = `${MP_ORIGIN}${MP_BASE}?quality=low`;

/**
 * The window both seats run in. `openSide` makes its OWN contexts (the project
 * `use.viewport` only reaches the runner's built-in fixtures), so the width
 * matters here for real: the offer tray — the market's "Take" button — is
 * `display: none` under 1320px (styles.css), and a spec that cannot see the
 * tray cannot take an offer.
 */
export const MP_VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * The room's reconnect grace (`rundot/realtime.e2e.config.json`) plus room for
 * the round trip: a departure only reaches the far seat AFTER the sidecar has
 * held the seat this long, so every assertion about one is given this budget.
 * It must be at least the sidecar's own value — a shorter wait would fail the
 * suite for being in a hurry.
 */
export const MP_GRACE_MS = 60_000;
/** Ceiling for a departure to be observed: the grace, the close handshake and
 *  the eviction broadcast. */
export const MP_DEPARTURE_MS = MP_GRACE_MS * 3;
/** Ceiling for a dropped seat to be resumed. A client saturated by software
 *  rasterization can take tens of seconds to notice its own socket died and to
 *  open a new one; the room only has to hold the seat while it does. */
export const MP_REATTACH_MS = 240_000;

/**
 * Press one control, the way a player does.
 *
 * Both the React lobby and the canvas HUD re-render on a live clock (the
 * roster, the offer countdown, every arriving delta), so an element can be
 * created, measured and replaced inside the window Playwright's actionability
 * check needs to see it "stable". When the pointer path cannot settle, this
 * falls back to dispatching the click on the SAME element — the app's own
 * handler, still exercised; only the coordinate hit-test is skipped. A control
 * that is genuinely unusable still fails this suite, because the assertions
 * that follow it do.
 */
export async function press(locator: Locator, what: string): Promise<void> {
  try {
    await locator.click({ timeout: 15_000 });
  } catch (err) {
    try {
      await locator.dispatchEvent("click", undefined, { timeout: 5_000 });
    } catch {
      throw err;
    }
    void what;
  }
}

/** One browser window: its context, its page, and what it said. */
export interface Side {
  name: string;
  ctx: BrowserContext;
  page: Page;
  /** Console lines the page printed (the SDK narrates reconnects here). */
  console: string[];
  /** Page errors — a spec asserts this stays empty. */
  errors: string[];
  /** Room-wire frame types this side saw (`room:joined`, `delta`, …). */
  wire: string[];
}

export interface Pair {
  host: Side;
  guest: Side;
  code: string;
}

/**
 * Open one window. Separate CONTEXTS (not two pages of one context) are what
 * make the two clients two people: the SDK's dev delegate keeps its fake tab
 * profile in `sessionStorage`, and every context has its own — exactly the
 * incognito-window recipe docs/multiplayer-local-testing.md §2 documents.
 */
export async function openSide(browser: Browser, name: string): Promise<Side> {
  const ctx = await browser.newContext({ viewport: { ...MP_VIEWPORT } });
  const page = await ctx.newPage();
  const side: Side = { name, ctx, page, console: [], errors: [], wire: [] };

  page.on("console", (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    side.console.push(line);
  });
  page.on("pageerror", (err) => side.errors.push(err.message));
  page.on("websocket", (ws) => {
    // The room sidecar only (§ the SDK's own socket is the SDK's business).
    if (!ws.url().includes(":9001/")) return;
    side.wire.push("ws:open");
    ws.on("framereceived", (frame) => {
      const text = String(frame.payload);
      if (!text.includes("\"type\"")) return;
      try {
        const msg = JSON.parse(text) as {
          type?: string; msgType?: string; reason?: string; roomCode?: string;
          data?: { type?: string; reason?: string };
        };
        if (msg.type === "ping" || msg.type === "pong") return;
        // The interesting frames carry their payload in one of two shapes: a
        // direct message (`room:joined` with the code the room minted, a
        // top-level `reason`), or a wrapped one (`room:broadcast` /
        // `room:sendTo` with `msgType` and the game message under `data`). The
        // room's host-left refusal travels wrapped, so the reason has to be
        // read from BOTH places or a spec would see only the envelope.
        const type = msg.msgType ? `${msg.type}:${msg.msgType}` : String(msg.type);
        const detail = msg.reason ?? msg.data?.reason ?? msg.roomCode;
        side.wire.push(detail ? `${type}:${detail}` : type);
      } catch { /* a frame that is not JSON is the SDK's business */ }
    });
    ws.on("close", () => side.wire.push("ws:close"));
  });

  // The same onboarding gates the browser suite sets: these specs play a match,
  // they do not exercise the tour or the difficulty picker.
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  // The transport seam: record every WebSocket the page opens, so a spec can
  // drop the room link exactly as a network failure does. Installed before any
  // app code, and invisible to it — the constructor is the same object.
  await page.addInitScript(recordSockets);
  // Every toast the game raises, kept for the whole run. A line that matters —
  // the room's rejection, an opponent's departure — arrives on its own clock
  // and auto-dismisses; a spec must not race that timer to see it.
  await page.addInitScript(recordToasts);

  await page.goto(MP_URL);
  await page.locator(".menu-btn.primary").waitFor();
  return side;
}

/** The front door: Play (the main menu) → the mode screen. */
export async function toStartScreen(side: Side): Promise<void> {
  await press(side.page.locator(".menu-btn.primary"), "the main menu's Play");
  await side.page.getByRole("button", { name: /Play vs AI/ }).waitFor();
}

/** Host a room and wait for the code the room actually minted — the lobby
 *  renders a placeholder ("——") until the welcome lands, and a spec that read
 *  it too early would type a code no room has. */
export async function hostRoom(host: Side): Promise<string> {
  await press(host.page.getByRole("button", { name: /Host a game/ }), "Host a game");
  await expect.poll(async () => (await host.page.locator(".room-code b").textContent()) ?? "", {
    message: "the host's room code (the welcome must land before it is real)",
  }).not.toBe("——");
  return ((await host.page.locator(".room-code b").textContent()) ?? "").trim();
}

/** Join by code, typed the way a player types it. */
export async function joinRoom(guest: Side, code: string): Promise<void> {
  await press(guest.page.getByRole("button", { name: /Join with a code/ }), "Join with a code");
  await guest.page.locator(".code-input").fill(code);
  await press(guest.page.getByRole("button", { name: /^Join game$/ }), "Join game");
}

/** Both lobbies show both seats — the room's roster, not a guess. */
export async function expectSeated(pair: Pair): Promise<void> {
  for (const side of [pair.host, pair.guest]) {
    await expect.poll(async () => side.page.locator(".seat-list .seat.filled").count(), {
      message: `${side.name} sees two seated players`,
    }).toBe(2);
  }
}

/** The two buttons that actually start the match, on their two screens. */
export async function startMatch(pair: Pair): Promise<void> {
  await press(pair.host.page.getByRole("button", { name: /Start game/ }), "Start game");
  await press(pair.guest.page.getByRole("button", { name: /^Play$/ }), "Play");
}

/** The game is up and past the loading screen on this side. */
export async function expectBooted(side: Side, budgetMs = mpBudget(180_000)): Promise<void> {
  await side.page.waitForFunction(
    () => {
      const h = (window as unknown as { __iso?: { loading?: boolean; phase?: string; grid?: unknown } }).__iso;
      return !!h && !!h.grid && h.loading === false && h.phase === "setup-factory";
    },
    null,
    { timeout: budgetMs },
  );
}

/** Booting/rasterizing a shared runner is slow: `PW_MP_BOOT_BUDGET` raises the
 *  default (the browser suite's `PW_BOOT_BUDGET` trick, scoped to this suite). */
function mpBudget(fallback: number): number {
  const env = Number(process.env.PW_MP_BOOT_BUDGET ?? 0);
  return env > 0 ? env : fallback;
}

/** One seat's plant is open: enough of the match for the board/market specs. */
export async function expectInPlay(side: Side, budgetMs = mpBudget(90_000)): Promise<void> {
  await side.page.waitForFunction(() => (window as unknown as { __iso?: { phase?: string } }).__iso?.phase === "play",
    null, { timeout: budgetMs });
}

/** The name this window's SDK profile goes by (`Dev Player XXXX`). Separate
 *  contexts mint separate profiles — which is what makes them two people. */
export async function ownUsername(side: Side): Promise<string> {
  return await side.page.evaluate(() => {
    const raw = sessionStorage.getItem("__rundot_fake_tab_profile__");
    return raw ? (JSON.parse(raw) as { username?: string }).username ?? "" : "";
  });
}

/** The lobby's seats, in the order the roster painted them. */
export async function lobbySeats(side: Side): Promise<{ name: string; status: string }[]> {
  return await side.page.evaluate(() => Array.from(document.querySelectorAll(".seat-list .seat.filled"))
    .map((el) => ({
      name: (el.querySelector(".seat-name")?.textContent ?? "").trim(),
      status: (el.querySelector(".seat-status")?.textContent ?? "").trim(),
    })));
}

/** Both players are in the match: factory + depot down, both seats in `play`. */
export async function playSetup(pair: Pair): Promise<void> {
  await setupSeat(pair.host, "host");
  // The guest's own opening is planned against the mirrored world, so it waits
  // for the host's two structures to arrive before it searches for its own.
  await expectMirrored(pair.guest, "the host's opening");
  await setupSeat(pair.guest, "guest");
  await expectMirrored(pair.host, "the guest's opening");
  for (const side of [pair.host, pair.guest]) await side.page.evaluate(finishSetup);
  await Promise.all([expectInPlay(pair.host), expectInPlay(pair.guest)]);
}

/** One seat's whole opening: a Factory beside a town, then a Depot beside an
 *  industry. The tiles come from the seat's own `placementPlan`, so nothing
 *  hard-codes a coordinate a re-rolled map would move — and the two seats
 *  search from opposite corners, so their openings cannot collide.
 *
 *  The two seats do NOT commit the same way, and the spec has to respect that:
 *  the host's `placeFactory` runs the rule locally and answers `true` when the
 *  building stands; the guest's sends an intent and answers `true` when the
 *  ROOM took it. For the guest, "committed" is therefore the mirror on the
 *  other side, never the return value — which is exactly what
 *  `expectMirrored`/`expectInPlay` wait on. */
async function setupSeat(side: Side, label: "host" | "guest"): Promise<void> {
  const reverse = label === "guest";
  const factorySearch: FindSpotOptions = { kind: "factory", reverse };
  const factory = await side.page.evaluate(findSpot, factorySearch);
  if (!factory) throw new Error(`${label}: no legal Factory site — ${await side.page.evaluate(spotReport, factorySearch)}`);
  const factoryOk = await side.page.evaluate(placeFactory, { tx: factory[0], ty: factory[1] });
  expect(factoryOk, `${label}: the Factory was committed`).toBe(true);
  const depotSearch: FindSpotOptions = { kind: "depot", reverse, near: [factory[0], factory[1]] };
  const depot = await side.page.evaluate(findSpot, depotSearch);
  if (!depot) throw new Error(`${label}: no legal Depot site — ${await side.page.evaluate(spotReport, depotSearch)}`);
  const depotOk = await side.page.evaluate(placeDepot, { tx: depot![0], ty: depot![1] });
  expect(depotOk, `${label}: the Depot was committed`).toBe(true);
}

/** The other seat's opening has landed: a Factory and a Depot owned by the
 *  rival seat are in this side's world. The rival is `ai` in every local frame
 *  (`players[0]` is always the local seat), so this is the same predicate on
 *  both sides. */
async function expectMirrored(side: Side, what: string): Promise<void> {
  await expect.poll(async () => {
    const state = await readState(side);
    return state.factories.some((f) => f[0] === "ai") && state.harvesters.some((h) => h[0] === "ai");
  }, { message: `${side.name} mirrors ${what}`, timeout: 60_000 }).toBe(true);
}

/** One seat's live state, read in the page. */
export async function readState(side: Side): Promise<MpState> {
  return await side.page.evaluate(mpState);
}

/** One seat's world digest, read in the page. */
export async function readWorld(side: Side): Promise<MpWorld> {
  return await side.page.evaluate(mpWorld);
}

/** Did this side's room link carry a frame mentioning `needle`? */
export const wireHas = (side: Side, needle: string): boolean => side.wire.some((line) => line.includes(needle));

/**
 * The front door of a match, walked by two people: two contexts (two
 * identities), Host, read the code, Join by typing it, both seats seated.
 * Nothing here is mocked — this is the room the sidecar minted.
 */
export async function pairUp(browser: Browser): Promise<Pair> {
  const host = await openSide(browser, "host");
  const guest = await openSide(browser, "guest");
  await toStartScreen(host);
  await toStartScreen(guest);
  const code = await hostRoom(host);
  await joinRoom(guest, code);
  const pair: Pair = { host, guest, code };
  await expectSeated(pair);
  return pair;
}

/**
 * Leave Room, the shipped way out: the ☰ menu, its destructive item, and the
 * confirm plate. Both multiplayer specs that end a match use this, so the spec
 * and the game cannot drift apart on the flow.
 */
export async function leaveRoom(side: Side): Promise<void> {
  await press(side.page.locator("#iso-menu-btn"), "the in-game menu");
  await press(side.page.locator("#iso-topmenu .tm-item", { hasText: /Leave Room/i }), "Leave Room");
  await press(side.page.locator(".confirm-sheet [data-confirm-ok]"), "the leave confirmation");
}

/** Attach both sides' console + room-wire logs when a test fails. */
export async function attachLogs(testInfo: TestInfo, ...sides: Side[]): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const side of sides) {
    await testInfo.attach(`${side.name}-console.txt`, {
      body: `${side.errors.length ? `PAGE ERRORS:\n${side.errors.join("\n")}\n\n` : ""}${side.console.join("\n")}`,
      contentType: "text/plain",
    });
    await testInfo.attach(`${side.name}-room-wire.txt`, {
      body: side.wire.join("\n"),
      contentType: "text/plain",
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// In-page probes. Self-contained by construction (Playwright ships the source).
// ══════════════════════════════════════════════════════════════════════════

/** The seam a spec drops the link through: record every socket the page opens. */
export function recordSockets(): void {
  const w = window as unknown as { __mpSockets?: WebSocket[]; WebSocket: typeof WebSocket };
  if (w.__mpSockets) return;
  w.__mpSockets = [];
  const Original = w.WebSocket;
  const Recorded = class extends Original {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      w.__mpSockets!.push(this as unknown as WebSocket);
    }
  };
  w.WebSocket = Recorded as unknown as typeof WebSocket;
}

/**
 * The game's live state, narrowed to what the room specs assert on: the map
 * both seats must agree on, the two board bodies, the purses, the market, and
 * the two HUD name tags.
 */
export interface MpState {
  phase: string;
  seed: number;
  map: { w: number; h: number; industries: [number, number, string][]; towns: [number, number, string][] };
  factories: [string, number, number][];
  harvesters: [string, number, number][];
  purse: Record<string, number>;
  /** The OTHER seat's purse, as this side's world holds it (the market's own
   *  bag for that seat — the host's authority, mirrored to the guest). */
  rivalPurse: Record<string, number>;
  offers: [number, string, number, string, number][];
  names: string[];
  toasts: string[];
  modal: string;
  boardSig: string;
  rivalBoardSig: string;
}

export function mpState(): MpState {
  const h = (window as unknown as { __iso: any }).__iso;
  const signature = (board: any): string =>
    JSON.stringify(board.grid.map((row: any[]) => row.map((g: any) =>
      g ? [g.id, g.res, g.tier, g.hard, g.block ? 1 : 0, g.forged ? 1 : 0] : 0)));
  const modalRoot = document.querySelector(".modal-root") as HTMLElement | null;
  return {
    phase: h.phase,
    seed: h.grid.seed,
    map: {
      w: h.grid.w,
      h: h.grid.h,
      industries: h.grid.industries.map((i: any) => [i.tx, i.ty, i.type]),
      towns: h.grid.towns.map((t: any) => [t.tx, t.ty, t.name ?? ""]),
    },
    factories: h.factories.map((f: any) => [f.owner, f.tx, f.ty]),
    harvesters: h.harvesters.map((x: any) => [x.owner, x.tx, x.ty]),
    purse: { ...h.purse },
    rivalPurse: { ...h.market.players[1].res },
    offers: h.market.ctx.offers.map((o: any) => [o.from, o.give, o.giveN, o.want, o.wantN]),
    names: Array.from(document.querySelectorAll(".king-name")).map((el) => (el.textContent ?? "").trim()),
    toasts: Array.from(document.querySelectorAll(".toast-msg")).map((el) => (el.textContent ?? "").trim()),
    modal: modalRoot && !modalRoot.classList.contains("hidden") ? (modalRoot.textContent ?? "").trim() : "",
    boardSig: signature(h.board),
    rivalBoardSig: signature(h.rivalPlant.board),
  };
}

/**
 * A digest of the WORLD both seats share — the track layers, byte for byte,
 * plus their own seat's owner byte remapped onto the host's frame (`owner` and
 * `ownerMirrored` are the same array read from the two sides). Two clients
 * "showing the same map" means these numbers are equal; a count of tiles is
 * also carried so a failure prints something a reader can picture.
 */
export interface MpWorld {
  dirt: string;
  road: string;
  upgraded: string;
  owner: string;
  ownerMirrored: string;
  counts: { dirt: number; road: number; upgraded: number; you: number; ai: number };
}

export function mpWorld(): MpWorld {
  const h = (window as unknown as { __iso: any }).__iso;
  const hash = (layer: ArrayLike<number>): string => {
    let acc = 2166136261 >>> 0;
    for (let i = 0; i < layer.length; i++) {
      acc ^= layer[i]!;
      acc = Math.imul(acc, 16777619) >>> 0;
    }
    return acc.toString(16).padStart(8, "0");
  };
  const dirt = h.track.dirt as Uint8Array;
  const road = h.track.road as Uint8Array;
  const upgraded = h.track.upgraded as Uint8Array;
  const owner = h.track.owner as Uint8Array;
  const flipped = owner.map((b: number) => (b === 1 ? 2 : b === 2 ? 1 : b));
  let countDirt = 0, countRoad = 0, countUpgraded = 0, countYou = 0, countAi = 0;
  for (let i = 0; i < owner.length; i++) {
    if (dirt[i]) countDirt++;
    if (road[i]) countRoad++;
    if (upgraded[i]) countUpgraded++;
    if (owner[i] === 1) countYou++;
    if (owner[i] === 2) countAi++;
  }
  return {
    dirt: hash(dirt), road: hash(road), upgraded: hash(upgraded),
    owner: hash(owner), ownerMirrored: hash(flipped),
    counts: { dirt: countDirt, road: countRoad, upgraded: countUpgraded, you: countYou, ai: countAi },
  };
}

/** The first tile a legal Factory or Depot would stand on, from the seat's own
 *  plan (and clear of every structure already mirrored in) — the same search
 *  `tests/unit/iso-mp.test.ts` uses, so a spec never hard-codes a coordinate
 *  that a map re-roll would move. */
export interface FindSpotOptions {
  kind: "factory" | "depot" | "plant";
  reverse?: boolean;
  avoid?: number;
  /** Depot searches start here and work outward; omitted = whole map. */
  near?: [number, number];
}

export function findSpot(opts: FindSpotOptions): [number, number] | null {
  const h = (window as unknown as { __iso: any }).__iso;
  const W: number = h.grid.w;
  const H: number = h.grid.h;
  const avoid = opts.avoid ?? 6;
  const busy: [number, number][] = [
    ...h.factories.map((f: any) => [f.tx, f.ty] as [number, number]),
    ...h.harvesters.map((x: any) => [x.tx, x.ty] as [number, number]),
  ];
  const clear = (x: number, y: number) => busy.every(([bx, by]) => Math.abs(bx - x) > avoid || Math.abs(by - y) > avoid);
  const legal = (x: number, y: number) => {
    if (!clear(x, y)) return false;
    try { return !!h.placementPlan(opts.kind, x, y).valid; } catch { return false; }
  };
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = 4; x < W - 4; x++) xs.push(opts.reverse ? W - 5 - (x - 4) : x);
  for (let y = 4; y < H - 4; y++) ys.push(opts.reverse ? H - 5 - (y - 4) : y);
  if (opts.near) {
    const [cx, cy] = opts.near;
    for (let r = 1; r <= 24; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          if (legal(x, y)) return [x, y];
        }
      }
    }
    // Nothing legal next to the Factory: fall through to the whole-map sweep
    // below instead of failing. A Depot needs an INDUSTRY in its 4×4 catchment
    // and an unclaimed one at that (PP-16), so on a 144×144 map a seat that
    // opened in an industry-poor corner can genuinely have no site within 24
    // tiles while legal ones exist elsewhere. The distance is a taste
    // preference, not a rule — the game's own plan is the authority on what is
    // legal, and that is what `legal()` asks.
  }
  for (const y of ys) for (const x of xs) if (legal(x, y)) return [x, y];
  return null;
}

/** Why a search came up empty: how many sites the game's own plan accepts
 *  anywhere on the map, where the first one is, and a tally of its refusal
 *  codes. Printed in the setup assertions' messages, so a seed that strands a
 *  seat's opening explains itself instead of just saying `null`. */
export function spotReport(opts: FindSpotOptions): string {
  const h = (window as unknown as { __iso: any }).__iso;
  const codes: Record<string, number> = {};
  let legalSites = 0;
  let first: [number, number] | null = null;
  for (let y = 1; y < h.grid.h - 1; y++) {
    for (let x = 1; x < h.grid.w - 1; x++) {
      let plan: { valid?: boolean; code?: string | null; why?: string | null };
      try { plan = h.placementPlan(opts.kind, x, y); } catch { continue; }
      if (plan.valid) {
        legalSites++;
        if (!first) first = [x, y];
      } else {
        const code = plan.code ?? plan.why ?? "unknown";
        codes[code] = (codes[code] ?? 0) + 1;
      }
    }
  }
  const where = opts.near ? `[${opts.near[0]},${opts.near[1]}]` : "whole map";
  return `${opts.kind} near ${where}: ${legalSites} legal site(s)` +
    `${first ? `, first [${first[0]},${first[1]}]` : ""} · refusals ${JSON.stringify(codes)}`;
}

/** The seat's own opening: a Factory on the first legal site (`placeFactory`
 *  is the twin of the map click, and on a guest it is the typed intent). */
export function placeFactory(at: { tx: number; ty: number }): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  return h.placeFactory(at.tx, at.ty) as boolean;
}

/** The seat's second opening step — the Depot (free in setup). */
export function placeDepot(at: { tx: number; ty: number }): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  return h.placeDepot(at.tx, at.ty) as boolean;
}

/** The twin of the setup click that flips a seat into `play`. */
export function finishSetup(): void {
  (window as unknown as { __iso: any }).__iso.finishSetup();
}

/** The twin of a road drag, with the preview's own verdict returned. */
export function dragBuild(drag: { kind: "dirt" | "road"; ax: number; ay: number; bx: number; by: number }): { tiles: { tx: number; ty: number }[] } | null {
  const h = (window as unknown as { __iso: any }).__iso;
  return h.dragBuild(drag.kind, drag.ax, drag.ay, drag.bx, drag.by, true);
}

/** Is this drag legal for this seat right now? (The preview, not the commit.) */
export function dragPreview(drag: { kind: "dirt" | "road"; ax: number; ay: number; bx: number; by: number }): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  return !!h.dragPreview(drag.kind, drag.ax, drag.ay, drag.bx, drag.by, true);
}

/** The seat's own purse — the live object the market escrows against. */
export function setPurse(edit: { cargo: string; amount: number }): void {
  const h = (window as unknown as { __iso: any }).__iso;
  h.purse[edit.cargo] = edit.amount;
}

/** The OTHER seat's authoritative resources, from this (host) side. */
export function setRivalRes(edit: { cargo: string; amount: number }): void {
  const h = (window as unknown as { __iso: any }).__iso;
  h.market.players[1].res[edit.cargo] = edit.amount;
}

/** Host: post an offer from the local seat (the same call the composer runs). */
export interface OfferArgs { give: string; giveN: number; want: string; wantN: number }

export function postOffer(offer: OfferArgs): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  return h.market.post(h.market.players[0], offer.give, offer.giveN, offer.want, offer.wantN) as boolean;
}

/** Guest: accept the rival's newest open offer — exactly what the tray's
 *  "Take" button runs (the button itself is re-rendered every frame, so a
 *  spec that clicked the DOM node would race the renderer; this calls the same
 *  handler with the same arguments). */
export function acceptNewestOffer(): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  const offers = h.market.ctx.offers.filter((o: any) => o.from !== h.market.players[0].i);
  if (!offers.length) return false;
  return h.market.accept(h.market.players[0], offers[offers.length - 1].id) as boolean;
}

/** The twin of the ♻ Reset button (its click path, on every seat). */
export function resetPlant(): void {
  (window as unknown as { __iso: any }).__iso.resetPlant();
}

/** A construction site as the plan twin takes it (an object, so the probe can
 *  be handed to `page.evaluate` — see `FindSpotOptions`). */
export interface PlanSite { kind: "factory" | "depot"; tx: number; ty: number }

/** Is this tile a legal construction site for THIS seat, by the game's own
 *  plan (the same verdict the click handler uses and the overlay paints)? */
export function planValid(site: PlanSite): boolean {
  const h = (window as unknown as { __iso: any }).__iso;
  try { return !!h.placementPlan(site.kind, site.tx, site.ty).valid; } catch { return false; }
}

/** One tile's occupants, as this seat's world sees them (mirrored owners). */
export function tileOccupants(site: { tx: number; ty: number }): { depots: string[]; factories: string[] } {
  const h = (window as unknown as { __iso: any }).__iso;
  return {
    depots: h.harvesters.filter((x: any) => x.tx === site.tx && x.ty === site.ty).map((x: any) => x.owner),
    factories: h.factories.filter((f: any) => f.tx === site.tx && f.ty === site.ty).map((f: any) => f.owner),
  };
}

/** The rival's offer tray — the market's "Take" button, as a player sees it. */
export interface TrayState { visible: boolean; offers: number; takeEnabled: boolean; text: string }

export function trayState(): TrayState {
  const el = document.querySelector(".offer-tray") as HTMLElement | null;
  const btn = document.querySelector(".offer-tray .tray-offer button.mini") as HTMLButtonElement | null;
  return {
    visible: !!el && getComputedStyle(el).display !== "none" && !el.classList.contains("hidden"),
    offers: document.querySelectorAll(".offer-tray .tray-offer").length,
    takeEnabled: !!btn && !btn.disabled,
    text: (el?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
}


// ══════════════════════════════════════════════════════════════════════════
// Page-level helpers: the ones that click real DOM or wait on live state.
// ══════════════════════════════════════════════════════════════════════════


/** Wait until this seat's purse shows `amount` of `cargo`. */
export async function expectPurse(side: Side, cargo: string, amount: number): Promise<void> {
  await expect.poll(async () => (await readState(side)).purse[cargo] ?? 0, {
    message: `${side.name}'s ${cargo}`,
  }).toBe(amount);
}

/** The market's Take button, pressed. The tray re-renders with the offer's
 *  countdown (and on every delta), so the button node is replaced under a
 *  pointer-driven click: Playwright's actionability check would re-resolve the
 *  node forever and the click would never fire. Pressing the live button in the
 *  page runs the SAME handler the button runs — the tray's own click — without
 *  racing the renderer for the node. */
export async function takeNewestOffer(side: Side): Promise<void> {
  const pressed = await side.page.evaluate(() => {
    const button = document.querySelector(".offer-tray .tray-offer button.mini") as HTMLButtonElement | null;
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  expect(pressed, `${side.name}: the tray's Take button was pressed`).toBe(true);
}

/** The ♻ Reset button, clicked the way a player clicks it. */
export async function clickReset(side: Side): Promise<void> {
  await press(side.page.locator(".reset-btn"), "the ♻ Reset button");
}

/** The tray as a player sees it, read from the DOM. */
export async function tray(side: Side): Promise<TrayState> {
  return await side.page.evaluate(trayState);
}

/** A tile a Depot may stand on for BOTH seats — the setup for the
 *  simultaneous-construction race. Searched on the guest's own plan (which
 *  reads the mirrored world) and then confirmed on the host's, so the contest
 *  is a real one and not an assumption about the mirror. */
export async function contestedDepotSite(pair: Pair): Promise<{ tx: number; ty: number } | null> {
  const spot = await pair.guest.page.evaluate(findSpot, { kind: "depot", reverse: true, avoid: 4 } as FindSpotOptions);
  if (!spot) return null;
  const [tx, ty] = spot;
  const site: PlanSite = { kind: "depot", tx, ty };
  const hostOk = await pair.host.page.evaluate(planValid, site);
  return hostOk ? { tx, ty } : null;
}

/** Both purses deep enough to pay a Depot (wood/stone/grain/oil) — the host's
 *  own, and the host's authoritative copy of the guest's (the one an intent is
 *  validated against). */
export async function fundDepots(side: Side, amount = 20): Promise<void> {
  await side.page.evaluate(setPurse, { cargo: "wood", amount });
  await side.page.evaluate(setPurse, { cargo: "stone", amount });
  await side.page.evaluate(setPurse, { cargo: "grain", amount });
  await side.page.evaluate(setPurse, { cargo: "oil", amount });
  await side.page.evaluate(setRivalRes, { cargo: "wood", amount });
  await side.page.evaluate(setRivalRes, { cargo: "stone", amount });
  await side.page.evaluate(setRivalRes, { cargo: "grain", amount });
  await side.page.evaluate(setRivalRes, { cargo: "oil", amount });
}

/** Wait until this seat has been told `pattern` in a toast. The log survives
 *  the toast's own dismissal timer, so this cannot miss a line that arrived
 *  while the previous step was running. */
export async function expectToast(side: Side, pattern: RegExp | string): Promise<void> {
  await expect.poll(async () => (await side.page.evaluate(seenToasts)).join("\n"), {
    message: `${side.name} is told ${pattern}`,
  }).toMatch(pattern);
}

/** The ended-match state both leave directions must produce: the game's own
 *  modal, carrying the line the other seat's departure earned. */
export async function expectEndedMatch(side: Side, pattern: RegExp | string): Promise<string> {
  await expect.poll(async () => (await readState(side)).modal, {
    message: `${side.name} is told the match is over`,
    timeout: MP_DEPARTURE_MS,
  }).toMatch(pattern);
  return (await readState(side)).modal;
}

/** No ended-match state: no modal, no opponent-left line anywhere. */
export async function expectNoEndedMatch(side: Side): Promise<void> {
  const state = await readState(side);
  expect(state.modal, `${side.name} has no ended-match modal`).toBe("");
  for (const line of state.toasts) {
    expect(line, `${side.name} heard no departure`).not.toMatch(/left the room|host left the game/i);
  }
}

/** Keep every toast the game raises, in the order it raised them. */
export function recordToasts(): void {
  const w = window as unknown as { __mpToasts?: string[] };
  if (w.__mpToasts) return;
  w.__mpToasts = [];
  const capture = (el: Element) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && !w.__mpToasts!.includes(text)) w.__mpToasts!.push(text);
  };
  const start = () => {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (node.classList.contains("toast")) capture(node);
          else for (const el of Array.from(node.querySelectorAll(".toast"))) capture(el);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

/** Every toast this seat has seen so far, oldest first. */
export function seenToasts(): string[] {
  return [...((window as unknown as { __mpToasts?: string[] }).__mpToasts ?? [])];
}

/** Drop this page's room link the way a network failure does. */
export function dropRoomSocket(): boolean {
  const w = window as unknown as { __mpSockets?: WebSocket[] };
  const live = (w.__mpSockets ?? []).filter((s) => s.readyState === 1);
  if (!live.length) return false;
  live[live.length - 1]!.close();
  return true;
}
