// @vitest-environment jsdom
//
// MON-1 (#367) — the RUN Bits store.
//
// The store's own logic is the part a unit test can hold to a promise: what
// "owned" means when the network is silent, that a purchase is charged once
// however often it is retried, and that a store that cannot be reached costs
// the player a sentence and nothing else. The panel is exercised here too,
// because it is the promise the player actually reads.
//
// No test here touches the RUN SDK: every adapter is injected, so the module
// never reaches its dynamic `import("../net/transport")`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_ITEMS, STORE_ITEM_IDS, fmtBits, storeItem } from "../../src/iso/config";
import {
  buyStoreItem, createMockStoreAdapter, loadStore, ownsStoreItem, ownedStoreItemIds,
  isStoreItemUnlocked, resetStoreForTests, setStoreAdapter, storeMockEnabled,
  storeSnapshot, subscribeStore,
  type StoreAdapter, type StorePurchaseRequest, type StorePurchaseOutcome,
} from "../../src/game/store";
import { showStorePanel, type StorePanelHandle } from "../../src/game/store-panel";
import { STORE_MOCK_KEY, STORE_STORAGE_KEY } from "../../src/game/store";

/** The mock store, on this page's localStorage — the `?store=mock` door. */
function liveMock(balance = 1000): StoreAdapter {
  return createMockStoreAdapter({ balance });
}

/** An adapter that cannot sell: no RUN host behind the page. */
function deadAdapter(): StoreAdapter {
  return {
    kind: "platform",
    available: () => false,
    readBalance: async () => null,
    readEntitlements: async () => null,
    purchase: async () => ({ ok: false, reason: "unavailable", balance: null }),
  };
}

/** A recording adapter: every call is counted, and the script answers in order. */
function scripted(opts: {
  available?: boolean;
  balance?: number | null;
  entitlements?: Record<string, number> | null;
  /** Answers, one per purchase call; the last one repeats. */
  purchases?: StorePurchaseOutcome[];
} = {}) {
  const calls: StorePurchaseRequest[] = [];
  const balance = opts.balance === undefined ? 500 : opts.balance;
  const script = opts.purchases ?? [{ ok: true, reason: null, balance }];
  const adapter: StoreAdapter = {
    kind: "platform",
    available: () => opts.available !== false,
    readBalance: async () => balance,
    readEntitlements: async () => (opts.entitlements === undefined ? {} : opts.entitlements),
    purchase: async (req) => {
      calls.push({ ...req });
      return script[Math.min(calls.length - 1, script.length - 1)];
    },
  };
  return { adapter, calls };
}

beforeEach(() => {
  localStorage.clear();
  resetStoreForTests();
  // No `?store=mock` in the URL by default: unless a test asks for the mock
  // door, the adapter is injected explicitly.
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  setStoreAdapter(null);
  resetStoreForTests();
  localStorage.clear();
});

// ── The catalogue ─────────────────────────────────────────────────────────
describe("MON-1 — the catalogue (src/iso/config.ts)", () => {
  it("declares railways first, and every item is unenforced in MON-1", () => {
    expect(STORE_ITEMS.length).toBeGreaterThan(0);
    expect(STORE_ITEMS[0].id).toBe("railways");
    // MON-1 is the plumbing: nothing is locked by this ticket.
    for (const item of STORE_ITEMS) expect(item.enforced).toBe(false);
    // …and the gate honours that: an unenforced item is unlocked for everyone.
    for (const item of STORE_ITEMS) expect(isStoreItemUnlocked(item.id)).toBe(true);
  });

  it("is the single declaration of ids, names and prices", () => {
    const ids = STORE_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);            // no duplicate ids
    expect(STORE_ITEM_IDS).toEqual(ids);
    for (const item of STORE_ITEMS) {
      expect(item.id).toMatch(/^[a-z][a-z0-9_]*$/);        // a safe product id on RUN
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.price).toBeGreaterThan(0);
      expect(item.unlocks.trim().length).toBeGreaterThan(0);
      expect(item.icon.trim().length).toBeGreaterThan(0);
    }
    expect(storeItem("railways")!.name).toBe("Railways");
    expect(storeItem("nope")).toBeNull();
  });

  it("prints the price the way the panel does", () => {
    expect(fmtBits(150)).toBe("150 Bits");
    expect(fmtBits(1500)).toBe("1,500 Bits");
    expect(fmtBits(-3)).toBe("0 Bits");
  });
});

