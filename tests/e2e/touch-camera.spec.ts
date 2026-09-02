import { test, expect, type Page } from "@playwright/test";
import { bootGame, hex } from "./helpers";

// Two-finger gesture via the Chrome DevTools Protocol (Playwright's
// touchscreen only dispatches single points). We send raw touch events.
async function twoFingerDrag(
  page: Page,
  a0: [number, number], b0: [number, number],
  a1: [number, number], b1: [number, number],
  steps = 6,
) {
  await page.touchscreen.tap(a0[0], a0[1]).catch(() => {});
  // Build touch sequences manually over CDP
  const client = await page.context().newCDPSession(page);
  const pts = [
    { x: a0[0], y: a0[1] }, { x: b0[0], y: b0[1] },
  ];
  const dispatch = (type: string, touches: { x: number; y: number }[]) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: touches.map((t, i) => ({
        x: t.x, y: t.y, id: i,
      })),
    });
  await dispatch("touchStart", pts);
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    const cur = [
      { x: a0[0] + (a1[0] - a0[0]) * f, y: a0[1] + (a1[1] - a0[1]) * f },
      { x: b0[0] + (b1[0] - b0[0]) * f, y: b0[1] + (b1[1] - b0[1]) * f },
    ];
    await dispatch("touchMove", cur);
    await page.waitForTimeout(16);
  }
  await dispatch("touchEnd", []);
}

test.describe("touch camera (#5/#6/#7)", () => {
  test.beforeEach(async ({ page }) => {
    await bootGame(page);
  });

  test("one-finger drag pans the camera", async ({ page }) => {
    const before = await hex(page).target();
    await page.mouse.move(200, 300);
    await page.touchscreen.tap(200, 300).catch(() => {});
    // one-finger pan: pointer down → move → up
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x: 200, y: 300, id: 0 }],
    });
    for (let i = 1; i <= 6; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 200 + i * 12, y: 300 + i * 10, id: 0 }],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500); // damping
    const after = await hex(page).target();
    expect(Math.abs(after[0] - before[0]) + Math.abs(after[2] - before[2])).toBeGreaterThan(0.3);
  });

  test("two-finger twist rotates and pitches the camera (ticket #5)", async ({ page }) => {
    const yawBefore = await hex(page).yaw();
    const pitchBefore = await hex(page).pitch();
    // both fingers move right with a slight downward drift → yaw should change
    await twoFingerDrag(page, [140, 300], [260, 300], [200, 300], [320, 300]);
    await page.waitForTimeout(500);
    const yawAfter = await hex(page).yaw();
    expect(Math.abs(yawAfter - yawBefore)).toBeGreaterThan(0.05);
    // vertical midpoint movement changes pitch
    await twoFingerDrag(page, [180, 200], [280, 200], [180, 320], [280, 320]);
    await page.waitForTimeout(500);
    const pitchAfter = await hex(page).pitch();
    expect(Math.abs(pitchAfter - pitchBefore)).toBeGreaterThan(0.03);
    // pitch is clamped to the allowed range
    expect(pitchAfter).toBeGreaterThanOrEqual(0.22);
    expect(pitchAfter).toBeLessThanOrEqual(1.42);
  });

  test("pinch zoom changes distance (ticket #6)", async ({ page }) => {
    const before = await hex(page).dist();
    // fingers move apart → zoom in (dist decreases)
    await twoFingerDrag(page, [180, 300], [220, 300], [120, 300], [280, 300]);
    await page.waitForTimeout(600);
    const after = await hex(page).dist();
    expect(after).toBeLessThan(before);
  });

  test("lifting one finger after a pinch leaves a working pan, not a stuck orbit (ticket #7)", async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    // start two fingers, pinch, then lift the second
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 150, y: 300, id: 0 }, { x: 250, y: 300, id: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 130, y: 300, id: 0 }, { x: 270, y: 300, id: 1 }],
    });
    // lift finger 1
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd", touchPoints: [{ x: 130, y: 300, id: 0 }],
    });
    await page.waitForTimeout(50);
    // remaining finger pans: target should move without the camera snapping
    const t0 = await hex(page).target();
    for (let i = 1; i <= 5; i++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: 130 + i * 10, y: 300, id: 0 }],
      });
      await page.waitForTimeout(16);
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
    const t1 = await hex(page).target();
    expect(Math.abs(t1[0] - t0[0]) + Math.abs(t1[2] - t0[2])).toBeGreaterThan(0.1);
  });
});
