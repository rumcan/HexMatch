# MOBILE_QA.md — Real-Device Checklist for MOB-1

**Design wave (lead, 2026-09-26).** Part of the design plan in the tracking issue.
RUN store and real-money work are out of scope.

---

## Device Matrix

| Device | OS | Browser | Viewport (CSS px) | DPR | Status |
|---|---|---|---|---|---|
| iPhone 15 Pro | iOS 17+ | Safari | 390×844 | 3 | ☐ |
| iPhone 15 Pro Max | iOS 17+ | Safari | 430×932 | 3 | ☐ |
| iPhone SE (3rd) | iOS 17+ | Safari | 375×667 | 2 | ☐ |
| Pixel 8 | Android 14 | Chrome | 393×851 | 2.75 | ☐ |
| Pixel 8 Pro | Android 14 | Chrome | 412×915 | 3.5 | ☐ |
| Galaxy S24 | Android 14 | Chrome | 360×800 | 3 | ☐ |
| Galaxy S24 Ultra | Android 14 | Chrome | 412×915 | 3.5 | ☐ |
| iPad Mini | iPadOS 17+ | Safari | 744×1133 | 2 | ☐ |
| iPad Pro 12.9" | iPadOS 17+ | Safari | 1024×1366 | 2 | ☐ |

---

## 1. Tap Target Audit (≥44×44 CSS px)

**Automated test:** `tests/unit/mobile-474-targets.test.ts` — runs at 390×844 viewport.

### Manual Verification (per device)

| Control | Location | Min Size | iPhone 15 Pro | Pixel 8 | Galaxy S24 | iPad Mini | Notes |
|---|---|---|---|---|---|---|---|
| Build tool buttons (Dirt, Street, Road, Highway, Depot, Plant, Rail, Platform, Demolish) | Build sheet | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Tool group headers (Road Ways, Rail Ways) | Build sheet | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Bottom nav (Map, Build, Economy) | Mobile nav bar | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Tab strip (Bank, Market, Black Market, Feed, Quests) | Economy sheet | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Bank exchange selects (Give, Want) | Economy → Bank | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Bank Exchange button | Economy → Bank | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Market Sell buttons (1, 10, All) | Economy → Market | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Offer Post / Accept / Cancel | Economy → Market | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Black Market sabotage buttons | Economy → Black Market | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Security Forces button | Economy → Black Market | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| FAB cluster (Minimap, Zoom +, Zoom −, Recenter) | Map view (right edge) | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Held tool chip (label + ✕) | Map view (bottom-left) | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Modebar cancel ✕ | Map view (above resbar) | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Depot card actions (Upgrade, Retune, Close) | Bottom-center card | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Tuning session (Finish, Abandon) | Session window | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Tuning results Confirm | Results popup | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Guide strip (Next, Back, Skip, End) | Guide overlay | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Guide menu section rows | ☰ → Tutorial | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| ☰ menu rows (Settings, How to Play, Quit) | Top-right ☰ | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Settings sheet controls | Settings | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Chat input / Send / Presets | Chat panel | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Chat head toggle | Chat dock | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Radio station / volume / play | Radio dock | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Minimap toggle FAB | FAB cluster | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Toast ✕ dismiss | Toast stack | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Banner ✕ dismiss | Banner bar | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Objective dismiss | Objective bar | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Quest dismiss / hide | Quest panel | 44×44 | ☐ | ☐ | ☐ | ☐ | |
| Voice skip / line skip | Voice subtitle | 44×44 | ☐ | ☐ | ☐ | ☐ | |

---

## 2. Bottom Sheets (One-Thumb Reach)

### Build Sheet (`data-view="build"`)
- **Trigger:** Bottom nav "Build" button (🏗)
- **Content:** Full tool list (Road Ways, Rail Ways groups + standalone tools)
- **Thumb zone:** Bottom 40% of screen
- **Dismiss:** Tap Map/Trade nav, tap backdrop, drag down, Esc
- **Status:** ☐ Implemented ☐ Verified on all devices

### Economy Sheet (`data-view="trade"`)
- **Trigger:** Bottom nav "Economy" button (⇄)
- **Content:** Tab strip (Bank, Market, Black Market, Feed, Quests) + pane content
- **Thumb zone:** Bottom 40% (tab strip), content scrolls
- **Dismiss:** Tap Map/Build nav, tap backdrop, drag down, Esc
- **Status:** ☐ Implemented ☐ Verified on all devices

