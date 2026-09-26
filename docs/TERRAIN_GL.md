# terrain-gl — WebGL2 terrain renderer for HexMatch Industries

Files

| path | purpose |
|---|---|
| `src/iso/terrain-gl/index.ts` | the contract: `createTerrainRenderer`, `TerrainRenderer`, pure helpers re-exported |
| `src/iso/terrain-gl/shaders.ts` | vertex + fragment GLSL ES 3.00 as plain strings |
| `src/iso/terrain-gl/mesh.ts` | pure: `buildTerrainMesh`, `worldOfCorner`, `hash2`, vertex slope shade, signed distance fields, region updates, the elevation/erosion field (`buildErosionField`) |
| `src/iso/terrain-gl/procedural.ts` | pure: seamless procedural fallback textures + the shader noise atlas |
| `src/iso/terrain-gl/terrain-gl.test.ts` | Vitest, no WebGL (`npx vitest run`) |
| `tools/terrain-gl/harness.html`, `harness.ts`, `synthetic.ts` | standalone harness (`npx vite tools/terrain-gl`) — also mounted by the repo's demo `App.tsx` |

No runtime dependencies. Strict TypeScript, no `any`.

---

## How each requirement is met

### Geometry / camera / alignment
* **One static mesh.** `buildTerrainMesh` creates one shared vertex per lattice corner
  ((w+1)(h+1) = 21 025 for 144²) and two triangles per tile (124 416 indices, `Uint32Array`,
  drawn with `UNSIGNED_INT`). Vertex `v = j*(w+1)+i` is at `worldOfCorner(i, j, level)` =
  `[(i-j)*32, (i+j)*16 - level*8]`, so tile (tx,ty)'s diamond lands exactly on
  `W(tx,ty) / W(tx+1,ty) / W(tx+1,ty+1) / W(tx,ty+1)`. The unit test checks every corner of
  every tile against the formula with heights applied.
* **Diagonal choice.** Each tile is split along the diagonal whose two corners differ least in
  height, so a single raised corner does not fold the quad into a crease.
* **Camera.** The vertex shader does literally `screen = world * zoom + cam` then maps to clip
  space with the canvas size in device px. Viewport = whole canvas → pixel-exact under the 2D
  overlay. The harness draws the diamond lattice on a second 2D canvas with the same formula
  (plus a red "building footprint" diamond at the screen-centre tile) to prove it.
* **One draw call, no per-frame CPU work.** `render()` sets ~9 uniforms and issues one
  `drawElements`. No allocation per frame. Texture units are bound once (rebound only after an
  upload). No shader recompiles: zoom/quality are uniforms (`uDetailAmt`, `uWaterAnim`).

### Per-tile data and distance fields
* `uCodes` — R8, NEAREST, `w×h`: bits 0-1 = terrain code, bit 7 = river flag.
* `uField` — RGBA8, **LINEAR**, `w×h`: four signed distance fields in tiles, clamped ±8
  (`byte = (d/16 + 0.5)*255`): R shore (any water; land +, water −), G rough (outside +),
  B river water (outside +), A generator SAND (outside +). Built once per `setMap` with an exact
  separable Euclidean distance transform (Felzenszwalb–Huttenlocher), 8 transforms for 144² in
  ~2–4 ms. Distances are between tile centres minus 0.5, so LINEAR filtering crosses 0 exactly
  on the shared tile edge.
* `uGround` — RGBA8, **LINEAR**, `(w+1)×(h+1)` (the corner lattice, so the samples line up with
  the mesh vertices): the elevation/erosion field from `buildErosionField`, the source of every
  material weight. R slope (0 flat → 1 for 1.5 levels per lattice step), G curvature
  (+ hollow, − ridge, stored `0.5 + v/2`), B flow accumulation (D8, one rain drop per corner,
  log-normalised and **gated by local relief** so a flat map stays uniform and only gradients
  carry drainage lines), A thermal erosion (3 relaxation steps; + material lost on crests,
  − material gained in hollows, normalised to ±1). ~2–3 ms for 144², deterministic from the
  height lattice alone (the seed enters only as the D8 tie-break between equally steep
  neighbours). Because flow accumulation is a global property of the lattice, `invalidateTiles`
  re-bakes this one field whole (the distance fields still update per window).
