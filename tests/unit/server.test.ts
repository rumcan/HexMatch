import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { createRoomServer } from "../../server/server.js";

const port = 9123;
let httpServer: ReturnType<typeof createRoomServer>["httpServer"];

function connect(p = port): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${p}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMsg(ws: WebSocket, type?: string): Promise<any> {
  return new Promise((resolve) => {
    const h = (raw: string) => {
      const m = JSON.parse(raw.toString());
      if (!type || m.type === type) { ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
}

async function host(name = "Host"): Promise<{ ws: WebSocket; code: string; token: string }> {
  const ws = await connect();
  ws.send(JSON.stringify({ type: "create", name }));
  const m = await nextMsg(ws, "created");
  return { ws, code: m.code, token: m.token };
}

async function guest(code: string, name = "Player"): Promise<{ ws: WebSocket; id: string }> {
  const ws = await connect();
  ws.send(JSON.stringify({ type: "join", code, name }));
  const m = await nextMsg(ws, "joined");
  return { ws, id: m.id };
}

describe("room server", () => {
  beforeAll(async () => {
    const server = createRoomServer();
    httpServer = server.httpServer;
    await new Promise<void>((r) => httpServer.listen(port, "127.0.0.1", r));
  });

  afterAll(() => httpServer.close());

  it("creates a room and hands the host a code, seed and token", async () => {
    const h = await host();
    expect(h.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(typeof h.token).toBe("string");
    expect(h.token.length).toBeGreaterThan(10);
    h.ws.close();
  });

  it("forwards guest joins to the host and back to the guest", async () => {
    const h = await host();
    const p = Promise.all([nextMsg(h.ws, "guest-joined"), guest(h.code)]);
    const [joined, g] = await p;
    expect(joined.name).toBe("Player");
    g.ws.close(); h.ws.close();
  });

  it("rejects joins into a closed (host-gone) room (ticket #16)", async () => {
    const h = await host();
    const code = h.code;
    h.ws.close();
    await new Promise((r) => setTimeout(r, 150));
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", code }));
    const err = await nextMsg(ws, "error");
    expect(err.reason).toBe("host-gone");
    ws.close();
  });

  it("lets a rehosting host reattach with the token (ticket #16)", async () => {
    const h = await host();
    const code = h.code, token = h.token;
    // a guest is present while the host reloads
    const g = await guest(code);
    const left = nextMsg(g.ws, "host-left");
    h.ws.close();
    await left;
    // host reattaches
    const ws2 = await connect();
    ws2.send(JSON.stringify({ type: "rehost", code, token, name: "Host" }));
    const created = await nextMsg(ws2, "created");
    expect(created.rehosted).toBe(true);
    const back = await nextMsg(g.ws, "host-back");
    expect(back.type).toBe("host-back");
    ws2.close(); g.ws.close();
  });

  it("refuses rehost with a bad token", async () => {
    const h = await host();
    const code = h.code;
    h.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const ws = await connect();
    ws.send(JSON.stringify({ type: "rehost", code, token: "nope" }));
    const err = await nextMsg(ws, "error");
    expect(err.reason).toBe("no-rehost");
    ws.close();
  });

  it("caps guests at MAX_GUESTS = 3 (ticket #17)", async () => {
    const h = await host();
    const guests: WebSocket[] = [];
    for (let i = 0; i < 3; i++) {
      const g = await guest(h.code, `P${i}`);
      guests.push(g.ws);
    }
    // 4th join is rejected
    const ws = await connect();
    ws.send(JSON.stringify({ type: "join", code: h.code, name: "overflow" }));
    const err = await nextMsg(ws, "error");
    expect(err.reason).toBe("full");
    ws.close();
    guests.forEach((g) => g.close());
    h.ws.close();
  });

  it("does not forward intents from an unassigned guest (ticket #15)", async () => {
    const h = await host();
    const g = await guest(h.code);
    g.ws.send(JSON.stringify({ type: "intent", action: "build", payload: { x: 1 } }));
    // give the relay a moment; the host must NOT receive an intent
    const got = await Promise.race([
      new Promise((r) => h.ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "intent") r(m);
      })),
      new Promise((r) => setTimeout(() => r(null), 400)),
    ]);
    expect(got).toBeNull();
    g.ws.close(); h.ws.close();
  });

  it("rate-limits a socket that floods messages (ticket #15)", async () => {
    const ws = await connect();
    let limited = false;
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "error" && m.reason === "rate-limited") limited = true;
    });
    for (let i = 0; i < 60; i++) ws.send(JSON.stringify({ type: "ping" }));
    await new Promise((r) => setTimeout(r, 300));
    expect(limited).toBe(true);
    ws.close();
  });

  it("ignores malformed JSON and garbage messages", async () => {
    const ws = await connect();
    ws.send("not json at all");
    ws.send(JSON.stringify({ hello: "world" }));
    ws.send(JSON.stringify({ type: 123 }));
    const pong = nextMsg(ws, "pong");
    ws.send(JSON.stringify({ type: "ping" }));
    expect((await pong).type).toBe("pong");
    ws.close();
  });
});
