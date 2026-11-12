// The Match lab's queries (MTCH1-06): `match.preview` and `match.previewBatch` on a detached stream
// (deterministic per seed, different across seeds, never touching the world, its RNG, traces or
// event log), and the lab's `match.labOptions` and `match.labWorkers`.
// Design: docs/design/match-rating.md#previews
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  OMNISCIENT_VIEWER,
  type Engine,
  type Viewer,
} from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import { addDays } from '../../../src/core/date';
import { parseId, type PersonId, type RegionId } from '../../../src/core/ids';
import { RngRegistry, detachedStream } from '../../../src/core/rng';
import { countTraceNodes, isTruncationNote, type TraceNode } from '../../../src/core/trace';
import type { GameWorld } from '../../../src/model/tables';
import { defaultSystems } from '../../../src/systems';
import {
  MATCH_PREVIEW_STREAM,
  type PreviewArgs,
  type PreviewResult,
} from '../../../src/systems/match';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { worldBuilder } from '../../support';
import { expectSerialisable } from '../../support/trace';
import { updatePerson } from './rating/fixtures';

const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

interface LabWorld {
  readonly engine: Engine;
  readonly world: GameWorld;
  readonly roster: readonly PersonId[];
  readonly rivals: readonly PersonId[];
  readonly regions: readonly RegionId[];
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

/** The player's promotion with 8 wrestlers, a rival with 4, every catalog. */
function labWorld(edit?: (world: GameWorld, roster: readonly PersonId[]) => void): LabWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) => promotion.withRoster(8),
    )
    .withPromotion({ name: 'Test Promotion B', shortName: 'TPB' }, (promotion) =>
      promotion.withRoster(4),
    )
    .build();
  const roster = ids.people.slice(0, 8);
  const rivals = ids.people.slice(8, 12);
  edit?.(world, roster);
  const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
  return { engine, world, roster, rivals, regions: ids.regions };
}

function singles(lab: LabWorld, overrides: Partial<PreviewArgs> = {}): PreviewArgs {
  return {
    kind: 'match',
    typeKey: parseContentKey('match.singles'),
    sides: [[at(lab.roster, 0)], [at(lab.roster, 1)]],
    slotRole: 'mainEvent',
    importance: 'major',
    regionId: at(lab.regions, 0),
    televised: true,
    previewSeed: 7,
    ...overrides,
  };
}

