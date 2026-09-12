import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
// SFX-01: one document-wide delegation gives every control in the game a hover
// tick and a press sound — the start screen below, the HUD, the bounty chooser
// and the ending card alike — and installs `window.__sfx` in a dev build so the
// mix can be auditioned from the console (`__sfx.audition()`). Nothing sounds
// until the player's first real gesture; see docs/SFX-01-ui-sound.md.
import { attachUiSound } from "./audio/sfx";

attachUiSound();
createRoot(document.getElementById("root")!).render(<App />);