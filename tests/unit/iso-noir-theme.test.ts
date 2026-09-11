// ══════════════════════════════════════════════════════════════════════════
// NOIR — the "Foundry Syndicate" restyle, pinned from the stylesheet out.
//
// A restyle is exactly the kind of change that can be beautiful and broken at
// once: a nested comment marker kills the whole sheet in Tailwind's parser, a
// renamed asset silently leaves a panel unpainted, a "harmless" border-width on
// a panel pushes the quarry board out of the column `ui.ts` sized for it. The
// tests here are the three contracts the theme must not break:
//
//   1. the sheet parses (balanced comments, every url() resolves, every font it
//      names is actually vendored);
//   2. the layout constants the corridor picker replays are still the ones the
//      CSS declares — the theme paints INSIDE the boxes, never moves them;
//   3. the painted art is wired end to end: one sigil per action the HUD can
//      build, one token per cargo the board can pay, both on disk and both with
//      the alpha the CSS expects.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const CSS_PATH = "src/game/styles.css";
const css = readFileSync(CSS_PATH, "utf8");
const ui = readFileSync("src/game/ui.ts", "utf8");
const gameConfig = readFileSync("src/game/config.ts", "utf8");

/**
 * Every `{ … }` body written for `selector` as its own whole compound (see the
 * same token match in iso-fx-styles.test.ts — a mention inside a comment or
 * inside a longer selector must not pass). All bodies, not the first: the sheet
 * states a value once and refines it in a media query, and a grouped rule like
 * `.build-btn, .tab { … }` is not the one that sizes the button.
 */
function bodiesFor(selector: string): string[] {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[},\\s])${esc}(?=[\\s,{])`, "gm");
  const out: string[] = [];
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const open = css.indexOf("{", m.index);
    const close = open < 0 ? -1 : css.indexOf("}", open);
    if (close > open) out.push(css.slice(open + 1, close));
  }
  return out;
}
/** The one body (of those for `selector`) that declares `re`. */
const ruleFor = (selector: string, re?: RegExp): string | null =>
  (re ? bodiesFor(selector).find((b) => re.test(b)) : bodiesFor(selector)[0]) ?? null;

describe("NOIR the sheet is valid CSS, not just valid prose", () => {
  it("has no nested comment markers", () => {
    // CSS comments do not nest: one `/*` inside a block comment (the old header
    // wrote the path `assets/ui-src/noir/*.png`, which contains one) closes the
    // block early and @tailwindcss/vite then fails the whole file with
    // "Missing opening (" — the sheet must be balanced, not merely readable.
    const opens = css.match(/\/\*/g)?.length ?? 0;
    const closes = css.match(/\*\//g)?.length ?? 0;
    expect(opens, "unbalanced /* … */ pairs").toBe(closes);
    // …and every comment must be closed in order, not just in count.
    let at = 0;
    while (true) {
      const o = css.indexOf("/*", at);
      if (o < 0) break;
      const c = css.indexOf("*/", o + 2);
      expect(c, `comment opened at offset ${o} is never closed`).toBeGreaterThan(-1);
      expect(css.slice(o + 2, c), `comment at offset ${o} nests another /*`).not.toContain("/*");
      at = c + 2;
    }
  });

  it("resolves every url() it paints with", () => {
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]).filter((u) => !u.startsWith("data:"));
    expect(urls.length, "the theme references no art at all").toBeGreaterThan(20);
    for (const u of urls) {
      expect(
        existsSync(resolve(dirname(CSS_PATH), u)),
        `${u} is styled but was never shipped — drop a PNG/webp of that name in, or remove the rule`,
      ).toBe(true);
    }
  });

  it("vendors the fonts its four stacks name first", () => {
    const faces = new Set<string>();
    for (const m of css.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)) faces.add(m[1]);
    const declared = new Set<string>();
    for (const v of ["--display", "--serif", "--sans", "--mono"]) {
      const first = new RegExp(`\\${v}:\\s*"([^"]+)"`).exec(css);
      expect(first, `${v} must name a real family`).toBeTruthy();
      declared.add(first![1]);
      expect(faces, `${first![1]} is used but never declared by an @font-face`).toContain(first![1]);
    }
    // …and the file each @font-face points at exists (a pruned woff2 is silent)
    for (const m of css.matchAll(/@font-face\s*\{[^}]*src:\s*url\("([^"]+)"\)/g)) {
      expect(existsSync(resolve(dirname(CSS_PATH), m[1])), m[1]).toBe(true);
    }
    expect([...declared]).toEqual(["Cinzel", "Barlow Condensed", "Barlow Semi Condensed", "Special Elite"]);
  });
});

