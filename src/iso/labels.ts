// ══════════════════════════════════════════════════════════════════════════
// NAMES — persistent name labels over the map's features.
//
// The strategy-game ask: while you pan the map you should be able to READ
// what a resource, town, plant or depot is without hovering it. So the game
// keeps one small text tag above every named feature, anchored to its tile
// the same way the A1 floats are (re-positioned from the LIVE camera every
// frame, so a label pans and zooms with the building under it).
//
// Unlike the floats, labels never expire on their own: `sync(entries)`
// replaces the whole set (the game calls it whenever the world changes),
// `setEnabled` hides every tag at once (the "Names" top-bar button) and
// `frame` is a cheap no-op while hidden. DOM, not canvas art — a tag is
// something a test can read back, and the one-line text needs no atlas.
// ══════════════════════════════════════════════════════════════════════════

export interface LabelEntry {
  /** Stable id: what keeps a tag across a resync (depot id, industry id…). */
  key: string;
  /** The text on the tag. */
  name: string;
  /** Anchor tile (fractional allowed — an industry anchors at its footprint centre). */
  tx: number;
  ty: number;
  /** Extra class for the feature kind (`label-industry`, `label-town`, …). */
  cls?: string;
}

interface LiveLabel {
  el: HTMLElement;
  entry: LabelEntry;
}

export interface LabelLayer {
  /** Replace the whole label set, keeping the tags that survived a resync. */
  sync(entries: readonly LabelEntry[]): void;
  /** Show or hide every tag (the Names button). */
  setEnabled(on: boolean): void;
  /** Whether the tags are currently shown. */
  readonly enabled: boolean;
  /** Re-anchor every visible label to the live camera. */
  frame(): void;
  /** Drop every label (used when the game is disposed). */
  clear(): void;
  /** How many labels are live. */
  count(): number;
  /** The live names, in sync order. */
  texts(): string[];
}

/**
 * `screenAt` maps a (possibly fractional) tile to CSS pixels INSIDE `host` —
 * the game passes the live camera and device-pixel-ratio through it, so this
 * module never learns about cameras, zoom or DPR (the floats.ts contract).
 */
export function createLabelLayer(
  host: HTMLElement, screenAt: (tx: number, ty: number) => [number, number],
): LabelLayer {
  let enabled = true;
  const items: LiveLabel[] = [];

  const place = (f: LiveLabel) => {
    const [x, y] = screenAt(f.entry.tx, f.entry.ty);
    f.el.style.left = `${Math.round(x)}px`;
    f.el.style.top = `${Math.round(y)}px`;
  };

  const sync = (entries: readonly LabelEntry[]) => {
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.key);
      let live = items.find((f) => f.entry.key === entry.key);
      if (!live) {
        const el = document.createElement("div");
        el.className = "iso-label" + (entry.cls ? ` ${entry.cls}` : "");
        const text = document.createElement("span");
        el.appendChild(text);
        live = { el, entry };
        items.push(live);
        host.appendChild(el);
      }
      if (live.entry !== entry) {
        live.entry = entry;
        if (entry.cls) live.el.className = "iso-label " + entry.cls;
      }
      const textEl = live.el.firstChild as HTMLElement;
      if (textEl.textContent !== entry.name) textEl.textContent = entry.name;
      place(live);
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (!seen.has(items[i].entry.key)) { items[i].el.remove(); items.splice(i, 1); }
    }
  };

  const setEnabled = (on: boolean) => {
    enabled = on;
    for (const f of items) f.el.classList.toggle("hidden", !on);
  };

  const frame = () => {
    if (!enabled) return;
    for (const f of items) place(f);
  };

  const clear = () => {
    for (const f of items) f.el.remove();
    items.length = 0;
  };

  return {
    sync,
    setEnabled,
    get enabled() { return enabled; },
    frame,
    clear,
    count: () => items.length,
    texts: () => items.map((f) => f.entry.name),
  };
}