// ── The mock door ─────────────────────────────────────────────────────────
describe("MON-1 — the mock store (?store=mock)", () => {
  it("reads the flag off the URL, and only the flag", () => {
    expect(storeMockEnabled("?store=mock")).toBe(true);
    expect(storeMockEnabled("?store=1")).toBe(true);
    expect(storeMockEnabled("?store=on")).toBe(true);
    expect(storeMockEnabled("?seed=7&store=mock")).toBe(true);
    expect(storeMockEnabled("?store=live")).toBe(false);
    expect(storeMockEnabled("?store=0")).toBe(false);
    expect(storeMockEnabled("")).toBe(false);
    expect(storeMockEnabled("?seed=7")).toBe(false);
  });

  it("sells without a platform and without real Bits", async () => {
    setStoreAdapter(liveMock(1000));
    const out = await buyStoreItem("railways");
    expect(out.ok).toBe(true);
    expect(ownsStoreItem("railways")).toBe(true);
    // the fake purse paid
    expect(JSON.parse(localStorage.getItem(STORE_MOCK_KEY)!).balance).toBe(850);
  });

  it("refuses a purchase the purse cannot cover", async () => {
    setStoreAdapter(liveMock(10));
    const out = await buyStoreItem("railways");
    expect(out).toMatchObject({ ok: false, reason: "insufficient-funds" });
    expect(ownsStoreItem("railways")).toBe(false);
  });

  it("the mock adapter is idempotent on a replayed key", async () => {
    const a = createMockStoreAdapter({ storage: null, balance: 500 });
    const first = await a.purchase({ itemId: "railways", price: 150, name: "Railways", idempotencyKey: "k1" });
    const replay = await a.purchase({ itemId: "railways", price: 150, name: "Railways", idempotencyKey: "k1" });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    // charged once, not twice
    expect(await a.readBalance()).toBe(350);
  });
});

