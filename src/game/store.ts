// ══════════════════════════════════════════════════════════════════════════
// MON-1 (#367) — the RUN Bits store: entitlements, purchases, cache, mock.
//
// This module OWNS what a player owns and nothing else. The platform (RUN) is
// the ledger of record — it holds the Bits and mints the entitlement — so the
// rules here are about being honest in between reads:
//
//   1. LOCAL FIRST, ALWAYS. The cache in localStorage is read synchronously,
//      so `owns()` is true the instant the module is asked, with no network,
//      no await, and no boot dependency. A purchase also writes the grant
//      here BEFORE it is reported back, so a reload right after a receipt
//      still shows the item owned.
//   2. VERIFY IS UNION, NEVER SUBTRACTION. A platform read can only ADD
//      ownership. If the network cannot answer, `readEntitlements` resolves
//      null — and null means UNKNOWN, never "owns nothing". Taking an unlock
//      away because a read failed is the one bug a player would never forgive
//      us for; revocation is a support job and a follow-up, not this module's.
//   3. THE STORE IS NEVER A GATE. Every path resolves. An unavailable store
//      paints "unavailable" in the panel and the island keeps running (§1: an
//      unlockable must never hold the game hostage).
//   4. NO SDK HERE. This file reaches no part of the RUN.world SDK package —
//      not even `transport.ts` statically. `tests/unit/net-protocol.test.ts`
//      pins that package to `src/net/transport.ts` and the server room (its
//      text search is why this sentence does not name it), and the platform
//      adapter is pulled in by a DYNAMIC import so the store's own logic
//      stays testable in plain node/jsdom with a fake.
//
// MON-1 gates NOTHING: every catalogue item is `enforced: false`. MON-2 flips
// the first one and calls `owns()`; nothing else in the game has to change.
// ══════════════════════════════════════════════════════════════════════════
import { STORE_ITEM_IDS, storeItem, type StoreItemDef } from "../iso/config";

// ── Shapes ────────────────────────────────────────────────────────────────

export type StoreStatus = "loading" | "ready" | "unavailable" | "mock";

/** Why a buy did not go through. `null` means it did. */
export type StoreFailure = "unavailable" | "user-cancelled" | "insufficient-funds" | "unknown-item" | "error";

export interface StoreSnapshot {
  /** `loading` before the first platform answer, then ready / mock / unavailable. */
  status: StoreStatus;
  /** Item ids this player owns (cached grants ∪ verified entitlements). */
  owned: readonly string[];
  /** Bits on the purse, or null when the purse cannot be read. */
  balance: number | null;
  /** The last failure the panel should say out loud, or null. */
  lastError: StoreFailure | null;
  /** Epoch ms of the last successful platform verification (0 = never). */
  verifiedAt: number;
  /** Items with a buy in flight — the panel dims their buttons. */
  purchasing: readonly string[];
  /**
   * Attempts whose outcome is unknown (the tab died mid-purchase). They are
   * NOT retried automatically — a second charge is worse than a slower one —
   * but the next `buyStoreItem` for that item re-sends the SAME key.
   */
  pending: readonly StoreReceipt[];
}

/** A finished or unfinished purchase attempt, keyed by our idempotency key. */
export interface StoreReceipt {
  itemId: string;
  key: string;
  at: number;
}

export interface BuyOutcome {
  ok: boolean;
  reason: StoreFailure | null;
  /** Already owned before the call — no charge, no SDK round trip. */
  alreadyOwned?: boolean;
  /** The key this attempt used (reused on a retry of the same attempt). */
  idempotencyKey?: string;
}

export interface StorePurchaseRequest {
  itemId: string;
  price: number;
  name: string;
  /** One per ATTEMPT: a retry of an unfinished attempt re-sends the same key. */
  idempotencyKey: string;
}

export interface StorePurchaseOutcome {
  ok: boolean;
  reason: StoreFailure | null;
  balance: number | null;
}

