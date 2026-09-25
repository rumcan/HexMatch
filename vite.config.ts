import path from "path";
import { execFile, execSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { rundotMultiplayerPlugin } from "@series-inc/rundot-game-sdk/vite";
import { defineConfig, type Plugin } from "vite";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DEV ONLY. `rundotMultiplayerPlugin` starts the local room sidecar and injects
 * `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__ = "http://localhost:9001"` into the
 * page. That is right for a browser on the dev machine and wrong for any browser
 * that reaches Vite through a tunnel or a sandbox preview (Arena's live preview,
 * ngrok, a codespace port forward): "localhost" there is the VIEWER's machine,
 * which has no sidecar, so every room call fails.
 *
 * Set `RUNDOT_DEV_ROOM_URL` to the public origin that forwards to port 9001 and
 * this rewrites the injected origin — `https://…` becomes `wss://…/ws` for the
 * socket, which the SDK derives by swapping the scheme. Unset, this plugin does
 * nothing at all. Never affects `vite build`: published games talk to RUN.world's
 * hosted room server, not the sidecar.
 */
function devRoomServerOrigin(): Plugin {
  const publicUrl = process.env.RUNDOT_DEV_ROOM_URL?.replace(/\/+$/, "");
  return {
    name: "hexmatch:dev-room-origin",
    apply: "serve",
    transformIndexHtml: {
      // `post` — the sidecar origin is already in the html by the time this runs.
      order: "post",
      handler(html) {
        if (!publicUrl) return html;
        return html.split("http://localhost:9001").join(publicUrl);
      },
    },
  };
}

/**
 * DEV ONLY. Which rooms file the local room sidecar runs.
 *
 * `rundotMultiplayerPlugin()` resolves `rundot/realtime.config.json` on its own,
 * and that is what `npm run dev` uses — unchanged. The multiplayer Playwright
 * suite (`npm run test:e2e:mp`, docs/multiplayer-local-testing.md §8) needs the
 * room's reconnect grace to be a value the SUITE owns rather than one inherited
 * from the shipped file, so `RUNDOT_DEV_ROOMS_CONFIG` points the sidecar at
 * `rundot/realtime.e2e.config.json` for that run. Its `reconnectTimeout` is the
 * shipped 60s: the suite asserts both outcomes of a seat's grace (resumed
 * inside it, evicted after it), and a dropped link on a software-rasterized
 * runner can take tens of seconds just to be noticed, so a shorter grace would
 * make the reconnect spec a coin toss instead of a test.
 *
 * Serve-only by construction — the plugin never starts a sidecar on `vite build`
 * — so a published game is untouched whatever this variable says.
 */
function devRoomsConfigPath(): string | undefined {
  const path = process.env.RUNDOT_DEV_ROOMS_CONFIG?.trim();
  return path || undefined;
}

/**
 * TICKET-B0 (ART-1950S): ship `assets/buildings/` in the production build.
 *
 * `loadBuildingLayers()` (src/iso/atlas.ts) fetches
 * `${BASE_URL}assets/buildings/manifest.json` at RUNTIME — a fetch, not a
 * static import, so Vite neither bundles nor copies those files. Under
 * `vite dev` the request resolves off the project root and everything works;
 * under `vite build` nothing copied `assets/buildings/` into `dist/`, so in
 * every built/deployed copy the manifest 404'd and ALL per-building art
 * silently fell back to the shared sheet.
 *
 * Fix: a static-copy step. Chosen over the bundle-import alternative because
 * the non-gating runtime design is deliberate — the sheet fallback keeps a
 * partial migration fully playable, and authors can drop a PNG in the folder
 * and re-run the tool without a rebuild of the TS graph. This hook copies
 * `assets/buildings/**` into `<outDir>/assets/buildings/` verbatim (no
 * hashing): the runtime fetch path is then identical in dev, preview and
 * deploy. `assets/` is deliberately NOT made `publicDir` — that would
 * deoptimise the bundled atlases and ground textures.
 */
/**
 * VO-1: ship `assets/voice/` (the line script and, once the lead drops them,
 * the MP3s) beside index.html. The runtime fetches
 * `${BASE_URL}assets/voice/<speaker>/<id>.mp3` — a missing file is a subtitle
 * with no sound, but a present file has to actually be in the build.
 */
function copyVoiceLines(): Plugin {
  let outDir = "dist";
  let srcDir = "";
  return {
    name: "hexmatch:voice-lines",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      srcDir = config.root;
    },
    closeBundle() {
      const from = path.resolve(srcDir, "assets", "voice");
      if (!existsSync(from)) return;
      const to = path.resolve(srcDir, outDir, "assets", "voice");
      cpSync(from, to, { recursive: true });
    },
  };
}

