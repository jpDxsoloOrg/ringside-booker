// The popularity door's fast path (POL4-12): with the fast paths on, a region's change is worked
// out as a plain number unless the door's trace shows its working, and the world figure is rolled
// once per map. The door must write, record and publish exactly what the full path does.
// Design: docs/design/day-pipeline.md#fast-paths
import { describe, expect, it } from 'vitest';
import { createEngine, type EngineState } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { defineSystem } from '../../../src/core/api/system';
import { setFastPaths } from '../../../src/core/fastPaths';
import type { RegionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { inputOf, type Traced } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  applyPopularityChange,
  popularityAnchor,
  popularityChange,
  workersSystem,
  type PopularityChangeInputs,
} from '../../../src/systems/workers';
import { DOOR_TRACE_DETAILED_REGIONS } from '../../../src/systems/workers/doors';
import { popularityChangeValue } from '../../../src/systems/workers/formulas/popularityChange';
import { startDefaultGame } from '../calendar/default-game';

describe('popularityChangeValue', () => {
  const befores = [0, 0.01, 3.5, 19.99, 20, 33.33, 50, 61.27, 80, 99.99, 100];
  const deltas = [-120, -12.5, -3, -0.004, 0, 0.004, 0.6, 2, 7.25, 15, 140];
  const weights = [-0.5, 0, 0.013, 0.25, 0.5, 0.875, 1, 1.5];
  const overrideSets: TunableOverrides[] = [
    {},
    { 'workers.popularity.taperSpan': 0 },
    { 'workers.popularity.taperSpan': 7, 'workers.popularity.taperFloor': 0.35 },
  ];

  it('gives the traced change to the bit for people and promotions', () => {
    let compared = 0;
    for (const overrides of overrideSets) {
      const tunables = createEngineTunables(overrides);
      const anchors = [10, 50, 95].map((charisma) => popularityAnchor({ charisma }, { tunables }));
      for (const before of befores) {
        for (const delta of deltas) {
          for (const weight of weights) {
            const cases: PopularityChangeInputs[] = [
              ...anchors.map((anchor): PopularityChangeInputs => ({
                subjectKind: 'person',
                regionName: 'Test Region',
                before,
                delta,
                weight,
                anchor,
              })),
              {
                subjectKind: 'promotion',
                regionName: 'Test Region',
                before,
                delta: inputOf('Asked', delta),
                weight,
                anchor: null,
              },
            ];
            for (const inputs of cases) {
              const traced = popularityChange(inputs, { tunables }).value;
              const fast = popularityChangeValue(inputs, { tunables });
              expect(Object.is(fast, traced), JSON.stringify({ inputs, overrides })).toBe(true);
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });

  it('hands a change it cannot work out back to the traced path', () => {
    const tunables = createEngineTunables();
    const inputs: PopularityChangeInputs = {
      subjectKind: 'promotion',
      regionName: 'Test Region',
      before: 10,
      delta: Number.POSITIVE_INFINITY,
      weight: 1,
      anchor: null,
    };
    expect(popularityChangeValue(inputs, { tunables })).toBeNull();
    expect(() => popularityChange(inputs, { tunables })).toThrow();
  });
});

/** The changes the probe makes on day one, the same with the fast paths on and off. */
function probeSystem() {
  let ran = false;
  return defineSystem({
    id: 'popularityProbe',
    phases: [
      definePhase({
        id: 'popularityProbe.run',
        group: 'housekeeping',
        order: 3,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (ran) return;
          ran = true;
          const regionIds = ctx.read.tables.regions.ids();
          const people = ctx.read.tables.people.values().slice(0, 60);
          for (const [index, person] of people.entries()) {
            // Every region weighted (a national show), with gains and losses big enough to clamp,
            // taper above the anchor and drop tiny regions.
            const regionWeights: Partial<Record<RegionId, number>> = {};
            for (const [regionIndex, regionId] of regionIds.entries()) {
              if ((regionIndex + index) % 5 !== 0) {
                regionWeights[regionId] = ((regionIndex * 7 + index * 3) % 11) / 10;
              }
            }
            const delta = index % 3 === 0 ? -(index % 17) - 0.37 : (index % 13) + 0.21;
            applyPopularityChange(ctx, {
              subject: { kind: 'person', id: person.id },
              regionWeights,
              delta: index % 2 === 0 ? delta : inputOf('Show effect', delta),
              source: 'system',
              reason: { key: 'test.probe', label: `Probe ${String(index)}` },
            });
          }
          for (const [index, promotion] of ctx.read.tables.promotions.values().entries()) {
            const regionDeltas: Partial<Record<RegionId, number | Traced<number>>> = {};
            for (const [regionIndex, regionId] of regionIds.entries()) {
              const amount = (((regionIndex + index) % 9) - 4) * 1.13;
              if (amount !== 0) {
                regionDeltas[regionId] =
                  regionIndex % 2 === 0 ? amount : inputOf('Region effect', amount);
              }
            }
            applyPopularityChange(ctx, {
              subject: { kind: 'promotion', id: promotion.id },
              regionDeltas,
              source: 'system',
              reason: { key: 'test.probe', label: 'Promotion probe' },
            });
          }
        },
      }),
    ],
  });
}

async function runProbe(fast: boolean): Promise<EngineState> {
  const was = setFastPaths(fast);
  try {
    const engine = createEngine({
      state: startDefaultGame(),
      systems: [simSystem, workersSystem, probeSystem()],
    });
    const advanced = await engine.advanceDays({ maxDays: 1 });
    expect(advanced.daysAdvanced).toBe(1);
    expect(advanced.failures).toEqual([]);
    return engine.exportState();
  } finally {
    setFastPaths(was);
  }
}

describe('the popularity door fast path', () => {
  it('writes, records and publishes what the full path does on the default map', async () => {
    const full = await runProbe(false);
    const fast = await runProbe(true);
    expect(fast.world.tables.people).toEqual(full.world.tables.people);
    expect(fast.world.tables.promotions).toEqual(full.world.tables.promotions);
    expect(fast.traces).toEqual(full.traces);
    expect(fast.events).toEqual(full.events);
    expect(fast.rng).toEqual(full.rng);
    // The probe's changes were made and kept (in full or, past the byte budget, as summaries).
    const isProbe = (label: string): boolean =>
      label.startsWith('Popularity change: Probe') ||
      label === 'Popularity change: Promotion probe';
    const probeTraces =
      fast.traces.full.filter((entry) => isProbe(entry.trace.label)).length +
      fast.traces.summaries.filter((entry) => isProbe(entry.label)).length;
    expect(probeTraces).toBeGreaterThan(60);
    // And past the few regions that show their working, which is what the fast path shortens.
    const widest = Math.max(
      ...fast.traces.full
        .filter((entry) => isProbe(entry.trace.label))
        .map((entry) => (entry.trace.children ?? []).filter((node) => node.kind === 'add').length),
    );
    expect(widest).toBeGreaterThan(DOOR_TRACE_DETAILED_REGIONS);
  });
});