/**
 * Everything the store needs from the outside world. Three implementations:
 * the platform adapter (over `src/net/transport.ts`), the mock (`?store=mock`
 * and unit tests), and "none" (no platform — the store is unavailable).
 */
export interface StoreAdapter {
  readonly kind: "platform" | "mock" | "none";
  /** Can this adapter actually sell something right now? */
  available(): boolean;
  readBalance(): Promise<number | null>;
  /** `null` = unknown (never "owns nothing"). */
  readEntitlements(ids: readonly string[]): Promise<Record<string, number> | null>;
  purchase(req: StorePurchaseRequest): Promise<StorePurchaseOutcome>;
  /** Analytics hook — optional, fire-and-forget. */
  record?(event: string, payload?: Record<string, unknown>): void;
}

// ── Storage ───────────────────────────────────────────────────────────────

/** The cached entitlement ledger. */
export const STORE_STORAGE_KEY = "hexmatch:store";
/** The mock store's own purse, so `?store=mock` survives a reload. */
export const STORE_MOCK_KEY = "hexmatch:store-mock";

interface StoreFile {
  v: 1;
  owned: string[];
  purchases: StoreReceipt[];
  pending: StoreReceipt[];
  verifiedAt: number;
}

const EMPTY_FILE: StoreFile = { v: 1, owned: [], purchases: [], pending: [], verifiedAt: 0 };

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    // Private mode / a sandboxed frame: the store still works, it just
    // forgets. Never let storage be the reason a purchase fails.
    return null;
  }
}

/** Read the cache. A corrupt or unreadable blob is an empty one, never a throw. */
function readFile(key = STORE_STORAGE_KEY): StoreFile {
  const raw = safeStorage()?.getItem(key) ?? null;
  if (!raw) return { ...EMPTY_FILE, owned: [], purchases: [], pending: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<StoreFile>;
    return {
      v: 1,
      owned: Array.isArray(parsed.owned) ? parsed.owned.filter((s) => typeof s === "string") : [],
      purchases: Array.isArray(parsed.purchases) ? parsed.purchases.filter(isReceipt) : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending.filter(isReceipt) : [],
      verifiedAt: typeof parsed.verifiedAt === "number" ? parsed.verifiedAt : 0,
    };
  } catch {
    return { ...EMPTY_FILE, owned: [], purchases: [], pending: [] };
  }
}

function isReceipt(r: unknown): r is StoreReceipt {
  const o = r as StoreReceipt | null;
  return !!o && typeof o.itemId === "string" && typeof o.key === "string" && typeof o.at === "number";
}

function writeFile(file: StoreFile): void {
  try {
    safeStorage()?.setItem(STORE_STORAGE_KEY, JSON.stringify(file));
  } catch {
    /* a full or refused store is not a purchase failure */
  }
}

/**
 * One key per ATTEMPT. `crypto.randomUUID` where it exists, a time+random
 * fallback everywhere else (http pages, older webviews, node tests).
 */
