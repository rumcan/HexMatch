// ══════════════════════════════════════════════════════════════════════════
// The game version shown at the foot of the main menu.
//
// RUN.world assigns the version at DEPLOY time (1.7.0, 1.8.0…), after the
// build has already been made, so it cannot be baked in. It serves each
// version from a folder named after it — `…/1.7.0/index.html` — so the page's
// own URL carries it. Locally (vite dev / preview) there is no such folder and
// the label says "dev".
//
// The build id is the short git commit, injected by vite.config.ts, so a
// screenshot always says exactly which code is running.
// ══════════════════════════════════════════════════════════════════════════

/** The RUN.world version folder in a path, e.g. "/1.7.0/index.html" → "1.7.0". */
export function versionFromPath(pathname: string): string | null {
  const m = /\/(\d+\.\d+\.\d+)(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}

/** "v1.7.0 · f0e2103" on RUN.world, "dev · f0e2103" anywhere else. */
export function gameVersionLabel(pathname: string, buildId: string | null): string {
  const version = versionFromPath(pathname);
  const head = version ? `v${version}` : "dev";
  return buildId ? `${head} · ${buildId}` : head;
}

/** The label for the running page. Safe in tests, where no build id is defined. */
export function currentVersionLabel(): string {
  const id = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : null;
  const path = typeof location !== "undefined" ? location.pathname : "";
  return gameVersionLabel(path, id);
}
