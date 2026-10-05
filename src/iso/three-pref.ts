// LIVE3D-ON (#698): the persisted "3D buildings" setting. Its own tiny module so the
// menu (SETTINGS-1 #701) can read and write it without importing three.js;
// `three-layer.ts` re-exports both functions for its existing callers.
const THREE_KEY = "hexmatch.three3d";
export const threeSetting = (): boolean => {
  try { return localStorage.getItem(THREE_KEY) !== "0"; } catch { return true; }
};
export const setThreeSetting = (on: boolean): void => {
  try { localStorage.setItem(THREE_KEY, on ? "1" : "0"); } catch { /* storage blocked */ }
};