export function newIdempotencyKey(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch { /* fall through */ }
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ── Module state (one store per page) ─────────────────────────────────────

let file: StoreFile = readFile();
let status: StoreStatus = "loading";
let balance: number | null = null;
let lastError: StoreFailure | null = null;
let loading: Promise<StoreSnapshot> | null = null;
let attached: StoreAdapter | null = null;
let override: StoreAdapter | null = null;
const purchasing = new Set<string>();
const inflight = new Map<string, Promise<BuyOutcome>>();
const listeners = new Set<(s: StoreSnapshot) => void>();

function snapshot(): StoreSnapshot {
  return {
    status,
    owned: [...file.owned],
    balance,
    lastError,
    verifiedAt: file.verifiedAt,
    purchasing: [...purchasing],
    pending: file.pending.map((r) => ({ ...r })),
  };
}

function notify(): void {
  const snap = snapshot();
  for (const fn of [...listeners]) {
    try { fn(snap); } catch { /* a broken painter must not break the store */ }
  }
}

/** Subscribe to the store. Returns the unsubscribe. */
export function subscribeStore(fn: (s: StoreSnapshot) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The current answer, synchronously. Never throws, never awaits. */
export function storeSnapshot(): StoreSnapshot {
  return snapshot();
}

/** Does this player own the item? Cached — true from the first frame. */
export function ownsStoreItem(itemId: string): boolean {
  return file.owned.includes(itemId);
}

/**
 * Ids of everything owned — the payload a seat's join would carry once an
 * item is actually ENFORCED (MON-2 + the MP follow-up). Nothing sends it yet,
 * and that is deliberate: a wire field nothing reads is a compatibility debt
 * for a gate that does not exist. When MON-2 flips `railways`, this is the
 * list the host trusts per seat — the host still re-verifies through the SDK
 * rather than believing the guest, and a guest can never unlock for the host.
 */
export function ownedStoreItemIds(): readonly string[] {
  return [...file.owned];
}

/** Bits on the purse, or null when nobody has told us. */
export function bitsBalance(): number | null {
  return balance;
}

/**
 * MON-2's hook: true when the item is owned OR nothing gates it yet. MON-1
 * ships every item unenforced, so this is true for all of them — which is the
 * point: the gate is written once and the plumbing is exercised from day one.
 */
export function isStoreItemUnlocked(itemId: string): boolean {
  const item = storeItem(itemId);
  if (!item) return false;         // an undeclared item is never "unlocked"
  if (!item.enforced) return true;
  return ownsStoreItem(itemId);
}

// ── Adapters ──────────────────────────────────────────────────────────────

/** The adapter that cannot sell: no RUN host, no mock, no fake. */
export const NO_STORE_ADAPTER: StoreAdapter = {
  kind: "none",
  available: () => false,
  readBalance: async () => null,
  readEntitlements: async () => null,
  purchase: async () => ({ ok: false, reason: "unavailable", balance: null }),
};

/** The slice of `src/net/transport.ts` the platform adapter needs. Structural, so tests can fake it. */
export interface PlatformStoreTransport {
  isStoreAvailable(): boolean;
  readBitsBalance(): Promise<number | null>;
  readEntitlements(ids: readonly string[]): Promise<Record<string, number> | null>;
  purchaseWithBits(req: {
    productId: string;
    price: number;
    description: string;
    idempotencyKey: string;
  }): Promise<{ ok: boolean; reason: string | null; balance: number | null }>;
  openBitsStore?(): Promise<{ purchased: boolean; balance: number | null } | null>;
  recordStoreEvent?(event: string, payload?: Record<string, unknown>): void;
}

/** Wrap the SDK wrappers (transport.ts) as a store adapter. */
export function createPlatformStoreAdapter(t: PlatformStoreTransport): StoreAdapter {
  return {
    kind: "platform",
    available: () => {
      try { return t.isStoreAvailable(); } catch { return false; }
    },
    readBalance: async () => {
      try { return await t.readBitsBalance(); } catch { return null; }
    },
    readEntitlements: async (ids) => {
      try { return await t.readEntitlements(ids); } catch { return null; }
    },
    purchase: async (req) => {
      const item = storeItem(req.itemId);
      const res = await t.purchaseWithBits({
        productId: req.itemId,
        price: req.price,
        description: item ? item.name : req.name,
        idempotencyKey: req.idempotencyKey,
      });
      return {
        ok: res?.ok === true,
        reason: (res?.reason as StoreFailure | null) ?? (res?.ok ? null : "error"),
        balance: typeof res?.balance === "number" ? res.balance : null,
      };
    },
    record: (event, payload) => {
      try { t.recordStoreEvent?.(event, payload); } catch { /* never fatal */ }
    },
  };
}

export interface MockStoreOptions {
  /**
   * Where the fake purse lives. `undefined` = localStorage (the `?store=mock`
   * path, so a reload keeps the fake purchases); `null` = memory only (unit
   * tests); or a `Storage` of your own.
   */
  storage?: Storage | null;
  /** Starting Bits. Default 1,000 — enough to try every row twice. */
  balance?: number;
  /** Fail the next N purchases with `failReason` (default "error"). */
  failNext?: number;
  failReason?: StoreFailure;
  /** Report the store as unavailable instead of the mock (the "store down" test). */
  unavailable?: boolean;
}

interface MockFile {
  v: 1;
  balance: number;
  /** itemId → quantity owned. */
  entitlements: Record<string, number>;
  ledger: { itemId: string; key: string; price: number; at: number }[];
  /** Keys already charged — the mock is idempotent on a replayed key. */
  keys: string[];
}

const MOCK_START_BALANCE = 1000;

function readMock(storage: Storage | null, startBalance: number): MockFile {
  const raw = storage?.getItem(STORE_MOCK_KEY) ?? null;
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<MockFile>;
      return {
        v: 1,
        balance: typeof p.balance === "number" ? p.balance : startBalance,
        entitlements: (p.entitlements && typeof p.entitlements === "object") ? p.entitlements : {},
        ledger: Array.isArray(p.ledger) ? p.ledger : [],
        keys: Array.isArray(p.keys) ? p.keys : [],
      };
    } catch { /* corrupt mock file: start over */ }
  }
  return { v: 1, balance: startBalance, entitlements: {}, ledger: [], keys: [] };
}

