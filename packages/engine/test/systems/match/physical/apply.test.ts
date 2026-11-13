// Show night's physical toll applier (MTCH4-04): each competitor's fatigue, condition and in-match
// attributes change by exactly their traced amounts, a worker in two matches carries the first into
// the second, angles cost nothing, and injuries go to the handler (or are only logged without one).
// Design: docs/design/physical-toll.md#show-night
import { afterEach, describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate } from '../../../../src/core/date';
import type { PersonId, SegmentId } from '../../../../src/core/ids';
import type { PhaseContext } from '../../../../src/core/pipeline/context';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { findTraceNodes, type Traced, type TraceValue } from '../../../../src/core/trace';
import { refKey } from '../../../../src/core/trace/store';
import { BODY_PARTS, type BodyCondition, type Person } from '../../../../src/model/entities/person';
import type { GameWorld } from '../../../../src/model/tables';
import type { DeepReadonly } from '../../../../src/model/world';
import '../../../../src/systems/aip';
import {
  ALREADY_INJURED_TONIGHT_LABEL,
  IN_MATCH_LEARNING,
  NO_INJURY_HANDLER_LOG,
  RIVAL_NO_INJURIES_LABEL,
  applyPhysicalToll,
  clearInjuryHandler,
  fatigueTraceRef,
  injuryChanceTraceRef,
  injuryRollTraceRef,
  learningTraceRef,
  registerInjuryHandler,
  registerRiskModifier,
  restoreBuiltInInjuryHandler,
  wearTraceRef,
  type InjuryRequest,
  type PhysicalTollResult,
} from '../../../../src/systems/match';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { DEFAULT_BEAT_KEY, anAngle, aParticipant } from '../../../support/builders/creative';
import type { DeepPartial } from '../../../support/builders/build-row';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { worldBuilder } from '../../../support/world-builder';

const SHOW_DATE = parseGameDate('2026-02-04');
const OPEN = { potential: 900, ceilings: {} };

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  // Put back `health.injure` (WRK6-03's built-in handler) for later files in the same thread.
  restoreBuiltInInjuryHandler();
});

interface Built {
  readonly world: GameWorld;
  readonly person: (index: number) => PersonId;
  /** Slot 0: 0 v 1. Slot 1: 0 and 2 v 1 and 3. Slot 2: an angle with 4 talking. */
  readonly singles: SegmentId;
  readonly tag: SegmentId;
  readonly angle: SegmentId;
}

function built(options: { rival?: boolean; people?: readonly DeepPartial<Person>[] } = {}): Built {
  let angle: SegmentId | undefined;
  const { world, ids } = worldBuilder({ currentDate: SHOW_DATE })
    .withGeography('mini')
    .withCatalogs()
    .withPromotion(
      {
        controller:
          options.rival === true
            ? { kind: 'computer' }
            : { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion.withRoster(5, {
          person: (index) => ({ development: OPEN, ...(options.people?.[index] ?? {}) }),
        }),
    )
    .withEventInstance({
      date: SHOW_DATE,
      status: 'completed',
      format: { slots: 4, preShowSlots: 0 },
    })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0, slot: 0 })
    .withCompletedMatch({
      show: 0,
      sides: [
        [0, 2],
        [1, 3],
      ],
      result: 1,
      slot: 1,
    })
    .with('angle', (context) => {
      const [show] = context.ids.eventInstances;
      const speaker = context.ids.people[4];
      if (show === undefined || speaker === undefined) throw new Error('no show');
      const segment = context.insert(
        'segments',
        anAngle(
          {
            eventInstanceId: show,
            slot: 2,
            angle: { beats: [{ beatKey: DEFAULT_BEAT_KEY, personIds: [speaker] }] },
          },
          context.sequence,
        ),
      );
      context.insert(
        'participants',
        aParticipant(
          { segmentId: segment.id, personId: speaker, role: 'speaker' },
          context.sequence,
        ),
      );
      angle = segment.id;
    })
    .build();
  const at = <T>(list: readonly T[], index: number): T => {
    const value = list[index];
    if (value === undefined) throw new Error(`no entry ${String(index)}`);
    return value;
  };
  if (angle === undefined) throw new Error('no angle');
  return {
    world,
    person: (index) => at(ids.people, index),
    singles: at(ids.segments, 0),
    tag: at(ids.segments, 1),
    angle,
  };
}

