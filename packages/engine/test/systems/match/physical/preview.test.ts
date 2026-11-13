// The Match lab's physical preview (MTCH4-05): the `physical` preview extension on `match.simulate`,
// `match.simulateBatch`, `match.preview` and `match.previewBatch`. Deterministic per seed, never
// touching the world or its RNG, with the lab's fatigue what-if labelled in the traces.
// Design: docs/design/physical-toll.md#match-lab, match-rating.md#preview-extensions.
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { parseContentKey } from '../../../../src/core/content-key';
import type { PersonId, RegionId } from '../../../../src/core/ids';
import type { TraceNode } from '../../../../src/core/trace';
import { defaultSystems } from '../../../../src/systems';
import {
  FATIGUE_OVERRIDE_RANGE_MESSAGE,
  LAB_WHAT_IF_FATIGUE_LABEL,
  registerPreviewExtension,
  registerRiskModifier,
  type PhysicalPreviewResult,
  type PreviewArgs,
  type SimulateArgs,
} from '../../../../src/systems/match';
import { z } from 'zod';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { worldBuilder } from '../../../support';
import { personId } from '../../../support/show-world';
import { expectSerialisable } from '../../../support/trace';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

interface Lab {
  readonly engine: Engine;
  readonly roster: readonly PersonId[];
  readonly region: RegionId;
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

function labWorld(tunableOverrides: Record<string, number | boolean> = {}): Lab {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) => promotion.withRoster(6),
    )
    .build();
  const engine = createEngine({
    state: { ...initialEngineState(world), tunableOverrides },
    systems: defaultSystems,
  });
  return { engine, roster: ids.people.slice(0, 6), region: at(ids.regions, 0) };
}

function singles(lab: Lab, overrides: Partial<SimulateArgs> = {}): SimulateArgs {
  return {
    kind: 'match',
    typeKey: parseContentKey('match.singles'),
    sides: [[at(lab.roster, 0)], [at(lab.roster, 1)]],
    slotRole: 'mainEvent',
    importance: 'major',
    regionId: lab.region,
    televised: true,
    previewSeed: 7,
    winner: 'auto',
    finishKey: null,
    extensions: { physical: {} },
    ...overrides,
  };
}

/** The preview arguments of a Simulate draft: no plan. */
function previewOnly(args: SimulateArgs): PreviewArgs {
  const preview: PreviewArgs & Partial<SimulateArgs> = { ...args };
  delete preview.winner;
  delete preview.finishKey;
  delete preview.methodKey;
  return preview;
}

function physicalOf(lab: Lab, args: SimulateArgs): PhysicalPreviewResult {
  const result = lab.engine.query('match.simulate', args, PLAYER);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  expectSerialisable(result.data);
  const physical = result.data.extensions?.physical;
  if (physical === undefined) {
    throw new Error('no physical extension in the answer');
  }
  return physical;
}

