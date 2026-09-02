import { defineConfig, devices } from "@playwright/test";

// Headless e2e against the real built game served by `vite preview` (#3/#4).
// The app is served under base "/hexmatch/", so every URL includes that prefix.
const BASE = "/hexmatch/";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:4173${BASE}`,
    trace: "on-first-retry",
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], channel: undefined },
    },
    {
      name: "iphone",
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
    url: "http://localhost:4173/hexmatch/",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

export { BASE };
