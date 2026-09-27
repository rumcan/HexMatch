import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { moneyValueOf } from '../../src/iso/config';
import { runRace } from './helpers/race';

const count = Number(process.env.BALANCE_SEEDS ?? 30);
const firstSeed = Number(process.env.BALANCE_FIRST_SEED ?? 1000);
const minutes = Number(process.env.BALANCE_MINUTES ?? 30);

describe('BAL-1 full calibration', () => {
  it(`simulates ${count} seeds for each difficulty and writes the report`, async () => {
    const matches = [];
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < count; i++) {
        const seed = firstSeed + i;
        const stockTrace: { minute: number; steadyStockValueProxy: number; rivalStockValueProxy: number }[] = [];
        const race = runRace(seed, { minutes, skills: ['normal', difficulty], onMinute: (t, seats) => {
          if (t % 60_000 === 0) stockTrace.push({ minute: t / 60_000,
            steadyStockValueProxy: moneyValueOf(seats[0].purse), rivalStockValueProxy: moneyValueOf(seats[1].purse) });
        } });
        matches.push({ difficulty, seed,
          matchMinutes: race.winner ? Number((race.winner.at / 60_000).toFixed(2)) : null,
          winner: race.winner?.id ?? 'none', rivalStars: race.vp.ai, steadyStars: race.vp.you,
          starsOverTime: race.trace.map(p => ({ minute: Number((p.t / 60_000).toFixed(2)), steady: p.you, rival: p.ai })),
          stockValueProxyOverTime: stockTrace });
      }
      console.log(`${difficulty}: ${matches.filter(m => m.difficulty === difficulty).length}/${count}`);
    }
    const summary = (['easy', 'normal', 'hard'] as const).map(difficulty => {
      const cohort = matches.filter(m => m.difficulty === difficulty);
      const lengths = cohort.map(m => m.matchMinutes).filter((n): n is number => n !== null).sort((a,b) => a-b);
      return { difficulty, seeds: cohort.length,
        rivalWinRate: cohort.filter(m => m.winner === 'ai').length / cohort.length,
        medianMatchMinutes: lengths.length ? lengths[Math.floor(lengths.length / 2)] : null,
        unfinished: cohort.length - lengths.length };
    });
    const report = { generatedAt: new Date().toISOString(), methodology: 'Normal-policy steady bot vs live rival policy at selected skill; test-side race helper.',
      importantLimitations: ['Resource-bag base-price value is a stock-value proxy, not the shipped fluctuating money ledger.',
        'The steady bot is the existing AI policy at Normal, not a human or a purpose-built novice/steady/sharp scripted player.',
        'This race harness does not model FTUE trainee tutorial completion.'],
      horizonMinutes: minutes, seedRange: [firstSeed, firstSeed + count - 1], summary, matches };
    await mkdir('docs/playtest-reports', { recursive: true });
    await writeFile('docs/playtest-reports/balance-471.json', JSON.stringify(report, null, 2) + '\n');
    expect(matches).toHaveLength(count * 3);
  }, 900_000);
});
