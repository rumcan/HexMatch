// ══════════════════════════════════════════════════════════════════════════
// A1 — floating text anchored to an iso TILE.
//
// Two things needed to say something on the map rather than in a panel:
//
//   * the lorry's "+2 🌾" the moment it reaches the Factory — the delivery
//     that also mints the token on a gem, so the number on the board and the
//     number at the Factory are the same event;
//   * the sabotage marker over the rival's plant when a Black Market buy
//     lands there.
//
// The floats live in the map host (above the three canvas layers) and are
// re-positioned from the LIVE camera every frame, so a float pans and zooms
// with the tile it belongs to instead of sticking to the screen. They are
// deliberately not canvas art: the rise-and-fade is CSS, and a DOM node is
// something a test can read back.
//
// A float is anchored at the tile's screen point and drawn ABOVE it (the
// `translate(-50%,-100%)` in `.iso-float`), so it rises out of the tile the
// way the quarry's own callouts rise out of a gem.
// ══════════════════════════════════════════════════════════════════════════

/** How long a world float lives, in ms. Matches `.iso-float`'s animation. */
export const FLOAT_LIFE_MS = 1150;

/** Vertical room one float takes, so simultaneous floats on one tile stack. */
const STACK_STEP = 24;

export interface FloatOptions {
  /** Override the lifetime (ms). */
  life?: number;
  /** Extra class: `delivery` (gold) or `sabotage` (ice blue). */
  cls?: string;
  /** Spawn time; defaults to the `now` of the next `frame` (or 0). */
  now?: number;
}

interface LiveFloat {
  el: HTMLElement;
  tx: number;
  ty: number;
  born: number;
  life: number;
  slot: number;
}

export interface FloatLayer {
  /** Pop `text` over tile (tx,ty). Returns the element (tests read it). */
  add(text: string, tx: number, ty: number, opts?: FloatOptions): HTMLElement;
  /** Re-anchor every float to the live camera and reap the expired ones. */
  frame(now: number): void;
  /** Drop every float (used when the game is disposed). */
  clear(): void;
  /** How many floats are alive. */
  count(): number;
  /** The live texts, oldest first. */
  texts(): string[];
}

/**
 * `screenAt` maps a tile to CSS pixels INSIDE `host` — the game passes the
 * live camera and device-pixel-ratio through it, so this module never learns
 * about cameras, zoom or DPR.
 */
export function createFloatLayer(
  host: HTMLElement, screenAt: (tx: number, ty: number) => [number, number],
): FloatLayer {
  const items: LiveFloat[] = [];

  const add = (text: string, tx: number, ty: number, opts: FloatOptions = {}): HTMLElement => {
    const el = document.createElement("div");
    el.className = `iso-float${opts.cls ? ` ${opts.cls}` : ""}`;
    el.textContent = text;
    // Stack same-tile floats so a lorry delivering two cargoes shows both.
    const slot = items.reduce((n, f) => (f.tx === tx && f.ty === ty ? n + 1 : n), 0);
    const item: LiveFloat = {
      el, tx, ty, slot,
      born: opts.now ?? 0,
      life: opts.life ?? FLOAT_LIFE_MS,
    };
    items.push(item);
    place(item);
    host.appendChild(el);
    return el;
  };

  /** Re-anchor one float to wherever its tile is on screen right now. */
  const place = (f: LiveFloat) => {
    const [x, y] = screenAt(f.tx, f.ty);
    f.el.style.left = `${Math.round(x)}px`;
    f.el.style.top = `${Math.round(y - f.slot * STACK_STEP)}px`;
  };

  const frame = (now: number) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const f = items[i];
      // `born === 0` = the caller had no clock to hand: start the life on the
      // first frame that draws it, so a float is never reaped before it has
      // been positioned once.
      if (f.born === 0) f.born = now;
      if (now - f.born >= f.life) { f.el.remove(); items.splice(i, 1); continue; }
      place(f);
    }
  };

  const clear = () => {
    for (const f of items) f.el.remove();
    items.length = 0;
  };

  return {
    add,
    frame,
    clear,
    count: () => items.length,
    texts: () => items.map((f) => f.el.textContent ?? ""),
  };
}
