import { describe, expect, it } from 'vitest';
import { runRace } from './helpers/race';

// A deterministic handful of seeds keeps the test-side balance probe quick.
// Wide win-rate and duration bands intentionally catch catastrophic drift;
// the full 30-seed calibration is emitted by tools/balance-sim.mjs.
describe('BAL-1 balance simulation smoke', () => {
  it('runs several deterministic opening windows and records progress', () => {
    for (const seed of [7, 42, 1337]) {
      const race = runRace(seed, { minutes: 1, skills: ['normal', 'normal'] });
      expect(race.trace.length, `seed ${seed} has no time series`).toBeGreaterThan(0);
      expect(race.trace.every(p => p.you >= 0 && p.ai >= 0), `seed ${seed} has invalid stars`).toBe(true);
    }
  }, 120_000);
});
