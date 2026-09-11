import { GameRoom } from "@series-inc/rundot-game-sdk/mp-server";

/**
 * Hexmatch room type — registered in `rundot/realtime.config.json`.
 *
 * MP-01 placeholder: this file exists so the room-type config resolves to a
 * real, bundleable `GameRoom` subclass and `vite build` can emit the server
 * bundle. The host-authoritative relay (seed minting, host identity, and
 * guest→host message routing) lands in MP-03 and will speak the shared
 * protocol union from `src/net/protocol.ts` (MP-02). See
 * `docs/HexMatch-tickets.md` §2 and §6.
 */
type HexProtocol = { type: "ping" };

export default class HexmatchRoom extends GameRoom<HexProtocol> {
  onCreate() {
    // MP-03: mint the map seed here and assign the first joiner as host.
  }
}
