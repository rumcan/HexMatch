import { chromium } from "@playwright/test";
const [,, out, names, yaws = "0,1,2,3", extra = ""] = process.argv;
const b = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const p = await (await b.newContext({ viewport: { width: 1200, height: 400 } })).newPage();
p.on("console", (m) => console.log(m.text())); p.on("pageerror", (e) => console.log("ERR", e.message));
for (const y of yaws.split(",")) {
  await p.goto(`http://localhost:5180/gallery-tmp.html?m=${names}&yaw=${y}${extra}`);
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 }); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}-${y}.png` });
}
await b.close();
