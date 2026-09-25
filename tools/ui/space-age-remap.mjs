#!/usr/bin/env node
// UI Space Age (docs/UI_SPACE_AGE_PLAN.md, P2 + P3): a one-shot rewrite of
// src/game/styles.css. It remaps the old theme's hard-coded warm colours onto
// the Space Age palette and (with --flatten) removes rounding, gradients,
// bevels, glows and text shadows. Protected selectors (gems, the match-3
// board, cargo identity colours, map labels, floats, portraits, story art) are
// never touched. Every change is written to tools/ui/space-age-remap.report.txt.
//
//   node tools/ui/space-age-remap.mjs [--flatten] [--dry]
import { readFileSync, writeFileSync } from "node:fs";

const CSS = "src/game/styles.css";
const REPORT = "tools/ui/space-age-remap.report.txt";
const FLATTEN = process.argv.includes("--flatten");
const DRY = process.argv.includes("--dry");

const PROTECTED = /gem|\.face|\.grid\b|\.cell|board-|cargo|data-cargo|grain|iso-label|float|portrait|tycoon|story|@font-face|keyframes|\.fx-|minimap-canvas/i;

// ── colour maths (sRGB ↔ OKLCH) ─────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
function toOklch([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb); let h = (Math.atan2(bb, a) * 180) / Math.PI; if (h < 0) h += 360;
  return { L, C, h };
}
function fromOklch({ L, C, h }) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

// ── explicit families (alpha kept) ──────────────────────────────────────
const FAMILY = new Map();
const fam = (name, list) => list.forEach((k) => FAMILY.set(k, name));
fam("orange", ["255,176,46", "255,166,43", "233,168,62", "255,217,138", "255,212,126", "201,135,49"]);
fam("line", ["201,162,74", "200,161,58", "107,81,35", "98,68,24", "151,119,47"]);
fam("bone", ["242,220,166", "239,228,208", "255,246,221", "242,230,200", "236,224,198", "247,230,189"]);
fam("red", ["226,112,79"]);

function parseColor(tok) {
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(tok))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, a };
  }
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i.exec(tok))) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { rgb: [+m[1], +m[2], +m[3]], a };
  }
  return null;
}
const withAlpha = (rgb, a) => (a >= 1 ? hex(rgb) : `rgba(${rgb.join(", ")}, ${+a.toFixed(3)})`);

function remapColor(tok) {
  const c = parseColor(tok);
  if (!c) return tok;
  const key = c.rgb.join(",");
  const f = FAMILY.get(key);
  if (f) return `rgb(var(--c-${f}) / ${+c.a.toFixed(3)})`;
  const o = toOklch(c.rgb);
  const warm = o.h >= 20 && o.h <= 110;
  if (o.C < 0.004 || !warm) return tok;                 // neutral or cool: leave
  if (o.C < 0.06) return withAlpha(fromOklch({ L: o.L, C: 0.01, h: 215 }), c.a);   // warm grey/brown → cool charcoal
  if (o.L > 0.82) return `rgb(var(--c-bone) / ${+c.a.toFixed(3)})`;
  return withAlpha(fromOklch({ L: o.L, C: Math.min(o.C, 0.16), h: 62 }), c.a);     // warm saturated → orange at same L
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

// ── flatten helpers ─────────────────────────────────────────────────────
function splitTop(v, sep = ",") {
  const out = []; let depth = 0, cur = "";
  for (const ch of v) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out.map((s) => s.trim());
}
function firstStop(grad) {
  const inner = grad.slice(grad.indexOf("(") + 1, grad.lastIndexOf(")"));
  for (const part of splitTop(inner)) {
    const m = /(rgb\(var\(--[a-z0-9-]+\)\s*\/\s*[\d.]+\)|#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|var\(--[a-z0-9-]+\)|transparent)/i.exec(part);
    if (m && !/deg|turn|^to |circle|ellipse|at /i.test(part.split(m[0])[0].trim() || "")) return m[1];
  }
  return null;
}
function flattenDecl(prop, value) {
  const p = prop.trim().toLowerCase();
  if (/radius$/.test(p)) return /50%/.test(value) ? value : "0";
  if (p === "box-shadow") {
    if (/^\s*none\s*$/.test(value)) return value;
    const layers = splitTop(value);
    const crisp = layers.every((l) => !/inset/.test(l) && /^(-?[\d.]+px|0)\s+(-?[\d.]+px|0)\s+(0|0px)\b/.test(l.replace(/^\s+/, "")));
    return crisp ? value : "none";
  }
  if (p === "text-shadow") return "none";
  if ((p === "background" || p === "background-image") && /gradient\(/.test(value) && !/url\(|var\(--(room|iron|felt|ledger|flat|plate)/.test(value)) {
    if (/transparent/.test(value)) return value;
    const layers = splitTop(value);
    const last = layers[layers.length - 1];
    const g = /(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)/.exec(last);
    if (!g) return value;
    const stop = firstStop(g[0]);
    if (!stop) return value;
    return p === "background-image" ? "none" : last.replace(g[0], stop);
  }
  return value;
}

// ── walk the sheet ──────────────────────────────────────────────────────
const src = readFileSync(CSS, "utf8");
const report = [];
let out = "", i = 0, stack = [], segStart = 0;
while (i < src.length) {
  if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end); i = end; continue; }
  const ch = src[i];
  if (ch === "{") {
    const sel = src.slice(segStart, i).trim().replace(/\s+/g, " ");
    stack.push(sel); out += ch; i++; segStart = i;
    // is this block a declaration block (no nested { before its }) ?
    const close = src.indexOf("}", i), nextOpen = src.indexOf("{", i);
    if (close >= 0 && (nextOpen < 0 || nextOpen > close) && !/^@/.test(sel)) {
      const body = src.slice(i, close);
      const inherited = stack.join(" ");
      let newBody = body;
      if (!PROTECTED.test(inherited)) {
        newBody = body.replace(/(^|;)(\s*)([a-z-]+)(\s*:\s*)([^;]*)/gi, (all, pre, ws, prop, colon, value) => {
          if (/^--/.test(prop)) return all;
          let v = value.replace(COLOR_RE, (tok) => { const r = remapColor(tok); if (r !== tok) report.push(`${sel} | ${prop}: ${tok} -> ${r}`); return r; });
          if (FLATTEN) { const f = flattenDecl(prop, v); if (f !== v) { report.push(`${sel} | ${prop}: ${v.trim().slice(0, 90)} -> ${f.trim().slice(0, 90)}`); v = f; } }
          return pre + ws + prop + colon + v;
        });
      }
      out += newBody + "}"; i = close + 1; stack.pop(); segStart = i; continue;
    }
    continue;
  }
  if (ch === "}") { stack.pop(); out += ch; i++; segStart = i; continue; }
  if (ch === ";" && stack.length === 0) { out += ch; i++; segStart = i; continue; }
  out += ch; i++;
}
writeFileSync(REPORT, report.join("\n") + "\n");
if (!DRY) writeFileSync(CSS, out);
console.log(`${report.length} changes${DRY ? " (dry run)" : ""} → ${REPORT}`);
