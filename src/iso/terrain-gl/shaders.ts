/**
 * GLSL ES 3.00 sources for the terrain renderer (plain strings, no plugins).
 *
 * One program is compiled at startup and never again: every zoom / quality
 * dependent behaviour is driven by uniforms (uDetailAmt, uWaterAnim,
 * uVariantAmt, ...), so there are no per-zoom shader variants and no runtime
 * recompiles.
 */

export const TERRAIN_VS = /* glsl */ `#version 300 es
precision highp float;

// Static mesh attributes: world px (height already applied), continuous tile
// coordinates (i, j) that ignore height, and the baked slope-light factor.
in vec2  aPos;
in vec2  aTile;
in float aShade;

uniform vec2  uCam;    // device-pixel translation (cam.x, cam.y)
uniform float uZoom;   // 0.5 | 1 | 2
uniform vec2  uView;   // canvas size in device px

out vec2  vWorld;
out vec2  vTile;
out float vShade;

void main() {
  vWorld = aPos;
  vTile  = aTile;
  vShade = aShade;
  // Exactly the game's camera: screen = world * zoom + cam. The viewport is
  // the whole canvas, so this lands pixel-exact under the 2D overlay.
  vec2 s = aPos * uZoom + uCam;
  gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);
}
`;

export const TERRAIN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler2DArray;

in vec2  vWorld;
in vec2  vTile;
in float vShade;
out vec4 fragColor;

// Per-map data ----------------------------------------------------------
uniform sampler2D      uField;  // RGBA8 LINEAR  signed distances (tiles, /16+0.5): R shore, G rough, B river, A sand
uniform sampler2D      uCodes;  // R8 NEAREST    bits 0-1 terrain code, bit 7 river flag
uniform sampler2D      uNoise;  // RGBA8 REPEAT  R,G low fBm  B clump fBm  A fine fBm (seed enters via uSeedOff)
uniform sampler2D      uGround; // RGBA8 LINEAR  elevation/erosion field on the corner lattice: R slope, G curvature, B flow, A erosion
// Ground art: one 3-layer array per material — layers 0/1/2 are the A/B/C
// variants of the same texture (see matVariants below) -------------------------
uniform sampler2DArray uGrassArr;
uniform sampler2DArray uMeadowArr;
uniform sampler2DArray uDirtArr;
uniform sampler2DArray uRockArr;
uniform sampler2DArray uSandArr;
uniform sampler2D      uDetail;
uniform sampler2D      uWaterN;
uniform float uGrid;      // 0..1 strength of the faint tile grid (0 = off)

uniform vec2  uMapSize;        // (w, h) tiles
uniform vec2  uCornerSize;     // (w+1, h+1): texels of uGround (the corner lattice)
uniform vec2  uSeedOff;        // seed-derived UV offset into uNoise
uniform float uZoom;           // 0.5 | 1 | 2
uniform float uDetailAmt;      // 1 @2, 0.35 @1, 0 @0.5 (0 in low quality)
uniform float uWaterAnim;      // 1 @2, 0.5 @1, 0 @0.5 (0 in low quality)
uniform float uVariantAmt;     // how many variants blend per material: 1..3
uniform float uTime;           // seconds
uniform float uTilesPerRepeat; // ground texture repeat length in tiles (~5)
uniform vec4  uLumA;           // mean luminance of grass, meadow, dirt, rock (variant A)

const vec3 LIGHT       = normalize(vec3(-0.42, -0.5, 0.76)); // toward the light (screen upper-left)
const vec3 SEA_SHALLOW = vec3(0.247, 0.549, 0.580); // #3f8c94
const vec3 SEA_DEEP    = vec3(0.106, 0.373, 0.447); // #1b5f72
const vec3 SEA_ABYSS   = vec3(0.070, 0.275, 0.345);
const vec3 RIVER_TINT  = vec3(0.230, 0.430, 0.400);
const vec3 SEABED      = vec3(0.560, 0.520, 0.400);
const vec3 FOAM        = vec3(0.930, 0.950, 0.930);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Interleaved gradient noise: the tiny pixel-scale term that keeps dither
// edges crisp. Keyed to WORLD pixels at the current zoom so it stays glued to
// the ground while panning instead of crawling over it.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Inigo Quilez' anti-repetition: pick two pseudo-random offsets of the texture
// from a low-frequency index noise and cross-fade them where the index
// changes, biased by the colour difference so the seam hides in the texture's
// own contrast. The index noise k is shared by all layers (one fetch total).
// Array-sampler version: layer 0 is the material's base variant.
vec3 noTileArr(sampler2DArray samp, vec2 uv, vec2 dx, vec2 dy, float k) {
  float l  = k * 8.0;
  float f  = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia);
  vec2 offb = sin(vec2(3.0, 7.0) * ib);
  vec3 ca = textureGrad(samp, vec3(uv + offa, 0.0), dx, dy).rgb;
  vec3 cb = textureGrad(samp, vec3(uv + offb, 0.0), dx, dy).rgb;
  float s = dot(ca - cb, vec3(1.0));
  return mix(ca, cb, smoothstep(0.2, 0.8, f - 0.1 * s));
}

