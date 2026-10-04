// @vitest-environment jsdom
// LIVE3D-ON (#698): 3D is the default; ?three=0 and the stored setting turn it off; the URL wins.
import { beforeEach, describe, expect, it } from "vitest";
import { mountThreeLayer, setThreeSetting, threeSetting, threeUnavailable, threeWanted, rotationAvailable } from "../../src/iso/three-layer";

beforeEach(() => { localStorage.clear(); });

describe("LIVE3D-ON", () => {
  it("is on by default and for ?three=1", () => {
    expect(threeWanted("")).toBe(true);
    expect(threeWanted("?three=1")).toBe(true);
  });
  it("?three=0 and the setting off give 2D", () => {
    expect(threeWanted("?three=0")).toBe(false);
    setThreeSetting(false);
    expect(threeSetting()).toBe(false);
    expect(threeWanted("")).toBe(false);
  });
  it("the URL overrides the stored setting for one boot", () => {
    setThreeSetting(false);
    expect(threeWanted("?three=1")).toBe(true);
    setThreeSetting(true);
    expect(threeWanted("?three=0")).toBe(false);
    expect(threeSetting()).toBe(true);   // the stored choice is untouched
  });
  it("a failing WebGL context falls back to null, silently, and reads as unavailable", () => {
    const host = document.createElement("div");
    expect(mountThreeLayer(host, null, "")).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();
    expect(rotationAvailable()).toBe(false);
    expect(threeUnavailable()).toBe(true);
  });
});
