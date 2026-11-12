// Show night is deterministic: same save, same night. Design: docs/design/show-night.md#phase
import { describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../src/core/api';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import { RngRegistry } from '../../../src/core/rng/registry';
import { runShowsPhase, SHOWS_OFFSCREEN_STREAM } from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { showNightEngine, showNightEvents, showNightWorld, TODAY } from './show-night-world';

describe('shows.runShows determinism', () => {
  it('gives two engines from the same save identical results, traces and events', async () => {
    const save = initialEngineState(showNightWorld().world);
    const runs = await Promise.all(
      [0, 1].map(async () => {
        const built = showNightWorld();
        const engine = showNightEngine(built.world);
        expect(initialEngineState(built.world)).toEqual(save);
        await engine.advanceDays({ maxDays: 1 });
        return { state: engine.exportState(), events: showNightEvents(engine) };
      }),
    );
    const [first, second] = runs;
    expect(first?.events.length).toBeGreaterThan(0);
    expect(second?.state.world).toEqual(first?.state.world);
    expect(second?.state.traces).toEqual(first?.state.traces);
    expect(second?.state.rng).toEqual(first?.state.rng);
    expect(second?.events).toEqual(first?.events);
  });

  it('draws the off-screen stream exactly once per off-screen show', () => {
    const built = showNightWorld({ bareRivalShows: 3 });
    const runtime = createRuntime({ world: built.world, tunables: createEngineTunables() });
    const report = runStep(
      runtime,
      runShowsPhase.id,
      { kind: 'phase', id: runShowsPhase.id },
      runShowsPhase.run,
      { date: TODAY },
    );
    expect(report.status).toBe('ok');
    const expected = new RngRegistry(built.world.meta.seed);
    const stream = expected.stream(SHOWS_OFFSCREEN_STREAM);
    for (let draw = 0; draw < 3; draw += 1) {
      stream.nextFloat();
    }
    expect(runtime.rng.toState().streams[SHOWS_OFFSCREEN_STREAM]).toEqual(
      expected.toState().streams[SHOWS_OFFSCREEN_STREAM],
    );
  });

  it("does not change a rival show's off-screen score when a human show is added", async () => {
    const scoreOf = async (withoutHumanShows: boolean) => {
      const built = showNightWorld({ withoutHumanShows });
      const engine = showNightEngine(built.world);
      await engine.advanceDays({ maxDays: 1 });
      const bare = built.rivalBare[0];
      const show = engine.exportState().world.tables.eventInstances.find((row) => row.id === bare);
      return show?.result?.score;
    };
    const alone = await scoreOf(true);
    expect(alone).toEqual(expect.any(Number));
    expect(await scoreOf(false)).toBe(alone);
  });
});
