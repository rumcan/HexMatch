import { defineConfig, devices } from "@playwright/test";

// Headless e2e against the real built game served by `vite preview` (#3/#4).
// The app is served under base "/", so every URL includes that prefix.
const BASE = "/";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:4173${BASE}`,
    // #324 sends a brand-new browser straight into a coached first game,
    // skipping the menu every spec clicks through. Specs start as a player
    // who has been here before; a spec that tests the first launch clears it
    // with `test.use({ storageState: { cookies: [], origins: [] } })`.
    storageState: "tests/e2e/onboarded.storage.json",
    trace: "on-first-retry",
    launchOptions: {
      // Network-restricted environments (sandboxes, air-gapped CI) cannot
      // reach the Playwright CDN to `npx playwright install chromium`. Point
      // PW_CHROMIUM_EXECUTABLE at any locally available Chromium/Chrome
      // binary to run the suite against it; unset (the normal case, and
      // GitHub Actions) uses the Playwright-managed browser.
      executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
      // `--mute-audio`: SFX-01 gave the game a synthesised mix, and an e2e run
      // clicks through several full matches. The cues still run (the Web Audio
      // graph is built exactly as in a real session, so a regression in it still
      // fails a spec) — they simply never reach a speaker on the runner.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--mute-audio"],
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], channel: undefined },
    },
    // MOBILE-01: the phone projects rasterize the island at dpr 2-3 in
    // software on a CDN-blocked runner, where a boot alone can take a minute
    // (see tests/e2e/boot.ts). Give their tests the room the pixels need;
    // desktop keeps the 30s the suite has always run under.
    {
      name: "iphone",
      timeout: 150000,
      use: {
        ...devices["iPhone 13"],       // 390×844, hasTouch, isMobile, webkit engine UA
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: "android-small",
      timeout: 150000,
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        viewport: { width: 360, height: 640 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "android-landscape",
      timeout: 150000,
      use: {
        browserName: "chromium",
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

export { BASE };
