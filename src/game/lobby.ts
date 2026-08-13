/**
 * Multiplayer lobby — the first thing the player sees.
 *
 * Three states live in one modal:
 *   choose  → Solo / Host / Join
 *   host    → shows the room code and who has connected
 *   join    → server address + code entry
 *
 * The lobby never touches game rules. It resolves to exactly one of three
 * outcomes and hands control back to main.ts via the `game:start` event:
 *   { mode: "solo" }
 *   { mode: "host", seed }
 *   { mode: "guest", seed }
 */
import { bus } from "./state";
import { Net, hostRoom, joinRoom } from "./net";

let root: HTMLElement;
let state: "choose" | "host" | "join" | "connecting" = "choose";
let errorMsg = "";

const h = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

// Remember the last server address so you aren't retyping it every match.
const LAST_URL = "hexmatch:lastServer";
const lastServer = () => {
  try { return localStorage.getItem(LAST_URL) || ""; } catch { return ""; }
};
const rememberServer = (u: string) => {
  try { localStorage.setItem(LAST_URL, u); } catch { /* private mode */ }
};

const playerName = () => {
  const n = (document.getElementById("mpName") as HTMLInputElement)?.value?.trim();
  return n || "Player";
};

export function openLobby(container: HTMLElement) {
  root = container;
  state = "choose";
  errorMsg = "";
  render();
  wireEvents();
}

function close() {
  root.innerHTML = "";
  root.classList.add("hidden");
}

/* ── network events drive the lobby's state ─────────────────────── */
let wired = false;
function wireEvents() {
  if (wired) return;
  wired = true;

  bus.on("net:created", () => { state = "host"; render(); });
  bus.on("net:roster", () => { if (state === "host") render(); });

  bus.on("net:joined", (d: any) => {
    // a guest is ready the moment it has the seed — the host's snapshot will
    // fill in everything else
    close();
    bus.emit("game:start", { mode: "guest", seed: d.seed });
  });

  bus.on("net:error", (d: any) => {
    errorMsg = d.message || "Something went wrong.";
    state = "join";
    render();
  });
}

/* ── rendering ──────────────────────────────────────────────────── */

function render() {
  root.classList.remove("hidden");
  root.innerHTML = "";
  const back = h("div", "modal-back");
  const box = h("div", "modal box small lobby");
  box.appendChild(h("h2", "", "⚙️ HEXMATCH"));

  if (state === "choose") renderChoose(box);
  else if (state === "host") renderHost(box);
  else if (state === "join") renderJoin(box);
  else box.appendChild(h("p", "sub", "Connecting…"));

  root.appendChild(back);
  root.appendChild(box);
}

function nameField(): HTMLElement {
  const wrap = h("div", "lobby-field");
  wrap.innerHTML = `<label for="mpName">Your name</label>
    <input id="mpName" class="res-sel" maxlength="16" placeholder="Player" value="${
      (() => { try { return localStorage.getItem("hexmatch:name") || ""; } catch { return ""; } })()
    }">`;
  wrap.querySelector("input")!.addEventListener("change", (e) => {
    try { localStorage.setItem("hexmatch:name", (e.target as HTMLInputElement).value); } catch {}
  });
  return wrap;
}

function renderChoose(box: HTMLElement) {
  box.appendChild(h("p", "sub", "Play alone against the machines, or open a room for up to four."));
  box.appendChild(nameField());

  const row = h("div", "lobby-actions");

  const solo = h("button", "big-btn", "Play Solo");
  solo.onclick = () => { close(); bus.emit("game:start", { mode: "solo" }); };

  const host = h("button", "big-btn", "Host a Room");
  host.onclick = async () => {
    const url = askServer();
    if (!url) return;
    state = "connecting"; render();
    try {
      await hostRoom(url, playerName());
      rememberServer(url);
    } catch (err: any) {
      errorMsg = err?.message || "Could not reach that server.";
      state = "choose"; render();
    }
  };

  const join = h("button", "big-btn ghost", "Join a Room");
  join.onclick = () => { state = "join"; errorMsg = ""; render(); };

  row.appendChild(solo); row.appendChild(host); row.appendChild(join);
  box.appendChild(row);
  if (errorMsg) box.appendChild(h("p", "lobby-error", errorMsg));
}