function writeMock(storage: Storage | null, m: MockFile): void {
  try { storage?.setItem(STORE_MOCK_KEY, JSON.stringify(m)); } catch { /* memory-only is fine */ }
}

/**
 * A store that needs no RUN account and no Bits: a fake purse, a fake
 * entitlement ledger, and the same promise shape as the platform. This is
 * BOTH the `?store=mock` dev door and the unit-test fake (`storage: null`
 * keeps it off the page's localStorage entirely).
 */
export function createMockStoreAdapter(opts: MockStoreOptions = {}): StoreAdapter {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const startBalance = opts.balance ?? MOCK_START_BALANCE;
  let fails = opts.failNext ?? 0;
  const failReason = opts.failReason ?? "error";
  const unavailable = opts.unavailable === true;
  // `storage: null` is MEMORY, not amnesia: a mock that forgot its own ledger
  // between two calls could neither be tested nor demonstrate idempotency.
  let mem: MockFile | null = null;
  const load = (): MockFile =>
    storage ? readMock(storage, startBalance) : (mem ??= readMock(null, startBalance));
  const save = (m: MockFile): void => {
    if (storage) writeMock(storage, m);
    else mem = m;
  };

  return {
    kind: "mock",
    available: () => !unavailable,
    readBalance: async () => (unavailable ? null : load().balance),
    readEntitlements: async (ids) => {
      if (unavailable) return null;
      const m = load();
      const out: Record<string, number> = {};
      for (const id of ids) if ((m.entitlements[id] ?? 0) > 0) out[id] = m.entitlements[id];
      return out;
    },
    purchase: async (req) => {
      if (unavailable) return { ok: false, reason: "unavailable", balance: null };
      const m = load();
      // Idempotency: a replayed key is the SAME purchase — answer it again
      // without charging again, exactly as a server-side ledger would.
      if (m.keys.includes(req.idempotencyKey)) {
        m.entitlements[req.itemId] = (m.entitlements[req.itemId] ?? 0) + 1;
        save(m);
        return { ok: true, reason: null, balance: m.balance };
      }
      if (fails > 0) {
        fails -= 1;
        return { ok: false, reason: failReason, balance: m.balance };
      }
      if (m.balance < req.price) {
        return { ok: false, reason: "insufficient-funds", balance: m.balance };
      }
      m.balance -= req.price;
      m.entitlements[req.itemId] = (m.entitlements[req.itemId] ?? 0) + 1;
      m.ledger.push({ itemId: req.itemId, key: req.idempotencyKey, price: req.price, at: Date.now() });
      m.keys.push(req.idempotencyKey);
      save(m);
      return { ok: true, reason: null, balance: m.balance };
    },
  };
}

