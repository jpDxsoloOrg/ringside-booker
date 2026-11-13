// Rival decisions: the kind registry, recordDecision, pruning and next-due dates (AIP1-03).
// Design: docs/design/rival-desk.md#decision-log and #jobs
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, makeGameDate, type GameDate } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import { InvalidArgumentError, RegistryError } from '../../../src/core/errors';
import type { AiDecisionId, PersonId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import { untraced } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import { aiUnitKey } from '../../../src/model/entities/ai-profile';
import {
  computerUnits,
  decisionKindOf,
  decisionKinds,
  isDue,
  nextDueOn,
  pruneDecisionLog,
  pruneDecisionLogOn,
  registerAiJob,
  registerDecisionKind,
  ROSTER_REVIEW_DECISION_KIND,
  writeAiDecision,
  type AiJobContext,
} from '../../../src/systems/aip';
import { testId } from '../../support';
import { pruneOn, RUNNER_START, runnerWorld, runTurnsFor, type RunnerWorld } from './runner-world';

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const KIND = 'decisionTest';
const SUMMARY = { key: parseContentKey('aip.test.summary'), params: { count: 2 } };

function withTestKind(): void {
  cleanups.push(registerDecisionKind({ kind: KIND, chip: 'Decision test', icon: 'Users' }));
}

function withJob(run: (job: AiJobContext) => void): void {
  cleanups.push(registerAiJob({ id: 'test.decide', cadence: 'daily', run }));
}

describe('registerDecisionKind', () => {
  it('lists kinds sorted, with rosterReview registered by the rival desk', () => {
    withTestKind();
    expect(decisionKindOf(ROSTER_REVIEW_DECISION_KIND)).toEqual({
      kind: 'rosterReview',
      chip: 'Roster review',
      icon: null,
    });
    expect(decisionKindOf(KIND)).toEqual({ kind: KIND, chip: 'Decision test', icon: 'Users' });
    const kinds = decisionKinds().map((kind) => kind.kind);
    expect(kinds).toEqual([...kinds].sort());
    expect(decisionKindOf('neverRegistered')).toBeNull();
  });

  it('refuses a duplicate kind and a malformed one', () => {
    expect(() => registerDecisionKind({ kind: 'rosterReview', chip: 'Again' })).toThrow(
      RegistryError,
    );
    expect(() => registerDecisionKind({ kind: 'Roster review', chip: 'Bad' })).toThrow(
      RegistryError,
    );
    expect(() => registerDecisionKind({ kind: 'emptyChip', chip: ' ' })).toThrow(RegistryError);
  });
});

describe('recordDecision', () => {
  it('writes the row, stores a summary-only trace under its ref and publishes the event', () => {
    withTestKind();
    const ids: AiDecisionId[] = [];
    withJob((job) => {
      ids.push(
        job.recordDecision({
          kind: KIND,
          summary: SUMMARY,
          traced: untraced(7, 'Workers reviewed'),
          importance: 2,
        }),
      );
      ids.push(job.recordDecision({ kind: KIND, summary: SUMMARY }));
    });
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 1);

    const unitKey = aiUnitKey(built.proB, null);
    const rowsOfB = built.world.tables.aiDecisions
      .values()
      .filter((decision) => decision.promotionId === built.proB);
    const first = rowsOfB.find((decision) => decision.importance === 2);
    const second = rowsOfB.find((decision) => decision.importance === 0);
    expect(first).toMatchObject({
      brandId: null,
      date: RUNNER_START,
      kind: KIND,
      summary: SUMMARY,
      refs: {
        personIds: [],
        employmentIds: [],
        titleIds: [],
        promotionIds: [],
        eventInstanceId: null,
      },
      traceRef: { kind: `aip.${KIND}`, id: `${unitKey}:${RUNNER_START}:0` },
      revealOn: RUNNER_START,
      importance: 2,
    });
    expect(second).toMatchObject({ traceRef: null, importance: 0 });
    expect(ids).toContain(first?.id);

    const ref = first?.traceRef;
    if (ref === null || ref === undefined) {
      throw new Error('the first decision should have a trace');
    }
    expect(built.runtime.traces.has(ref)).toBe(true);
    const stored = built.runtime.traces.get(ref);
    expect(stored !== undefined && !isFullTrace(stored) && stored.summaryOnly).toBe(true);

    const events = built.runtime.bus.recent({ types: ['aip.decisionRecorded'] });
    expect(events).toHaveLength(6);
    expect(events.map((event) => event.payload)).toContainEqual({
      decisionId: first?.id,
      promotionId: built.proB,
      brandId: null,
      kind: KIND,
      revealOn: RUNNER_START,
      importance: 2,
    });
  });

  it('rolls the job back for a kind nobody registered', () => {
    withJob((job) => {
      job.recordDecision({ kind: 'notAKind', summary: SUMMARY });
    });
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 1);
    expect(built.world.tables.aiDecisions.size).toBe(0);
    expect(built.runtime.bus.recent({ types: ['aip.decisionRecorded'] })).toEqual([]);
    const failures = built.runtime.bus.recent({ types: ['aip.jobFailed'] });
    expect(failures).toHaveLength(3);
    expect(failures[0]?.payload.message).toMatch(
      /kind must be a kind added with registerDecisionKind/,
    );
  });

  it('refuses more than 12 IDs in a ref list and an importance above 3', () => {
    withTestKind();
    const built = runnerWorld();
    const [unit] = computerUnits(built.world);
    if (unit === undefined) {
      throw new Error('no unit');
    }
    const people: PersonId[] = Array.from({ length: 13 }, (_, index) =>
      testId('person', index + 1),
    );
    const report = runStep(
      built.runtime,
      'test.write',
      { kind: 'phase', id: 'test.write' },
      (ctx) => {
        expect(() =>
          writeAiDecision(ctx.tx, ctx, unit, {
            kind: KIND,
            summary: SUMMARY,
            refs: { personIds: people },
          }),
        ).toThrow(InvalidArgumentError);
        expect(() =>
          writeAiDecision(ctx.tx, ctx, unit, { kind: KIND, summary: SUMMARY, importance: 4 }),
        ).toThrow(InvalidArgumentError);
        // A trace to store and an existing one to point at: one or the other.
        expect(() =>
          writeAiDecision(ctx.tx, ctx, unit, {
            kind: KIND,
            summary: SUMMARY,
            traced: untraced('x', 'Test'),
            traceRef: { kind: 'test.trace', id: 'one' },
          }),
        ).toThrow(InvalidArgumentError);
        writeAiDecision(ctx.tx, ctx, unit, {
          kind: KIND,
          summary: SUMMARY,
          revealOn: addDays(RUNNER_START, 3),
          traceRef: { kind: 'test.trace', id: 'one' },
        });
      },
      { date: RUNNER_START },
    );
    expect(report.status).toBe('ok');
    expect(
      built.world.tables.aiDecisions.values().map((row) => [row.revealOn, row.traceRef]),
    ).toEqual([[addDays(RUNNER_START, 3), { kind: 'test.trace', id: 'one' }]]);
  });
});