function askServer(): string {
  const prev = lastServer() || "ws://localhost:8787";
  const url = window.prompt(
    "Server address\n\nRunning it on this PC? Keep the default.\nOthers on your network use your LAN address.",
    prev);
  return (url || "").trim();
}

function renderHost(box: HTMLElement) {
  box.appendChild(h("p", "sub", "Read this code out. Players enter it to take a seat."));

  const code = h("div", "room-code", Net.code.split("").map((c) => `<b>${c}</b>`).join(""));
  box.appendChild(code);

  const copy = h("button", "mini", "Copy join details");
  copy.onclick = () => {
    const url = lastServer() || "ws://localhost:8787";
    navigator.clipboard?.writeText(`Hexmatch — server ${url}, room code ${Net.code}`);
    copy.textContent = "Copied";
    setTimeout(() => { copy.textContent = "Copy join details"; }, 1500);
  };
  box.appendChild(copy);

  // seats: the host plus up to three guests, the rest stay AI
  const seats = h("div", "seat-list");
  seats.appendChild(seatRow(playerName(), "Host", true));
  for (const g of Net.roster) seats.appendChild(seatRow(g.name, "Connected", true));
  for (let i = Net.roster.length; i < 3; i++) {
    seats.appendChild(seatRow("Open seat", "AI will play", false));
  }
  box.appendChild(seats);

  const start = h("button", "big-btn", "Start Production ⚙️");
  start.onclick = () => {
    Net.started = true;
    close();
    bus.emit("game:start", { mode: "host", seed: Net.seed });
  };
  box.appendChild(start);
  box.appendChild(h("p", "lobby-note",
    "Players can still join after you start — they'll take over an AI mid-match."));
}

function seatRow(name: string, status: string, filled: boolean): HTMLElement {
  const r = h("div", "seat" + (filled ? " filled" : ""));
  r.innerHTML = `<span class="seat-name">${name}</span><span class="seat-status">${status}</span>`;
  return r;
}

function renderJoin(box: HTMLElement) {
  box.appendChild(h("p", "sub", "Enter the code your host read out."));
  box.appendChild(nameField());

  const f = h("div", "lobby-field");
  f.innerHTML = `<label for="mpServer">Server</label>
    <input id="mpServer" class="res-sel" placeholder="ws://192.168.0.2:8787"
           value="${lastServer()}">`;
  box.appendChild(f);

  const c = h("div", "lobby-field");
  c.innerHTML = `<label for="mpCode">Room code</label>
    <input id="mpCode" class="res-sel code-input" maxlength="4" autocomplete="off"
           placeholder="ABCD">`;
  box.appendChild(c);

  const row = h("div", "lobby-actions");
  const go = h("button", "big-btn", "Join");
  go.onclick = async () => {
    const url = (document.getElementById("mpServer") as HTMLInputElement).value.trim();
    const code = (document.getElementById("mpCode") as HTMLInputElement).value.trim().toUpperCase();
    if (!url) { errorMsg = "Enter the server address."; render(); return; }
    if (code.length !== 4) { errorMsg = "Room codes are four characters."; render(); return; }
    state = "connecting"; render();
    try {
      await joinRoom(url, code, playerName());
      rememberServer(url);
    } catch (err: any) {
      errorMsg = err?.message || "Could not reach that server.";
      state = "join"; render();
    }
  };
  const back = h("button", "big-btn ghost", "Back");
  back.onclick = () => { state = "choose"; errorMsg = ""; render(); };
  row.appendChild(go); row.appendChild(back);
  box.appendChild(row);

  if (errorMsg) box.appendChild(h("p", "lobby-error", errorMsg));

  setTimeout(() => (document.getElementById("mpCode") as HTMLInputElement)?.focus(), 30);
}