describe("NOIR the theme paints inside the boxes; it never moves them", () => {
  // tests/unit/iso-corridor-picker.test.ts replays the fixed HUD from these
  // same numbers. If a restyle changes one of them, that test's model and the
  // real hit-testing disagree — so they are pinned here, at the source.
  const boxes: [string, RegExp][] = [
    [".topbar", /height:\s*60px/],
    [".aside", /top:\s*68px/],
    [".aside", /bottom:\s*52px/],
    [".aside.left", /width:\s*300px/],
    [".board-wrap", /padding:\s*5px/],
    [".build-btn", /min-height:\s*68px/],
    [".offer-tray", /width:\s*252px/],
    [".banner", /top:\s*104px/],
    [".iso-inspect", /top:\s*70px/],
  ];
  it.each(boxes)("%s still declares %s", (sel, re) => {
    expect(bodiesFor(sel).length, `${sel} has no rule`).toBeGreaterThan(0);
    expect(bodiesFor(sel).some((b) => re.test(b)), `${sel} moved`).toBe(true);
  });

  it("keeps the quarry panel's own box at zero border and zero margin", () => {
    // ui.ts sizes --board-px from the board alone; #iso-quarry is the one panel
    // that must not add a frame, or the last columns clip.
    expect(css).toMatch(/#iso-trade > #iso-quarry\s*\{\s*border:\s*0;\s*margin:\s*0;\s*\}/);
  });

  it("never overrides a gem's inline translate with a transform", () => {
    // ui.ts positions every token with `style.transform = translate(…)`. A
    // theme rule that sets `transform` on .gem/.sel would yank a selected token
    // to the board origin — the lift has to be drawn on the face instead.
    for (const sel of [".gem.selected", ".gem.sel", ".gem:hover"]) {
      for (const body of bodiesFor(sel)) {
        expect(body, `${sel} must not set transform`).not.toMatch(/(?:^|[;{\s])transform:/);
      }
    }
  });

  it("draws the selected token with an outline, not a bitmap frame", () => {
    expect(ruleFor(".gem.sel .face", /outline:\s*2px solid/), ".gem.sel .face outline").toBeTruthy();
    // …and the painted tokens are not upscaled nearest-neighbour any more
    expect(ruleFor(".gem .face.sprite", /image-rendering:\s*auto/), "sprite rendering").toBeTruthy();
  });
});

describe("NOIR the surfaces neither seam nor stretch", () => {
  // The two ways painted chrome goes wrong: a bitmap tiled across a box shows
  // the line where it wraps, and a bitmap scaled to a box that does not share
  // its aspect turns rivets into ovals. Both are structural, so both are
  // measurable — from the sheet for the stretch, from the pixels for the seam.

  it("never sizes a bitmap to two different axes", () => {
    // `100% 100%` is the classic offender, but so is `300px 100%`; a gradient
    // may do what it likes (it has no pixels to distort), so only declarations
    // are read, and each is legal if both components agree or one is `auto`.
    const sizes = [...css.matchAll(/background-size:([^;]+);/g)].map((m) => m[1].trim());
    expect(sizes.length, "the sheet should size its layers explicitly").toBeGreaterThanOrEqual(8);
    for (const value of sizes) {
      for (const layer of value.split(/,(?![^(]*\))/)) {
        const t = layer.trim();
        if (t === "auto 100%" || t === "cover" || t === "contain" || t === "auto") continue;
        const nums = t.match(/([\d.]+)(px|%|em)/g) ?? [];
        if (nums.length === 2) {
          expect(nums[0], `background-size: ${t} stretches one axis`).toBe(nums[1]);
        } else if (nums.length > 2) {
          // `6px 6px, 6px 6px, auto 100% …` is a list of layers, each checked alone
          expect(t, `background-size: ${t} must be a per-layer list`).toContain("auto");
        }
      }
    }
  });

  it("keeps that rule when a feature lands on top of the sheet", () => {
    // A theme is a standing contract, not a snapshot: the HOLY CROSS angel
    // (PP-14) arrived after the noir pass carrying `background-size: 100%
    // 100%`, which is exactly the stretch above forbids. It is a 76×76 square
    // box, so `contain` is the identical picture drawn proportionally — and if
    // anyone reverts it to per-axis sizing, the test before this one fails.
    expect(css, ".fx-cross must not be stretched per axis").not.toMatch(/\.fx-cross\s*\{[^}]*background-size:\s*100% 100%/);
    expect(bodiesFor(".fx-cross").join(" ")).toMatch(/background-size:\s*contain/);
  });

  it("gives every build and racket a gutter for its artwork", () => {
    // A sigil painted at `right center` sits in the button's PADDING BOX, so
    // `padding-right` is the only thing between a label and the artwork — and
    // the labels are typed on a 300px sheet. Each plate therefore declares its
    // art width once and reserves a wider gutter from the same numbers.
    for (const sel of [".build-btn", ".sab-btn"]) {
      const body = bodiesFor(sel).join(" ");
      const w = Number(/--sigil-w:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
      const gutter = Number(/--sigil-gutter:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
      expect(w, `${sel} never sizes its sigil`).toBeGreaterThan(0);
      expect(gutter, `${sel} never reserves its gutter`).toBeGreaterThan(0);
      expect(gutter, `${sel} gutter is too narrow for a ${w}px sigil`).toBeGreaterThanOrEqual(w + 4);
      // …and both are painted from the same declaration pair, or they drift apart
      // the moment one of them is edited.
      expect(body).toMatch(/padding:[^;]*var\(--sigil-gutter\)/);
      expect(body).toMatch(/background-size:[^;]*auto var\(--sigil-w\)/);
      // a label that cannot fit breaks; it does not reach under the art
      if (sel === ".build-btn") expect(body).toMatch(/overflow:\s*hidden/);
    }
    // The gutter must also leave a real text column. The plate is 300px wide
    // (252px on a phone), the panel insets it by 9px and the button borders by
    // 2 — measured here as the sheet's own minimum label column.
    const cols: [string, number, number][] = [   // sel, button box, px of text left
      [".build-btn", 280, 176],
      [".sab-btn", 280, 150],
    ];
    for (const [sel, box, minText] of cols) {
      const body = bodiesFor(sel).join(" ");
      const pl = Number(/padding:[^;]*?(\d+)px\s+var\(--sigil-gutter\)\s+(\d+)px/.exec(body)?.[1] ?? NaN);
      const gutter = Number(/--sigil-gutter:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
      const text = box - gutter - pl - 8;   // …minus the flex gap
      expect(text, `${sel} leaves only ${text}px for the label (${minText} needed)`).toBeGreaterThanOrEqual(minText);
    }
    const mid = ruleFor(".bb-mid", /overflow-wrap/) ?? "";
    expect(mid, ".bb-mid lost its break-word guard").toContain("overflow-wrap");
    // the mobile sheet narrows the plate, so the art has to shrink with it.
    // The phone rule is the LAST one written for each selector (media queries
    // come after the base block) and it re-declares both numbers.
    for (const [sel, max] of [[".build-btn", 58], [".sab-btn", 50]] as const) {
      const small = bodiesFor(sel).filter((b) => /--sigil-w:/.test(b)).pop();
      expect(small, `${sel} has no phone rule`).toBeTruthy();
      const w = Number(/--sigil-w:\s*(\d+)px/.exec(small!)?.[1] ?? NaN);
      expect(w, `${sel} keeps a desktop sigil on a phone (${w}px)`).toBeLessThanOrEqual(max);
      const g = Number(/--sigil-gutter:\s*(\d+)px/.exec(small!)?.[1] ?? NaN);
      expect(g, `${sel} phone gutter is not sized from its sigil`).toBeGreaterThanOrEqual(w + 4);
    }
  });

  it("shrinks the frame ornaments, never blows them up", () => {
    // tools/make-noir-art.mjs cuts the chamfer at 108px and the medallion at
    // 88px; anything larger in CSS is an upscale, and an upscale of a bitmap is
    // its own kind of stretch. `--corner` is ONE length, which is also what
    // makes the scale uniform — two lengths could disagree.
    const painted = { ".aside.left .panel::after": 108, ".modal.box": 88, ".iso-skill-card": 88 };
    for (const [sel, max] of Object.entries(painted)) {
      const body = bodiesFor(sel).join(" ");
      const n = Number(/--corner:\s*(\d+)px/.exec(body)?.[1] ?? NaN);
      expect(n, `${sel} never sets --corner`).toBeGreaterThan(0);
      expect(n, `${sel} upscales its ornament (${n}px > ${max}px)`).toBeLessThanOrEqual(max);
      // the paint size is declared once, for all three ornamented plates
      expect(css).toMatch(/background-size:\s*var\(--corner\)/);
    }
  });

  it("cuts four ornaments per family, not one used four times", async () => {
    // CSS cannot mirror a background image, so both ornament sets are four
    // files, each turned toward its own corner. If a regeneration ever writes
    // the same crop four times, the frame's corners stop being corners — and
    // that is visible in exactly one number: they have to differ.
    for (const set of [["boss", 88], ["corner", 108]] as const) {
      const [name, size] = [set[0], set[1]] as [string, number];
      const grey: Record<string, Buffer> = {};
      for (const k of ["tl", "tr", "bl", "br"]) {
        const file = join("src/assets/ui/noir", `${name}-${k}.webp`);
        expect(existsSync(file), file).toBe(true);
        const { data, info } = await sharp(file).ensureAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
        expect(info.width, `${name}-${k} is square`).toBe(info.height);
        expect(info.width).toBe(size);
        grey[k] = data;
      }
      const diff = (a: string, b: string) => {
        let t = 0;
        for (let i = 0; i < grey[a].length; i++) t += Math.abs(grey[a][i] - grey[b][i]);
        return t / grey[a].length;
      };
      expect(diff("tl", "br"), `${name}: opposite corners are the same picture`).toBeGreaterThan(6);
      expect(diff("tl", "tr"), `${name}: the two top corners are the same picture`).toBeGreaterThan(6);
      // a medallion earns its place by reading against dark iron; the chamfer is
      // allowed to be barely there, and the first time it was, it was 13 levels
      if (name === "boss") {
        const mean = grey.tl.reduce((a: number, b: number) => a + b, 0) / grey.tl.length;
        expect(mean, `boss-tl is too dark to see on a plate (mean ${mean.toFixed(0)})`).toBeGreaterThanOrEqual(38);
      }
    }
  });

  it("paints the corner ornaments only where the frame is", async () => {
    // Each corner must be an L along its two edges with a transparent interior:
    // that is what lets a panel keep its felt under the title while still
    // wearing the frame. Measured per file, per corner.
    const BAND = 24;                                   // levels of ornament inward
    const near = (v: number, edge: "lo" | "hi", n: number) => (edge === "lo" ? v : n - 1 - v);
    for (const [key, row, col] of [["tl", "lo", "lo"], ["tr", "lo", "hi"], ["bl", "hi", "lo"], ["br", "hi", "hi"]] as const) {
      const file = join("src/assets/ui/noir", `corner-${key}.webp`);
      expect(existsSync(file), file).toBe(true);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const w = info.width!, h = info.height!;
      const a = (x: number, y: number) => data[(y * w + x) * 4 + 3];
      expect(a(0, 0) > 200 || (row === "hi" && col === "hi" && a(w - 1, h - 1) > 200), `${key}: its own corner is painted`).toBe(true);
      expect(a(w >> 1, h >> 1), `${key}: the middle of the ornament must be knocked out`).toBeLessThan(4);
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
        if (a(x, y) < 40) continue;
        const d = Math.min(near(x, col, w), near(y, row, h));
        const diag = (near(x, col, w) + near(y, row, h)) / 2;
        expect(Math.min(d, diag), `${key} has opaque paint ${x},${y} away from its edges`).toBeLessThan(BAND);
      }
    }
  });

  it("repeats only tiles whose edges are already continuous", async () => {
    // The same measurement tools/make-noir-art.mjs prints, from the other side:
    // the mean step across a wrap boundary, against the sheet's own grain. A
    // line of 3 levels is invisible on any material; past that, the sheet has
    // to be as busy as the line before a repeat hides it (`ledger.webp`).
    const tiled = ["felt.webp", "smoke.webp", "ledger.webp"];
    for (const f of tiled) {
      const file = join("src/assets/ui/noir", f);
      expect(existsSync(file), file).toBe(true);
      const { data, info } = await sharp(file).ensureAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
      const w = info.width!, h = info.height!;
      const at = (x: number, y: number) => data[y * w + x];
      const edge: number[] = []; const inside: number[] = [];
      for (let y = 0; y < h; y++) edge.push(Math.abs(at(0, y) - at(w - 1, y)));
      for (let x = 0; x < w; x++) edge.push(Math.abs(at(x, 0) - at(x, h - 1)));
      // the sheet's own grain, both ways: a ruled paper is much busier
      // vertically than horizontally, and grading a horizontal wrap against one
      // axis alone would call a period line a seam (the tool samples both)
      for (let y = 0; y < h; y += 2) for (let x = 0; x + 1 < w; x += 2) inside.push(Math.abs(at(x, y) - at(x + 1, y)));
      for (let y = 0; y + 1 < h; y += 2) for (let x = 0; x < w; x += 2) inside.push(Math.abs(at(x, y) - at(x, y + 1)));
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const e = mean(edge), i = mean(inside);
      expect(e <= 3 || e / Math.max(0.6, i) <= 1.6, `${f}: seam ${e.toFixed(1)} levels (grain ${i.toFixed(1)}) would show when tiled`).toBe(true);
    }
  });

  it("does not repeat a sheet that has no reason to", () => {
    // `cover` and `contain` are crops, not tiles: nothing to seam. Anything the
    // sheet repeats must therefore come from the three seamless textures above,
    // and the war-room photograph must never repeat at all.
    for (const varName of ["--room", "--seal", "--seal-sm", "--sigil"]) {
      for (const body of css.split("\n").filter((l) => l.includes(`var(${varName})`))) {
        expect(body, `${varName} is being tiled: ${body.trim()}`).toMatch(/no-repeat|cover|contain/);
      }
    }
  });
});

describe("NOIR the painted set is wired end to end", () => {
  // the tool keys, read out of ui.ts's TOOLS table — the same list the loop
  // turns into `build-btn bg-<key>` buttons, so a tool with no art fails here.
  const tools = [...ui.matchAll(/\{ key: "([a-z]+)", label:/g)].map((m) => m[1]);
  // the sabotage keys, read out of the SABOTAGE table itself — the same object
  // ui.ts iterates, so a new racket with no art fails here rather than in play.
  const table = /export const SABOTAGE[^{]*\{([\s\S]*?)\n\};/.exec(gameConfig)![1];
  const sabots = [...table.matchAll(/^  ([a-z]+):\s*\{ name:/gm)].map((m) => m[1]);

  it("gives every build tool its sigil, rule and plate", () => {
    expect(tools).toEqual(["dirt", "road", "harvester", "plant", "demolish"]);
    for (const t of tools) {
      expect(css, `.build-btn.bg-${t} has no rule`).toMatch(new RegExp(`\\.build-btn\\.bg-${t}\\s*\\{`));
      expect(existsSync(`src/assets/ui/noir/sigil/${t}.png`), `${t} sigil file`).toBe(true);
    }
  });

  it("gives every sabotage its sigil, rule and plate", () => {
    expect(sabots.length, "SABOTAGE disappeared from the config").toBeGreaterThan(3);
    expect(sabots).toEqual(["bandit", "harden", "block", "fog", "protest"]);
    for (const key of sabots) {
      expect(existsSync(`src/assets/ui/noir/sigil/${key}.png`), `${key} sigil file`).toBe(true);
      expect(css, `.sab-btn.sb-${key} has no rule`).toMatch(new RegExp(`\\.sab-btn\\.sb-${key}\\s*\\{`));
    }
    for (const cls of ["secure-btn", "repair-btn"]) {
      expect(css, `.sab-btn.${cls} has no rule`).toMatch(new RegExp(`\\.sab-btn\\.${cls}\\s*\\{`));
      expect(existsSync(`src/assets/ui/noir/sigil/${cls === "secure-btn" ? "security" : "repair"}.png`)).toBe(true);
    }
  });

  it("presses one cargo token per cargo — a HEX gem, transparent in the corners", async () => {
    // HEXmatch is a hex board: the tokens are the repo's own painted hexagons,
    // not noir derivatives. `tools/make-noir-art.mjs` only repaints them behind
    // an explicit `--gems`, and this is the assertion that says why.
    const cargoes = ["grain", "wood", "ore", "stone", "oil", "gold"];
    for (const c of cargoes) {
      const file = join("src/assets/gems", `${c}.png`);
      expect(existsSync(file), file).toBe(true);
      const info = await sharp(file).metadata();
      expect(info.width, `${c} token size`).toBe(128);
      expect(info.height, `${c} token size`).toBe(128);
      expect(info.hasAlpha, `${c} must carry the hex matte`).toBe(true);
      const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      for (const [x, y, what] of [
        [1, 1, "top-left corner"], [126, 1, "top-right corner"],
        [1, 126, "bottom-left corner"], [126, 126, "bottom-right corner"],
      ] as const) {
        expect(at(x as number, y as number), `${c} ${what}`).toBeLessThan(16);
      }
      expect(at(64, 0), `${c} pointy top edge is the hexagon's apex`).toBeGreaterThan(128);
      expect(at(64, 64), `${c} centre is opaque`).toBeGreaterThan(250);
    }
    // …and the sheet cuts the token along that hexagon instead of a circle, so
    // the clip never carves into the painting (percentages: it scales with
    // --gem, which is the one thing a bitmap could not do).
    const sprite = ruleFor(".gem .face.sprite", /clip-path:/);
    expect(sprite, ".gem .face.sprite lost its hex clip").toBeTruthy();
    expect(sprite!, "hex clip is not a 6-point polygon").toMatch(
      /clip-path:\s*polygon\(\s*50% 0,\s*100% 25%,\s*100% 75%,\s*50% 100%,\s*0 75%,\s*0 25%\s*\)/,
    );
  });

  it("leaves the gem art alone: the theme paints nothing over the token", () => {
    // "restore the old gems" means the presentation too. The sheet may size a
    // token and cut its matte, but a saturate/brightness pass on top of a
    // finished painting is what made them read as new art.
    const sprite = ruleFor(".gem .face.sprite", /filter:/) ?? "";
    expect(sprite, "sprite face is being re-tinted").not.toMatch(/saturate\(\s*1?\.?[1-9]/);
    expect(sprite, "sprite face is being re-lit").not.toMatch(/brightness\(\s*1\.[1-9]/);
    expect(sprite).toMatch(/filter:\s*drop-shadow\(0 2px 3px rgba\(0, 0, 0, \.5\)\)/);
    // a gold token keeps the base's single soft glow, not a themed neon one
    expect(ruleFor(".gem.token .face.sprite", /filter:/)).toMatch(/0 0 6px var\(--gold2\)/);
    // and the square selection ring is dropped for painted tokens (it drew a
    // box around a hexagon); the lift is the glow, drawn on the sprite.
    expect(ruleFor(".gem.selected .face.sprite", /outline:\s*none/), "square ring on a sprite").toBeTruthy();
    expect(css).toMatch(/\.gem\.sel \.face\.sprite, \.gem\.selected \.face\.sprite\s*\{\s*filter:/);
    // ui.ts must not re-introduce the per-axis stretch
    expect(ui).not.toMatch(/backgroundSize\s*=\s*["']100% 100%["']/);
  });

  it("prints the instruction sheet on clean paper", () => {
    // The banner is read mid-game, at arm's length: `multiply` under 11px type
    // is a sheet of static. The ledger stays (it is the theme) but it is washed
    // flat by an opaque ivory layer, and the type moves off the typewriter.
    const body = bodiesFor(".banner").join(" ");
    expect(body).toMatch(/background-blend-mode:\s*normal,\s*multiply/);
    const first = /background:\s*linear-gradient\([^;]*?rgba\(\s*2[0-9]{2},\s*2[0-9]{2},\s*1[0-9]{2},\s*\.[6-9]/.exec(body);
    expect(first, ".banner has no light wash over the ledger").toBeTruthy();
    const small = bodiesFor(".banner small").join(" ");
    expect(small, "the banner message is still 11px typewriter").toMatch(/font-size:\s*13px/);
    expect(small).toMatch(/font-family:\s*var\(--sans\)/);
    expect(small).toMatch(/color:\s*#1f1405/);
    // the log shares the recipe
    expect(bodiesFor(".feed-row").join(" ")).toMatch(/background-blend-mode:\s*normal,\s*multiply/);
  });

  it("keeps a solid corner medallion clear of the title it frames", async () => {
    // `boss-*.webp` is opaque in ALL FOUR of its corners — measured, not
    // assumed — so a medallion is a solid square, not a chamfer that fades out.
    for (const k of ["tl", "tr", "bl", "br"]) {
      const file = join("src/assets/ui/noir", `boss-${k}.webp`);
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const w = info.width!, h = info.height!;
      const a = (x: number, y: number) => data[(y * w + x) * 4 + 3];
      expect(Math.min(a(0, 0), a(w - 1, 0), a(0, h - 1), a(w - 1, h - 1)), `boss-${k} is not a solid square`).toBeGreaterThan(200);
    }
    // …so it is painted flush on the edge and the plate keeps an exactly
    // matching gutter that its own heading reads (one source of truth).
    expect(css).toMatch(/\.modal\.box::after, \.iso-skill-card::after\s*\{[^}]*background-position:\s*left top,\s*right top,\s*left bottom,\s*right bottom/);
    for (const sel of [".modal.box", ".iso-skill-card"]) {
      const host = bodiesFor(sel).join(" ");
      const inset = Number(/--corner-inset:\s*(\d+)(?:px)?/.exec(host)?.[1] ?? NaN);
      const corner = Number(/--corner:\s*(\d+)px/.exec(host)?.[1] ?? NaN);
      expect(inset, `${sel} never declares --corner-inset`).toBe(0);
      expect(corner, `${sel} never declares --corner`).toBeGreaterThan(0);
      expect(host, `${sel} does not derive --text-clear from its ornament`)
        .toMatch(/--text-clear:\s*calc\(var\(--corner-inset\) \+ var\(--corner\)\)/);
    }
    // …centred in the band the two ornaments leave, not parked next to one of
    // them: the reservation is symmetric, and a flex title that overflows it is
    // clamped with `safe center` (a plain centred flex line overflows its LEFT
    // item only — which is exactly how the guild seal ended up under the brass).
    for (const sel of ["#iso-skill-prompt h2", ".modal h2"]) {
      const body = bodiesFor(sel).join(" ");
      expect(body, `${sel} does not reserve the medallion band`)
        .toMatch(/padding-inline:\s*var\(--text-clear\)/);
      expect(body, `${sel} is not centred`).toMatch(/text-align:\s*center|justify-content:\s*safe center/);
    }
    expect(bodiesFor(".modal h2").join(" "), ".modal h2 lost its safe centring")
      .toMatch(/justify-content:\s*safe center/);
  });

  it("seats the sigil off the plate's edge, not under the label", () => {
    for (const sel of [".build-btn", ".sab-btn"]) {
      const body = bodiesFor(sel).join(" ");
      expect(body, `${sel} paints its sigil flush at the edge`).toMatch(/background-position:\s*right 8px center/);
    }
    // a sabotage card's two lines share a row: the name takes what is left and
    // the price never squeezes it into the art
    expect(bodiesFor(".sab-top > b").join(" ")).toMatch(/overflow-wrap:\s*break-word/);
    expect(bodiesFor(".sab-cost").join(" ")).toMatch(/flex:\s*0 0 auto/);
  });

  it("ships the painted sources the tool reads", () => {
    // `node tools/make-noir-art.mjs` regenerates the whole set from these; a
    // pruned source plate would make the theme irreproducible.
    for (const p of [
      "frame-panel.png", "frame-plate.png", "bg-warroom.png", "emblem-logo.png",
      "tex-smoke.png", "tex-ledger.png", "icons-build.png", "icons-sab.png", "icons-gems.png",
    ]) {
      expect(existsSync(join("assets/ui-src/noir", p)), p).toBe(true);
    }
  });

  it("leaves the features that landed after the pass wired up", () => {
    // The noir pass rewrote styles.css and ui.ts whole, which is precisely the
    // kind of merge that quietly drops someone else's new block. The theme
    // layer stays pure, so anything main adds must survive it: the cross
    // chooser's art, its CSS, and the mount point that keeps them alive.
    for (const sel of [".cross-pick", ".cross-pick-btn", ".cross-pick-confirm"]) {
      expect(bodiesFor(sel).join(""), sel).not.toBe("");
    }
    expect(css).toMatch(/\.start-screen\s*\{/);
    expect(existsSync("src/assets/ui/angel.png"), "angel.png").toBe(true);
    expect(existsSync("src/game/holy.ts"), "holy.ts").toBe(true);
    expect(ui).toMatch(/function crossPick\(/);
    expect(ui).toMatch(/\n    crossPick,\n/); // …and it is still handed to the board
  });

  it("puts the family portraits back on the dossiers", () => {
    expect(ui).toMatch(/class="king-av has-portrait"/);
    expect(css).toMatch(/\.king-av\.has-portrait\s*\{\s*color:\s*transparent/);
    for (const f of ["tycoon_you.png", "tycoon_krag.png", "tycoon_torvin.png", "tycoon_vex.png"]) {
      expect(existsSync(join("src/assets/ui", f)), f).toBe(true);
    }
  });
});
