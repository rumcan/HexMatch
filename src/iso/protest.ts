// ══════════════════════════════════════════════════════════════════════════
// M2 (#256) — Sabotage events (protests, blockades) on the minimap.
//
// Active Black Market sabotages appear as live event markers on the minimap
// with the attacker's colour and a countdown ring. Clicking a marker opens
// a small event window showing a static illustration of that sabotage type,
// who did it, the target, live time remaining, and a "Go there" button that
// pans the camera. When the sabotage ends, both the marker and the window
// disappear.
// ══════════════════════════════════════════════════════════════════════════
import { BANDIT_MS, PROTEST_MS } from "../game/config";
import { INDUSTRY_BY_KEY } from "./config";
import { MINIMAP_PALETTE, type MinimapMarker } from "./minimap";
import blockadeImg from "../assets/sabotage/blockade.png";
import protestImg from "../assets/sabotage/protest.png";

export interface Protest {
  tx: number;
  ty: number;
  until: number;
  owner: string;
}

export type SabotageKind = "blockade" | "protest";

export interface SabotageEvent {
  /** Stable event id ("blockade:<id>" or "protest:<tx>,<ty>") */
  id: string;
  kind: SabotageKind;
  tx: number;
  ty: number;
  until: number;
  totalDuration: number;
  owner: string;
  targetName: string;
  label: string;
}

export interface SabotageIndustryTarget {
  id: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  type: string;
  banditUntil: number;
  banditOwner?: string;
}

export interface SabotagePlayerInfo {
  id: string;
  name?: string;
  colour: string;
}

export interface SabotageCollectionSource {
  protests: Iterable<Protest>;
  industries: readonly SabotageIndustryTarget[];
  players: readonly SabotagePlayerInfo[];
  now: number;
}

/** Formats milliseconds remaining into mm:ss (e.g. 0:45, 1:20). */
export function fmtSabotageCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Collects all live protests and blockades into structured sabotage events.
 */
export function collectSabotageEvents(source: SabotageCollectionSource): SabotageEvent[] {
  const events: SabotageEvent[] = [];
  const { protests, industries, now } = source;

  // Protests on public roads
  for (const p of protests) {
    if (p.until > now) {
      events.push({
        id: `protest:${p.tx},${p.ty}`,
        kind: "protest",
        tx: p.tx,
        ty: p.ty,
        until: p.until,
        totalDuration: PROTEST_MS,
        owner: p.owner,
        targetName: `Public Road (${p.tx}, ${p.ty})`,
        label: "Protest",
      });
    }
  }

  // Blockades on industries
  for (const ind of industries) {
    if (ind.banditUntil > now) {
      const def = INDUSTRY_BY_KEY[ind.type];
      const centerX = ind.tx + Math.floor(ind.w / 2);
      const centerY = ind.ty + Math.floor(ind.h / 2);
      const owner = ind.banditOwner ?? (source.players[1]?.id ?? "ai");
      events.push({
        id: `blockade:${ind.id}`,
        kind: "blockade",
        tx: centerX,
        ty: centerY,
        until: ind.banditUntil,
        totalDuration: BANDIT_MS,
        owner,
        targetName: def?.name ?? ind.type,
        label: "Blockade",
      });
    }
  }

  return events;
}

/**
 * Turns active sabotage events into minimap markers with owner colour and countdown ring.
 */
export function sabotageEventsToMarkers(
  events: readonly SabotageEvent[],
  players: readonly SabotagePlayerInfo[],
  now: number,
): MinimapMarker[] {
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const markers: MinimapMarker[] = [];

  for (const ev of events) {
    const p = playerMap.get(ev.owner);
    const color = p?.colour ?? MINIMAP_PALETTE.owner;
    const remaining = Math.max(0, ev.until - now);
    const progress = ev.totalDuration > 0 ? Math.min(1, Math.max(0, remaining / ev.totalDuration)) : 0;
    const timeStr = fmtSabotageCountdown(remaining);

    markers.push({
      id: ev.id,
      tx: ev.tx,
      ty: ev.ty,
      color,
      progress,
      kind: ev.kind,
      label: `${ev.label} — ${timeStr}`,
    });
  }

  return markers;
}

/**
 * Full helper: collects live sabotage events and produces the MinimapMarker list.
 */
export function collectSabotageMarkers(source: SabotageCollectionSource): MinimapMarker[] {
  const events = collectSabotageEvents(source);
  return sabotageEventsToMarkers(events, source.players, source.now);
}

// ── Image slot component (#258) ──────────────────────────────────────────
export const SABOTAGE_IMAGES: Record<string, string> = {
  blockade: blockadeImg,
  bandit: blockadeImg,
  protest: protestImg,
};

export interface SabotageImageSlot {
  readonly element: HTMLElement;
  readonly img: HTMLImageElement;
  setKind(kind: string): void;
  destroy(): void;
}

/**
 * Creates the illustration container for the event window. Encapsulated as
 * a component so #258 can replace or augment it with animation.
 */
export function createSabotageImageSlot(initialKind?: string): SabotageImageSlot {
  const element = document.createElement("div");
  element.className = "sabotage-image-slot";
  const img = document.createElement("img");
  img.className = "sabotage-illustration";
  element.appendChild(img);

  const setKind = (kind: string) => {
    const src = SABOTAGE_IMAGES[kind] ?? protestImg;
    img.src = src;
    img.alt = `${kind} sabotage illustration`;
    element.dataset.kind = kind;
  };

  if (initialKind) setKind(initialKind);

  return {
    element,
    img,
    setKind,
    destroy() {
      element.remove();
    },
  };
}

