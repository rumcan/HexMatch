// ══════════════════════════════════════════════════════════════════════════
// Owner (2026-09-29): "hide multiplayer behind a pin … so I can publish to
// run.world later and test multiplayer in prod". A soft gate, not security:
// the Multiplayer tab stays hidden until this device is unlocked with the PIN
// (tap the version label five times, or open the game once with `?mp=<pin>`).
// Invite links still work — a guest joining a room never needs the PIN.
// The PIN is `VITE_MP_PIN` at build time, "1949" by default.
// ══════════════════════════════════════════════════════════════════════════

const KEY = "hexmatch:mp-unlocked";

export const MP_PIN: string =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MP_PIN) || "1949";

/** Is the Multiplayer menu unlocked on this device? */
export function multiplayerUnlocked(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** Try a PIN; on a match the device stays unlocked. Returns whether it matched. */
export function tryMultiplayerPin(pin: string | null | undefined): boolean {
  if ((pin ?? "").trim() !== MP_PIN) return false;
  try { localStorage.setItem(KEY, "1"); } catch { /* private mode: unlocked for this page only */ }
  unlockedThisPage = true;
  return true;
}

/** Lock the menu again (console: `__mp.lock()`). */
export function lockMultiplayer(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  unlockedThisPage = false;
}

let unlockedThisPage = false;
/** Unlocked on this device, or this page (when storage is blocked). */
export const multiplayerVisible = (): boolean => unlockedThisPage || multiplayerUnlocked();

/** `?mp=<pin>` in the address unlocks once, then the flag is kept. */
export function unlockFromUrl(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  const pin = new URLSearchParams(search).get("mp");
  return pin !== null && tryMultiplayerPin(pin);
}

if (typeof window !== "undefined") {
  unlockFromUrl();
  (window as unknown as Record<string, unknown>).__mp = { lock: lockMultiplayer, visible: multiplayerVisible };
}
