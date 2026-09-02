// ─────────────────────────────────────────────────────────────────────────
// E10 — multiplayer snapshot for the iso map.
// Terrain and industries are seed-derived and never sent; only the two
// transport layers and the harvester list cross the wire. The Uint8Arrays are
// sent as base64 (2304 bytes each vs ~10KB as JSON number arrays). Every
// snapshot carries a version so stale guests get a clear error instead of
// silently desyncing.
// ─────────────────────────────────────────────────────────────────────────

import { IsoWorld } from "./world";

export const SNAPSHOT_VERSION = 1;

export interface IsoSnapshot {
  version: number;
  seed: number;
  road: string;         // base64 Uint8Array
  rail: string;
  factories: { player: number; tx: number; ty: number }[];
  harvesters: { id: number; player: number; tx: number; ty: number }[];
}

export function encodeBits(bits: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bits.length; i++) bin += String.fromCharCode(bits[i]);
  return btoa(bin);
}

export function decodeBits(s: string, length: number): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(length);
  for (let i = 0; i < bin.length && i < length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function buildSnapshot(world: IsoWorld, seed: number): IsoSnapshot {
  const factories: IsoSnapshot["factories"] = [];
  world.factories.forEach((f, player) => factories.push({ player, tx: f.tx, ty: f.ty }));
  const harvesters = world.harvesters.map((h, i) => ({
    id: h.id, player: world.harvesterOwner[i], tx: h.tx, ty: h.ty,
  }));
  return {
    version: SNAPSHOT_VERSION,
    seed,
    road: encodeBits(world.net.road),
    rail: encodeBits(world.net.rail),
    factories,
    harvesters,
  };
}

/** Apply a snapshot onto a world; returns an error string if the version mismatches. */
export function applySnapshot(world: IsoWorld, snap: IsoSnapshot, expectedSeed: number): string | null {
  if (!snap || typeof snap.version !== "number") return "malformed snapshot";
  if (snap.version !== SNAPSHOT_VERSION) {
    return `Version mismatch: server runs game v${snap.version}, you are on v${SNAPSHOT_VERSION}. Refresh the page.`;
  }
  if (snap.seed !== expectedSeed) return "Map seed mismatch — rejoin the room.";
  const len = world.map.w * world.map.h;
  world.net.road.set(decodeBits(snap.road, len));
  world.net.rail.set(decodeBits(snap.rail, len));
  world.factories.clear();
  for (const f of snap.factories) world.factories.set(f.player, { tx: f.tx, ty: f.ty });
  world.harvesters.length = 0;
  world.harvesterOwner.length = 0;
  for (const h of snap.harvesters) {
    world.harvesters.push({ id: h.id, tx: h.tx, ty: h.ty });
    world.harvesterOwner.push(h.player);
  }
  world.checkConnections();
  return null;
}
