import { Page, expect } from "@playwright/test";

export const GAME_URL = "/hexmatch/?hexhook=1&seed=1337";

export async function bootGame(page: Page) {
  await page.goto(GAME_URL);
  await page.waitForFunction(() => !!(window as any).__hex?.view, null, { timeout: 20000 });
  // wait until the map has legal capital targets (first setup step)
  await page.waitForFunction(
    () => (window as any).__hex?.view?.legalVerts?.size > 0,
    null, { timeout: 15000 },
  );
  return (window: Window) => (window as any).__hex;
}

export function hex(page: Page) {
  // proxy reads through page.evaluate for ergonomic assertions
  return new Proxy({} as any, {
    get: (_t, prop: string) => (...args: any[]) =>
      page.evaluate(({ prop, args }) => {
        const h = (window as any).__hex;
        const v = h.view;
        switch (prop) {
          case "legalVerts": return v.legalVerts.size;
          case "legalEdges": return v.legalEdges.size;
          case "mode": return v.mode;
          case "setupPhase": return h.G.setupPhase;
          case "buildMode": return h.G.buildMode;
          case "setupStep": return h.G.setupStep;
          case "yaw": return v.yaw;
          case "pitch": return v.pitch;
          case "dist": return v.dist;
          case "target": return [v.target.x, v.target.y, v.target.z];
          case "markerScreen": return v.screenPosOf(args[0], args[1]);
          case "firstLegalVertex": {
            const id = [...v.legalVerts][0];
            return { id, pos: v.screenPosOf("vertex", id) };
          }
          case "firstLegalEdge": {
            const id = [...v.legalEdges][0];
            return { id, pos: v.screenPosOf("edge", id) };
          }
          default: return undefined;
        }
      }, { prop, args }),
  });
}

/** Place the HQ (setup step 0) by tapping a legal vertex marker. */
export async function placeCapital(page: Page) {
  const { id, pos } = await hex(page).firstLegalVertex();
  expect(pos).not.toBeNull();
  await page.mouse.click(pos[0], pos[1]);
  await page.waitForFunction(
    (id) => (window as any).__hex.G.map.verts[id].building === "capital",
    id, { timeout: 5000 },
  );
}

/** Place one setup rail by tapping a legal edge marker. */
export async function placeRail(page: Page) {
  const { id, pos } = await hex(page).firstLegalEdge();
  expect(pos).not.toBeNull();
  await page.mouse.click(pos[0], pos[1]);
  await page.waitForFunction(
    (id) => (window as any).__hex.G.map.edges[id].owner === 0,
    id, { timeout: 5000 },
  );
}

/** Full guided setup: capital + two free rails → setup ends. */
export async function completeSetup(page: Page) {
  await placeCapital(page);
  await page.waitForFunction(() => (window as any).__hex.view.legalEdges.size > 0);
  await placeRail(page);
  await page.waitForFunction(() => (window as any).__hex.view.legalEdges.size > 0);
  await placeRail(page);
  await page.waitForFunction(() => (window as any).__hex.G.setupPhase === false, null, { timeout: 8000 });
}
