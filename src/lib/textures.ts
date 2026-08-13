import * as THREE from "three";

/* ---------- tiny value-noise helpers ---------- */

function hash(x: number, y: number, seed = 1) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves = 5, seed = 1) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, y * freq, seed + i * 13);
    freq *= 2.07;
    amp *= 0.5;
  }
  return v;
}

function mix(a: number[], b: number[], t: number) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export type TerrainStyle = {
  colors: number[][]; // gradient ramp (dark -> light)
  scale: number;
  octaves: number;
  contrast: number;
  speckle?: number;
  speckleColor?: number[];
};

const SIZE = 256;

/** Generates a color map + a matching normal map from fbm noise. */
export function makeTerrainTexture(style: TerrainStyle, seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);

  const height = new Float32Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      let n = fbm(
        (x / SIZE) * style.scale,
        (y / SIZE) * style.scale,
        style.octaves,
        seed,
      );
      n = Math.min(1, Math.max(0, (n - 0.5) * style.contrast + 0.5));
      height[i] = n;

      // ramp
      const ramp = style.colors;
      const f = n * (ramp.length - 1);
      const idx = Math.min(ramp.length - 2, Math.floor(f));
      let c = mix(ramp[idx], ramp[idx + 1], f - idx);

      if (style.speckle && hash(x, y, seed * 3) < style.speckle) {
        c = mix(c, style.speckleColor ?? [255, 255, 255], 0.55);
      }

      const p = i * 4;
      img.data[p] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  // normal map from height field
  const nCanvas = document.createElement("canvas");
  nCanvas.width = nCanvas.height = SIZE;
  const nCtx = nCanvas.getContext("2d")!;
  const nImg = nCtx.createImageData(SIZE, SIZE);
  const strength = 3.0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const l = height[y * SIZE + ((x - 1 + SIZE) % SIZE)];
      const r = height[y * SIZE + ((x + 1) % SIZE)];
      const u = height[((y - 1 + SIZE) % SIZE) * SIZE + x];
      const d = height[((y + 1) % SIZE) * SIZE + x];
      const dx = (l - r) * strength;
      const dy = (u - d) * strength;
      const len = Math.hypot(dx, dy, 1);
      const p = (y * SIZE + x) * 4;
      nImg.data[p] = ((dx / len) * 0.5 + 0.5) * 255;
      nImg.data[p + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nImg.data[p + 2] = (1 / len) * 0.5 * 255 + 127;
      nImg.data[p + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;

  return { map, normalMap };
}
