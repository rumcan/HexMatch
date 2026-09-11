import path from "path";
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

// https://vite.dev/config/
export default defineConfig({
  base: "/hexmatch/",
  server: { host: true, allowedHosts: [".e2b.app"] },
  plugins: [react(), tailwindcss(), rundotMultiplayerPlugin(), devRoomServerOrigin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
