#!/usr/bin/env node
/**
 * Y1 — declaration-driven sprite extractor.
 *
 * Parses OpenGFX's `.pnml` sprite declarations (restored to
 * `src/assets/sprites/pnml/{base,templates}/*.pnml`) instead of guessing
 * pixel rectangles by eye. Two forms are handled:
 *
 *   Direct:    base_graphics sprNNNN(NNNN, "file") { [x, y, w, h, xrel, yrel(, flags)] }
 *   Templated: base_graphics sprNNNN(NNNN, "file") { tmpl_groundtiles(1, 1) }
 *
 * Templates (`sprites/templates/sprite_templates.pnml`) may themselves call
 * other templates with arithmetic expressions over their parameters
 * (`tmpl_rough(1510+x, y)`), so expansion is a small recursive-descent
 * expression evaluator plus macro expander, not a regex.
 *
 * Output: tools/opengfx-sprites.json, keyed by sprite id (string):
 *   { "3981": { "file": "terrain/grass-temperate.gimp.png",
 *               "x": 0, "y": 1, "w": 64, "h": 31, "xrel": -31, "yrel": 0,
 *               "flags": [] } }
 *
 * Usage:
 *   node tools/parse-pnml.mjs                       # writes the JSON file
 *   import { parsePnml } from "./parse-pnml.mjs"     # for unit tests
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNML_ROOT = join(ROOT, "src/assets/sprites/pnml");
const KNOWN_FLAGS = new Set(["ANIM", "NOCROP"]);

// ── tokenizer ────────────────────────────────────────────────────────────
function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1, s = "";
      while (j < n && text[j] !== '"') { s += text[j]; j++; }
      tokens.push({ type: "str", value: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9]/.test(text[j])) j++;
      // NML hex literals (0x01..0xFF ranges in recolour tables) — not used
      // in sprite geometry, but tolerate them so the tokenizer never wedges.
      if (text[j] === "x" || text[j] === "X") {
        j++;
        while (j < n && /[0-9a-fA-F]/.test(text[j])) j++;
        tokens.push({ type: "num", value: parseInt(text.slice(i, j), 16) });
      } else {
        tokens.push({ type: "num", value: Number(text.slice(i, j)) });
      }
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
      tokens.push({ type: "ident", value: text.slice(i, j) });
      i = j;
      continue;
    }
    if ("(),[]{}+*-".includes(c)) {
      tokens.push({ type: c, value: c });
      i++;
      continue;
    }
    if (c === ":" || c === ";" || c === "." || c === "|") { i++; continue; }
    // unknown character — skip (keeps the parser resilient to stray syntax
    // in parts of the grammar we don't model, e.g. NML string escapes)
    i++;
  }
  return tokens;
}

// ── recursive-descent statement / expression parser ───────────────────────
// Grammar (the subset of NML this file actually needs):
//   program    := statement*
//   statement  := templateDef | graphicsDecl
//   templateDef:= 'template' IDENT '(' params ')' '{' bodyStmt* '}'
//   graphicsDecl := ('base_graphics' | 'alternative_sprites') '(' ... ')' IDENT? ... — see parseTopLevel
//   bodyStmt   := array | call
//   array      := '[' expr (',' expr)* ']'
//   call       := IDENT '(' (expr (',' expr)*)? ')'
//   expr       := term (('+'|'-') term)*
//   term       := factor ('*' factor)*
//   factor     := '-' factor | NUMBER | STRING | IDENT | '(' expr ')'
class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek(o = 0) { return this.t[this.i + o]; }
  next() { return this.t[this.i++]; }
  expect(type) {
    const tok = this.next();
    if (!tok || tok.type !== type) throw new Error(`expected ${type}, got ${tok ? tok.type + ":" + tok.value : "EOF"}`);
    return tok;
  }
  atEnd() { return this.i >= this.t.length; }

  parseExpr() {
    let node = this.parseTerm();
    while (this.peek() && (this.peek().type === "+" || this.peek().type === "-")) {
      const op = this.next().type;
      node = { op, l: node, r: this.parseTerm() };
    }
    return node;
  }
  parseTerm() {
    let node = this.parseFactor();
    while (this.peek() && this.peek().type === "*") {
      this.next();
      node = { op: "*", l: node, r: this.parseFactor() };
    }
    return node;
  }
  parseFactor() {
    const tok = this.peek();
    if (!tok) throw new Error("unexpected EOF in expression");
    if (tok.type === "-") { this.next(); return { op: "neg", l: this.parseFactor() }; }
    if (tok.type === "num") { this.next(); return { lit: tok.value }; }
    if (tok.type === "str") { this.next(); return { lit: tok.value }; }
    if (tok.type === "ident") { this.next(); return { ident: tok.value }; }
    if (tok.type === "(") {
      this.next();
      const e = this.parseExpr();
      this.expect(")");
      return e;
    }
    throw new Error(`unexpected token ${tok.type}:${tok.value} in expression`);
  }

  /** One array literal `[ e, e, ... ]`. */
  parseArray() {
    this.expect("[");
    const items = [];
    if (this.peek().type !== "]") {
      items.push(this.parseExpr());
      while (this.peek().type === ",") { this.next(); items.push(this.parseExpr()); }
    }
    this.expect("]");
    return { kind: "array", items };
  }

  /** One template call `name(e, e, ...)`. */
  parseCall() {
    const name = this.expect("ident").value;
    this.expect("(");
    const args = [];
    if (this.peek().type !== ")") {
      args.push(this.parseExpr());
      while (this.peek().type === ",") { this.next(); args.push(this.parseExpr()); }
    }
    this.expect(")");
    return { kind: "call", name, args };
  }

  /**
   * Body of a template or base_graphics/alternative_sprites block: zero or
   * more statements. Recolour tables (`recolour_sprite { 0x01..0x0C: 0xF0; }`)
   * are not sprite geometry and are not part of Y1's concern — skip any
   * nested `ident { ... }` block wholesale rather than trying to parse its
   * (very different) inner grammar.
   */
  parseBody() {
    this.expect("{");
    const stmts = [];
    while (this.peek() && this.peek().type !== "}") {
      if (this.peek().type === "[") { stmts.push(this.parseArray()); continue; }
      if (this.peek().type === "ident" && this.peek(1)?.type === "{") {
        this.next(); // block name
        let depth = 0;
        do {
          const t = this.next();
          if (t.type === "{") depth++;
          if (t.type === "}") depth--;
        } while (depth > 0);
        continue;
      }
      stmts.push(this.parseCall());
    }
    this.expect("}");
    return stmts;
  }
}