// ONE material, three variants. The variants are blended through a
// high-frequency, domain-warped ridged mask (vB: the mid band, vC: the crest
// of the same field — both computed once per fragment in main), never through
// a smooth low-frequency field: the seams are thin, branching and wiggle with
// the fine noise instead of reading as round "golf course" patches.
// Each variant is fetched at its own rotation / scale / offset so the three
// repeats never line up, and the variant's own luminance biases its mask, so a
// seam follows clods and blades instead of fading in a straight line.
vec3 matVariants(sampler2DArray t, vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC, float meanLum) {
  vec3 a = noTileArr(t, uv, dx, dy, k);
  if (uVariantAmt < 1.5) return a;
  mat2 r1 = rot2(2.10);
  vec2 s1 = uv * 1.09 + vec2(0.37, 0.11);
  vec3 b = textureGrad(t, vec3(r1 * s1, 1.0), r1 * (dx * 1.09), r1 * (dy * 1.09)).rgb;
  float t1 = clamp(uVariantAmt - 1.0, 0.0, 1.0) * smoothstep(0.30, 0.70, vB + (lum(b) - meanLum) * 0.55);
  vec3 c = mix(a, b, t1);
  if (uVariantAmt < 2.5) return c;
  mat2 r2 = rot2(-1.23);
  vec2 s2 = uv * 0.93 + vec2(0.71, 0.53);
  vec3 d = textureGrad(t, vec3(r2 * s2, 2.0), r2 * (dx * 0.93), r2 * (dy * 0.93)).rgb;
  float t2 = clamp(uVariantAmt - 2.0, 0.0, 1.0) * smoothstep(0.45, 0.82, vC + (lum(d) - meanLum) * 0.55);
  return mix(c, d, t2);
}

// One function per material. Each keeps its own repeat scale + offset (from
// the single-texture build) so the layers' repeats never coincide either.
vec3 grassColor (vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC) {
  return matVariants(uGrassArr,  uv,                    dx,                    dy,                    k, vB, vC, uLumA.x);
}
vec3 meadowColor(vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC) {
  return matVariants(uMeadowArr, uv * 1.13 + 0.37,      dx * 1.13,             dy * 1.13,             k, vB, vC, uLumA.y);
}
vec3 dirtColor  (vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC) {
  return matVariants(uDirtArr,   uv * 0.91 + 0.71,      dx * 0.91,             dy * 0.91,             k, vB, vC, uLumA.z);
}
vec3 rockColor  (vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC) {
  return matVariants(uRockArr,   uv * 1.21 + 0.19,      dx * 1.21,             dy * 1.21,             k, vB, vC, uLumA.w);
}
vec3 sandColor  (vec2 uv, vec2 dx, vec2 dy, float k, float vB, float vC) {
  return matVariants(uSandArr,   uv * 1.05 + 0.53,      dx * 1.05,             dy * 1.05,             k, vB, vC, 0.74);
}

// Clumpy dither threshold shared by every transition in this fragment (set in main).
float gDn;
// Noise-thresholded mask: 1 where target exceeds the local threshold. Feathered
// by the target's own screen-space footprint (not the noisy threshold's) so
// edges stay ~1px soft at every zoom without smearing.
float dither(float target) {
  float e = fwidth(target) * 0.75 + 0.02;
  return smoothstep(gDn - e, gDn + e, target);
}

