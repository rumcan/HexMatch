#!/usr/bin/env node
// ART-3D (#504) step 1 — turn painted masters into 3D models on Meshy.
//
//   node tools/meshy/submit.mjs [--env ../hm-hud/.env.local] [--model meshy-6]
//        [--prompts prompts.json]   (names found there go through text-to-3D)
//        [--polycount 30000] [--src assets/buildings-src] [--min-credits 35]
//        [--batch A_industries|B_depots|C_town|all] [<name> …]
//
// --batch reads names from tools/meshy/batch.json. Before each NEW task the
// balance is read; below --min-credits the run stops cleanly (a task is
// never started that the account cannot finish), and a re-run resumes.
//
// For each <name> it uploads <src>/<name>@2x.png (upscaled 4× with lanczos
// first — the masters are small, and image-to-3D reads detail it is given),
// polls the image-to-3d task, and downloads the result into
// tools/art-src/meshy/<name>/ (model.glb, thumbnail.png, task.json).
// Re-runnable: a name whose model.glb exists is skipped, and a task already
// submitted (task.json without a model) is polled rather than paid for again.
//
// The key: MESHY_API_KEY from the environment, or from the dotenv file given
// with --env (the lead keeps it in hm-hud/.env.local, git-ignored by *.local).
// It is never printed, logged or written anywhere by this script.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const API = "https://api.meshy.ai/openapi/v1";
const API2 = "https://api.meshy.ai/openapi/v2";
const OUT = "tools/art-src/meshy";

function parseArgs(argv) {
  const opts = { env: null, model: "meshy-6", polycount: 30000, src: "assets/buildings-src", minCredits: 35, names: [], prompts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--env") opts.env = argv[++i];
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--polycount") opts.polycount = Number(argv[++i]);
    else if (a === "--src") opts.src = argv[++i];
    else if (a === "--prompts") opts.prompts = JSON.parse(fs.readFileSync(argv[++i], "utf8"));
    else if (a === "--min-credits") opts.minCredits = Number(argv[++i]);
    else if (a === "--batch") {
      const b = JSON.parse(fs.readFileSync("tools/meshy/batch.json", "utf8"));
      const key = argv[++i];
      for (const [k, v] of Object.entries(b)) if (!k.startsWith("_") && (key === "all" || k === key)) opts.names.push(...v);
    }
    else opts.names.push(a);
  }
  return opts;
}

function loadKey(envFile) {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY.trim();
  if (envFile && fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*MESHY_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m) return m[1];
    }
  }
  throw new Error("MESHY_API_KEY not set (env var, or --env <dotenv file>)");
}

async function api(key, method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function balance(key) {
  try { return (await api(key, "GET", "/balance")).balance ?? null; } catch { return null; }
}

async function dataUri(file) {
  const meta = await sharp(file).metadata();
  // Small masters are upscaled 4×; big ones (owner renders) only up to ~1024 px.
  const k = Math.max(1, Math.min(4, Math.round(1024 / meta.width)));
  const png = await sharp(file)
    .resize(meta.width * k, meta.height * k, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.names.length) throw new Error("name at least one master");
  const key = loadKey(opts.env);
  const before = await balance(key);
  console.log(`credits before: ${before ?? "?"}`);

  for (const name of opts.names) {
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const glb = path.join(dir, "model.glb");
    const taskFile = path.join(dir, "task.json");
    if (fs.existsSync(glb)) { console.log(`${name}: model exists, skipped`); continue; }

    let id = fs.existsSync(taskFile) ? JSON.parse(fs.readFileSync(taskFile, "utf8")).id : null;
    if (!id) {
      const bal = await balance(key);
      if (bal != null && bal < opts.minCredits) {
        console.log(`${name}: stopping — balance ${bal} < ${opts.minCredits} credits. Top up and re-run to resume.`);
        break;
      }
      const prompt = opts.prompts[name];
      if (prompt) {
        // Text-to-3D (no usable master): preview, then refine with textures.
        const pre = (await api(key, "POST", `${API2}/text-to-3d`, {
          mode: "preview", prompt, art_style: "realistic", ai_model: opts.model,
          should_remesh: true, topology: "triangle", target_polycount: opts.polycount,
        })).result;
        console.log(`${name}: text preview ${pre}`);
        for (;;) {
          const t = await api(key, "GET", `${API2}/text-to-3d/${pre}`);
          if (t.status === "SUCCEEDED") break;
          if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`${name}: preview ${t.status}`);
          await sleep(10_000);
        }
        id = (await api(key, "POST", `${API2}/text-to-3d`, { mode: "refine", preview_task_id: pre, enable_pbr: false })).result;
        fs.writeFileSync(taskFile, JSON.stringify({ id, name, prompt, preview: pre, kind: "text", model: opts.model }, null, 2));
        console.log(`${name}: refine ${id}`);
      } else {
      const src = path.join(opts.src, `${name}@2x.png`);
      const body = {
        image_url: await dataUri(src),
        ai_model: opts.model,
        should_texture: true,
        enable_pbr: false,
        should_remesh: true,
        topology: "triangle",
        target_polycount: opts.polycount,
      };
      id = (await api(key, "POST", "/image-to-3d", body)).result;
      fs.writeFileSync(taskFile, JSON.stringify({ id, name, src, model: opts.model, polycount: opts.polycount }, null, 2));
      console.log(`${name}: submitted ${id}`);
      }
    } else {
      console.log(`${name}: resuming ${id}`);
    }

    const isText = !!opts.prompts[name];
    const poll = isText ? `${API2}/text-to-3d/${id}` : `/image-to-3d/${id}`;
    let task;
    for (;;) {
      task = await api(key, "GET", poll);
      if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED") break;
      process.stdout.write(`  ${name}: ${task.status} ${task.progress ?? 0}%\r`);
      await sleep(10_000);
    }
    if (task.status !== "SUCCEEDED") {
      console.log(`\n${name}: ${task.status} ${JSON.stringify(task.task_error ?? {})}`);
      continue;
    }
    await download(task.model_urls.glb, glb);
    if (task.thumbnail_url) await download(task.thumbnail_url, path.join(dir, "thumbnail.png"));
    const kept = { id, name, status: task.status, model: opts.model, polycount: opts.polycount, created_at: task.created_at, finished_at: task.finished_at };
    fs.writeFileSync(taskFile, JSON.stringify(kept, null, 2));
    console.log(`\n${name}: ${(fs.statSync(glb).size / 1e6).toFixed(1)} MB → ${glb}`);
  }

  const after = await balance(key);
  console.log(`credits after: ${after ?? "?"}${before != null && after != null ? ` (used ${before - after})` : ""}`);
}

run().catch((e) => { console.error(e.message); process.exit(1); });
