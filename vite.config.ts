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
  plugins: [react(), tailwindcss(), rundotMultiplayerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