function copyBuildingLayers(): Plugin {
  let outDir = "dist";
  let srcDir = "";
  return {
    name: "hexmatch:building-layers",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      srcDir = config.root;
    },
    closeBundle() {
      const from = path.resolve(srcDir, "assets", "buildings");
      if (existsSync(from)) {
        const to = path.resolve(srcDir, outDir, "assets", "buildings");
        cpSync(from, to, { recursive: true });
        this.environment?.logger?.info?.(`building layers copied → ${path.relative(srcDir, to)}`);
      }
    },
  };
}

/**
 * DEV ONLY. Recompile a building the moment its master is saved.
 *
 * Artists edit `assets/buildings-src/<name>@2x.png`; the game loads the
 * compiled, trimmed `assets/buildings/<name>@{0.5x,1x,2x}.png` + manifest.
 * Forgetting `node tools/make-building-pngs.mjs <name>` (or editing the
 * compiled file instead) left the manifest describing the OLD size, and the
 * game cropped the new art. This watches the masters (top level only — never
 * `templates/`), runs the tool for the saved building after a short debounce,
 * and reloads the page so the new art — at whatever height it now is — shows
 * straight away. `vite build` is untouched.
 */
function watchBuildingSources(): Plugin {
  return {
    name: "hexmatch:building-sources",
    apply: "serve",
    configureServer(server) {
      const dir = path.resolve(__dirname, "assets", "buildings-src");
      if (!existsSync(dir)) return;
      server.watcher.add(dir);
      const timers = new Map<string, ReturnType<typeof setTimeout>>();
      const compile = (file: string) => {
        const rel = path.relative(dir, file);
        if (rel.startsWith("..") || rel.includes(path.sep) || !/@2x\.png$/.test(rel)) return;
        const name = rel.replace(/@2x\.png$/, "");
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => {
          timers.delete(name);
          execFile(process.execPath, [path.resolve(__dirname, "tools", "make-building-pngs.mjs"), name],
            { cwd: __dirname }, (err, _stdout, stderr) => {
              if (err) {
                server.config.logger.error(`[building-layers] ${name}: ${stderr || err.message}`);
                return;
              }
              server.config.logger.info(`[building-layers] recompiled ${name}`);
              server.ws.send({ type: "full-reload" });
            });
        }, 300));
      };
      server.watcher.on("add", compile);
      server.watcher.on("change", compile);
    },
  };
}

/**
 * The build's short git commit, shown beside the game version at the foot of
 * the main menu (src/ui/version.ts) so a screenshot says exactly which code is
 * running. The RUN.world version itself is assigned at deploy time and read
 * from the page URL instead — it does not exist yet when this build runs.
 */
function buildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "local";
  } catch {
    return "local";
  }
}

// https://vite.dev/config/
export default defineConfig({
  // RELATIVE, not "/hexmatch/": RUN.world serves each build from its own
  // version folder (…/1.18.0/index.html), so a root-absolute base sends every
  // asset request to the domain root and 404s the whole bundle. "./" resolves
  // beside index.html wherever it is served — the version folder, a Pages
  // subpath, or the root.
  base: "./",
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  // `server` covers `vite dev`; `preview` covers `vite preview` of a built app
  // (the e2e webServer and Arena's sandbox live preview both use it). Vite 7
  // rejects unknown Host headers on both unless allowedHosts permits them —
  // localhost is always allowed, tunnelled/sandboxed hosts are not.
  server: { host: true, allowedHosts: [".e2b.app"] },
  preview: { host: true, allowedHosts: [".e2b.app"] },
  plugins: [
    react(),
    tailwindcss(),
    // The sidecar's rooms file: the shipped one unless a dev/e2e run overrides
    // it (see `devRoomsConfigPath`).
    // `RUNDOT_DEV_ROOM_PORT` moves the local room server off 9001, so a second
    // dev server (another checkout, a worktree) can run beside the first.
    rundotMultiplayerPlugin({
      ...(devRoomsConfigPath() ? { configPath: devRoomsConfigPath() } : {}),
      ...(process.env.RUNDOT_DEV_ROOM_PORT ? { devPort: Number(process.env.RUNDOT_DEV_ROOM_PORT) } : {}),
    }),
    devRoomServerOrigin(),
    copyBuildingLayers(),
    copyVoiceLines(),
    watchBuildingSources(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
