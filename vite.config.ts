import path from "path";
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
      if (!existsSync(from)) return;
      const to = path.resolve(srcDir, outDir, "assets", "buildings");
      cpSync(from, to, { recursive: true });
      this.environment?.logger?.info?.(`building layers copied → ${path.relative(srcDir, to)}`);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "/hexmatch/",
  server: { host: true, allowedHosts: [".e2b.app"] },
  plugins: [react(), tailwindcss(), rundotMultiplayerPlugin(), devRoomServerOrigin(), copyBuildingLayers()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
