import { defineConfig, devices } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// #132 — the desktop multiplayer e2e: two real browsers, one real room.
//
// A SEPARATE CONFIG, not another project in `playwright.config.ts`, because the
// two suites need different servers and Playwright starts every `webServer` a
// run declares:
//
//   playwright.config.ts   `vite preview` of the BUILT app (port 4173) — the
//                          browser suite, which asserts on shipped output.
//   THIS file              `vite dev` (port 5173) — the only place the local
//                          room sidecar exists at all. The multiplayer plugin
//                          injects its origin on `serve` only, and
//                          docs/multiplayer-local-testing.md §6 is explicit
//                          that a previewed build answers with the SDK's
//                          offline mock — two mocked rooms would not prove
//                          anything about the room lifecycle.
//
// So `npm run test:e2e:mp` runs this file, and `npm run test:e2e` runs the
// preview suite; neither drags the other's server along.
//
// The room the sidecar runs is `rundot/realtime.e2e.config.json`: same room
// bundle as production with the suite's own `reconnectTimeout` (the shipped
// 60s — see vite.config.ts → `devRoomsConfigPath`). Everything else about the
// transport is production: `src/net/transport.ts`, the SDK adapter, and the
// real `src/rooms/HexmatchRoom.ts` compiled and run by the sidecar.
// ══════════════════════════════════════════════════════════════════════════

export const MP_BASE = "/hexmatch/";
/** The dev server the suite starts (and the harness points its two contexts at).
 *  `PW_MP_PORT` exists for the one case that needs it: proving the suite fails
 *  when the room it expects is not there (a black hole on the sidecar's port,
 *  `docs/multiplayer-local-testing.md` §8), or simply a busy 5173. */
export const MP_PORT = Number(process.env.PW_MP_PORT ?? 0) || 5173;
export const MP_ORIGIN = `http://localhost:${MP_PORT}`;

/** Booting two software-rasterized clients is slow on a shared runner. */
const BOOT_BUDGET = Number(process.env.PW_MP_BOOT_BUDGET ?? 0) || 90_000;
/** One test can boot a pair, play a match and end it — the boot budget plus room. */
const TEST_TIMEOUT = Number(process.env.PW_MP_TIMEOUT ?? 0) || BOOT_BUDGET * 4;

export default defineConfig({
  testDir: "./tests/e2e-mp",
  timeout: TEST_TIMEOUT,
  // The suite shares one live room between its steps by design (#132: "two
  // contexts demonstrably exchange authoritative state through the room
  // service"), so it is serial and single-worker.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-mp" }]],
  outputDir: "test-results-mp",
  expect: { timeout: 30_000 },
  use: {
    // Two clients booting software-rasterized art: a UI action that cannot
    // complete should fail ITS step with a message and a trace, not sit until
    // the whole test budget is gone.
    actionTimeout: 20_000,
    baseURL: `${MP_ORIGIN}${MP_BASE}`,
    // #132: "Save useful traces and console errors on failure." Traces are kept
    // whenever a test fails (retries too — the first failure's trace is the one
    // worth having); the specs also attach both pages' console + room-wire logs.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Network-restricted environments (sandboxes, air-gapped CI) cannot reach
      // the Playwright CDN to `npx playwright install chromium`. Point
      // PW_CHROMIUM_EXECUTABLE at any locally available Chromium/Chrome binary
      // to run the suite against it; unset (the normal case, CI included) uses
      // the Playwright-managed browser.
      executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
      // Software GL: the same flags the preview suite runs with, so the two
      // suites see the same renderer. `--mute-audio` keeps the synthesised mix
      // out of the runner's ears; the graph still builds, so an audio
      // regression still fails a spec.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
    },
  },
  projects: [
    {
      name: "desktop-multiplayer",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
        // The offer tray (the market's "Take" button) is `display: none` under
        // 1320px — a phone fits the board, not the cards — so a desktop
        // multiplayer spec must be wider than that or it cannot take an offer.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${MP_PORT} --strictPort`,
    url: `${MP_ORIGIN}${MP_BASE}`,
    env: {
      // The suite's own rooms file: it pins the reconnect grace the departure
      // specs wait on, instead of inheriting whatever the shipped file says.
      RUNDOT_DEV_ROOMS_CONFIG: "rundot/realtime.e2e.config.json",
    },
    // Never reuse a dev server: one started by hand (or by a previous run) may
    // be on the SHIPPED rooms config, and the disconnect specs would then pass
    // only by luck. A busy port is an honest error, not something to paper over.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
