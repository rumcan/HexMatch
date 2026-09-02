// E1 — atlas manifest validator (pure, no deps, used by the slicer and CI).
export function validateManifest(m) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(m && typeof m === "object", "manifest must be an object");
  if (errors.length) return errors;
  need(typeof m.image === "string" && m.image.length, "image: non-empty string");
  need(Number.isInteger(m.tileW) && m.tileW > 0, "tileW: positive integer");
  need(Number.isInteger(m.tileH) && m.tileH > 0, "tileH: positive integer");
  need(m.sprites && typeof m.sprites === "object", "sprites: object");
  for (const [name, s] of Object.entries(m.sprites || {})) {
    const k = `sprites.${name}`;
    for (const f of ["x", "y", "w", "h", "frames"])
      need(Number.isInteger(s?.[f]) && s[f] >= 0, `${k}.${f}: integer >= 0`);
    need(Array.isArray(s?.footprint) && s.footprint.length === 2 &&
      s.footprint.every((n) => Number.isInteger(n) && n >= 1), `${k}.footprint: [w,h] of positive ints`);
    need(Array.isArray(s?.anchor) && s.anchor.length === 2 &&
      s.anchor.every((n) => Number.isInteger(n) && n >= 0), `${k}.anchor: [x,y] of non-negative ints`);
    if (s?.frameMs !== undefined)
      need(Number.isInteger(s.frameMs) && s.frameMs >= 1, `${k}.frameMs: positive integer`);
  }
  return errors;
}