function preview(engine: Engine, args: PreviewArgs, viewer: Viewer = PLAYER): PreviewResult {
  const result = engine.query('match.preview', args, viewer);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

/** Every variance roll line in the trace, with its value. */
function varianceLines(node: TraceNode): (number | string | boolean | null)[] {
  const found: (number | string | boolean | null)[] = [];
  const visit = (current: TraceNode): void => {
    if (/variance/i.test(current.label)) {
      found.push(current.value ?? null);
    }
    for (const child of current.children ?? []) {
      visit(child);
    }
  };
  visit(node);
  return found;
}

describe('detachedStream', () => {
  it('is the same sequence for the same seed, name and key, and another for another key', () => {
    const draws = (key: string): number[] => {
      const stream = detachedStream('seed', MATCH_PREVIEW_STREAM, key);
      return [stream.nextUint32(), stream.nextUint32(), stream.nextUint32()];
    };
    expect(draws('1')).toEqual(draws('1'));
    expect(draws('1')).not.toEqual(draws('2'));
  });

  it('never touches a registry, and differs from the registry stream of the same name', () => {
    const registry = new RngRegistry('seed');
    const before = registry.toState();
    const stream = detachedStream('seed', MATCH_PREVIEW_STREAM, '0');
    stream.nextUint32();
    expect(registry.toState()).toEqual(before);
    expect(stream.nextUint32()).not.toBe(registry.stream(MATCH_PREVIEW_STREAM).nextUint32());
  });

  it('refuses a badly shaped name', () => {
    // @ts-expect-error: not a declared stream name.
    expect(() => detachedStream('seed', 'Bad', '0')).toThrow(/stream name/);
  });
});

describe('match.preview', () => {
  it('returns the rating with inline traces, worker lines, slot, warnings, policy and the seed', () => {
    const lab = labWorld();
    const data = preview(lab.engine, singles(lab));
    expect(data.previewSeed).toBe(7);
    expect(data.kind).toBe('match');
    expect(data.score.trace).toBeDefined();
    expect(data.workRate?.trace).toBeDefined();
    expect(data.talk).toBeNull();
    expect(data.crowd.trace).toBeDefined();
    expect(data.expectation.trace).toBeDefined();
    expect(data.slot.role).toBe('mainEvent');
    expect(data.workers.map((line) => line.personId)).toEqual(lab.roster.slice(0, 2));
    expect(data.warnings).toEqual([]);
    expect(data.policy.label.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain('traceRef');
    expectSerialisable(data);
  });

  it('gives byte-identical JSON for the same arguments and seed', () => {
    const lab = labWorld();
    expect(JSON.stringify(preview(lab.engine, singles(lab)))).toBe(
      JSON.stringify(preview(labWorld().engine, singles(lab))),
    );
  });

  it('changes at least the variance lines for a different seed', () => {
    const lab = labWorld();
    const first = preview(lab.engine, singles(lab, { previewSeed: 1 }));
    const second = preview(lab.engine, singles(lab, { previewSeed: 2 }));
    const lines = (data: PreviewResult): unknown[] => [
      ...varianceLines(data.workRate?.trace ?? data.score.trace),
      ...varianceLines(data.crowd.trace),
    ];
    expect(lines(first).length).toBeGreaterThan(0);
    expect(lines(first)).not.toEqual(lines(second));
  });

  it('never moves the world, its RNG, traces or event log (1 preview and a 500-run batch)', () => {
    const lab = labWorld();
    const before = JSON.stringify(lab.engine.exportState());
    preview(lab.engine, singles(lab));
    const batch = lab.engine.query('match.previewBatch', { ...singles(lab), runs: 500 }, PLAYER);
    expect(batch.ok).toBe(true);
    const after = lab.engine.exportState();
    expect(after.rng.streams).not.toHaveProperty(MATCH_PREVIEW_STREAM);
    expect(JSON.stringify(after)).toBe(before);
  });

  it('rates three people in a singles match, with the side-count warning', () => {
    const lab = labWorld();
    const data = preview(
      lab.engine,
      singles(lab, {
        sides: [[at(lab.roster, 0)], [at(lab.roster, 1)], [at(lab.roster, 2)]],
      }),
    );
    expect(data.score.value).toBeGreaterThanOrEqual(0);
    expect(data.warnings.map((warning) => warning.code)).toContain('sideCount');
  });

  it('rates an injured worker, with the injury warning', () => {
    const lab = labWorld((world, roster) => {
      updatePerson(world, at(roster, 1), (person) => ({
        ...person,
        injury: {
          kindKey: parseContentKey('injury.sprained-ankle'),
          bodyPart: 'legs',
          since: TEST_START_DATE,
          expectedReturn: addDays(TEST_START_DATE, 30),
          canWorkAngles: true,
        },
      }));
    });
    const data = preview(lab.engine, singles(lab));
    expect(data.warnings).toContainEqual(
      expect.objectContaining({ code: 'injured', personId: at(lab.roster, 1) }),
    );
  });

  it('rates a talking segment with talk in place of work rate', () => {
    const lab = labWorld();
    const data = preview(
      lab.engine,
      singles(lab, { kind: 'angle', typeKey: parseContentKey('angle.promo') }),
    );
    expect(data.kind).toBe('angle');
    expect(data.workRate).toBeNull();
    expect(data.talk?.trace).toBeDefined();
  });

  it('passes on the refusals of rateSegment', () => {
    const lab = labWorld();
    const result = lab.engine.query(
      'match.preview',
      singles(lab, { typeKey: parseContentKey('match.cage'), sides: [[at(lab.roster, 0)], []] }),
      PLAYER,
    );
    expect(!result.ok && result.reasons.map((reason) => reason.code)).toEqual([
      'unknownType',
      'emptySide',
    ]);
  });

  it('refuses with noCatalog on a world without match types', () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
        promotion.withRoster(2),
      )
      .build();
    const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
    const result = engine.query(
      'match.preview',
      {
        kind: 'match',
        typeKey: parseContentKey('match.singles'),
        sides: [[at(ids.people, 0)], [at(ids.people, 1)]],
        slotRole: 'midcard',
        importance: 'regular',
        regionId: at(ids.regions, 0),
        televised: true,
        previewSeed: 0,
      },
      PLAYER,
    );
    expect(!result.ok && result.reasons.map((reason) => reason.code)).toEqual(['noCatalog']);
  });

  it('needs a promotion from a viewer who runs none, and refuses one that does not exist', () => {
    const lab = labWorld();
    const missing = lab.engine.query('match.preview', singles(lab), OMNISCIENT_VIEWER);
    expect(!missing.ok && missing.reasons.map((reason) => [reason.code, reason.field])).toEqual([
      ['invalidArgs', 'promotionId'],
    ]);

    const promotionId = at(lab.world.tables.promotions.values(), 0).id;
    expect(
      lab.engine.query('match.preview', singles(lab, { promotionId }), OMNISCIENT_VIEWER).ok,
    ).toBe(true);

    const unknown = lab.engine.query(
      'match.preview',
      singles(lab, { promotionId: parseId('promotion', 'pro_zzzzzzzzzz') }),
      PLAYER,
    );
    expect(!unknown.ok && unknown.reasons.map((reason) => [reason.code, reason.field])).toEqual([
      ['invalidArgs', 'promotionId'],
    ]);
  });

  it('refuses an unknown region and arguments outside the schema', () => {
    const lab = labWorld();
    const region = lab.engine.query(
      'match.preview',
      singles(lab, { regionId: parseId('region', 'reg_zzzzzzzzzz') }),
      PLAYER,
    );
    expect(!region.ok && region.reasons.map((reason) => reason.field)).toEqual(['regionId']);
    const seed = lab.engine.query('match.preview', singles(lab, { previewSeed: -1 }), PLAYER);
    expect(!seed.ok && seed.reasons.map((reason) => reason.code)).toEqual(['invalidArgs']);
    const extra = lab.engine.queryRaw('match.preview', { ...singles(lab), runs: 3 }, PLAYER);
    expect(extra.ok).toBe(false);
  });

  it('shows nothing hidden in a worker line', () => {
    const lab = labWorld();
    const text = JSON.stringify(preview(lab.engine, singles(lab)));
    for (const hidden of ['development', 'potential', 'ceilings', 'vices', 'morale', 'terms']) {
      expect(text).not.toContain(`"${hidden}"`);
    }
  });
});

