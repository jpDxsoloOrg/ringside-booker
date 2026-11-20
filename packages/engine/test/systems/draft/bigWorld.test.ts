// The draft in a big world (DRF-01): 300 promotions and about 13,700 people, every pick made by
// the computer. Slow (RB_SLOW_TESTS=1): it builds the world first. Design: docs/design/draft.md#speed
import { describe, expect, it } from 'vitest';
import { cpuMs } from '../../support/cpu-budget';
import { SLOW_TESTS } from '../../support/slow';
import { bigWorldPacks, engineOf, PLAYER, PLAYER_VIEW, run, startDraftGame } from './draft-game';

describe.runIf(SLOW_TESTS)('a draft in a big world', () => {
  it('drafts 300 promotions in a few seconds', () => {
    const state = startDraftGame({ packs: bigWorldPacks(25), settings: { draftStaff: true } });
    expect(state.world.tables.promotions).toHaveLength(300);
    const engine = engineOf(state);
    const timed = <T>(body: () => T): { value: T; ms: number } => {
      let value: T | undefined;
      const ms = cpuMs(() => {
        value = body();
      });
      if (value === undefined) throw new Error('no result');
      return { value, ms };
    };
    const sim = timed(() => run(engine.command('draft.simToMyPick', {}, PLAYER)));
    const pool = timed(() => run(engine.query('draft.pool', { limit: 50 }, PLAYER_VIEW)));
    const best = pool.value.rows[0]?.personId;
    if (best === undefined) throw new Error('empty pool');
    const pick = timed(() => run(engine.command('draft.pick', { personId: best }, PLAYER)));
    const rest = timed(() => run(engine.command('draft.autoPickRest', {}, PLAYER)));
    const finish = timed(() => run(engine.command('draft.finish', {}, PLAYER)));
    const picks = sim.value.picksMade + pick.value.picksMade + rest.value.picksMade;
    console.info(
      `big world draft: ${String(picks)} picks (CPU time); pool page ${pool.ms.toFixed(0)} ms, sim to my pick ${sim.ms.toFixed(0)} ms, ` +
        `my pick ${pick.ms.toFixed(0)} ms, auto-pick the rest ${rest.ms.toFixed(0)} ms, finish ${finish.ms.toFixed(0)} ms`,
    );
    expect(picks).toBe(300 * 24);
    // CPU time, with generous ceilings (about 5× what a desktop takes).
    expect(rest.ms).toBeLessThan(10_000);
    expect(pick.ms).toBeLessThan(2_000);
  }, 300_000);
});