/** Writes one decision for promotion B dated `date`, revealed on `revealOn` (default `date`). */
function seedDecision(built: RunnerWorld, date: GameDate, revealOn: GameDate = date): void {
  const [unit] = computerUnits(built.world).filter((each) => each.promotionId === built.proB);
  if (unit === undefined) {
    throw new Error('no unit B');
  }
  const report = runStep(
    built.runtime,
    'test.seed',
    { kind: 'phase', id: 'test.seed' },
    (ctx) => {
      writeAiDecision(ctx.tx, ctx, unit, { kind: KIND, summary: SUMMARY, revealOn });
    },
    { date },
  );
  if (report.status !== 'ok') {
    throw new Error(report.error?.message);
  }
}

function datesLeft(built: RunnerWorld): GameDate[] {
  return built.world.tables.aiDecisions
    .values()
    .map((row) => row.date)
    .sort();
}

describe('pruning the decision log', () => {
  it('keeps rows inside the window, day by day through the indexes', () => {
    withTestKind();
    const built = runnerWorld(undefined, { 'aip.decisionLogRetentionDays': 5 });
    for (let offset = 0; offset < 10; offset++) {
      seedDecision(built, addDays(RUNNER_START, offset));
    }
    // A plan revealed later than its window stays until it airs.
    seedDecision(built, RUNNER_START, addDays(RUNNER_START, 12));
    for (let offset = 0; offset < 13; offset++) {
      pruneOn(built.runtime, addDays(RUNNER_START, offset));
      if (offset === 11) {
        // Day 11 keeps days 7 to 9 and the unrevealed plan from day 0.
        expect(datesLeft(built)).toEqual([
          RUNNER_START,
          addDays(RUNNER_START, 7),
          addDays(RUNNER_START, 8),
          addDays(RUNNER_START, 9),
        ]);
      }
    }
    expect(datesLeft(built)).toEqual([addDays(RUNNER_START, 8), addDays(RUNNER_START, 9)]);
  });

  it('a retention of 0 removes every revealed row, with the sweep and the daily prune', () => {
    withTestKind();
    const built = runnerWorld();
    for (let offset = 0; offset < 4; offset++) {
      seedDecision(built, addDays(RUNNER_START, offset));
    }
    const today = addDays(RUNNER_START, 3);
    const swept = built.world.transact('sweep', (tx) => pruneDecisionLog(tx, today, 0));
    expect(swept.ok && swept.value).toBe(4);
    expect(built.world.tables.aiDecisions.size).toBe(0);

    seedDecision(built, today);
    const daily = built.world.transact('daily', (tx) => pruneDecisionLogOn(tx, today, 0));
    expect(daily.ok && daily.value).toBe(1);
    expect(built.world.tables.aiDecisions.size).toBe(0);
  });

  it('the monthly sweep catches rows a lowered retention left behind', () => {
    withTestKind();
    const built = runnerWorld(undefined, { 'aip.decisionLogRetentionDays': 3 });
    const from = makeGameDate(2026, 1, 20);
    seedDecision(built, from);
    seedDecision(built, addDays(from, 1));
    // A retention lowered to 3: 31 January's daily prune only reaches the 28th.
    pruneOn(built.runtime, makeGameDate(2026, 1, 31));
    expect(built.world.tables.aiDecisions.size).toBe(2);
    pruneOn(built.runtime, makeGameDate(2026, 2, 1));
    expect(built.world.tables.aiDecisions.size).toBe(0);
  });
});

describe('nextDueOn', () => {
  it('agrees with isDue over 60 days for weekly and monthly jobs', () => {
    const built = runnerWorld();
    const from = makeGameDate(2026, 11, 15);
    for (const unit of computerUnits(built.world)) {
      for (const cadence of ['weekly', 'monthly'] as const) {
        for (let offset = 0; offset < 60; offset++) {
          const date = addDays(from, offset);
          const next = nextDueOn(cadence, unit, date);
          if (next === null) {
            throw new Error(`${cadence} should have a next date`);
          }
          expect(isDue(cadence, unit, next, built.world)).toBe(true);
          expect(isDue(cadence, unit, date, built.world)).toBe(next === date);
          for (let between = date; between < next; between = addDays(between, 1)) {
            expect(isDue(cadence, unit, between, built.world)).toBe(false);
          }
        }
      }
      expect(nextDueOn('daily', unit, from)).toBeNull();
      expect(nextDueOn('beforeShow', unit, from)).toBeNull();
    }
  });
});