### Contracts Sheet
- **Trigger:** (Future — guide targets resolve here)
- **Content:** Active contracts, available contracts, history
- **Thumb zone:** Bottom 40%
- **Status:** ☐ Not yet implemented ☐ Verified on all devices

---

## 3. Drag Building — Hold-Then-Drag

**Spec:**
- Tap-and-hold ≥ 300ms on map → arm drag mode with visible start marker
- Drag moves ghost; release → confirm placement (shows confirm button)
- Two-finger pan (pinch/zoom) **never** builds — only camera
- Visual feedback: start marker pulse, ghost follows finger, valid/invalid tint

### Implementation Checklist

| Feature | Location | Status |
|---|---|---|
| Hold gesture detection (≥300ms) | `src/iso/game.ts` pointer handlers | ☐ |
| Start marker (pulse ring at hold origin) | `src/iso/placement.ts` overlay | ☐ |
| Ghost follows single finger | `src/iso/game.ts` drag logic | ☐ |
| Two-finger pan → camera only, no build | `src/iso/camera.ts` gesture state | ☐ |
| Release → confirm button (not instant build) | UI confirm sheet | ☐ |
| Valid placement: green tint + confirm enabled | Placement plan `valid` flag | ☐ |
| Invalid placement: red tint + confirm disabled | Placement plan `code`/`why` | ☐ |
| Cancel via ✕ / Esc / backdrop tap | Hooks `onTool("select")` | ☐ |

---

## 4. Placement Assist — Confirm-to-Place

**Spec (from BUILD-1 dependency):**
- Legal-spot tint extra visible on phones (thicker, higher contrast)
- A "Confirm" button appears for a placement instead of instant tap-build
- Guide targets resolve to phone sheets

### Implementation Checklist

| Feature | Location | Status |
|---|---|---|
| Phone-specific legal tint (thicker stroke, brighter) | `theme-space-age.css` `[data-phone="1"]` | ☐ |
| Confirm button sheet (bottom-center, thumb reach) | New component in `ui.ts` | ☐ |
| Confirm button: enabled only when `plan.valid === true` | `placement.ts` plan | ☐ |
| Confirm action → `hooks.onTool` with placement coords | `game.ts` build handler | ☐ |
| Cancel button on confirm sheet | Same sheet | ☐ |
| Guide step targets → phone sheet selectors | `guide/sections.ts` selectors | ☐ |

---

## 5. Guide Targets → Phone Sheets

**Current desktop selectors** (from `guide/sections.ts`):
- `[data-tool="dirt"]`, `[data-tool="road"]`, etc. → Build panel buttons
- `.tab[data-tab="bank"]`, `.tab[data-tab="market"]`, etc. → Right rail tabs
- `#iso-aside-left`, `#iso-aside-right` → Rail panels

**Phone sheet selectors needed:**
- Build sheet: `.mnav-btn[data-view="build"]` opens sheet, then `[data-tool="..."]` inside
- Economy sheet: `.mnav-btn[data-view="trade"]` opens sheet, then `.tab[data-tab="..."]`
- Contracts sheet: `.mnav-btn[data-view="contracts"]` (new)

**Action:** Update `targetSelectors` in `guide/engine.ts` and section steps in `guide/sections.ts` to use phone-aware selectors when `isPhoneViewport()`.

---

## 6. Real-Device Sign-Off

**Lead:** ________________________  
**Date:** ________________________

| Device | Tap Targets Pass | Bottom Sheets Work | Drag Build Works | Confirm-to-Place Works | Guide Resolves | Notes |
|---|---|---|---|---|---|---|
| iPhone 15 Pro | ☐ | ☐ | ☐ | ☐ | ☐ | |
| iPhone 15 Pro Max | ☐ | ☐ | ☐ | ☐ | ☐ | |
| iPhone SE | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Pixel 8 | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Pixel 8 Pro | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Galaxy S24 | ☐ | ☐ | ☐ | ☐ | ☐ | |
| Galaxy S24 Ultra | ☐ | ☐ | ☐ | ☐ | ☐ | |
| iPad Mini | ☐ | ☐ | ☐ | ☐ | ☐ | |
| iPad Pro 12.9" | ☐ | ☐ | ☐ | ☐ | ☐ | |

**Overall MOB-1 Acceptance:** ☐ PASS / ☐ FAIL  
**Lead Signature:** ________________________  
**Date:** ________________________