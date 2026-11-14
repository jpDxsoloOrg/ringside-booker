// The headline popularity fast path (POL4-10): with the fast paths on, the Why? of every promotion
// under every headline scope is the one the full roll-up gives, and the map is built once.
// Design: docs/design/day-pipeline.md#fast-paths
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import { setFastPaths } from '../../../src/core/fastPaths';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { Traced } from '../../../src/core/trace';
import type { GameWorldView } from '../../../src/model/tables';
import { HEADLINE_SCOPES } from '../../../src/systems/office/tunables';
import { headlinePopularityOf } from '../../../src/systems/office';
import { createEngineTunables } from '../../../src/systems/tunables';
import { geographyOf } from '../../../src/systems/world/geography';
import { startDefaultGame } from '../calendar/default-game';

function withFastPaths<T>(on: boolean, run: () => T): T {
  const was = setFastPaths(on);
  try {
    return run();
  } finally {
    setFastPaths(was);
  }
}

/** Runs `probe` once against the default world's first day. */
async function onTheDefaultWorld(probe: (read: GameWorldView) => void): Promise<void> {
  let ran = false;
  const probeSystem = defineSystem({
    id: 'headlineProbe',
    phases: [
      definePhase({
        id: 'headlineProbe.run',
        group: 'housekeeping',
        order: 10,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (!ran) {
            ran = true;
            probe(ctx.read);
          }
        },
      }),
    ],
  });
  const engine = createEngine({ state: startDefaultGame(), systems: [probeSystem] });
  const advanced = await engine.advanceDays({ maxDays: 1 });
  expect(advanced.failures).toEqual([]);
  expect(ran).toBe(true);
}

describe('the headline popularity fast path', () => {
  it('gives every promotion the full path Why? under every scope', async () => {
    await onTheDefaultWorld((read) => {
      const promotions = read.tables.promotions.values();
      expect(promotions.length).toBeGreaterThan(1);
      for (const scope of HEADLINE_SCOPES) {
        const tunables = createEngineTunables({ 'office.popularity.headlineScope': scope });
        for (const promotion of promotions) {
          const headline = (on: boolean): Traced<number> =>
            withFastPaths(on, () => headlinePopularityOf(read, promotion.id, tunables));
          expect(headline(true), `${promotion.name}, ${scope}`).toEqual(headline(false));
        }
      }
    });
  });

  it('hands back the same map while the map is unchanged', async () => {
    await onTheDefaultWorld((read) => {
      expect(geographyOf(read)).toBe(geographyOf(read));
      withFastPaths(false, () => {
        expect(geographyOf(read)).not.toBe(geographyOf(read));
      });
    });
  });
});