describe('match.previewBatch', () => {
  it('summarises the runs: stats, quarter stars and a 20-bin histogram', () => {
    const lab = labWorld();
    const result = lab.engine.query('match.previewBatch', { ...singles(lab), runs: 50 }, PLAYER);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const data = result.data;
    expect(data.runs).toBe(50);
    expect(data.histogram).toHaveLength(20);
    expect(data.histogram.reduce((total, bin) => total + bin.count, 0)).toBe(50);
    expect(at(data.histogram, 19)).toMatchObject({ from: 95, to: 100 });
    expect(data.stars.byQuarter.reduce((total, entry) => total + entry.count, 0)).toBe(50);
    expect(data.talk).toBeNull();
    expect(data.workRate).not.toBeNull();
    expect(data.score.min).toBeLessThanOrEqual(data.score.p50);
    expect(data.score.p50).toBeLessThanOrEqual(data.score.max);
    expect(JSON.stringify(data)).not.toContain('"trace"');
    expectSerialisable(data);
  });

  it('makes run 0 the single preview with the same seed', () => {
    const lab = labWorld();
    const single = preview(lab.engine, singles(lab, { previewSeed: 41 }));
    const batch = lab.engine.query(
      'match.previewBatch',
      { ...singles(lab, { previewSeed: 41 }), runs: 1 },
      PLAYER,
    );
    if (!batch.ok) {
      throw new Error(JSON.stringify(batch.reasons));
    }
    expect(batch.data.score).toMatchObject({ min: single.score.value, max: single.score.value });
    expect(batch.data.stars.p50).toBe(single.stars.value);
    expect(batch.data.workRate?.mean).toBe(Math.round((single.workRate?.value ?? 0) * 10) / 10);
    expect(batch.data.crowd.mean).toBe(Math.round(single.crowd.value * 10) / 10);
  });

  it('runs at most 500 nights', () => {
    const lab = labWorld();
    const result = lab.engine.query('match.previewBatch', { ...singles(lab), runs: 501 }, PLAYER);
    expect(!result.ok && result.reasons.map((reason) => [reason.code, reason.field])).toEqual([
      ['invalidArgs', 'runs'],
    ]);
  });
});