/** Evaluate an expression node against a scope of already-resolved values (numbers or strings). */
function evalExpr(node, scope) {
  if ("lit" in node) return node.lit;
  if ("ident" in node) {
    if (node.ident in scope) return scope[node.ident];
    // Unbound identifier: a bare flag word (ANIM/NOCROP) or an unresolved
    // template parameter used only positionally (e.g. a file placeholder).
    return node.ident;
  }
  if (node.op === "neg") {
    const v = evalExpr(node.l, scope);
    if (typeof v !== "number") throw new Error(`cannot negate non-numeric operand ${JSON.stringify(v)}`);
    return -v;
  }
  const l = evalExpr(node.l, scope), r = evalExpr(node.r, scope);
  if (typeof l !== "number" || typeof r !== "number") {
    throw new Error(`cannot apply '${node.op}' to non-numeric operands (${JSON.stringify(l)}, ${JSON.stringify(r)})`);
  }
  if (node.op === "+") return l + r;
  if (node.op === "-") return l - r;
  return l * r;
}

/** Parse every `template NAME(params) { ... }` in the given text into a map. */
function parseTemplates(text) {
  const tokens = tokenize(text);
  const p = new Parser(tokens);
  const templates = new Map();
  while (!p.atEnd()) {
    const tok = p.peek();
    if (tok.type === "ident" && tok.value === "template") {
      p.next();
      const name = p.expect("ident").value;
      p.expect("(");
      const params = [];
      if (p.peek().type !== ")") {
        params.push(p.expect("ident").value);
        while (p.peek().type === ",") { p.next(); params.push(p.expect("ident").value); }
      }
      p.expect(")");
      // Inline single-line templates: `template foo(x) { [x, ...] }` — parseBody handles both.
      const body = p.parseBody();
      templates.set(name, { params, body });
    } else {
      p.next();
    }
  }
  return templates;
}

/**
 * Expand a list of body statements (arrays and/or template calls) into a
 * flat list of raw sprite rectangles `{x,y,w,h,xrel,yrel,flags,file?}`.
 * `scope` maps the enclosing template's parameter names to resolved values.
 */
function expandStmts(stmts, scope, templates) {
  const out = [];
  for (const stmt of stmts) {
    if (stmt.kind === "array") {
      const vals = stmt.items.map((it) => evalExpr(it, scope));
      const [x, y, w, h, xrel, yrel, ...rest] = vals;
      const flags = [];
      let file;
      for (const v of rest) {
        if (typeof v === "string" && KNOWN_FLAGS.has(v)) flags.push(v);
        else if (typeof v === "string") file = v;
      }
      out.push({ x, y, w, h, xrel, yrel, flags, ...(file ? { file } : {}) });
    } else {
      const def = templates.get(stmt.name);
      if (!def) throw new Error(`unknown template '${stmt.name}'`);
      const args = stmt.args.map((a) => evalExpr(a, scope));
      const inner = {};
      def.params.forEach((p, i) => { inner[p] = args[i]; });
      out.push(...expandStmts(def.body, inner, templates));
    }
  }
  return out;
}