// ── Event Window component ───────────────────────────────────────────────
export interface SabotageEventWindowOptions {
  host: HTMLElement;
  onGoTo: (tx: number, ty: number) => void;
  onClose?: () => void;
  resolvePlayerName?: (id: string) => string;
}

export interface SabotageEventWindow {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  readonly currentEvent: SabotageEvent | null;
  open(event: SabotageEvent): void;
  update(now: number, activeEvents?: readonly SabotageEvent[]): void;
  close(): void;
  destroy(): void;
}

export function createSabotageEventWindow(opts: SabotageEventWindowOptions): SabotageEventWindow {
  const doc = opts.host.ownerDocument;
  const container = doc.createElement("div");
  container.className = "sabotage-event-window hidden";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Sabotage Event");

  // Header
  const header = doc.createElement("div");
  header.className = "sabotage-window-header";
  const title = doc.createElement("h4");
  title.className = "sabotage-window-title";
  const closeBtn = doc.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sabotage-window-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  header.appendChild(title);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Image slot component (#258 hook)
  const imageSlot = createSabotageImageSlot();
  container.appendChild(imageSlot.element);

  // Details
  const details = doc.createElement("div");
  details.className = "sabotage-details";

  const ownerRow = doc.createElement("div");
  ownerRow.className = "sabotage-detail-row";
  const ownerLabel = doc.createElement("span");
  ownerLabel.className = "sabotage-label";
  ownerLabel.textContent = "By:";
  const ownerVal = doc.createElement("span");
  ownerVal.className = "sabotage-val sabotage-owner";
  ownerRow.appendChild(ownerLabel);
  ownerRow.appendChild(ownerVal);
  details.appendChild(ownerRow);

  const targetRow = doc.createElement("div");
  targetRow.className = "sabotage-detail-row";
  const targetLabel = doc.createElement("span");
  targetLabel.className = "sabotage-label";
  targetLabel.textContent = "Target:";
  const targetVal = doc.createElement("span");
  targetVal.className = "sabotage-val sabotage-target";
  targetRow.appendChild(targetLabel);
  targetRow.appendChild(targetVal);
  details.appendChild(targetRow);

  const timeRow = doc.createElement("div");
  timeRow.className = "sabotage-detail-row";
  const timeLabel = doc.createElement("span");
  timeLabel.className = "sabotage-label";
  timeLabel.textContent = "Time remaining:";
  const timeVal = doc.createElement("span");
  timeVal.className = "sabotage-val sabotage-countdown";
  timeRow.appendChild(timeLabel);
  timeRow.appendChild(timeVal);
  details.appendChild(timeRow);

  container.appendChild(details);

  // Actions
  const actions = doc.createElement("div");
  actions.className = "sabotage-window-actions";
  const goToBtn = doc.createElement("button");
  goToBtn.type = "button";
  goToBtn.className = "btn btn-primary sabotage-goto-btn";
  goToBtn.textContent = "Go there";

  const dismissBtn = doc.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn sabotage-dismiss-btn";
  dismissBtn.textContent = "Close";

  actions.appendChild(goToBtn);
  actions.appendChild(dismissBtn);
  container.appendChild(actions);

  opts.host.appendChild(container);

  let currentEvent: SabotageEvent | null = null;
  let isOpen = false;

  const defaultResolve = (id: string) => {
    if (id === "you" || id === "1") return "You";
    if (id === "ai" || id === "2") return "Rival";
    return id;
  };
  const resolveName = opts.resolvePlayerName ?? defaultResolve;

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    currentEvent = null;
    container.classList.add("hidden");
    opts.onClose?.();
  };

  closeBtn.addEventListener("click", close);
  dismissBtn.addEventListener("click", close);

  goToBtn.addEventListener("click", () => {
    if (currentEvent) {
      opts.onGoTo(currentEvent.tx, currentEvent.ty);
    }
  });

  const open = (event: SabotageEvent) => {
    currentEvent = event;
    isOpen = true;
    title.textContent = `${event.kind === "blockade" ? "⛓" : "✊"} ${event.label.toUpperCase()}`;
    imageSlot.setKind(event.kind);
    ownerVal.textContent = resolveName(event.owner);
    targetVal.textContent = event.targetName;
    const rem = Math.max(0, event.until - performance.now());
    timeVal.textContent = fmtSabotageCountdown(rem);
    container.classList.remove("hidden");
  };

  const update = (now: number, activeEvents?: readonly SabotageEvent[]) => {
    if (!isOpen || !currentEvent) return;
    if (now >= currentEvent.until) {
      close();
      return;
    }
    if (activeEvents && !activeEvents.some((e) => e.id === currentEvent!.id)) {
      close();
      return;
    }
    timeVal.textContent = fmtSabotageCountdown(currentEvent.until - now);
  };

  const destroy = () => {
    close();
    closeBtn.removeEventListener("click", close);
    dismissBtn.removeEventListener("click", close);
    imageSlot.destroy();
    container.remove();
  };

  return {
    get element() { return container; },
    get isOpen() { return isOpen; },
    get currentEvent() { return currentEvent; },
    open,
    update,
    close,
    destroy,
  };
}
