// Balance check for off-screen injuries: a year of them on a 228-wrestler world lands near the
// yearly rate. Design: docs/design/health.md#off-screen-injuries
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { healthSystem } from '../../../src/systems/health';
import { aPerson } from '../../support/builders/people';
import { worldBuilder } from '../../support/world-builder';

/** The default world's wrestler count when this check was written. */
const WRESTLERS = 228;
const DAYS = 365;
const PER_YEAR = 0.3;

describe('off-screen injuries over a year', () => {
  it(
    `hurt about ${String(PER_YEAR)} per wrestler, and nobody holds two at once`,
    { timeout: 120_000 },
    async () => {
      const { world } = worldBuilder()
        .withGeography('mini')
        .withInjuryCatalog()
        .with(`${String(WRESTLERS)} free-agent wrestlers`, (context) => {
          for (let index = 0; index < WRESTLERS; index++) {
            context.insert('people', aPerson({}, context.sequence));
          }
        })
        .build();
      const engine = createEngine({
        state: initialEngineState(world),
        systems: [simSystem, healthSystem],
      });
      const result = await engine.advanceDays({ maxDays: DAYS });
      expect(result.failures).toEqual([]);
      const injuries = engine.exportState().world.tables.injuries;
      const expected = WRESTLERS * PER_YEAR;
      // Measured when written: 66 of an expected 68.4 (docs/design/health.md#off-screen-injuries).
      expect(injuries.length).toBeGreaterThanOrEqual(expected * 0.65);
      expect(injuries.length).toBeLessThanOrEqual(expected * 1.35);
      const open = new Set<string>();
      for (const row of injuries) {
        if (row.returnedOn === null) {
          expect(open.has(row.personId), row.personId).toBe(false);
          open.add(row.personId);
        }
      }
    },
  );
});