/** Parse every `base_graphics sprNNNN(NNNN, "file") { ... }` declaration in `text`. */
function parseBaseGraphics(text, templates) {
  const tokens = tokenize(text);
  const p = new Parser(tokens);
  const sprites = {};
  while (!p.atEnd()) {
    const tok = p.peek();
    if (tok.type === "ident" && tok.value === "template") {
      // Some base files declare a private template alongside their sprites
      // (e.g. base-3092-road-vehicles.pnml's tmpl_roadvehicles). Those were
      // already collected into `templates` in a first pass; skip the body
      // here so the token stream stays aligned.
      p.next();
      p.expect("ident");
      p.expect("(");
      while (p.peek().type !== ")") p.next();
      p.expect(")");
      p.parseBody();
    } else if (tok.type === "ident" && tok.value === "base_graphics") {
      p.next();
      p.expect("ident"); // sprNNNN label — redundant with the numeric id below
      p.expect("(");
      const id = p.expect("num").value;
      p.expect(",");
      const file = p.expect("str").value;
      p.expect(")");
      const body = p.parseBody();
      const entries = expandStmts(body, {}, templates);
      entries.forEach((e, offset) => {
        const sid = id + offset;
        sprites[sid] = { file: e.file ?? file, x: e.x, y: e.y, w: e.w, h: e.h, xrel: e.xrel, yrel: e.yrel, flags: e.flags };
      });
    } else if (tok.type === "ident" && tok.value === "alternative_sprites") {
      // 2x/hi-dpi overlays — not part of the base declaration set we care
      // about (E1 only needs the 1x base graphics). Skip the whole block.
      p.next();
      p.expect("(");
      let depth = 1;
      while (depth > 0) { const t = p.next(); if (t.type === "(") depth++; if (t.type === ")") depth--; }
      p.parseBody();
    } else {
      p.next();
    }
  }
  return sprites;
}

/**
 * Parse the whole restored OpenGFX declaration set into one
 * `{ [spriteId]: {file,x,y,w,h,xrel,yrel,flags} }` map.
 */
export function parsePnml(root = PNML_ROOT) {
  const templateFiles = readdirSync(join(root, "templates"))
    .filter((f) => f.endsWith(".pnml") || f.endsWith(".nml"));
  const templates = new Map();
  for (const f of templateFiles) {
    const text = readFileSync(join(root, "templates", f), "utf8");
    for (const [k, v] of parseTemplates(text)) templates.set(k, v);
  }
  const baseFiles = readdirSync(join(root, "base")).filter((f) => f.endsWith(".pnml"));
  const baseTexts = baseFiles.map((f) => readFileSync(join(root, "base", f), "utf8"));
  // A few base files declare their own private templates alongside sprites
  // (e.g. tmpl_roadvehicles, tmpl_default_face, tmpl_aircraft_*) — collect
  // those too before expanding any sprite declarations.
  for (const text of baseTexts) {
    for (const [k, v] of parseTemplates(text)) templates.set(k, v);
  }
  const sprites = {};
  for (let i = 0; i < baseTexts.length; i++) {
    try {
      Object.assign(sprites, parseBaseGraphics(baseTexts[i], templates));
    } catch (e) {
      throw new Error(`while parsing ${baseFiles[i]}: ${e.message}`);
    }
  }
  return sprites;
}

const isCli = process.argv[1] && import.meta.url.split("/").pop() === process.argv[1].split("/").pop();
if (isCli) {
  const sprites = parsePnml();
  const out = join(ROOT, "tools/opengfx-sprites.json");
  const sorted = {};
  for (const k of Object.keys(sprites).sort((a, b) => Number(a) - Number(b))) sorted[k] = sprites[k];
  writeFileSync(out, JSON.stringify(sorted, null, 2));
  console.log(`parsed sprites: ${Object.keys(sprites).length}`);
  const sample = [1332, 2011, 2013, 3981];
  for (const id of sample) {
    const s = sprites[id];
    if (s) console.log(id, s.file, s.x, s.y, `${s.w}x${s.h}`, "xrel", s.xrel, "yrel", s.yrel, s.flags.join(","));
  }
  console.log(`wrote ${out}`);
}
