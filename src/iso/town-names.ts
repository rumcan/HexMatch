// ══════════════════════════════════════════════════════════════════════════
// TOWN-3 (#561) — every town gets a generated 1940s–50s name instead of the
// placeholder "Town N".
//
// Names are SEEDED and DETERMINISTIC PER MAP: the same map seed always names
// its towns the same way, on every client (host, guest, a reloaded save), and
// two different towns on the same map never share a name. The draw uses its
// own private RNG stream (`mulberry32` salted with `TOWN_NAME_SALT`, exactly
// the pattern `makeElevation` already uses for its own seeded-but-separate
// stream) — it is NOT drawn from the map generator's main `rng`, so wiring
// names in changes nothing about the terrain/industry/town PLACEMENT stream:
// every existing seed keeps its byte-identical geometry (T1).
//
// Save/MP: a town's name is never put on the wire or the save file — every
// client and every reload calls `generateMap(seed)` again and re-derives the
// same names from the same seed (see `snapshot.ts`, `HexmatchRoom.ts`), so
// no new field is needed anywhere persistence already carries the seed.
// ══════════════════════════════════════════════════════════════════════════

/**
 * A pool of fictional small-town American names with an early/mid-20th
 * century ring to them — the kind of place a 1940s–50s rail line would
 * actually stop at. Deliberately invented (no real-world towns), so nothing
 * here can collide with an actual place name.
 *
 * Kept well past the largest town count any map option produces (`townCount`
 * tops out in the single digits), so a map "picks names with no repeats"
 * simply by drawing without replacement from this list.
 */
export const TOWN_NAME_POOL: readonly string[] = [
  "Millbrook", "Harmon's Crossing", "Cedar Falls", "Pinehurst", "Larkspur Junction",
  "Ashford", "Briarcliff", "Elmwood", "Foxhollow", "Granger's Mill",
  "Hartwell", "Ironbridge", "Juniper Bend", "Kingsley Corners", "Lockhaven",
  "Maple Ridge", "Norwood Station", "Oakdale", "Pruitt's Corner", "Quarryville",
  "Ridgemont", "Sutter's Landing", "Thornbury", "Union City", "Vandergrift",
  "Westfield Depot", "Youngstown Junction", "Amberly", "Bellweather", "Chesterfield",
  "Drummond Falls", "Emberton", "Fairhaven", "Gilcrest", "Hollis Springs",
  "Ivywood", "Jasper Hollow", "Kettleman Junction", "Larchmont", "Marrow Creek",
  "Netherfield", "Ottersgate", "Prairie Bend", "Quimby", "Redstone Landing",
  "Sable Ridge", "Talbot's Crossing", "Underhill", "Vesper Falls", "Wickham",
  "Alder Springs", "Bramblewood", "Culver's Bend", "Dunmore", "Ellery",
  "Farrowgate", "Greystone", "Halloway", "Ingram Falls", "Jefford's Landing",
  "Kestrel Bend", "Ledbury", "Marsh Haven", "Nettleton", "Ormsby",
  "Pemberton Junction", "Quinlan", "Rushford", "Saltmarsh", "Thistledown",
];

/** Salt for the naming RNG's private stream — kept apart from every other
 *  salt in `grid.ts` (`0x9e3779b9` for elevation) so the two draws can never
 *  line up and look coupled. */
const TOWN_NAME_SALT = 0x514e414d; // "TNAM" in hex, arbitrary but stable

/** Local mulberry32 — copied rather than imported so this module never has to
 *  reach into `game/config.ts` just for one PRNG (and can't be affected by
 *  changes there). Identical algorithm to every other mulberry32 in the repo,
 *  so results are exactly reproducible, not merely "similar". */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically name `count` towns for map `seed`.
 *
 * - Same `(seed, count)` always returns the same names, in the same order
 *   (index 0 is town 0's name, and so on) — a save/MP client regenerates the
 *   grid and gets identical names without anything travelling on the wire.
 * - No two names in one call repeat, as long as `count` fits in
 *   `TOWN_NAME_POOL` (it always does for any real map). If a map ever asked
 *   for more towns than the pool holds, later towns fall back to
 *   "<name> II", "<name> III"... cycling back through the (still shuffled)
 *   pool — still unique, and still a pure function of the seed.
 */
export function deriveTownNames(seed: number, count: number): string[] {
  if (count <= 0) return [];
  const rng = mulberry32((seed ^ TOWN_NAME_SALT) >>> 0);
  // Fisher–Yates over a private copy — draws from `rng`, not the map's main
  // stream, so this can never perturb terrain/industry/town placement.
  const pool = TOWN_NAME_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const base = pool[i % pool.length];
    const lap = Math.floor(i / pool.length);
    names.push(lap === 0 ? base : `${base} ${ROMAN[lap] ?? lap + 1}`);
  }
  return names;
}

const ROMAN: Record<number, string> = { 1: "II", 2: "III", 3: "IV", 4: "V", 5: "VI" };