describe('a 30-person battle royal', () => {
  const battleRoyal = (): { engine: Engine; args: PreviewArgs } => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withCatalogs()
      .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
        promotion.withRoster(30),
      )
      .build();
    const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
    return {
      engine,
      args: {
        kind: 'match',
        typeKey: parseContentKey('match.battle-royal'),
        sides: ids.people.slice(0, 30).map((personId) => [personId]),
        slotRole: 'midcard',
        importance: 'major',
        regionId: at(ids.regions, 0),
        televised: true,
        previewSeed: 3,
      },
    };
  };

  it('keeps every trace inside the node limit, saying when steps are not shown', () => {
    const { engine, args } = battleRoyal();
    const data = preview(engine, args);
    expect(data.workers).toHaveLength(30);
    const traces = [data.score, data.workRate, data.crowd, data.expectation, data.starPower];
    for (const traced of traces) {
      if (traced !== null) {
        expect(countTraceNodes(traced.trace)).toBeLessThanOrEqual(400);
      }
    }
    const hasNote = (node: TraceNode): boolean =>
      isTruncationNote(node) || (node.children ?? []).some(hasNote);
    // Thirty workers overflow the work rate trace: the cut steps are named by a note, not lost.
    const workRate = data.workRate;
    expect(workRate).not.toBeNull();
    if (workRate !== null) {
      expect(hasNote(workRate.trace)).toBe(true);
    }
  });

  // Performance guard: a generous budget (about 1 s alone on a laptop), skipped on CI where
  // shared runners vary, and retried because a full parallel test run can starve one worker.
  it.skipIf(process.env['CI'] !== undefined)(
    'runs a 500-run batch in under 3 s',
    { retry: 2, timeout: 20_000 },
    () => {
      const { engine, args } = battleRoyal();
      // Warm up, so the timing is of the ratings and not of the first call's compilation.
      engine.query('match.previewBatch', { ...args, runs: 20 }, PLAYER);
      // eslint-disable-next-line no-restricted-properties -- a speed test has to read the real clock
      const started = performance.now();
      const result = engine.query('match.previewBatch', { ...args, runs: 500 }, PLAYER);
      // eslint-disable-next-line no-restricted-properties -- a speed test has to read the real clock
      const elapsed = performance.now() - started;
      expect(result.ok).toBe(true);
      expect(elapsed).toBeLessThan(3000);
    },
  );
});

describe('match.labOptions', () => {
  it('defaults to Midcard, Regular and the home region, with every region and event size', () => {
    const lab = labWorld();
    const result = lab.engine.query('match.labOptions', {}, PLAYER);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    const promotion = at(lab.world.tables.promotions.values(), 0);
    expect(result.data.available).toBe(true);
    expect(result.data.promotion).toEqual({
      id: promotion.id,
      name: promotion.name,
      style: promotion.style,
      homeRegionId: promotion.homeRegionId,
    });
    expect(result.data.defaults).toEqual({
      slotRole: 'midcard',
      importance: 'regular',
      regionId: promotion.homeRegionId,
      televised: true,
      kind: 'match',
      typeKey: 'match.singles',
    });
    expect(result.data.importances.map((entry) => entry.label)).toEqual([
      'House show',
      'Minor',
      'Regular',
      'Major',
      'Flagship',
    ]);
    expect(result.data.regions).toHaveLength(4);
    const order = result.data.regions.map((region) => `${region.countryName}/${region.name}`);
    expect(order).toEqual([...order].sort());
    expectSerialisable(result.data);
  });

  it('has no promotion for a viewer who runs none, and says when there are no match types', () => {
    const { world } = worldBuilder().withGeography('mini').withPromotion().build();
    const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
    const result = engine.query('match.labOptions', {}, OMNISCIENT_VIEWER);
    expect(result.ok && result.data.promotion).toBeNull();
    expect(result.ok && result.data.available).toBe(false);
    expect(result.ok && result.data.defaults.typeKey).toBeNull();
    expect(result.ok && result.data.defaults.regionId).not.toBeNull();
  });
});