void main() {
  // -------------------------------------------------------------------------
  // 1. Smooth per-tile fields. LINEAR filtering between tile centres turns the
  //    hard tile codes into continuous signed distances; every transition
  //    below is a function of these, which is what removes the tile grid.
  // -------------------------------------------------------------------------
  vec2 fuv   = vTile / uMapSize;
  vec4 F     = (texture(uField, fuv) - 0.5) * 16.0;
  float dShore = F.r;   // + on land, - in water, 0 at the waterline
  float dRock  = F.g;   // - inside ROUGH
  float dRiver = F.b;   // - inside river water
  float dSand  = F.a;   // - inside generator-marked SAND

  // -------------------------------------------------------------------------
  // 2. Noise. One fetch of the atlas in ground (tile) space, seed-offset (the
  //    low-frequency land-blend fields of the old build are gone: the ground
  //    blend is terrain-driven now, see section 3).
  //    clump ~2.5 tiles: dithers, rock edges, material-edge break-up.
  //    fine ~0.5 tile: domain warp for the variant mask, foam breakup.
  // -------------------------------------------------------------------------
  vec2 rt   = vec2(vTile.x * 0.8 - vTile.y * 0.6, vTile.x * 0.6 + vTile.y * 0.8);
  vec4 nMid = texture(uNoise, rt * (1.0 / 48.0) + uSeedOff.yx * 1.7 + 0.31);
  float clump = nMid.b;
  float fine  = nMid.a;
  float k     = nMid.r;

  // Dither threshold = clumpy world-space noise + a little crisp grain.
  float grain = ign(floor(vWorld * uZoom));
  gDn = clamp(clump * 0.74 + 0.13 + (grain - 0.5) * 0.28, 0.0, 1.0);

  // Variant mask for the three texture variants of every material: the clump
  // field WARPED by the fine field and folded into ridges (1 - |2n-1|), then
  // sharpened. Domain-warped ridged noise branches and wiggles; a threshold on
  // a smooth field would be the round patch this ticket removes. vC (the
  // crest) is nested inside vB (the band), so the three variants interleave.
  float warped = clamp(clump + (fine - 0.5) * 0.6, 0.0, 1.0);
  float ridged = 1.0 - abs(2.0 * warped - 1.0);
  float vB = smoothstep(0.14, 0.58, ridged);
  float vC = smoothstep(0.52, 0.90, ridged);

  // Is the nearest water a river? (rivers get a thin lip, not a beach)
  float distWater = dShore + 0.5;
  float riverness = 1.0 - smoothstep(0.0, 1.0, dRiver - distWater);
  // Hard per-tile river flag from the code texture guarantees the tint inside
  // river tiles even where two water bodies meet and the field is ambiguous.
  float riverFlag = step(0.5, texture(uCodes, fuv).r);
  riverness = max(riverness, riverFlag);

  // Transition targets (0..1) that the dither thresholds against.
  float band   = mix(1.2, 0.35, riverness);                          // beach width in tiles
  float sandT  = max(smoothstep(band + 0.6, band - 0.6, dShore),     // band along every coast
                     smoothstep(0.6, -0.6, dSand));                  // + generator beaches
  float wetT   = smoothstep(0.55, 0.05, dShore);                     // 0 < d < ~0.35: wet sand
  float waterT = smoothstep(0.30, -0.30, dShore);                    // the waterline itself
  // All dithers are evaluated here, in uniform control flow, because
  // dither() takes screen-space derivatives (undefined inside branches).
  float waterM = dither(waterT);
  float sandM  = dither(sandT);
  float wetM   = dither(wetT) * sandM;

  // Ground texture coordinates: tile space IS the ground plane of the
  // isometric projection (a linear map of world px), so textures read as
  // lying on the ground and flow continuously across tiles.
  vec2 tdx = dFdx(vTile), tdy = dFdy(vTile);   // taken once, in uniform flow
  vec2 guv = vTile / uTilesPerRepeat;
  vec2 gdx = tdx / uTilesPerRepeat, gdy = tdy / uTilesPerRepeat;

  // -------------------------------------------------------------------------
  // 3. Land (skipped for open water; the branch is spatially coherent).
  //    The final land colour lives in ONE variable ("land") before the water
  //    composite in section 5, so a colour grade can multiply it (LIGHT-1).
  // -------------------------------------------------------------------------
  vec3 land = vec3(0.0);
  if (dShore > -0.9) {
    // 3a. Material weights come from the baked elevation/erosion field
    //     (uGround, corner lattice), NOT from cloud noise:
    //       slope    → dirt, then rock on the steepest faces
    //       ridge    → dirt on crests and shoulders
    //       hollow   → lusher meadow in dips
    //       damp     → meadow near water and low ground
    //       flow     → erosion streaks / drainage lines down the slopes
    //       erosion  → bare, exposed ground on crests, sediment in hollows
    vec4  GF     = texture(uGround, (vTile + 0.5) / uCornerSize);
    float slope  = GF.r;                                  // 0 flat .. 1 cliff
    float curv   = GF.g * 2.0 - 1.0;                      // + hollow, - ridge
    float flow   = GF.b;                                  // drainage lines
    float ero    = GF.a * 2.0 - 1.0;                      // + eroded, - sediment

    float steep  = smoothstep(0.14, 0.52, slope);
    float ridge  = smoothstep(0.08, 0.34, -curv);
    float hollow = smoothstep(0.08, 0.34, curv);
    float damp   = smoothstep(5.0, 0.5, distWater);
    float drain  = smoothstep(0.30, 0.75, flow);
    float bare   = smoothstep(0.25, 0.70, ero);
    float sed    = smoothstep(0.25, 0.70, -ero);

    // A ~2-tile break-up of the targets, so their edges follow the ground
    // noise instead of drawing clean contour lines around every slope.
    float nudge = (clump - 0.5) * 0.30;
    // Scuffed bare ground on gentle, well-drained ground — the crest of the
    // very same non-blobby ridged mask the variants use, never a cloud field.
    // It is what keeps a map with no elevation at all from reading flat.
    float scuff = smoothstep(0.62, 0.95, ridged) * (1.0 - steep) * (1.0 - hollow);
    float tDirt = clamp(steep * 0.85 + ridge * 0.60 + bare * 0.70 + scuff * 0.40
                        + drain * 0.35 * (1.0 - hollow) + nudge, 0.0, 1.0);
    float tRock = clamp(smoothstep(0.35, 0.78, steep * 0.75 + ridge * 0.30
                                   + drain * 0.25 + nudge * 0.6), 0.0, 1.0);
    float tMeadow = clamp(hollow * 0.85 + damp * 0.60 * (1.0 - steep)
                          + sed * 0.35 + drain * hollow * 0.6 - nudge, 0.0, 1.0);

    float wDirt   = tDirt;
    float wMeadow = tMeadow * (1.0 - wDirt);
    float wGrass  = 1.0 - max(wDirt, wMeadow);

    // Height blend: each layer's local brightness (relative to its mean)
    // biases the competition, so boundaries follow tufts and clods instead
    // of fading linearly. Layers with ~zero weight are not even fetched.
    const float HB = 1.0;
    vec3  grass  = grassColor(guv, gdx, gdy, k, vB, vC);
    float hG     = wGrass + (lum(grass) - uLumA.x) * HB;
    vec3  meadow = vec3(0.0); float hM = -10.0;
    vec3  dirt   = vec3(0.0); float hD = -10.0;
    if (wMeadow > 0.003) {
      meadow = meadowColor(guv, gdx, gdy, k, vB, vC);
      hM = wMeadow + (lum(meadow) - uLumA.y) * HB;
    }
    if (wDirt > 0.003) {
      dirt = dirtColor(guv, gdx, gdy, k, vB, vC);
      hD = wDirt + (lum(dirt) - uLumA.z) * HB;
    }
    float top = max(hG, max(hM, hD)) - 0.22;
    float bG = max(hG - top, 0.0), bM = max(hM - top, 0.0), bD = max(hD - top, 0.0);
    land = (grass * bG + meadow * bM + dirt * bD) / (bG + bM + bD);

    // 3b. Rock: the generator's ROUGH distance field (edge perturbed by clump
    //     noise) merged with the slope target, so the steepest faces turn to
    //     rock even where the generator stamped no ROUGH tile.
    float rockT = max(smoothstep(0.9, -0.4, dRock + (clump - 0.5) * 1.6), tRock);
    if (rockT > 0.003) {
      vec3 rock = rockColor(guv, gdx, gdy, k, vB, vC);
      float rockW = smoothstep(0.35, 0.65, rockT + (lum(rock) - uLumA.w) * 0.8);
      land = mix(land, rock, rockW);
    }

    // 3c. Beach: dithered sand patches creeping into the grass.
    if (sandM > 0.003) {
      vec3 sand = sandColor(guv, gdx, gdy, k, vB, vC);
      land = mix(land, sand, sandM);
      // Wet sand right at the waterline: darker, cooler, a touch glossy.
      land = mix(land, land * vec3(0.62, 0.66, 0.72), wetM);
    }

    // 3d. Detail overlay: fine grain at ~4× ground frequency, only near zoom.
    if (uDetailAmt > 0.0) {
      vec3 det = textureGrad(uDetail, guv * 4.0, gdx * 4.0, gdy * 4.0).rgb;   // neutral grey 0.5 → 2·b·d = b
      land = mix(land, land * 2.0 * det, uDetailAmt);
    }

    // 3e. Elevation lighting from the baked per-vertex factor (1 = flat).
    //     Lit faces warm up, shaded faces cool down, both subtly.
    // Owner: the level changes must READ at a glance - slopes away from the
    // upper-left sun go clearly dark and cool, sunlit ones warm and bright.
    vec3 tint = vShade >= 1.0
      // sunlit faces: a clear warm highlight, not a faint lift
      ? mix(vec3(1.0), vec3(1.55, 1.42, 1.12), clamp((vShade - 1.0) * 4.0, 0.0, 1.0))
      : mix(vec3(0.34, 0.40, 0.56), vec3(1.0), pow(clamp(vShade, 0.0, 1.0), 1.8));
    land *= tint;
  }

  // -------------------------------------------------------------------------
  // 4. Water (skipped well inland).
  // -------------------------------------------------------------------------
  vec3  water = vec3(0.0);
  float foam  = 0.0;
  if (dShore < 0.9) {
    // 4a. Painted depth bands from distance to shore: the whole look at 0.5×.
    float depth = clamp(-dShore, 0.0, 8.0);
    water = mix(SEA_SHALLOW, SEA_DEEP, smoothstep(0.0, 3.0, depth));
    water = mix(water, SEA_ABYSS, smoothstep(3.0, 8.0, depth));
    water = mix(water, RIVER_TINT, riverness * 0.55);
    // very low-frequency tonal drift so the sea is a painting, not a fill
    // (one graded fetch of the noise atlas' low field, only on water)
    water *= 0.94 + 0.12 * textureGrad(uNoise, vTile * (1.0 / 64.0) + uSeedOff, tdx * (1.0 / 64.0), tdy * (1.0 / 64.0)).g;
    // faint seabed showing through the shallows
    water = mix(water, SEABED * 0.9, (1.0 - smoothstep(0.0, 1.2, depth)) * 0.30);

    // 4b. Ripples: two scrolling normal-map samples, upper-left light,
    //     a soft specular. Amplitude and speed scale with uWaterAnim, which
    //     is 0 when zoomed out → the branch vanishes and the sea is static.
    if (uWaterAnim > 0.0) {
      float t = uTime * (0.4 + 0.6 * uWaterAnim);
      vec2 wuv = vTile * 0.45;
      vec2 wdx = tdx * 0.45, wdy = tdy * 0.45;
      vec3 n1 = textureGrad(uWaterN, wuv + vec2(0.021, 0.013) * t, wdx, wdy).xyz;
      vec3 n2 = textureGrad(uWaterN, wuv * 1.37 + vec2(0.7, 0.2) - vec2(0.017, 0.024) * t, wdx * 1.37, wdy * 1.37).xyz;
      vec2 nxy = (n1.xy + n2.xy) * 2.0 - 2.0;
      float amp = uWaterAnim * mix(1.0, 0.45, riverFlag);   // rivers are calmer
      vec3 nrm = normalize(vec3(nxy * amp, 2.2));
      float diff = dot(nrm, LIGHT) - LIGHT.z;               // 0 for a flat surface
      vec3  H    = normalize(LIGHT + vec3(0.0, 0.0, 1.0));
      float spec = pow(max(dot(nrm, H), 0.0), 48.0);
      water += diff * 0.35;
      water += spec * 0.16 * smoothstep(0.0, 1.5, depth + 0.4);
    }

    // 4c. Foam: a thin band hugging the waterline, broken up by the fine
    //     noise, wobbling only when animated.
    float wob   = 0.10 * uWaterAnim * sin(uTime * 1.3 + clump * 12.0 + fine * 4.0);
    float foamT = smoothstep(0.55, 0.12, abs(dShore + 0.28 + wob));
    foam = smoothstep(0.42, 0.62, foamT * (0.55 + 0.75 * fine + 0.3 * (clump - 0.5)));
    foam *= mix(1.0, 0.35, riverness);
  }

  // -------------------------------------------------------------------------
  // 5. Composite: dithered waterline, foam on top, opaque output (sRGB).
  // -------------------------------------------------------------------------
  vec3 col = mix(land, water, waterM);
  col = mix(col, FOAM, foam * waterM * 0.85);
  // Faint tile grid on land. vTile ignores height but the mesh carries it, so
  // the lines drape over the ground and every level change reads as a bend.
  if (uGrid > 0.0 && waterM < 0.5) {
    vec2 gw = fwidth(vTile);
    vec2 gd = abs(fract(vTile - 0.5) - 0.5) / max(gw, vec2(1e-4));
    float gl = 1.0 - clamp(min(gd.x, gd.y), 0.0, 1.0);
    col = mix(col, col * 0.72, gl * uGrid);
  }
  fragColor = vec4(col, 1.0);
}
`;
