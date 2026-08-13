import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PLOT, TILES, TileKey, RES, TEX, GEM_SHEET, GEM_FRAME, GEM_FRAMES } from "../game/config";
import { HexMap, Tile, Edge, Pt, tileOutline } from "../game/hexmap";
import { Player } from "../game/state";
import { makeTerrainTexture, TerrainStyle } from "../lib/textures";


const K = 0.02;                       // map units -> world units
const WATER_Y = 0.01;

const HEIGHT: Record<TileKey, number> = {
  mountain: 0.4, hills: 0.35, forest: 0.3, goldmine: 0.25,
  field: 0.2, pasture: 0.18, desert: 0.15,
};

const STYLE: Record<TileKey, TerrainStyle & { rough: number }> = {
  forest:   { colors: [[6, 48, 26], [10, 92, 40], [30, 150, 62], [120, 214, 96]],      scale: 10, octaves: 6, contrast: 1.9,  rough: 0.92 },
  pasture:  { colors: [[34, 122, 40], [72, 178, 52], [130, 224, 74], [198, 248, 128]], scale: 8,  octaves: 5, contrast: 1.6,  rough: 0.9 },
  field:    { colors: [[168, 104, 8], [226, 164, 18], [255, 208, 44], [255, 244, 150]],scale: 15, octaves: 4, contrast: 1.85, rough: 0.82 },
  hills:    { colors: [[108, 24, 16], [176, 52, 28], [228, 92, 46], [252, 152, 96]],   scale: 9,  octaves: 5, contrast: 1.75, rough: 0.93 },
  mountain: { colors: [[38, 46, 76], [78, 92, 132], [148, 164, 200], [238, 246, 255]], scale: 7,  octaves: 6, contrast: 2.0,  rough: 0.65 },
  goldmine: { colors: [[74, 44, 8], [156, 102, 14], [238, 176, 30], [255, 236, 140]],  scale: 9,  octaves: 6, contrast: 1.95, rough: 0.42 },
  desert:   { colors: [[206, 142, 62], [242, 190, 104], [255, 224, 156], [255, 248, 214]], scale: 11, octaves: 5, contrast: 1.5, speckle: 0.06, speckleColor: [255, 252, 232], rough: 0.97 },
};

/* ---------------- helpers ---------------- */

function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** push every outline point outward from its centroid by `w` map units */
function offsetOutline(pts: Pt[], w: number): Pt[] {
  const [cx, cy] = centroid(pts);
  return pts.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * w, y + (dy / l) * w] as Pt;
  });
}

function shapeFrom(pts: Pt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0] * K, p[1] * K) : s.moveTo(p[0] * K, p[1] * K)));
  s.closePath();
  return s;
}

