# terrain-gl — WebGL2 terrain renderer for HexMatch Industries

Files

| path | purpose |
|---|---|
| `src/iso/terrain-gl/index.ts` | the contract: `createTerrainRenderer`, `TerrainRenderer`, pure helpers re-exported |
| `src/iso/terrain-gl/shaders.ts` | vertex + fragment GLSL ES 3.00 as plain strings |
| `src/iso/terrain-gl/mesh.ts` | pure: `buildTerrainMesh`, `worldOfCorner`, `hash2`, vertex slope shade, signed distance fields, region updates |
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
* **Anti-repetition.** Every ground texture (grass, meadow, dirt, rock, sand) is fetched through
  Quilez's `textureNoTile` (two `textureGrad` fetches blended by a low-frequency index noise
  with contrast-biased cross-fade). The index noise is one shared fetch from the noise atlas.
  Layers additionally use slightly different scales/offsets so their repeats never coincide.
* **3-texture blend.** Two independent low-frequency fBm fields (R,G of the noise atlas, ~1
  feature per 8 tiles, 4 octaves) → `wMeadow = smoothstep(.45,.65,n1)`,
  `wDirt = smoothstep(.62,.78,n2)*(1-.5 wMeadow)`, `wGrass = 1-max(...)`, then **height
  blend**: each layer's local luminance minus its mean luminance (uniform `uLumA`, measured on
  upload) biases the competition, so edges follow tufts/clods. Layers with ~0 weight are not
  fetched (coherent branch).
* **ROUGH.** Weight from the rough distance field, edge perturbed by the clump noise (±0.8
  tiles), then shaped by the rock texture's own relief.
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
  texture arrives; `onReady` fires once all seven are uploaded or fell back.
* All noise derives from `seed`: the noise atlas is seed-independent and built once; the seed
  enters as `uSeedOff = (hash2(seed,11,7), hash2(seed,23,5))` (identical on every device).
* Context loss: `webglcontextlost` → stop drawing; `webglcontextrestored` → rebuild program,
  buffers, textures (from cached image elements / pixel buffers) and re-run `setMap` on the last
  map input.
* `createTerrainRenderer` never throws; returns `null` without WebGL2 or on any setup failure.

### Performance
* Fetch counts (worst case per fragment, all in one pass):
  * open sea, zoom 0.5: field 1 + codes 1 + noise 2 = **4**; zoom ≥1 adds 2 normal-map fetches.
  * inland grass, zoom 0.5: field 1 + codes 1 + noise 2 + grass 2 = **6**; +2 meadow, +2 dirt where
    those weights are non-zero (≈ 40 % / 10 % of land); +2 rock near ROUGH.
  * zoom 2 "high": + 1 detail. Shoreline pixels (both branches) peak around 15–16.
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

| slot | file suggestion | content |
|---|---|---|
| `grass` | `terrain/grass_512.png` | lush grass, mean colour ≈ #354312, soft tufts, low contrast |
| `meadow` | `terrain/meadow_512.png` | dry yellow-olive meadow grass, slightly lighter than grass |
| `dirt` | `terrain/dirt_512.png` | bare warm earth, small pebbles, low contrast |
| `rock` | `terrain/rock_512.png` | grey-brown scree / cracked rock, some lichen |
| `sand` | `terrain/sand_512.png` | beach sand ≈ #cdbb95 with faint ripples |
| `detail` | `terrain/detail_256.png` | **neutral grey (128,128,128 mean)** fine grain, blades, cracks — it is applied as overlay, any tint shifts the whole ground |
| `waterNormal` | `terrain/water_normal_256.png` | tileable tangent-space normal map of gentle ripples (128,128,255 flat) |

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
