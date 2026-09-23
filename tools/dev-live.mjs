#!/usr/bin/env node
// `npm run dev:live` — the Vite dev server, kept in step with GitHub.
//
// Vite already hot-reloads when a file changes. This adds the other half: every
// POLL_S seconds it fetches origin, and when the current branch's upstream has
// new commits it fast-forwards (`git pull --ff-only`). The pulled files land on
// disk, Vite sees them and the open game reloads. When package-lock.json moved,
// it runs `npm install` and restarts Vite so new dependencies are picked up.
//
// It never merges, rebases or discards anything: if the pull cannot
// fast-forward (local commits, or a local edit to a file that changed), it says
// so and keeps serving what is on disk.
//
//   npm run dev:live                 (port 5173, poll every 30 s)
//   npm run dev:live -- --port 4200 --poll 10
//
// One dev server at a time: the run.game SDK plugin also listens on port 9001,
// so a second `vite` (or `npm run dev`) beside this one fails with EADDRINUSE.
import { spawn, execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PORT = arg("port", "5173");
const POLL_S = Number(arg("poll", "30"));

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const log = (msg) => console.log(`\x1b[36m[dev:live]\x1b[0m ${msg}`);

let vite = null;
function startVite() {
  vite = spawn(`npx vite --port ${Number(PORT)} --host`, { stdio: "inherit", shell: true });
  vite.on("exit", (code) => { if (!restarting) process.exit(code ?? 0); });
}
let restarting = false;
function restartVite() {
  if (!vite) return;                     // not started yet: it starts on the new deps
  restarting = true;
  vite.once("exit", () => { restarting = false; startVite(); });
  vite.kill();
}

function poll() {
  try {
    const upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
    git("fetch", "--quiet");
    const behind = Number(git("rev-list", "--count", `HEAD..${upstream}`));
    if (!behind) return;
    const before = git("rev-parse", "HEAD");
    log(`${behind} new commit(s) on ${upstream} — pulling…`);
    try {
      git("pull", "--ff-only", "--quiet");
    } catch (err) {
      log(`could not fast-forward (local commits or edits in the way) — still serving what is on disk.\n${String(err.stderr ?? err).trim()}`);
      return;
    }
    const changed = git("diff", "--name-only", before, "HEAD").split("\n");
    log(`updated to ${git("log", "-1", "--format=%h %s")}`);
    if (changed.includes("package-lock.json") || changed.includes("package.json")) {
      log("dependencies changed — npm install, then restarting Vite");
      execFileSync("npm install", { stdio: "inherit", shell: true });
      restartVite();
    }
  } catch (err) {
    log(`poll skipped: ${String(err.stderr ?? err.message ?? err).trim().split("\n")[0]}`);
  }
}

log(`serving on http://localhost:${PORT} — checking GitHub every ${POLL_S}s`);
poll();
startVite();
setInterval(poll, POLL_S * 1000);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { vite?.kill(); process.exit(0); });