// ── Caching ───────────────────────────────────────────────────────────────
describe("MON-1 — entitlement caching", () => {
  it("a bought item is still owned after a reload", async () => {
    setStoreAdapter(liveMock(1000));
    await buyStoreItem("railways");
    expect(ownsStoreItem("railways")).toBe(true);

    // RELOAD: forget every in-memory answer, keep the cache on disk. A fresh
    // module reads it back before the platform has said anything.
    resetStoreForTests({ clearStorage: false });
    expect(ownedStoreItemIds()).toContain("railways");
    expect(storeSnapshot().owned).toContain("railways");
    // …and it survives even when the platform never answers at all.
    setStoreAdapter(deadAdapter());
    await loadStore();
    expect(storeSnapshot().status).toBe("unavailable");
    expect(ownsStoreItem("railways")).toBe(true);
  });

  it("a platform verification ADDS ownership and never removes it", async () => {
    localStorage.setItem(STORE_STORAGE_KEY, JSON.stringify({
      v: 1, owned: ["railways"], purchases: [], pending: [], verifiedAt: 0,
    }));
    resetStoreForTests({ clearStorage: false });
    // The platform knows about a different grant than the cache does.
    setStoreAdapter(scripted({ entitlements: { bridges: 1 } }).adapter);
    const snap = await loadStore();
    expect(snap.owned).toContain("railways");   // the cached grant stands
    expect(snap.owned).toContain("bridges");    // …and the platform's is added
    expect(snap.status).toBe("ready");
    expect(snap.verifiedAt).toBeGreaterThan(0);

    // Now a read that returns NOTHING: the platform is reachable but the
    // ledger came back empty (a fresh account on a shared browser). An
    // unknown answer is never "owns nothing" — nothing is taken away.
    setStoreAdapter(scripted({ entitlements: {} }).adapter);
    const again = await loadStore();
    expect(again.owned).toContain("railways");
    expect(again.owned).toContain("bridges");
  });

  it("an unreadable ledger is UNKNOWN, not empty", async () => {
    setStoreAdapter(scripted({ entitlements: null, balance: null }).adapter);
    const snap = await loadStore();
    expect(snap.status).toBe("unavailable");
    expect(snap.balance).toBeNull();
  });

  it("a corrupt cache file reads as empty instead of throwing", () => {
    localStorage.setItem(STORE_STORAGE_KEY, "{not json");
    resetStoreForTests({ clearStorage: false });
    expect(ownedStoreItemIds()).toEqual([]);
  });

  it("subscribers hear every change", async () => {
    const seen: string[] = [];
    const stop = subscribeStore((s) => seen.push(s.status));
    setStoreAdapter(liveMock(1000));
    await loadStore();
    await buyStoreItem("bridges");
    stop();
    expect(seen[0]).toBe("mock");
    expect(seen.length).toBeGreaterThan(1);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────
describe("MON-1 — idempotency", () => {
  it("mints one key per attempt and re-sends it when that attempt is retried", async () => {
    const { adapter, calls } = scripted({
      purchases: [
        { ok: false, reason: "error", balance: 500 },   // the tab died mid-call
        { ok: true, reason: null, balance: 350 },        // the retry goes through
      ],
    });
    setStoreAdapter(adapter);
    const first = await buyStoreItem("railways");
    expect(first).toMatchObject({ ok: false, reason: "error" });
    expect(calls).toHaveLength(1);
    const key = first.idempotencyKey!;

    // The failed attempt is still pending — and the retry REUSES its key
    // rather than opening a second charge.
    expect(storeSnapshot().pending.map((p) => p.key)).toContain(key);
    const second = await buyStoreItem("railways");
    expect(second.idempotencyKey).toBe(key);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([key, key]);
    expect(second.ok).toBe(true);
    expect(storeSnapshot().pending).toEqual([]);
  });

  it("charges once when the same buy is asked for twice at the same time", async () => {
    const { adapter, calls } = scripted();
    setStoreAdapter(adapter);
    const [a, b] = await Promise.all([buyStoreItem("railways"), buyStoreItem("railways")]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(calls).toHaveLength(1);                       // one charge, two answers
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
  });

  it("an already-owned item is free — no round trip, no charge", async () => {
    const { adapter, calls } = scripted();
    setStoreAdapter(adapter);
    await buyStoreItem("railways");
    calls.length = 0;
    const out = await buyStoreItem("railways");
    expect(out).toMatchObject({ ok: true, alreadyOwned: true });
    expect(calls).toHaveLength(0);
  });

  it("a refusal that charged nothing drops the pending attempt", async () => {
    const { adapter } = scripted({
      purchases: [{ ok: false, reason: "user-cancelled", balance: 500 }],
    });
    setStoreAdapter(adapter);
    const out = await buyStoreItem("railways");
    expect(out).toMatchObject({ ok: false, reason: "user-cancelled" });
    // the platform swore no charge happened, so a retry starts a NEW attempt
    expect(storeSnapshot().pending).toEqual([]);
    expect(ownsStoreItem("railways")).toBe(false);
  });

  it("an undeclared item is refused without a charge", async () => {
    const { adapter, calls } = scripted();
    setStoreAdapter(adapter);
    const out = await buyStoreItem("not_in_the_catalogue");
    expect(out).toMatchObject({ ok: false, reason: "unknown-item" });
    expect(calls).toHaveLength(0);
  });
});

// ── Unavailable store ─────────────────────────────────────────────────────
describe("MON-1 — the store that cannot be reached", () => {
  it("says so, buys nothing, and never throws", async () => {
    setStoreAdapter(deadAdapter());
    const snap = await loadStore();
    expect(snap.status).toBe("unavailable");
    expect(snap.balance).toBeNull();
    const out = await buyStoreItem("railways");
    expect(out).toMatchObject({ ok: false, reason: "unavailable" });
    expect(ownsStoreItem("railways")).toBe(false);
    expect(storeSnapshot().lastError).toBe("unavailable");
  });

  it("a purchase that throws is a failure, not a crash", async () => {
    setStoreAdapter({
      kind: "platform",
      available: () => true,
      readBalance: async () => 500,
      readEntitlements: async () => ({}),
      purchase: async () => { throw new Error("host frame went away"); },
    });
    const out = await buyStoreItem("railways");
    expect(out).toMatchObject({ ok: false, reason: "error" });
    expect(ownsStoreItem("railways")).toBe(false);
  });
});

// ── The panel ─────────────────────────────────────────────────────────────
describe("MON-1 — the store panel", () => {
  let host: HTMLDivElement;
  let panel: StorePanelHandle | null = null;

  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); });
  afterEach(() => {
    panel?.destroy();
    panel = null;
    host.remove();
    document.querySelectorAll(".store-sheet").forEach((n) => n.remove());
  });

  const row = (id: string) => host.querySelector(`.store-row[data-item="${id}"]`) as HTMLElement;
  const button = (id: string) => row(id).querySelector(".store-buy") as HTMLButtonElement;

  it("lists every catalogue item with its price and what it unlocks", () => {
    setStoreAdapter(liveMock(1000));
    panel = showStorePanel(host);
    for (const item of STORE_ITEMS) {
      expect(row(item.id)).toBeTruthy();
      expect(row(item.id).querySelector(".store-name")!.textContent).toBe(item.name);
      expect(row(item.id).querySelector(".store-price")!.textContent).toBe(fmtBits(item.price));
      expect(row(item.id).querySelector(".store-unlocks")!.textContent).toBe(item.unlocks);
    }
    expect(host.querySelectorAll(".store-row").length).toBe(STORE_ITEMS.length);
  });

  it("buys: the row goes from Buy to Owned and says so", async () => {
    setStoreAdapter(liveMock(1000));
    panel = showStorePanel(host);
    expect(button("railways").textContent).toBe("Buy");
    button("railways").click();
    // settle the async buy
    await vi.waitFor(() => expect(button("railways").textContent).toBe("Owned"));
    expect(row("railways").classList.contains("owned")).toBe(true);
    expect(row("railways").querySelector(".store-rowmsg")!.textContent).toMatch(/it is yours/i);
    expect(ownsStoreItem("railways")).toBe(true);
  });

  it("an unreachable store paints Unavailable and disables every Buy", async () => {
    setStoreAdapter(deadAdapter());
    panel = showStorePanel(host);
    await vi.waitFor(() => expect(host.querySelector("[data-store-note]")!.textContent).toMatch(/not reachable/i));
    for (const item of STORE_ITEMS) {
      expect(button(item.id).textContent).toBe("Unavailable");
      expect(button(item.id).disabled).toBe(true);
    }
    // …and it says nothing is locked, because nothing is.
    expect(host.querySelector("[data-store-note]")!.textContent).toMatch(/nothing here is locked/i);
  });

  it("a refused purchase reports that nothing was charged", async () => {
    setStoreAdapter(createMockStoreAdapter({ storage: null, balance: 5 }));
    panel = showStorePanel(host);
    button("railways").click();
    await vi.waitFor(() => expect(row("railways").querySelector(".store-rowmsg")!.textContent).not.toBe(""));
    expect(row("railways").querySelector(".store-rowmsg")!.textContent).toMatch(/not enough bits/i);
    expect(button("railways").textContent).toBe("Buy");   // still offered, still honest
  });

  it("closes on Done and on Escape, and leaves nothing behind", async () => {
    setStoreAdapter(liveMock(1000));
    panel = showStorePanel(host);
    let closed = false;
    void panel.promise.then(() => { closed = true; });
    (host.querySelector(".store-modal .big-btn") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(host.querySelector(".store-sheet")).toBeNull();

    panel = showStorePanel(host);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector(".store-sheet")).toBeNull());
    panel = null;
  });
});