interface Run {
  readonly results: readonly (PhysicalTollResult | null)[];
  readonly traces: ReadonlyMap<string, Traced<TraceValue>>;
  readonly summaryOnly: ReadonlySet<string>;
  readonly logs: readonly string[];
  readonly people: (personId: PersonId) => DeepReadonly<Person>;
}

/** Applies the segments' tolls in order inside one transaction, as show night would. */
function applyInOrder(
  world: GameWorld,
  segmentIds: readonly SegmentId[],
  tunables: EngineTunables = createEngineTunables(),
): Run {
  const traces = new Map<string, Traced<TraceValue>>();
  const summaryOnly = new Set<string>();
  const logs: string[] = [];
  const results: (PhysicalTollResult | null)[] = [];
  const rng = new RngRegistry('apply-test');
  const outcome = world.transact('apply physical toll', (tx) => {
    const ctx: PhaseContext = {
      date: SHOW_DATE,
      tx,
      read: tx.view,
      rng: (name) => rng.stream(name),
      tunables,
      publish: () => undefined,
      recordTrace: (ref, _date, traced, options) => {
        traces.set(refKey(ref), traced);
        if (options?.summaryOnly === true) summaryOnly.add(refKey(ref));
      },
      demoteTrace: () => undefined,
      log: (message) => {
        logs.push(message);
      },
    };
    for (const segmentId of segmentIds) {
      results.push(applyPhysicalToll(ctx, segmentId));
    }
  });
  if (!outcome.ok) throw outcome.error;
  return {
    results,
    traces,
    summaryOnly,
    logs,
    people: (personId) => world.tables.people.require(personId),
  };
}

function workerOf(result: PhysicalTollResult | null | undefined, personId: PersonId) {
  const worker = result?.workers.find((entry) => entry.personId === personId);
  if (worker === undefined) throw new Error(`no toll for ${personId}`);
  return worker;
}

/** Forces an injury roll to come up for everyone (at most `maxPerSegment` per segment). */
function certainInjuries(): EngineTunables {
  cleanups.push(
    registerRiskModifier({
      id: 'test.certainInjury',
      order: 0,
      contribute: () => [{ source: 'Test: certain injury', personIds: null, injuryAdd: 1 }],
    }),
  );
  return createEngineTunables({ 'match.injury.maxChance': 1 });
}

