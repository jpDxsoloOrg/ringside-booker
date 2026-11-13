// The rival desk's turn runner: jobs, cadences, spreading and savepoint isolation (AIP1-03).
// Design: docs/design/rival-desk.md#jobs
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { addDays, dayOfMonth, makeGameDate, type GameDate } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import { RegistryError } from '../../../src/core/errors';
import { untraced } from '../../../src/core/trace';
import { aiUnitKey } from '../../../src/model/entities/ai-profile';
import {
  aiJobs,
  computerUnits,
  isDue,
  monthlyDayOf,
  profileOf,
  registerAiJob,
  registerDecisionKind,
  unitOffset,
  WEEKLY_SPREAD_DAYS,
  type AiJobCadence,
  type AiJobContext,
  type AiJobSpec,
} from '../../../src/systems/aip';
import type { DoorContext } from '../../../src/systems/workers/doors';
import { startDefaultGame } from '../calendar/default-game';
import { RUNNER_START, runnerWorld, runTurnsFor, runTurnsOn } from './runner-world';

interface JobCall {
  readonly jobId: string;
  readonly unitKey: string;
  readonly date: GameDate;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Registers a test job for this test only. */
function testJob(spec: AiJobSpec): void {
  cleanups.push(registerAiJob(spec));
}

/** Registers a job of `cadence` that only notes each call in `calls`. */
function recordingJob(id: string, cadence: AiJobCadence, calls: JobCall[]): void {
  testJob({
    id,
    cadence,
    run: (job) => {
      calls.push({ jobId: id, unitKey: job.unit.key, date: job.date });
    },
  });
}

const TEST_KIND = 'runnerTest';

function registerTestKind(): void {
  cleanups.push(registerDecisionKind({ kind: TEST_KIND, chip: 'Runner test' }));
}

function decisionOf(job: AiJobContext, marker: string): void {
  job.recordDecision({
    kind: TEST_KIND,
    summary: { key: parseContentKey('aip.test.summary'), params: { marker } },
    traced: untraced(1, marker),
  });
}

describe('registerAiJob', () => {
  it('lists jobs by id and refuses a duplicate id, naming both', () => {
    testJob({ id: 'test.zeta', cadence: 'daily', run: () => undefined });
    testJob({ id: 'test.alpha', cadence: 'weekly', run: () => undefined });
    expect(aiJobs().map((job) => job.id)).toEqual(['test.alpha', 'test.zeta']);
    expect(aiJobs()[0]?.units).toBe('all');
    expect(() => {
      registerAiJob({ id: 'test.zeta', cadence: 'monthly', run: () => undefined });
    }).toThrow(/"test\.zeta" \(monthly\) is already registered as "test\.zeta" \(daily\)/);
    expect(() => {
      registerAiJob({ id: 'test.zeta', cadence: 'monthly', run: () => undefined });
    }).toThrow(RegistryError);
  });

  it('refuses an id that is not an API name', () => {
    expect(() => {
      registerAiJob({ id: 'rosterReview', cadence: 'daily', run: () => undefined });
    }).toThrow(RegistryError);
  });

  it('gives the job context the shape of a door context', () => {
    expectTypeOf<AiJobContext>().toExtend<DoorContext>();
  });
});

describe('aip.runTurns', () => {
  it('runs a daily job every day for every computer unit and never for the human one', () => {
    const calls: JobCall[] = [];
    recordingJob('test.daily', 'daily', calls);
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 3);

    const computerKeys = [
      aiUnitKey(built.proA, built.computerBrand),
      aiUnitKey(built.proB, null),
      aiUnitKey(built.proC, null),
    ].sort();
    for (let offset = 0; offset < 3; offset++) {
      const date = addDays(RUNNER_START, offset);
      expect(calls.filter((call) => call.date === date).map((call) => call.unitKey)).toEqual(
        computerKeys,
      );
    }
    expect(calls.some((call) => call.unitKey === aiUnitKey(built.proA, null))).toBe(false);

    const lastDay = addDays(RUNNER_START, 2);
    expect(profileOf(built.world, built.proB, null)?.lastTurnOn).toBe(lastDay);
    expect(profileOf(built.world, built.proA, null)).toBeNull();
    const turns = built.runtime.bus.recent({ types: ['aip.turnTaken'] });
    expect(turns).toHaveLength(9);
    expect(turns.at(-1)?.payload).toEqual({
      promotionId: built.proC,
      brandId: null,
      date: lastDay,
      jobIds: ['test.daily'],
    });
  });

  it('runs a job limited to brands only for the computer GM brand', () => {
    const calls: JobCall[] = [];
    testJob({
      id: 'test.brandsOnly',
      cadence: 'daily',
      units: 'brands',
      run: (job) => {
        calls.push({ jobId: 'test.brandsOnly', unitKey: job.unit.key, date: job.date });
      },
    });
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 1);
    expect(calls.map((call) => call.unitKey)).toEqual([aiUnitKey(built.proA, built.computerBrand)]);
  });

