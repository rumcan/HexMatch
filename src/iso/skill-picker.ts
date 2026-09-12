// ══════════════════════════════════════════════════════════════════════════
// AI-02 — the start-of-game difficulty prompt.
//
// The player asked for it verbatim: "make the player select the difficulty
// at the start of the game". AI-01 put three presets behind a top-bar
// selector, which is exactly the kind of quietly-correct UI nobody finds
// mid-game — so the FIRST session of a boot now opens with the choice where
// it cannot be missed.
//
// When does the prompt appear? When no difficulty has been EXPLICITLY chosen
// yet: a `?rival=` URL (playtest links, saved seeds) or a remembered
// localStorage choice both count as "the player already said" — the resolver
// (src/iso/skill.ts) would use them anyway, and re-asking on every boot of a
// game whose difficulty never changes would be nag, not onboarding. The
// top-bar selector remains the way to change your mind mid-game.
//
// The pick is written through the same `setRivalSkillActive` the top bar
// uses, so boot, selector, and prompt can never disagree about what the
// game runs.
// ══════════════════════════════════════════════════════════════════════════
import {
  RIVAL_SKILLS, SKILL_KEYS, SKILL_STORAGE_KEY, resolveSkillKey,
  type SkillKey,
} from "./skill";

export interface RivalSkillPromptOptions {
  /** Injectable search string (`?seed=…&rival=hard`) — tests drive it. */
  search?: string;
  /** Injectable storage — tests drive it. */
  storage?: Pick<Storage, "getItem"> | null;
  /** Persistence hook — default writes storage; game.ts swaps in its own
   *  `setRivalSkill` so the LIVE game's difficulty flips too, not just the
   *  next boot's. */
  onPick?: (key: SkillKey) => void;
}

/** True when boot should ask, i.e. neither the URL nor storage named a key. */
const valid = (raw: string | null): boolean =>
  !!raw && (SKILL_KEYS as string[]).includes(raw);

export function shouldPromptForSkill(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): boolean {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  if (valid(new URLSearchParams(rawSearch).get("rival"))) return false;  // URL pins it
  // a remembered choice counts only if the RESOLVER would honour it — a
  // corrupted value must fall through to the prompt, not silence it forever
  return !(storage && valid(storage.getItem(SKILL_STORAGE_KEY)));
}

/** One display card per preset, in the HUD's left-to-right order. */
const CARD_TEXT: Record<SkillKey, { pace: string }> = {
  easy: { pace: "≈14s between moves · never raids · easy market" },
  normal: { pace: "≈9s between moves · raids every couple of minutes" },
  hard: { pace: "≈5s between moves · expands twice a turn · raids often" },
};

/**
 * AI-04: the finish line is a difficulty lever now, so each card states it —
 * picking "Easy" is picking a 5★ race, and the player should see that before
 * the click rather than in the HUD afterwards.
 */
const lineText = (key: SkillKey): string => `first to ${RIVAL_SKILLS[key].winTarget}★ wins`;

/**
 * Show the three-preset chooser over `host` and resolve when the player
 * clicks. A no-op (the function returns without rendering anything) when a
 * difficulty was already pinned through the URL or remembered in storage —
 * see the module header for the reasoning.
 */
export function promptForRivalSkill(
  host: HTMLElement, opts: RivalSkillPromptOptions = {},
): Promise<SkillKey | null> {
  const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
  const storage = opts.storage
    ?? (typeof localStorage !== "undefined" ? localStorage : null);
  if (!shouldPromptForSkill(search, storage)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "iso-skill-prompt";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Choose your rival's difficulty");
    overlay.innerHTML = `<div class="iso-skill-card">
      <h2>Choose your rival</h2>
      <p class="iso-skill-sub">Your opponent plans its own network beside yours —
         first to the star line wins. How sharp should it be?</p>
      <div class="iso-skill-choices"></div>
      <p class="iso-skill-foot">You can change this any time from the top bar —
         the game also remembers it for next time.</p>
    </div>`;
    const choices = overlay.querySelector(".iso-skill-choices")!;
    const current = resolveSkillKey(search, storage);
    for (const key of SKILL_KEYS) {
      const preset = RIVAL_SKILLS[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `iso-skill-choice${key === current ? " iso-skill-current" : ""}`;
      btn.dataset.skill = key;
      // SFX-01: choosing a rival is a pick, not a click — the same small glass
      // ping the board's gems and the start screen's tycoons use.
      btn.dataset.sfx = "select";
      btn.innerHTML = `<span class="iso-skill-label">${preset.label}</span>
        <span class="iso-skill-blurb">${preset.blurb}</span>
        <span class="iso-skill-pace">${CARD_TEXT[key].pace} · ${lineText(key)}</span>`;
      btn.addEventListener("click", () => {
        (opts.onPick ?? rememberSkill)(key);
        overlay.remove();
        resolve(key);
      });
      choices.appendChild(btn);
      if (key === current) setTimeout(() => btn.focus());
    }
    host.appendChild(overlay);
  });
}

/** Write the choice where the boot resolver will find it on the next boot. */
export function rememberSkill(key: SkillKey): void {
  try { localStorage.setItem(SKILL_STORAGE_KEY, key); } catch { /* private mode */ }
}