describe('applyPhysicalToll', () => {
  it('changes fatigue, condition and attributes by exactly the traced amounts', () => {
    const { world, person, singles } = built();
    const before = world.tables.people.require(person(0));
    const run = applyInOrder(world, [singles]);
    const worker = workerOf(run.results[0], person(0));
    const after = run.people(person(0));

    expect(worker.fatigueGain.value).toBeGreaterThan(0);
    expect(after.fatigue).toBe(Math.min(100, before.fatigue + worker.fatigueGain.value));
    for (const part of BODY_PARTS) {
      expect(after.condition[part]).toBe(
        Math.max(0, before.condition[part] - worker.wearByPart[part].value),
      );
    }
    for (const { attribute } of IN_MATCH_LEARNING) {
      expect(after.attributes[attribute]).toBe(
        Math.min(100, before.attributes[attribute] + worker.learningByAttribute[attribute].value),
      );
    }
    expect(worker.learning.value).toBeGreaterThan(0);
    // Nothing else on the row moved.
    const rest = (row: DeepReadonly<Person>) => ({
      ...row,
      fatigue: null,
      condition: null,
      attributes: null,
    });
    expect(rest(after)).toEqual(rest(before));
  });

  it('carries a worker from their first match into their second', () => {
    const { world, person, singles, tag } = built();
    const before = world.tables.people.require(person(0));
    const run = applyInOrder(world, [singles, tag]);
    const first = workerOf(run.results[0], person(0));
    const second = workerOf(run.results[1], person(0));
    expect(second.fatigueBefore).toBe(first.fatigueAfter);
    expect(run.people(person(0)).fatigue).toBe(second.fatigueAfter);
    expect(second.fatigueAfter).toBeCloseTo(
      before.fatigue + first.fatigueGain.value + second.fatigueGain.value,
      10,
    );
    // The second match is the worker's second tonight, so it costs more.
    expect(
      findTraceNodes(second.fatigueGain.trace, 'multiply').map((node) => node.label),
    ).toContain('Second match tonight ×1.5');
    expect(second.conditionAfter.head).toBeCloseTo(
      100 - first.wearByPart.head.value - second.wearByPart.head.value,
      10,
    );
  });

  it('never takes condition below 0', () => {
    const worn: BodyCondition = {
      head: 0.1,
      neck: 0.1,
      back: 0.1,
      arms: 0.1,
      torso: 0.1,
      legs: 0.1,
    };
    const { world, person, singles } = built({ people: [{ condition: worn }] });
    const run = applyInOrder(world, [singles]);
    expect(run.people(person(0)).condition).toEqual({
      head: 0,
      neck: 0,
      back: 0,
      arms: 0,
      torso: 0,
      legs: 0,
    });
  });

  it('leaves a talking segment and its speakers alone', () => {
    const { world, person, angle } = built();
    const before = world.tables.people.require(person(4));
    const run = applyInOrder(world, [angle]);
    expect(run.results).toEqual([null]);
    expect(run.people(person(4))).toEqual(before);
    expect(run.traces.size).toBe(0);
  });

  it('stores fatigue, wear and learning in full on the player show, the roll only when hurt', () => {
    const { world, person, singles } = built();
    const run = applyInOrder(world, [singles]);
    const worker = workerOf(run.results[0], person(0));
    for (const ref of [
      fatigueTraceRef(singles, person(0)),
      wearTraceRef(singles, person(0)),
      learningTraceRef(singles, person(0)),
    ]) {
      expect(run.traces.has(refKey(ref)), ref.kind).toBe(true);
      expect(run.summaryOnly.has(refKey(ref))).toBe(false);
    }
    expect(run.traces.has(refKey(injuryChanceTraceRef(singles, person(0))))).toBe(true);
    expect(run.traces.get(refKey(fatigueTraceRef(singles, person(0))))?.value).toBe(
      worker.fatigueAfter,
    );
    expect(run.traces.get(refKey(injuryChanceTraceRef(singles, person(0))))?.value).toBe(
      worker.injuryChance.value,
    );
    expect(run.traces.has(refKey(injuryRollTraceRef(singles, person(0))))).toBe(false);
  });

  it("keeps a player's injury chance in full only for a worker who was hurt", () => {
    const { world, person, singles } = built();
    const run = applyInOrder(world, [singles]);
    const ref = refKey(injuryChanceTraceRef(singles, person(0)));
    expect(workerOf(run.results[0], person(0)).injury.injured).toBe(false);
    expect(run.summaryOnly.has(ref)).toBe(true);
    expect(run.traces.get(ref)?.value).toBe(workerOf(run.results[0], person(0)).injuryChance.value);

    const hurt = built();
    const hurtRun = applyInOrder(hurt.world, [hurt.singles], certainInjuries());
    const hurtRef = refKey(injuryChanceTraceRef(hurt.singles, hurt.person(0)));
    expect(workerOf(hurtRun.results[0], hurt.person(0)).injury.injured).toBe(true);
    expect(hurtRun.summaryOnly.has(hurtRef)).toBe(false);
    const labels = (hurtRun.traces.get(hurtRef)?.trace.children ?? []).map((child) => child.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Fatigue by the end of the match',
        expect.stringMatching(/^Worst body part: /u),
        expect.stringMatching(/ duration class$/u),
        expect.stringMatching(/^Least safe opponent: .+, safety \d+/u),
      ]),
    );
  });

  it('keeps only a fatigue summary on a rival show: no wear, learning or 0 injury chance', () => {
    const { world, person, singles } = built({ rival: true });
    const run = applyInOrder(world, [singles]);
    const worker = workerOf(run.results[0], person(0));
    const fatigueRef = fatigueTraceRef(singles, person(0));
    expect(run.summaryOnly.has(refKey(fatigueRef))).toBe(true);
    expect(run.traces.has(refKey(wearTraceRef(singles, person(0))))).toBe(false);
    expect(run.traces.has(refKey(learningTraceRef(singles, person(0))))).toBe(false);
    expect(run.traces.has(refKey(injuryChanceTraceRef(singles, person(0))))).toBe(false);
    // Rival rules (AIP1's `ai.skipInMatchInjuries`, on by default) make the chance 0, but the
    // worker is still tired, worn and a little better.
    expect(worker.injuryChance.value).toBe(0);
    expect(worker.fatigueGain.value).toBeGreaterThan(0);
    expect(worker.learningByAttribute.ringwork.value).toBeGreaterThan(0);
    expect(run.people(person(0)).fatigue).toBe(worker.fatigueAfter);
  });

  it('logs once and writes no injury when nobody handles injuries', () => {
    clearInjuryHandler();
    const tunables = certainInjuries();
    const { world, person, singles, tag } = built();
    const run = applyInOrder(world, [singles, tag], tunables);
    const hurt = run.results.flatMap((result) =>
      (result?.workers ?? []).filter((worker) => worker.injury.injured),
    );
    expect(hurt).toHaveLength(2);
    expect(run.logs.filter((line) => line === NO_INJURY_HANDLER_LOG)).toHaveLength(1);
    for (let index = 0; index < 4; index += 1) {
      expect(run.people(person(index)).injury).toBeNull();
    }
    [singles, tag].forEach((segmentId, index) => {
      for (const worker of run.results[index]?.workers ?? []) {
        const stored = run.traces.has(refKey(injuryRollTraceRef(segmentId, worker.personId)));
        expect(stored).toBe(worker.injury.injured);
      }
    });
  });

  it('hands an injury to the handler and never rolls that worker again on the show', () => {
    const tunables = certainInjuries();
    const { world, person, singles, tag } = built();
    const requests: InjuryRequest[] = [];
    // `health.injure` (WRK6-03) is the built-in handler: clear it so this test's handler can
    // register; afterEach puts it back.
    clearInjuryHandler();
    cleanups.push(
      registerInjuryHandler({
        id: 'test.injure',
        apply: (ctx, request) => {
          requests.push(request);
          ctx.tx.update('people', request.personId, {
            injury: {
              kindKey: parseContentKey('injury.test-arm'),
              bodyPart: request.bodyPartHint,
              since: request.date,
              expectedReturn: request.date,
              canWorkAngles: true,
            },
          });
          return { injuryTraceRef: null };
        },
      }),
    );
    const run = applyInOrder(world, [singles, tag], tunables);
    // Singles: the first to roll (side 0) is hurt. Tag: they are not rolled again.
    expect(requests[0]).toMatchObject({
      personId: person(0),
      segmentId: singles,
      date: SHOW_DATE,
    });
    expect(requests[0]?.bodyPartHint).toBe(workerOf(run.results[0], person(0)).worstPartAfter.part);
    const again = workerOf(run.results[1], person(0));
    expect(again.injury.injured).toBe(false);
    expect(again.injuryChance.value).toBe(0);
    expect(findTraceNodes(again.injuryChance.trace, 'branch').map((node) => node.label)).toContain(
      ALREADY_INJURED_TONIGHT_LABEL,
    );
    // They still took the load of the second match.
    expect(again.fatigueGain.value).toBeGreaterThan(0);
    expect(requests.map((request) => request.segmentId)).toEqual([singles, tag]);
    expect(run.logs).not.toContain(NO_INJURY_HANDLER_LOG);
  });

  it("rolls a rival's workers with the rival-rules line until the level playing field is on", () => {
    const tunables = certainInjuries();
    const rival = built({ rival: true });
    const ruled = applyInOrder(rival.world, [rival.singles], tunables);
    const worker = workerOf(ruled.results[0], rival.person(0));
    expect(worker.injuryChance.value).toBe(0);
    expect(findTraceNodes(worker.injuryChance.trace, 'branch').map((node) => node.label)).toContain(
      RIVAL_NO_INJURIES_LABEL,
    );

    const level = built({ rival: true });
    level.world.transact('level playing field', (tx) => {
      tx.setMeta({ settings: { ...tx.view.meta.settings, levelPlayingField: true } });
    });
    const even = applyInOrder(level.world, [level.singles], tunables);
    const evenWorker = workerOf(even.results[0], level.person(0));
    expect(evenWorker.injuryChance.value).toBeGreaterThan(0);
    expect(
      findTraceNodes(evenWorker.injuryChance.trace, 'branch').map((node) => node.label),
    ).not.toContain(RIVAL_NO_INJURIES_LABEL);
    expect(evenWorker.injury.injured).toBe(true);
  });

  it("rolls the player's own workers normally", () => {
    const tunables = certainInjuries();
    const { world, person, singles } = built();
    const run = applyInOrder(world, [singles], tunables);
    const worker = workerOf(run.results[0], person(0));
    expect(worker.injuryChance.value).toBeGreaterThan(0);
    expect(
      findTraceNodes(worker.injuryChance.trace, 'branch').map((node) => node.label),
    ).not.toContain(RIVAL_NO_INJURIES_LABEL);
  });
});
