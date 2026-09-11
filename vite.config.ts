import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { rundotMultiplayerPlugin } from "@series-inc/rundot-game-sdk/vite";
import { defineConfig } from "vite";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: "/hexmatch/",
  server: { host: true, allowedHosts: [".e2b.app"] },
  plugins: [
    react(),
    tailwindcss(),
    // MP-01 (docs/HexMatch-tickets.md §6): bundles src/rooms/HexmatchRoom.ts
    // into dist/server-bundle.js and copies rundot/realtime.config.json to
    // dist/rooms.config.json on build; on serve it runs the rooms locally on
    // the default devPort 9001 so two browser profiles can host/join without
    // the platform. Keep it in both serve and build config.
    rundotMultiplayerPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