* Every transition (beach band, wet sand, waterline, foam, depth, rock edge, river lip) is a
  function of these smooth fields — never of the hard codes — so there is no tile-grid look.
* `invalidateTiles` recomputes only a padded window of the fields (values depend on tiles ≤ 8
  away, so window = bbox+9 recomputed from bbox+18), uploads that sub-rect with
  `UNPACK_ROW_LENGTH/SKIP_*` straight from the full arrays, rewrites only the affected vertex
  rows (positions, shade) and tile rows (indices) with `bufferSubData`. If the bbox covers >40 %
  of the map it falls back to a full `setMap`.

### Ground look
* **Texture space.** Ground UVs are `vTile / tilesPerRepeat` (default 5 tiles per repeat).
  Tile space is a linear map of world space (rotate 45°, squash 2:1), i.e. the true ground
  plane of the isometric projection: textures flow continuously across tiles *and* read as lying
  on the ground rather than pasted on the screen. `TerrainOptions.tilesPerRepeat` (optional
  addition) tunes the scale.
* **One function per material, three variants each (#451).** Every ground material is a
  3-layer `sampler2DArray` (A/B/C) and its own shader function: `grassColor`, `meadowColor`,
  `dirtColor`, `rockColor`, `sandColor` → `matVariants`. Layer 0 goes through Quilez's
  `textureNoTile` (two `textureGrad` fetches blended by a shared index noise with a
  contrast-biased cross-fade); layers 1 and 2 are fetched at their own rotation (2.10 /
  −1.23 rad), scale and offset, so the three repeats never line up. The variant blend mask is
  **domain-warped ridged noise**: the ~2.5-tile clump field warped by the 0.5-tile fine field,
  folded (`1 − |2n − 1|`) and sharpened into a thin band (`vB`) with a nested crest (`vC`) —
  branching, wiggling seams instead of the round patches a threshold on a smooth field makes.
  Each variant's own luminance minus the material mean (from `uLumA`, measured on upload)
  biases its mask, so a seam follows clods and blades rather than fading in a straight line.
  `uVariantAmt` (1..3, from zoom/quality, `?variants=N` pins it) drops layers on the fly: 2 at
  0.5×, 3 at 1× and 2×, 1 in `quality:"low"`.
* **Material weights come from the terrain, not from clouds (#451).** `uGround` (slope,
  curvature, flow, thermal erosion) + distance to water drive the targets: dirt from
  `steep*0.85 + ridge*0.60 + bare*0.70 + drain*0.35`, rock from
  `smoothstep(.35,.78, steep*0.75 + ridge*0.30 + drain*0.25)`, meadow from
  `hollow*0.85 + damp*0.60 + sediment*0.35 + drain*hollow*0.6`. A ~2.5-tile `nudge` term
  (`clump − 0.5`) breaks the edges up so they follow the ground noise instead of drawing clean
  contour lines around every slope. The weights then go through the **height blend**: each
  layer's local luminance minus its mean biases the competition. Layers with ~0 weight are not
  fetched (coherent branch). No low-frequency cloud field touches the land any more.
* **ROCK.** Weight from the rough distance field, edge perturbed by the clump noise (±0.8
  tiles), merged (`max`) with the slope-driven rock target, then shaped by the rock texture's
  own relief.
* **Detail map.** Fetched at 4× the ground frequency, applied as overlay `2·base·detail`,
  intensity 1 / 0.35 / 0 at zoom 2 / 1 / 0.5 (uniform), 0 in `quality:"low"`.
* **Beach + dither.** `sandT = max(smoothstep(band+.6, band-.6, dShore), smoothstep(.6,-.6,
  dSand))` with `band = 1.2` tiles (0.35 near rivers). The dither threshold is a clumpy
  world-space fBm (~2.5 tiles, B channel) plus a small interleaved-gradient-noise term keyed to
  `floor(world * zoom)` — i.e. device pixels glued to the ground, stable while panning. Masks
  are `smoothstep(thr-e, thr+e, target)` with `e = fwidth(target)` → clumpy painted patches,
  ~1 px anti-aliased, not a gradient, not a Bayer checker. Wet sand (0 < d < ~0.35) uses the same
  threshold nested inside the sand mask (darker, cooler). The waterline itself is dithered too
  (`waterT = smoothstep(.3,-.3,d)`), so wet sand creeps into surf.
* **Water.** Colour = painted depth bands from `-dShore` (#3f8c94 → #1b5f72 → abyss), faint
  seabed in the shallows, a very-low-frequency tonal drift, river tint from the river field +
  river flag. At zoom 2: two scrolling normal-map samples, upper-left light, soft specular; zoom
  1: half amplitude/speed; zoom 0.5: `uWaterAnim = 0` → the branch is skipped entirely, the sea
  is static bands (map-like). Foam: thin band at d ≈ −0.28 broken up by fine noise, wobbles only
  when animated.
* **Elevation.** Per-vertex normal from the height lattice via central differences pushed
  through the isometric transform into screen space, `diffuse = dot(n, normalize(-0.42,-0.5,
  0.76))`, normalised so flat = **exactly 1.0** (a flat map is bit-identical to no elevation).
  Lit slopes are tinted warm, shaded slopes cool; the shader multiplies land only (water is
  never raised).
* **Colour.** Opaque canvas (`alpha:false, premultipliedAlpha:false`), sRGB output; all blending
  happens in display space on purpose (painterly art, no physically-based lighting) so the
  painted textures' colours are reproduced exactly. Anchors: grass mean ≈ #354312 (procedural
  grass mean ≈ #374614), sand #cdbb95, sea #1b5f72 / #3f8c94.

### Fallbacks, determinism, robustness
* Missing/failed texture URL → procedural texture for that slot, generated once (pure code, no
  OffscreenCanvas needed), seamless by periodic value noise: grass (blade streaks), meadow,
  dirt (pebbles), rock (ridged cracks, lichen), sand (ripples), detail (neutral grey 0.5 +
  grain), water normal (tileable normal map). Slots show a flat placeholder colour until their
  texture arrives (the arrays are allocated at the placeholder colour, so no variant is ever
  black); `onReady` fires once all `5×3` variant layers and both single slots are uploaded or
  fell back.
* **Missing variant file.** A material whose `_b_` / `_c_` art does not exist yet gets a
  placeholder derived from variant A's pixels (`variantFromBase`): an exact 90°/180° rotation
  plus an integer roll (so it stays seamless) with a small per-channel hue/value shift. The
  derivation needs readable pixels, so a cross-origin base image falls back to the procedural
  texture at the same size. Non-square or mismatched images are rejected (a texture array's
  layers must all match).
* All noise derives from `seed`: the noise atlas is seed-independent and built once; the seed
  enters as `uSeedOff = (hash2(seed,11,7), hash2(seed,23,5))` (identical on every device).
* Context loss: `webglcontextlost` → stop drawing; `webglcontextrestored` → rebuild program,
  buffers, textures (from cached image elements / pixel buffers) and re-run `setMap` on the last
  map input.
* `createTerrainRenderer` never throws; returns `null` without WebGL2 or on any setup failure.

### Performance
* Texture units: 11 of the guaranteed 16 (field, codes, noise, ground, five 3-layer material
  arrays, detail, water normal). Adding the two extra variants per material therefore costs no
  texture units at all.
* Fetch counts (worst case per fragment, all in one pass):
  * open sea, zoom 0.5: field 1 + codes 1 + noise 1 = **3** (the low-frequency cloud fields are
    no longer fetched for the land); zoom ≥1 adds 2 normal-map fetches.
  * inland grass, zoom 0.5 (`uVariantAmt = 2`): + ground 1 + grass (2 noTile + 1 variant B) =
    **7**; zoom 1/2 (`uVariantAmt = 3`): + 2 variants per material where its weight is non-zero.
  * zoom 2 "high": + 1 detail. Shoreline pixels (both branches) peak around 20.
* Ground textures: mipmaps, `LINEAR_MIPMAP_LINEAR`, anisotropy 8 (4 in low) if the extension
  exists; the noise atlas is mipmapped too — no shimmer at 0.5×.
* `quality:"low"`: no detail map, no water animation, 128² noise atlas, 256² procedural
  textures, aniso 4 — same look otherwise.
* `setMap` (144²): mesh + shade + 4 fields ≈ 4–8 ms in Node (test asserts < 30 ms); uploads are
  ~1.2 MB of buffers + 100 KB of textures.
* Startup: procedural textures cost ~30–60 ms each (one per task so frames can be presented in
  between). With painted textures supplied there is no procedural work except the 256² atlas
  (~10 ms).

---

## Textures the lead should generate

Seamless (tileable in both axes), authored **top-down**, sRGB PNG/JPG, upper-left light where
relief is painted. Recommended 512×512 (1024 also fine; mipmaps are generated at upload).

**Three variants per ground material (#451).** Each material is a 3-layer array; the three files
must be interchangeable in style, mean luminance and contrast (they cross-fade into each other),
but must NOT be copies — the point is that the repeat never lands twice in the same place.

| slot | files | content |
|---|---|---|
| grass | `terrain/grass_a_512.png`, `grass_b_512.png`, `grass_c_512.png` | lush grass, mean colour ≈ #354312, soft tufts, low contrast |
| meadow | `terrain/meadow_{a,b,c}_512.png` | dry yellow-olive meadow grass, slightly lighter than grass |
| dirt | `terrain/dirt_{a,b,c}_512.png` | bare warm earth, small pebbles, low contrast |
| rock | `terrain/rock_{a,b,c}_512.png` | grey-brown scree / cracked rock, some lichen |
| sand | `terrain/sand_{a,b,c}_512.png` | beach sand ≈ #cdbb95 with faint ripples |
| detail | `terrain/detail_256.png` | **neutral grey (128,128,128 mean)** fine grain, blades, cracks — it is applied as overlay, any tint shifts the whole ground |
| waterNormal | `terrain/water_normal_256.png` | tileable tangent-space normal map of gentle ripples (128,128,255 flat) |

Today's `<material>_512.png` files are wired as variant **A** until a `<material>_a_512.png`
exists, so the artist can land the variants one material at a time; a missing `_b_` / `_c_`
falls back to a rotated/rolled, slightly hue-shifted copy of A (see the fallbacks above).
`terrain-gl-adapter.ts` picks the files up through `import.meta.glob`, so no code change is
needed when they land.

Height blend uses each texture's luminance relative to its mean, so keep contrast moderate.
One repeat covers 5 tiles (`tilesPerRepeat`).

## Known limits
* Distance fields are clamped to ±8 tiles and quantised to 1/16 tile; nothing visible depends on
  larger distances (deepest water band saturates at 8 tiles).
* Field lookups use tile-space UVs, so on slopes the beach/water masks are projected straight
  down the slope — fine for the ≤4-level terraces in the game.
* River detection ("nearest water is a river") blends over ~1 tile where a river meets the sea,
  so the beach narrows gradually near an estuary.
* Cross-origin texture URLs must be CORS-enabled; otherwise the image still uploads but the mean
  luminance falls back to a default (height blend slightly less accurate).
* The water is unlit by buildings/trees (the game draws those on a separate canvas); no
  reflections.
* GPU timing cannot be measured from JS without `EXT_disjoint_timer_query_webgl2`; the harness
  shows CPU ms/frame and fps.

## Integration steps for the lead
1. Create `<canvas id="terrain">` **beneath** the game's transparent 2D canvas (same CSS size,
   `position:absolute`, same stacking box). Size both to `vw×vh` device px.
2. `const terrain = createTerrainRenderer(canvas, { textures: {...urls}, quality: isPhone ? "low" : "high", onReady })`.
3. On map load (and on every new map): `terrain?.setMap({ w, h, terrain, rivers, heights, seed })`.
   The renderer keeps a reference to the arrays; mutate them in place and then call
   `terrain.invalidateTiles([[tx,ty], ...])` for changed tiles (dams, new beaches, height edits).
4. In the frame loop, **before** the 2D pass: `terrain?.render({ x, y, zoom, vw, vh }, timeMs)`.
   On canvas resize call `terrain.resize(vw, vh)` (render also self-corrects).
5. When `terrain !== null`, skip the old 2D ground paint (leave the 2D canvas transparent where
   ground would be). When it is `null`, keep the 2D ground.
6. On teardown: `terrain.dispose()`.