  it('takes no turn and publishes nothing when no job is due', () => {
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 2);
    expect(built.runtime.bus.recent({ types: ['aip.turnTaken'] })).toEqual([]);
    expect(profileOf(built.world, built.proB, null)?.lastTurnOn).toBeNull();
  });

  it('runs a weekly job exactly 4 times per unit in 28 days, 7 days apart', () => {
    const calls: JobCall[] = [];
    recordingJob('test.weekly', 'weekly', calls);
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 28);
    const units = computerUnits(built.world);
    expect(units).toHaveLength(3);
    for (const unit of units) {
      const dates = calls.filter((call) => call.unitKey === unit.key).map((call) => call.date);
      expect(dates).toHaveLength(4);
      expect(dates.slice(1)).toEqual(dates.slice(0, -1).map((date) => addDays(date, 7)));
      expect(dates.every((date) => isDue('weekly', unit, date, built.world))).toBe(true);
    }
  });

  it("spreads the default world's 11 rivals over more than one weekday", () => {
    const state = startDefaultGame();
    const keys = state.world.tables.aiProfiles.map((profile) =>
      aiUnitKey(profile.promotionId, profile.brandId),
    );
    expect(keys).toHaveLength(11);
    const weekdays = new Set(keys.map((key) => unitOffset(key, WEEKLY_SPREAD_DAYS)));
    expect(weekdays.size).toBeGreaterThanOrEqual(2);
  });

  it('runs a monthly job once a month on day 1 + offset', () => {
    const calls: JobCall[] = [];
    recordingJob('test.monthly', 'monthly', calls);
    const built = runnerWorld();
    const from = makeGameDate(2026, 1, 1);
    // January to April 2026.
    runTurnsFor(built.runtime, from, 120);
    for (const unit of computerUnits(built.world)) {
      const dates = calls.filter((call) => call.unitKey === unit.key).map((call) => call.date);
      expect(dates).toHaveLength(4);
      expect(dates.map((date) => date.slice(0, 7))).toEqual([
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
      ]);
      expect(dates.every((date) => dayOfMonth(date) === monthlyDayOf(unit.key))).toBe(true);
    }
  });

  it('runs a beforeShow job only on the day of an open show of that unit', () => {
    const showDate = addDays(RUNNER_START, 2);
    const calls: { unitKey: string; date: GameDate; shows: number }[] = [];
    testJob({
      id: 'test.beforeShow',
      cadence: 'beforeShow',
      run: (job) => {
        calls.push({ unitKey: job.unit.key, date: job.date, shows: job.shows.length });
      },
    });
    const built = runnerWorld((builder) => {
      builder
        .withEventInstance({ date: showDate, airDate: showDate }, 'B')
        // A cancelled show is not one to plan for.
        .withEventInstance(
          { date: addDays(showDate, 1), airDate: addDays(showDate, 1), status: 'cancelled' },
          'B',
        )
        // The human promotion's own show is never a rival's.
        .withEventInstance({ date: showDate, airDate: showDate }, 'A');
    });
    runTurnsFor(built.runtime, RUNNER_START, 5);
    expect(calls).toEqual([{ unitKey: aiUnitKey(built.proB, null), date: showDate, shows: 1 }]);
  });

  it('runs jobs in id order for each unit, units in key order', () => {
    const calls: JobCall[] = [];
    recordingJob('test.zeta', 'daily', calls);
    recordingJob('test.alpha', 'daily', calls);
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 1);
    const keys = computerUnits(built.world).map((unit) => unit.key);
    expect(calls.map((call) => `${call.unitKey} ${call.jobId}`)).toEqual(
      keys.flatMap((key) => [`${key} test.alpha`, `${key} test.zeta`]),
    );
  });

  it('rolls back a throwing job alone: the next job and the next unit still commit', () => {
    registerTestKind();
    const built = runnerWorld();
    const failingKey = aiUnitKey(built.proB, null);
    testJob({
      id: 'test.aFails',
      cadence: 'daily',
      run: (job) => {
        decisionOf(job, `a ${job.unit.key}`);
        job.publish('aip.turnTaken', {
          promotionId: job.unit.promotionId,
          brandId: null,
          date: job.date,
          jobIds: ['buffered'],
        });
        if (job.unit.key === failingKey) {
          throw new Error('the rival lost its notes');
        }
      },
    });
    testJob({
      id: 'test.bWorks',
      cadence: 'daily',
      run: (job) => {
        decisionOf(job, `b ${job.unit.key}`);
      },
    });
    const [report] = runTurnsFor(built.runtime, RUNNER_START, 1);
    expect(report?.status).toBe('ok');
    expect(report?.logs.join('\n')).toContain(
      `Rival job test.aFails failed for ${failingKey} and was rolled back: the rival lost its notes`,
    );

    const markers = built.world.tables.aiDecisions
      .values()
      .map((decision) => decision.summary.params['marker']);
    const units = computerUnits(built.world).map((unit) => unit.key);
    expect(markers.sort()).toEqual(
      units.flatMap((key) => (key === failingKey ? [`b ${key}`] : [`a ${key}`, `b ${key}`])).sort(),
    );

    expect(
      built.runtime.bus.recent({ types: ['aip.jobFailed'] }).map((event) => event.payload),
    ).toEqual([
      {
        jobId: 'test.aFails',
        promotionId: built.proB,
        brandId: null,
        message: 'the rival lost its notes',
      },
    ]);
    // The failed job's buffered event, trace and decision event never reached the day.
    const buffered = built.runtime.bus
      .recent({ types: ['aip.turnTaken'] })
      .filter((event) => event.payload.jobIds.includes('buffered'));
    expect(buffered.map((event) => event.payload.promotionId)).not.toContain(built.proB);
    expect(buffered).toHaveLength(2);
    const recorded = built.runtime.bus.recent({ types: ['aip.decisionRecorded'] });
    expect(recorded).toHaveLength(5);
    const bTraces = built.runtime.traces
      .listByKind(`aip.${TEST_KIND}`)
      .filter((entry) => entry.ref.id.startsWith(`${failingKey}:`));
    // Only test.bWorks' decision for B, numbered 0 because test.aFails' row was rolled back.
    expect(bTraces.map((entry) => entry.ref.id)).toEqual([`${failingKey}:${RUNNER_START}:0`]);
  });

  it('gives a promotion added mid-game a profile on its first turn', () => {
    const calls: JobCall[] = [];
    recordingJob('test.daily', 'daily', calls);
    const built = runnerWorld();
    runTurnsOn(built.runtime, RUNNER_START);
    const { id: templateId, ...fields } = structuredClone(
      built.world.tables.promotions.require(built.proB),
    );
    expect(templateId).toBe(built.proB);
    const created = built.world.transact('found', (tx) =>
      tx.create('promotions', { ...fields, name: 'New Rival' }),
    );
    if (!created.ok) {
      throw created.error;
    }
    const newcomer = created.value.id;
    expect(profileOf(built.world, newcomer, null)).toBeNull();

    const nextDay = addDays(RUNNER_START, 1);
    runTurnsOn(built.runtime, nextDay);
    expect(profileOf(built.world, newcomer, null)).toMatchObject({
      createdOn: nextDay,
      lastTurnOn: nextDay,
    });
    expect(calls.filter((call) => call.date === nextDay)).toHaveLength(4);
  });
});