/**
 * `?store=mock` (or `?store=mock=1|on|true|yes`): run the whole store on the
 * fake adapter so a purchase, a reload and a re-verify can be exercised with
 * no RUN account and no real Bits. `?store=0|off` forces the real platform,
 * which is how you test the "unavailable" panel on a host that has one.
 */
export function storeMockEnabled(search?: string): boolean {
  const s = search ?? (typeof location !== "undefined" && typeof location.search === "string"
    ? location.search
    : "");
  if (!s) return false;
  try {
    const v = (new URLSearchParams(s).get("store") ?? "").trim().toLowerCase();
    if (!v) return false;
    if (["mock", "1", "on", "true", "yes"].includes(v)) return true;
    return false;
  } catch {
    return false;
  }
}

async function resolveAdapter(): Promise<StoreAdapter> {
  if (override) return override;
  if (attached) return attached;
  if (storeMockEnabled()) {
    attached = createMockStoreAdapter();
    return attached;
  }
  try {
    // Dynamic: keeps the SDK (and its `window` at construction) out of this
    // module's static graph, so the store's own logic stays unit-testable.
    const t = await import("../net/transport");
    attached = createPlatformStoreAdapter(t);
  } catch {
    attached = NO_STORE_ADAPTER;
  }
  return attached;
}

/**
 * Point the store at an adapter and forget the one it found. Pass `null` to
 * hand the choice back to the boot (mock flag, then the platform). Tests use
 * this to inject a fake; nothing in the game needs to call it.
 */
export function setStoreAdapter(adapter: StoreAdapter | null): void {
  override = adapter;
  if (adapter) {
    attached = adapter;
    status = adapter.available() ? (adapter.kind === "mock" ? "mock" : "ready") : "unavailable";
  } else {
    attached = null;
    status = "loading";
  }
  notify();
}

// ── Load / verify ─────────────────────────────────────────────────────────

async function verifyWith(a: StoreAdapter): Promise<boolean> {
  const [bal, ent] = await Promise.all([
    a.readBalance().catch(() => null),
    a.readEntitlements(STORE_ITEM_IDS).catch(() => null),
  ]);
  if (typeof bal === "number") balance = bal;
  if (ent) {
    // Union only: a platform read can add ownership, never remove it.
    for (const [id, qty] of Object.entries(ent)) {
      if (qty > 0 && storeItem(id) && !file.owned.includes(id)) file.owned.push(id);
    }
    file.verifiedAt = Date.now();
    writeFile(file);
    return true;
  }
  return typeof bal === "number";
}

/**
 * Boot hook: read the cache, then ask the platform what is really owned.
 * Idempotent and non-blocking — call it and walk away (`void loadStore()`).
 * A second call while the first is in flight shares the first answer.
 */
export function loadStore(): Promise<StoreSnapshot> {
  if (loading) return loading;
  loading = (async () => {
    const a = await resolveAdapter();
    if (a.available()) {
      const ok = await verifyWith(a);
      status = ok ? (a.kind === "mock" ? "mock" : "ready") : "unavailable";
    } else {
      status = "unavailable";
    }
    // An unfinished attempt is never retried here (a second charge is worse
    // than a slow one): verification above is the recovery, and the next
    // `buyStoreItem` for that item re-sends the same key.
    notify();
    return snapshot();
  })().finally(() => { loading = null; });
  return loading;
}

/** Ask again — after a top-up, a tab regaining focus, or a failed buy. */
export async function refreshStore(): Promise<StoreSnapshot> {
  loading = null;
  status = "loading";
  notify();
  return loadStore();
}

// ── Buy ───────────────────────────────────────────────────────────────────