function pointInPoly(pts: Pt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---- gem sprite sheet, loaded once and shared by every medallion ---- */
const gemSheetImg = new Image();
let gemSheetReady = false;
gemSheetImg.onload = () => { gemSheetReady = true; };
gemSheetImg.src = GEM_SHEET;

/**
 * Dark disc with a gold ring and the terrain's gem sprite in the middle.
 * The sprite sheet may not have decoded on first call, so the texture is
 * redrawn and flagged for upload once the image lands.
 */
function medallionTexture(type: TileKey): THREE.Texture {
  const S = 192;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  const res = TILES[type].res;

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;

  const paint = () => {
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 6, 0, 7);
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, "rgba(28,22,14,0.95)");
    g.addColorStop(1, "rgba(10,8,5,0.95)");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = res ? RES[res].ring : "#c9c9c9"; ctx.stroke();

    if (res && gemSheetReady) {
      const fw = gemSheetImg.naturalWidth / GEM_FRAMES;
      const fh = gemSheetImg.naturalHeight;
      const d = S * 0.62;
      ctx.drawImage(gemSheetImg, GEM_FRAME[res] * fw, 0, fw, fh,
                    (S - d) / 2, (S - d) / 2, d, d);
    } else if (!res) {
      ctx.font = `${S * 0.5}px "Apple Color Emoji","Segoe UI Emoji",serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("\u2620\uFE0F", S / 2, S / 2 + 4);
    }
    t.needsUpdate = true;
  };

  paint();
  if (res && !gemSheetReady) gemSheetImg.addEventListener("load", paint, { once: true });
  return t;
}

function banditTexture(): THREE.Texture {
  const S = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.font = `${S * 0.8}px "Apple Color Emoji","Segoe UI Emoji",serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("\u{1F6AB}", S / 2, S / 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- ocean shader ---------------- */

const WAVE_GLSL = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
float waveH(vec2 p, out vec2 grad){
  float h = 0.0; grad = vec2(0.0);
  vec4 w[4];
  w[0] = vec4( 1.0, 0.30, 6.0, 0.055);
  w[1] = vec4(-0.60,1.00, 3.6, 0.034);
  w[2] = vec4( 0.80,-0.55,2.1, 0.018);
  w[3] = vec4(-0.20,-1.00,1.2, 0.009);
  for(int i=0;i<4;i++){
    vec2 d = normalize(w[i].xy);
    float k = 6.28318 / w[i].z;
    float a = w[i].w;
    float sp = sqrt(9.8/k);
    float ph = dot(d,p)*k + uTime*sp;
    h += a*sin(ph);
    grad += d*(k*a*cos(ph));
  }
  return h;
}`;

/* ---------------- MapView3D ---------------- */

export class MapView3D {
  canvas: HTMLCanvasElement;
  map: HexMap;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  raycaster = new THREE.Raycaster();

  // public API parity with the old 2D MapView
  zoom = 1;
  cx = 0; cy = 0;
  hover: { kind: string; id: number } | null = null;
  legalVerts = new Set<number>();
  legalEdges = new Set<number>();
  mode: string | null = null;
  onPick: (hit: { kind: string; id: number } | null) => void = () => {};

  // internals
  private target = new THREE.Vector3();
  private dist = 26;
  private yaw = -0.5;
  private pitch = 0.92;
  private tTarget = new THREE.Vector3();
  private tDist = 26;
  private tYaw = -0.5;
  private tPitch = 0.92;

  private tileMeshes: THREE.Mesh[] = [];
  private tileHeight: number[] = [];
  private dynamic = new THREE.Group();
  private markers = new THREE.Group();
  private banditSprites: THREE.Sprite[] = [];
  private oceanUniforms = { uTime: { value: 0 } };
  private ringUniforms = { uTime: { value: 0 } };
  private shoreRings = new THREE.Group();
  private sig = "";
  private markerSig = "";
  private leftPanel = 278;
  private rightPanel = 480;

  constructor(canvas: HTMLCanvasElement, map: HexMap) {
    this.canvas = canvas;
    this.map = map;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);

    this.scene.fog = new THREE.FogExp2(0x0b6ea8, 0.0065);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
    this.scene.environmentIntensity = 0.35;

    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildLand();
    this.buildShoreRings();
    this.scene.add(this.dynamic);
    this.scene.add(this.markers);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.bindInput();
    this.fit();
  }

  /* ---------- scene construction ---------- */

  private buildSky() {
    const geo = new THREE.SphereGeometry(500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color("#0a4fb5") },
        mid: { value: new THREE.Color("#63c8f5") },
        bot: { value: new THREE.Color("#ffdca6") },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(bot, mid, smoothstep(-0.15, 0.18, h));
          c = mix(c, top, smoothstep(0.15, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x9fd4ff, 0x14484f, 0.30));
    const sun = new THREE.DirectionalLight(0xffd9a0, 3.4);
    sun.position.set(16, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.03;
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -22; c.right = 22; c.top = 22; c.bottom = -22; c.near = 1; c.far = 90;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x4aa6ff, 0.38);
    fill.position.set(-14, 9, -12);
    this.scene.add(fill);
  }

  private buildOcean() {
    // Dorfromantik-style water: calm, painterly, low-contrast. Detail comes from
    // smooth depth banding and slow contour ripples — never from high-frequency
    // noise, which tiles visibly at this camera distance.
    const geo = new THREE.PlaneGeometry(900, 900, 900, 900);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.oceanUniforms.uTime,
        uSunDir: { value: new THREE.Vector3(16, 16, 16).normalize() },
        uShore: { value: new THREE.Color("#7fe3e8") },
        uShallow: { value: new THREE.Color("#33b4dd") },
        uMid: { value: new THREE.Color("#1d78bf") },
        uDeep: { value: new THREE.Color("#12468c") },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNrm;

        // three long, slow swells — large wavelengths only, so no visible tiling
        float swell(vec2 p, out vec2 grad){
          float h = 0.0; grad = vec2(0.0);
          vec3 w[3];
          w[0] = vec3(3.01);
          w[1] = vec3( 3.01);
          w[2] = vec3( 3.01);
          float amp[3];
          amp[0] = 0.0; amp[1] = 0.0; amp[2] = 0.0;
          for(int i=0;i<3;i++){
            vec2 d = normalize(w[i].xy);
            float k = 6.28318 / w[i].z;
            float ph = dot(d,p)*k + uTime * sqrt(9.8/k) * 0.30;
            h += amp[i]*sin(ph);
            grad += d*(k*amp[i]*cos(ph));
          }
          return h;
        }

        void main(){
          vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;
          vec2 grd; float hh = swell(wp.xz, grd);
          vNrm = normalize(vec3(-grd.x, 1.0, -grd.y));
          vec3 transformed = position;
          transformed.z += hh;
          vWorld = wp + vec3(0.0, hh, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir, uShore, uShallow, uMid, uDeep;
        varying vec3 vWorld;
        varying vec3 vNrm;

        void main(){
          float d = length(vWorld.xz);

          // soft depth gradient — the main source of colour
          vec3 col = mix(uShore, uShallow, smoothstep(2.5, 8.0, d));
          col = mix(col, uMid,  smoothstep(8.0, 22.0, d));
          col = mix(col, uDeep, smoothstep(22.0, 70.0, d));

          vec3 N = normalize(vNrm);
          vec3 V = normalize(cameraPosition - vWorld);

          // gentle lambert-ish shading off the swell normals: gives the water
          // form without any speckle
          float lambert = 0.5 + 0.5 * dot(N, uSunDir);
          col *= 0.88 + lambert * 0.24;

          // wide, soft sun sheen (low exponent = broad highlight, no glitter)
          vec3 H = normalize(uSunDir + V);
          float sheen = pow(max(dot(N, H), 0.0), 22.0);
          col += vec3(1.0, 0.97, 0.90) * sheen * 0.22;

          // slow contour ripples radiating from the island — the illustrated
          // "hand-drawn water lines" look
          float rings = sin(d * 2.6 - uTime * 0.55);
          float lines = smoothstep(0.86, 1.0, rings) * (1.0 - smoothstep(6.0, 30.0, d));
          col = mix(col, col + vec3(0.16, 0.22, 0.20), lines * 0.55);

          // clean shore band, no noise
          float shore = 1.0 - smoothstep(1.6, 3.4, d);
          col = mix(col, vec3(0.90, 0.99, 1.0), shore * 0.55);

          // horizon lift so the far ocean meets the sky softly
          col = mix(col, vec3(0.36, 0.66, 0.86), smoothstep(90.0, 260.0, d) * 0.75);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = WATER_Y;
    this.scene.add(m);
  }

private buildShoreRings() {
    // Surf rings that trace the island silhouette and ripple outward, then fade.
    // The coastline is sampled into angular bins, smoothed so corners are soft,
    // and each ripple is a filled ribbon pushed seaward over its life.
    const b = this.map.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;

    // 1) sample the farthest coastline point per angular bin
    const BINS = 120;
    const far: number[] = new Array(BINS).fill(0);
    const farPt: Pt[] = new Array(BINS).fill(null as any);
    for (const t of this.map.tiles) {
      for (const pt of tileOutline(this.map, t)) {
        const a = Math.atan2(pt[1] - cy, pt[0] - cx);
        const bin = Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
        const d = Math.hypot(pt[0] - cx, pt[1] - cy);
        if (d > far[bin]) { far[bin] = d; farPt[bin] = pt; }
      }
    }
    // fill empty bins from neighbours
    for (let i = 0; i < BINS; i++) {
      if (farPt[i]) continue;
      let j = 1; while (!farPt[(i + j) % BINS] && j < BINS) j++;
      let k = 1; while (!farPt[(i - k + BINS) % BINS] && k < BINS) k++;
      const A = farPt[(i + j) % BINS], B = farPt[(i - k + BINS) % BINS];
      farPt[i] = A && B ? [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] : [cx, cy];
    }

    // 2) smooth the loop: a few passes of a wrap-around moving average round off
    //    the sharp corners while keeping the overall island shape.
    let loop: Pt[] = farPt.map((p) => [p[0], p[1]]);
    const smoothPasses = 4;
    for (let pass = 0; pass < smoothPasses; pass++) {
      const next: Pt[] = new Array(BINS);
      for (let i = 0; i < BINS; i++) {
        const p0 = loop[(i - 1 + BINS) % BINS];
        const p1 = loop[i];
        const p2 = loop[(i + 1) % BINS];
        // weighted 1-2-1 kernel
        next[i] = [(p0[0] + 2 * p1[0] + p2[0]) / 4, (p0[1] + 2 * p1[1] + p2[1]) / 4];
      }
      loop = next;
    }

    // 3) build a filled ribbon along the smoothed loop; each vertex carries its
    //    outward normal (for the seaward push) and an `across` coord (0 = shore
    //    edge, 1 = outer edge) so the shader can keep the interior solid.
    // Solid coastline "shape": a triangle-fan from the island centre out to the
    // smoothed coast loop (pushed out by `base`). Filled interior, not a ring.
    const makeRibbon = (base: number, _width: number) => {
      const pos: number[] = [];
      const nrm: number[] = [];
      const across: number[] = [];
      const rim: { x: number; y: number; nx: number; ny: number }[] = [];
      for (let i = 0; i <= BINS; i++) {
        const pt = loop[i % BINS];
        const dx = pt[0] - cx, dy = pt[1] - cy;
        const l = Math.hypot(dx, dy) || 1;
        const nx = dx / l, ny = dy / l;
        rim.push({ x: pt[0] + nx * base, y: pt[1] + ny * base, nx, ny });
      }
      const push = (x: number, y: number, nx: number, ny: number, t: number) => {
        pos.push(x * K, WATER_Y + 0.01, -y * K);
        nrm.push(nx * K, 0, -ny * K);
        across.push(t);
      };
      for (let i = 0; i < BINS; i++) {
        const a = rim[i], b2 = rim[i + 1];
        // fan triangle: centre -> a -> b2. centre across=0, rim across=1.
        push(cx, cy, 0, 0, 0);
        push(a.x, a.y, a.nx, a.ny, 1);
        push(b2.x, b2.y, b2.nx, b2.ny, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("onrm", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("across", new THREE.Float32BufferAttribute(across, 1));
      return g;
    };

    const RINGS = 4;
    const TRAVEL = PLOT * 0.55;   // how far each ripple moves out from the coast
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: this.ringUniforms.uTime,
          uPhase: { value: i / RINGS },
          uTravel: { value: TRAVEL },
          uColor: { value: new THREE.Color("#e6fbff") },
        },
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uPhase; uniform float uTravel;
          attribute vec3 onrm;
          attribute float across;
          varying float vLife;
          varying float vAcross;
          void main(){
            vLife = fract(uTime * 0.16 + uPhase);
            vAcross = across;
            vec3 pos = position + onrm * (vLife * uTravel);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; varying float vLife; varying float vAcross;
          void main(){
            // fully solid across the inner span, feather only the outermost edge
            float edge = 1.0 - smoothstep(0.80, 1.0, vAcross);
            float life = smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife));
            gl_FragColor = vec4(uColor, edge * life * 0.45);
          }`,
      });
      const ring = new THREE.Mesh(makeRibbon(PLOT * 0.09, PLOT * 0.144), mat);
      ring.renderOrder = 4;
      this.shoreRings.add(ring);
    }
    this.scene.add(this.shoreRings);
  }

  private buildLand() {
    const map = this.map;

    // shared materials
    const sandTex = makeTerrainTexture(
      { colors: [[206, 184, 142], [230, 214, 180], [244, 234, 212], [253, 250, 240]], scale: 22, octaves: 5, contrast: 1.1, speckle: 0.04, speckleColor: [255, 255, 250] },
      21,
    );
    sandTex.map.repeat.set(4.5, 4.5);
    sandTex.normalMap.repeat.set(4.5, 4.5);
    const sandMat = new THREE.MeshStandardMaterial({
      map: sandTex.map, normalMap: sandTex.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0,
      color: 0xffe9c2,
    });
    const cliffMat = new THREE.MeshStandardMaterial({ color: 0xb08558, roughness: 0.95 });

    // Tile tops use the original hand-made terrain photos (TEX) for surface
    // detail, paired with a procedural normal map so they still catch the sun.
    // TINT nudges each photo toward the palette the flat-colour pass established.
    const loader = new THREE.TextureLoader();
    const TINT: Record<TileKey, number> = {
      forest: 0x9ae88f, pasture: 0xc8f59a, field: 0xffd970, hills: 0xff9a6a,
      mountain: 0xd6e2f5, goldmine: 0xffd98a, desert: 0xfff0c4,
    };
    // ExtrudeGeometry derives top-face UVs straight from the shape coords, which
    // are already scaled by K — one tile spans roughly 0.3-0.5 UV units. So these
    // need to be single digits, not fractions, to get a few texture tiles per plot.

 const REPEAT: Record<TileKey, number> = {
      forest: 0.2, pasture: 0.2, field: 0.2, hills: 0.2,
      mountain: 0.2, goldmine: 0.2, desert: 0.2,
    };


    const topMats: Partial<Record<TileKey, THREE.MeshStandardMaterial>> = {};
    (Object.keys(STYLE) as TileKey[]).forEach((k, i) => {
      // procedural normals give relief the flat photo can't
      const { normalMap: n } = makeTerrainTexture(STYLE[k], i * 11 + 5);
      n.repeat.set(REPEAT[k], REPEAT[k]);

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(TINT[k]),
        normalMap: n,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: STYLE[k].rough,
        metalness: k === "goldmine" ? 0.4 : 0.02,
        envMapIntensity: 0.3,
      });

      const src = TEX[k];
      if (src) {
        loader.load(src, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 8;
          tex.repeat.set(REPEAT[k], REPEAT[k]);
          mat.map = tex;
          mat.needsUpdate = true;
        });
      }
      topMats[k] = mat;
    });

    const decorTree: THREE.Matrix4[] = [];
    const decorRock: THREE.Matrix4[] = [];
    const decorSheep: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    map.tiles.forEach((t) => {
      const outline = tileOutline(map, t);
      const h = HEIGHT[t.type];
      this.tileHeight[t.i] = h;

      // land prism
      const geo = new THREE.ExtrudeGeometry(shapeFrom(outline), {
        depth: h, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
      });
      geo.rotateX(-Math.PI / 2);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, [topMats[t.type]!, cliffMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: "tile", id: t.i };
      this.scene.add(mesh);
      this.tileMeshes.push(mesh);

      // beach rim
      const beach = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shapeFrom(offsetOutline(outline, 16)), { depth: 0.2, bevelEnabled: false }),
        sandMat,
      );
      beach.geometry.rotateX(-Math.PI / 2);
      beach.position.y = -0.02;
      beach.receiveShadow = true;
      this.scene.add(beach);

      // (shore surf handled globally by buildShoreRings, not per tile)
      // submerged shelf
      const shelf = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shapeFrom(offsetOutline(outline, 130)), { depth: 0.05, bevelEnabled: false }),
        sandMat,
      );
      shelf.geometry.rotateX(-Math.PI / 2);
      shelf.position.y = -0.45;
      this.scene.add(shelf);

      // medallion
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: medallionTexture(t.type), depthTest: true }));
      spr.scale.setScalar(0.9);
      spr.position.set(t.x * K, h + 0.62, -t.y * K);
      this.scene.add(spr);

      const bandit = new THREE.Sprite(new THREE.SpriteMaterial({ map: banditTexture(), depthTest: false }));
      bandit.scale.setScalar(0.85);
      bandit.position.set(t.x * K, h + 1.35, -t.y * K);
      bandit.visible = false;
      bandit.userData.tile = t.i;
      this.scene.add(bandit);
      this.banditSprites[t.i] = bandit;

      // scattered decoration
      const count = t.type === "forest" ? 16 : t.type === "mountain" ? 9 : t.type === "pasture" ? 8 : 0;
      let placed = 0, guard = 0;
      while (placed < count && guard++ < count * 12) {
        const px = t.x + (Math.random() - 0.5) * PLOT * 1.4;
        const py = t.y + (Math.random() - 0.5) * PLOT * 1.4;
        if (!pointInPoly(outline, px, py)) continue;
        placed++;
        const s = 0.75 + Math.random() * 0.6;
        dummy.position.set(px * K, h, -py * K);
        dummy.rotation.set(0, Math.random() * 6.28, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        const m = dummy.matrix.clone();
        if (t.type === "forest") decorTree.push(m);
        else if (t.type === "mountain") decorRock.push(m);
        else decorSheep.push(m);
      }
    });

    const addInstances = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) => {
      if (!mats.length) return;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      im.receiveShadow = true;
      this.scene.add(im);
    };

    const treeGeo = new THREE.ConeGeometry(0.16, 0.55, 8);
    treeGeo.translate(0, 0.3, 0);
    addInstances(treeGeo, new THREE.MeshStandardMaterial({ color: 0x1c7a34, roughness: 0.85, flatShading: true, emissive: 0x0a2e12, emissiveIntensity: 0.4 }), decorTree);

    const rockGeo = new THREE.ConeGeometry(0.3, 0.62, 5);
    rockGeo.translate(0, 0.3, 0);
    addInstances(rockGeo, new THREE.MeshStandardMaterial({ color: 0xb9c6dd, roughness: 0.6, metalness: 0.18, flatShading: true }), decorRock);

    const sheepGeo = new THREE.SphereGeometry(0.1, 10, 8);
    sheepGeo.translate(0, 0.11, 0);
    addInstances(sheepGeo, new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 1 }), decorSheep);
  }

  /* ---------- dynamic rebuild ---------- */

  private vertY(vId: number) {
    const v = this.map.verts[vId];
    let h = 0.3;
    for (const t of v.tiles) h = Math.max(h, this.tileHeight[t] ?? 0.4);
    return h;
  }
  private edgeY(e: Edge) {
    let h = 0.3;
    for (const t of e.tiles) h = Math.max(h, this.tileHeight[t] ?? 0.4);
    return h;
  }

  private edgePath(e: Edge, y: number) {
    const a = this.map.verts[e.a], b = this.map.verts[e.b];
    const pts: Pt[] = [[a.x, a.y], ...e.wob, [b.x, b.y]];
    return new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0] * K, y, -p[1] * K)));
  }

  private rebuildDynamic(players: Player[]) {
    const sig =
      this.map.edges.map((e) => e.owner).join(",") + "|" +
      this.map.verts.map((v) => (v.building ? v.building[0] + v.owner : "")).join(",");
    if (sig === this.sig) return;
    this.sig = sig;

    this.dynamic.clear();

    for (const e of this.map.edges) {
      if (e.owner < 0) continue;
      const y = this.edgeY(e) + 0.05;
      const curve = this.edgePath(e, y);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 18, 0.075, 7, false),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(players[e.owner].color),
          roughness: 0.45, metalness: 0.35,
          emissive: new THREE.Color(players[e.owner].color).multiplyScalar(0.18),
        }),
      );
      tube.castShadow = true;
      this.dynamic.add(tube);
      // sleepers
      const ties = new THREE.Group();
      for (let i = 0; i <= 6; i++) {
        const p = curve.getPointAt(i / 6);
        const tan = curve.getTangentAt(i / 6);
        const tie = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.04, 0.26),
          new THREE.MeshStandardMaterial({ color: 0x4a3722, roughness: 1 }),
        );
        tie.position.copy(p).setY(y - 0.03);
        tie.rotation.y = Math.atan2(tan.x, tan.z);
        ties.add(tie);
      }
      this.dynamic.add(ties);
    }

    for (const v of this.map.verts) {
      if (!v.building) continue;
      const col = new THREE.Color(players[v.owner].color);
      const y = this.vertY(v.i);
      const g = new THREE.Group();
      g.position.set(v.x * K, y, -v.y * K);

      const body = (w: number, hh: number, d: number, c: THREE.Color, yy: number) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(w, hh, d),
          new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.25 }),
        );
        m.position.y = yy + hh / 2;
        m.castShadow = true; m.receiveShadow = true;
        return m;
      };

      if (v.building === "capital") {
        g.add(body(0.62, 0.42, 0.62, col, 0));
        g.add(body(0.2, 0.66, 0.2, col.clone().multiplyScalar(0.75), 0.42));
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.3, 0.18),
          new THREE.MeshStandardMaterial({ color: 0xffd772, side: THREE.DoubleSide, roughness: 0.6 }),
        );
        flag.position.set(0.16, 1.0, 0);
        g.add(flag);
      } else if (v.building === "city") {
        g.add(body(0.6, 0.5, 0.42, col, 0));
        for (let i = 0; i < 3; i++) {
          const ch = body(0.1, 0.44, 0.1, col.clone().multiplyScalar(0.6), 0.5);
          ch.position.x = -0.18 + i * 0.18;
          g.add(ch);
          const smoke = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0.5, roughness: 1 }),
          );
          smoke.position.set(-0.18 + i * 0.18, 1.02, 0);
          g.add(smoke);
        }
      } else {
        g.add(body(0.42, 0.32, 0.32, col, 0));
        const ch = body(0.08, 0.3, 0.08, col.clone().multiplyScalar(0.6), 0.32);
        g.add(ch);
      }
      this.dynamic.add(g);
    }
  }

  private rebuildMarkers() {
    const sig = `${this.mode}|${[...this.legalVerts].join(",")}|${[...this.legalEdges].join(",")}`;
    if (sig === this.markerSig) return;
    this.markerSig = sig;
    this.markers.clear();

    const gold = new THREE.MeshStandardMaterial({
      color: 0xffe27a, emissive: 0xffbe33, emissiveIntensity: 0.9,
      roughness: 0.4, transparent: true, opacity: 0.92,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: 0xff9a3c, emissive: 0xff7a10, emissiveIntensity: 0.9, roughness: 0.4,
    });

    this.legalVerts.forEach((vi) => {
      const v = this.map.verts[vi];
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), gold);
      disc.position.set(v.x * K, this.vertY(vi) + 0.16, -v.y * K);
      disc.userData = { marker: "vert", id: vi };
      this.markers.add(disc);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.28 }),
      );
      beam.position.set(v.x * K, this.vertY(vi) + 0.6, -v.y * K);
      this.markers.add(beam);
    });

    const isToll = this.mode === "toll";
    this.legalEdges.forEach((ei) => {
      const e = this.map.edges[ei];
      const y = this.edgeY(e) + (isToll ? 0.16 : 0.07);
      const curve = this.edgePath(e, y);
      for (let i = 0; i < 7; i++) {
        const p = curve.getPointAt((i + 0.5) / 7);
        const tan = curve.getTangentAt((i + 0.5) / 7);
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.24), isToll ? orange : gold);
        dash.position.copy(p);
        dash.rotation.y = Math.atan2(tan.x, tan.z);
        dash.userData = { marker: "edge", id: ei };
        this.markers.add(dash);
      }
    });
  }

  /* ---------- camera / input ---------- */

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.leftPanel = w > 1200 ? 278 : 0;
    this.rightPanel = w > 1200 ? 480 : 0;
    const dx = (this.leftPanel - this.rightPanel) / 2;
    this.camera.setViewOffset(w, h, -dx, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  fit() {
    const b = this.map.bounds;
    this.tTarget.set(((b.minX + b.maxX) / 2) * K, 0.4, -((b.minY + b.maxY) / 2) * K);
    const r = Math.max(b.maxX - b.minX, b.maxY - b.minY) * K;
    this.tDist = Math.max(9, r * 1.15);
    this.tYaw = -0.45;
    this.tPitch = 0.95;
  }

  private bindInput() {
    const c = this.canvas;
    let mode: "none" | "pan" | "orbit" = "none";
    let px = 0, py = 0, sx = 0, sy = 0;
    let isTouch = false;
    let downAt = 0;
    let activeId = -1;
    // two-finger pinch state (touch only)
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    c.style.touchAction = "none";
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    c.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      isTouch = e.pointerType !== "mouse";

      // second finger: pinch-zoom + orbit, abandon the pan
      if (isTouch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        mode = "orbit";
        return;
      }
      if (pointers.size > 1) return;

      downAt = performance.now();
      activeId = e.pointerId;
      px = sx = e.clientX; py = sy = e.clientY;
      // left drag pans; right / middle / shift+left orbits
      mode = (e.button === 0 && !e.shiftKey) ? "pan" : "orbit";
      try { c.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    });

    c.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // pinch to zoom
      if (isTouch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) this.tDist = Math.max(3.2, Math.min(70, this.tDist * (pinchDist / d)));
        pinchDist = d;
        return;
      }

      if (mode === "none" || e.pointerId !== activeId) {
        if (!isTouch && mode === "none") this.hover = this.pickAt(e.clientX, e.clientY);
        return;
      }
      // if the mouse button was released outside the canvas, stop dragging
      if (!isTouch && e.buttons === 0) { mode = "none"; return; }

      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;

      if (mode === "orbit") {
        this.tYaw -= dx * 0.008;
        this.tPitch = Math.max(0.22, Math.min(1.42, this.tPitch - dy * 0.006));
      } else {
        // scale with zoom so the world tracks the cursor/finger at any distance
        const k = this.tDist * (isTouch ? 0.0042 : 0.0034);
        const fwd = new THREE.Vector3(Math.sin(this.tYaw), 0, Math.cos(this.tYaw));
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        this.tTarget.addScaledVector(right, -dx * k);
        this.tTarget.addScaledVector(fwd, -dy * k);
      }
    });

    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (e.pointerId !== activeId) { if (!pointers.size) mode = "none"; return; }

      const moved = Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy);
      const held = performance.now() - downAt;
      // fingers wobble far more than a mouse, so taps need a looser threshold
      const slop = isTouch ? 18 : 6;
      if (mode === "pan" && moved < slop && held < 700) {
        this.onPick(this.pickAt(e.clientX, e.clientY));
      }
      mode = "none";
      activeId = -1;
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      if (e.pointerId === activeId) { mode = "none"; activeId = -1; }
      if (!pointers.size) pinchDist = 0;
    });
    // releasing outside the window must not leave the camera stuck in a drag
    window.addEventListener("pointerup", (e) => {
      if (e.pointerId === activeId) { mode = "none"; activeId = -1; pointers.delete(e.pointerId); }
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.tDist = Math.max(3.2, Math.min(70, this.tDist * (e.deltaY < 0 ? 0.9 : 1.111)));
    }, { passive: false });
  }

  /** project a map point to screen pixels */
  private project(x: number, y: number, h: number): [number, number] {
    const v = new THREE.Vector3(x * K, h, -y * K).project(this.camera);
    return [((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight];
  }

  pickAt(sx: number, sy: number): { kind: string; id: number } | null {
    // fingers are far less precise than a cursor, so widen the hit radius
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (this.mode === "settlement" || this.mode === "city" || this.mode === "capital") {
      let best = -1, bd = touch ? 56 : 34;
      this.map.verts.forEach((v) => {
        if (!v.buildable) return;
        const [x, y] = this.project(v.x, v.y, this.vertY(v.i) + 0.2);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = v.i; }
      });
      return best >= 0 ? { kind: "vertex", id: best } : null;
    }
    if (this.mode === "road" || this.mode === "toll") {
      let best = -1, bd = touch ? 60 : 38;
      this.map.edges.forEach((e) => {
        if (!e.rail) return;
        const [x, y] = this.project(e.x, e.y, this.edgeY(e) + 0.1);
        const d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = e.i; }
      });
      return best >= 0 ? { kind: "edge", id: best } : null;
    }
    this.raycaster.setFromCamera(
      new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1),
      this.camera,
    );
    const hit = this.raycaster.intersectObjects(this.tileMeshes, false)[0];
    return hit ? { kind: "tile", id: (hit.object.userData as any).id } : null;
  }

  /* ---------- frame ---------- */

  draw(now: number, players: Player[]) {
    const t = now / 1000;
    this.oceanUniforms.uTime.value = t;
    this.ringUniforms.uTime.value = t;

    this.rebuildDynamic(players);
    this.rebuildMarkers();

    // bandit overlays
    this.map.tiles.forEach((tile: Tile) => {
      const spr = this.banditSprites[tile.i];
      if (!spr) return;
      const on = tile.banditUntil > now;
      spr.visible = on;
      if (on) spr.position.y = (this.tileHeight[tile.i] ?? 0.4) + 1.3 + Math.sin(t * 3) * 0.06;
    });

    // marker pulse + hover emphasis
    const hv = this.hover;
    this.markers.children.forEach((o) => {
      const ud: any = o.userData;
      const pulse = 1 + Math.sin(t * 4 + (o.position.x + o.position.z) * 2) * 0.12;
      let s = pulse;
      if (ud?.marker === "vert" && hv?.kind === "vertex" && hv.id === ud.id) s = pulse * 1.7;
      if (ud?.marker === "edge" && hv?.kind === "edge" && hv.id === ud.id) s = pulse * 1.5;
      o.scale.setScalar(s);
    });

    // camera damping
    const k = 0.14;
    this.target.lerp(this.tTarget, k);
    this.dist += (this.tDist - this.dist) * k;
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.zoom = 12 / this.dist;

    const cp = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.dist).add(this.target);
    this.camera.position.copy(cp);
    this.camera.lookAt(this.target);

    this.renderer.render(this.scene, this.camera);
  }
}

export { MapView3D as MapView };