describe('match.labWorkers', () => {
  it('lists only the promotion’s active roster for mine, nothing hidden', () => {
    const lab = labWorld();
    const result = lab.engine.query(
      'match.labWorkers',
      { scope: 'mine', regionId: at(lab.regions, 0) },
      PLAYER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expect(result.data.total).toBe(8);
    expect(result.data.rows.map((row) => row.personId).sort()).toEqual([...lab.roster].sort());
    for (const row of result.data.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'available',
        'name',
        'personId',
        'popularity',
        'promotionShortName',
        'roles',
        'style',
        'unavailableReason',
      ]);
    }
    const text = JSON.stringify(result.data);
    for (const hidden of ['development', 'vices', 'morale', 'terms', 'potential']) {
      expect(text).not.toContain(hidden);
    }
    expectSerialisable(result.data);
  });

  it('lists everyone for everyone, sorted by popularity then name, with availability', () => {
    const lab = labWorld((world, roster) => {
      const regionId = at(world.tables.regions.values(), 0).id;
      updatePerson(world, at(roster, 5), (person) => ({
        ...person,
        regionalPop: { [regionId]: 80 },
      }));
      updatePerson(world, at(roster, 2), (person) => ({
        ...person,
        injury: {
          kindKey: parseContentKey('injury.sprained-ankle'),
          bodyPart: 'back',
          since: TEST_START_DATE,
          expectedReturn: addDays(TEST_START_DATE, 30),
          canWorkAngles: false,
        },
      }));
    });
    const result = lab.engine.query(
      'match.labWorkers',
      { scope: 'everyone', regionId: at(lab.regions, 0) },
      PLAYER,
    );
    if (!result.ok) {
      throw new Error(JSON.stringify(result.reasons));
    }
    expect(result.data.total).toBe(12);
    const [first] = result.data.rows;
    expect(first).toMatchObject({ personId: at(lab.roster, 5), popularity: 80 });
    const names = result.data.rows.slice(1).map((row) => row.name.toLowerCase());
    expect(names).toEqual([...names].sort());
    const rival = result.data.rows.find((row) => row.personId === at(lab.rivals, 0));
    expect(rival?.promotionShortName).toBe('TPB');
    const injured = result.data.rows.find((row) => row.personId === at(lab.roster, 2));
    expect(injured).toMatchObject({ available: false, unavailableReason: 'Injured (back injury)' });
  });

  it('searches names and limits the list', () => {
    const lab = labWorld();
    const all = lab.engine.query(
      'match.labWorkers',
      { scope: 'everyone', regionId: at(lab.regions, 0), limit: 3 },
      PLAYER,
    );
    expect(all.ok && all.data.rows).toHaveLength(3);
    expect(all.ok && all.data.total).toBe(12);
    const name = at(lab.world.tables.people.values(), 0).defaultRingName;
    const found = lab.engine.query(
      'match.labWorkers',
      { scope: 'everyone', regionId: at(lab.regions, 0), search: name.toUpperCase() },
      PLAYER,
    );
    expect(found.ok && found.data.rows.map((row) => row.name)).toContain(name);
  });

  it('needs a promotion for mine from a viewer who runs none', () => {
    const lab = labWorld();
    const result = lab.engine.query(
      'match.labWorkers',
      { scope: 'mine', regionId: at(lab.regions, 0) },
      OMNISCIENT_VIEWER,
    );
    expect(!result.ok && result.reasons.map((reason) => reason.field)).toEqual(['promotionId']);
  });
});