function grant(itemId: string, key: string): void {
  if (!file.owned.includes(itemId)) file.owned.push(itemId);
  file.purchases.push({ itemId, key, at: Date.now() });
  file.pending = file.pending.filter((r) => !(r.itemId === itemId && r.key === key));
  lastError = null;
  writeFile(file);
}

function dropPending(itemId: string, key: string): void {
  file.pending = file.pending.filter((r) => !(r.itemId === itemId && r.key === key));
  writeFile(file);
}

/**
 * Buy one catalogued item.
 *
 * Idempotency, end to end: a key is minted once per ATTEMPT, written to the
 * cache BEFORE the platform is called, and re-sent unchanged if that attempt
 * is retried (a dead tab, a dropped host frame, an impatient second click).
 * A second concurrent call for the same item shares the first promise rather
 * than opening a second charge.
 */
export async function buyStoreItem(itemId: string): Promise<BuyOutcome> {
  const item: StoreItemDef | null = storeItem(itemId);
  if (!item) return { ok: false, reason: "unknown-item" };
  // Already owned: no charge, no round trip, no spinner.
  if (file.owned.includes(itemId)) return { ok: true, reason: null, alreadyOwned: true };
  const running = inflight.get(itemId);
  if (running) return running;

  const attempt = (async (): Promise<BuyOutcome> => {
    purchasing.add(itemId);
    notify();
    try {
      const a = await resolveAdapter();
      if (!a.available()) {
        lastError = "unavailable";
        return { ok: false, reason: "unavailable" };
      }
      // Reuse the key of an unfinished attempt for the same item; otherwise
      // this is a new attempt and it gets a new key.
      const pending = file.pending.find((r) => r.itemId === itemId);
      const key = pending?.key ?? newIdempotencyKey();
      if (!pending) {
        file.pending.push({ itemId, key, at: Date.now() });
        writeFile(file);
      }
      a.record?.("store_purchase_attempt", { itemId, price: item.price, key });

      let res: StorePurchaseOutcome;
      try {
        res = await a.purchase({ itemId, price: item.price, name: item.name, idempotencyKey: key });
      } catch {
        res = { ok: false, reason: "error", balance: null };
      }

      if (res.ok) {
        grant(itemId, key);
        if (typeof res.balance === "number") balance = res.balance;
        a.record?.("store_purchase_success", { itemId, price: item.price, key });
        return { ok: true, reason: null, idempotencyKey: key };
      }

      const reason: StoreFailure = res.reason ?? "error";
      lastError = reason;
      a.record?.("store_purchase_failure", { itemId, price: item.price, key, reason });
      // A refusal the platform swore did not charge is dropped; anything else
      // stays pending so the retry reuses the key instead of double-charging.
      if (reason === "user-cancelled" || reason === "unknown-item") dropPending(itemId, key);
      return { ok: false, reason, idempotencyKey: key };
    } finally {
      purchasing.delete(itemId);
      notify();
    }
  })();

  inflight.set(itemId, attempt);
  try {
    return await attempt;
  } finally {
    inflight.delete(itemId);
  }
}

// ── Test seam ─────────────────────────────────────────────────────────────

/**
 * Wipe the module's memory — state, cache, adapters, listeners. Unit tests
 * call this in `beforeEach`; nothing in the game should.
 *
 * `clearStorage: false` leaves the cached ledger on disk, which is what makes
 * a RELOAD testable: forget everything in memory, read the cache back, and
 * the item bought before the "reload" is still owned.
 */
export function resetStoreForTests(opts: { clearStorage?: boolean } = {}): void {
  if (opts.clearStorage !== false) {
    try { safeStorage()?.removeItem(STORE_STORAGE_KEY); } catch { /* nothing to clear */ }
  }
  // A fresh module READS the cache back — which is what makes a reload
  // testable: forget the memory, keep the disk, and `owns()` is still true.
  file = readFile();
  status = "loading";
  balance = null;
  lastError = null;
  loading = null;
  attached = null;
  override = null;
  purchasing.clear();
  inflight.clear();
  listeners.clear();
}