function labelsOf(node: TraceNode): string[] {
  return [node.label, ...(node.children ?? []).flatMap(labelsOf)];
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

describe('the physical preview extension', () => {
  it('gives every competitor the full toll, identical for the same seed', () => {
    const lab = labWorld();
    const first = physicalOf(lab, singles(lab));
    expect(first.workers.map((worker) => worker.personId)).toEqual([
      at(lab.roster, 0),
      at(lab.roster, 1),
    ]);
    expect(first.durationClass).toBe('long');
    for (const worker of first.workers) {
      expect(worker.fatigueGain.value).toBeGreaterThan(0);
      expect(worker.wearTotal.value).toBeGreaterThan(0);
      expect(worker.fatigueWhatIf).toBe(false);
      expect(worker.fatigueBefore).toBe(worker.fatigueNow);
    }
    expect(JSON.stringify(physicalOf(labWorld(), singles(lab)))).toBe(JSON.stringify(first));
  });

  it('can change wear and injury with a different preview seed', () => {
    const lab = labWorld();
    const wears = new Set<string>();
    const rolls = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      const physical = physicalOf(lab, singles(lab, { previewSeed: seed }));
      wears.add(JSON.stringify(physical.workers.map((worker) => worker.wearTotal.value)));
      rolls.add(JSON.stringify(physical.workers.map((worker) => worker.injury.roll.trace)));
    }
    expect(wears.size).toBeGreaterThan(1);
    expect(rolls.size).toBeGreaterThan(1);
  });

  it('never moves the world, its RNG, traces or event log (simulate and a 500-run batch)', () => {
    const lab = labWorld();
    const before = JSON.stringify(lab.engine.exportState());
    const daysBefore = lab.engine.exportState().world.meta.daysSimulated;
    physicalOf(lab, singles(lab));
    const batch = lab.engine.query('match.simulateBatch', { ...singles(lab), runs: 500 }, PLAYER);
    expect(batch.ok).toBe(true);
    const preview = lab.engine.query(
      'match.previewBatch',
      { ...previewOnly(singles(lab)), runs: 500 },
      PLAYER,
    );
    expect(preview.ok).toBe(true);
    const after = lab.engine.exportState();
    expect(after.rng.streams).not.toHaveProperty('match.wear');
    expect(after.rng.streams).not.toHaveProperty('match.injury');
    expect(after.world.meta.daysSimulated).toBe(daysBefore);
    expect(JSON.stringify(after)).toBe(before);
  });

  it('labels the fatigue what-if in the injury chance and leaves the world alone', () => {
    const lab = labWorld();
    const before = JSON.stringify(lab.engine.exportState());
    const personId = at(lab.roster, 0);
    const plain = physicalOf(lab, singles(lab));
    const tired = physicalOf(
      lab,
      singles(lab, { extensions: { physical: { fatigueOverrides: { [personId]: 100 } } } }),
    );
    const worker = tired.workers.find((entry) => entry.personId === personId);
    const fresh = plain.workers.find((entry) => entry.personId === personId);
    if (worker === undefined || fresh === undefined) {
      throw new Error('worker missing');
    }
    expect(worker.fatigueWhatIf).toBe(true);
    expect(worker.fatigueBefore).toBe(100);
    expect(worker.fatigueNow).toBe(fresh.fatigueNow);
    expect(worker.fatigueAfter).toBe(100);
    expect(worker.injuryChance.value).toBeGreaterThan(fresh.injuryChance.value);
    expect(labelsOf(worker.injuryChance.trace)).toContain(LAB_WHAT_IF_FATIGUE_LABEL);
    expect(labelsOf(fresh.injuryChance.trace)).not.toContain(LAB_WHAT_IF_FATIGUE_LABEL);
    expect(JSON.stringify(lab.engine.exportState())).toBe(before);
  });

  it('refuses a what-if above 100 in player words, and an unknown extension', () => {
    const lab = labWorld();
    const personId = at(lab.roster, 0);
    const refused = lab.engine.query(
      'match.simulate',
      singles(lab, { extensions: { physical: { fatigueOverrides: { [personId]: 101 } } } }),
      PLAYER,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reasons).toEqual([
      expect.objectContaining({
        code: 'invalidArgs',
        message: FATIGUE_OVERRIDE_RANGE_MESSAGE,
      }),
    ]);
    const unknown = lab.engine.query(
      'match.preview',
      // @ts-expect-error -- an extension nobody registered
      { ...previewOnly(singles(lab)), extensions: { stamina: {} } },
      PLAYER,
    );
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reasons[0]?.code).toBe('invalidArgs');
  });

  it('counts exactly 100 injured segments in 100 runs when every roll must hit', () => {
    const lab = labWorld({ 'match.injury.maxChance': 1, 'match.injury.maxPerSegment': 1 });
    // `match.injury.baseChance` tops out at 0.2, so a risk contribution pushes the chance to 1.
    cleanups.push(
      registerRiskModifier({
        id: 'test.certainInjury',
        order: 1,
        contribute: () => [
          { source: 'Test: always hurt', personIds: null, injuryAdd: 1, injuryMultiplier: 50 },
        ],
      }),
    );
    const batch = lab.engine.query('match.simulateBatch', { ...singles(lab), runs: 100 }, PLAYER);
    if (!batch.ok) {
      throw new Error(JSON.stringify(batch.reasons));
    }
    const summary = batch.data.extensionSummaries?.physical;
    expect(summary).toMatchObject({ runs: 100, injuredSegments: 100, injuriesPer100: 100 });
    expect(summary?.byPerson.map((entry) => entry.personId)).toEqual([
      at(lab.roster, 0),
      at(lab.roster, 1),
    ]);
    expect(summary?.byPerson.reduce((total, entry) => total + entry.injuries, 0)).toBe(100);
    const single = physicalOf(lab, singles(lab));
    expect(single.workers.filter((worker) => worker.injury.injured)).toHaveLength(1);
    expect(single.workers.filter((worker) => worker.injury.ignoredOverLimit)).toHaveLength(1);
  });

  it('gives the same batch counts for the same seed, and run 0 is the single simulate', () => {
    const lab = labWorld();
    const ask = (previewSeed: number) => {
      const batch = lab.engine.query(
        'match.simulateBatch',
        { ...singles(lab, { previewSeed }), runs: 50 },
        PLAYER,
      );
      if (!batch.ok) throw new Error(JSON.stringify(batch.reasons));
      return batch.data.extensionSummaries?.physical;
    };
    expect(ask(3)).toEqual(ask(3));
    const one = lab.engine.query('match.simulateBatch', { ...singles(lab), runs: 1 }, PLAYER);
    if (!one.ok) throw new Error(JSON.stringify(one.reasons));
    const single = physicalOf(lab, singles(lab));
    expect(
      one.data.extensionSummaries?.physical?.byPerson.map((entry) => entry.meanWearTotal),
    ).toEqual(single.workers.map((worker) => Math.round(worker.wearTotal.value * 10) / 10));
  });

  it('gives a main event more fatigue gain than the same draft as an opener', () => {
    const lab = labWorld();
    const main = physicalOf(lab, singles(lab, { slotRole: 'mainEvent' }));
    const opener = physicalOf(lab, singles(lab, { slotRole: 'opener' }));
    main.workers.forEach((worker, index) => {
      expect(worker.fatigueGain.value).toBeGreaterThan(
        opener.workers[index]?.fatigueGain.value ?? Infinity,
      );
      expect(labelsOf(worker.fatigueGain.trace).join(' ')).toMatch(/long duration class/i);
    });
    expect(labelsOf(at(opener.workers, 0).fatigueGain.trace).join(' ')).toMatch(
      /standard duration class/i,
    );
  });

  it('runs on match.preview and match.previewBatch too, and nothing when not asked', () => {
    const lab = labWorld();
    const preview = lab.engine.query('match.preview', previewOnly(singles(lab)), PLAYER);
    if (!preview.ok) throw new Error(JSON.stringify(preview.reasons));
    expect(preview.data.extensions?.physical?.workers).toHaveLength(2);
    const withoutExtensions = singles(lab);
    delete withoutExtensions.extensions;
    const plain = lab.engine.query('match.simulate', withoutExtensions, PLAYER);
    if (!plain.ok) throw new Error(JSON.stringify(plain.reasons));
    expect(plain.data).not.toHaveProperty('extensions');
    const batch = lab.engine.query(
      'match.previewBatch',
      { ...previewOnly(withoutExtensions), runs: 5 },
      PLAYER,
    );
    if (!batch.ok) throw new Error(JSON.stringify(batch.reasons));
    expect(batch.data).not.toHaveProperty('extensionSummaries');
  });

  it('refuses a producer the world does not have', () => {
    const lab = labWorld();
    const refused = lab.engine.query(
      'match.simulate',
      singles(lab, { crew: { producerId: personId(9999) } }),
      PLAYER,
    );
    expect(refused.ok).toBe(false);
  });
});

describe('registerPreviewExtension', () => {
  it('refuses a taken or malformed id', () => {
    expect(() =>
      registerPreviewExtension({
        id: 'physical',
        args: z.strictObject({}),
        run: () => ({ durationClass: 'short', maxInjuriesPerSegment: 1, workers: [] }),
        summarise: () => ({ runs: 0, injuredSegments: 0, injuriesPer100: 0, byPerson: [] }),
      }),
    ).toThrow(/already registered/);
  });
});
