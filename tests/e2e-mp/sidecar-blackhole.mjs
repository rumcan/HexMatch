// A port that answers nothing.
//
// `npm run test:e2e:mp` is only meaningful with the real room sidecar behind
// it: `vite dev` starts `src/rooms/HexmatchRoom.ts` on 9001 and injects its
// origin as `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__` (docs §6). Hold 9001
// with this listener and the dev server can no longer start the sidecar, which
// is exactly the "there is no room service" case the suite is supposed to
// catch — two contexts would otherwise happily sit in their own offline-mock
// rooms and never meet (src/net/transport.ts → `isOfflineMockRealtime`).
//
//   node tests/e2e-mp/sidecar-blackhole.mjs 9001 &
//   npm run test:e2e:mp          # must fail: WebServer exit code 1, EADDRINUSE
//   kill %1
//
// It is NOT a spec (Playwright's default testMatch only picks up *.spec.ts in
// tests/e2e-mp/), just a lever for reproducing the acceptance audit in §8.
import net from "node:net";

const port = Number(process.argv[2] ?? 9001);
const sockets = new Set();

const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  // A black hole: connections are accepted and then left hanging, so callers
  // see a port that is open and silent rather than one that is refused.
  socket.on("error", () => {});
});

server.listen(port, "0.0.0.0", () => {
  console.log(`black hole listening on ${port} — no room service here`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    for (const socket of sockets) socket.destroy();
    server.close(() => process.exit(0));
  });
}
