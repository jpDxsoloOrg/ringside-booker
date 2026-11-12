/**
 * The built-in match rater (MTCH1-05): the MTCH1 formulas run through the rating stages.
 *
 * Per worker: in-ring and entertainment performance (`performance` stage) and the stamina check.
 * Per side: the side aggregate (`side` stage) inside work rate (`workRate` stage, compressed). Then
 * star power, the expectation (`expectation` stage), the crowd (`crowd` stage, compressed), the
 * segment score with the policy's bonus (`score` stage) and the stars (`stars` stage).
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import { workerPerformance, type PerformanceAxis } from '../formulas/workerPerformance';
import { matchLeaderOf, staminaCheckOf, workRate } from '../formulas/workRate';
import type { RatingContext } from './context';
import {
  durationLabelOf,
  gatherSides,
  personIdsOf,
  policySummary,
  rateTail,
  rngDeps,
  type GatheredWorker,
} from './common';
import { runStage } from './runStage';
import type { SegmentRatingResult, WorkerLine, WorkerStaminaLine } from './types';

/** Rates a match. */
export function matchRater(ctx: RatingContext): SegmentRatingResult {
  const { matchType, tunables } = ctx;
  if (matchType === undefined) {
    throw new InvalidArgumentError('matchRater', 'ctx.matchType', undefined, 'a match type');
  }
  const sides = gatherSides(ctx);
  const workers = sides.flatMap((side) => side.workers);
  const durationLabel = durationLabelOf(ctx.slot);

  const performanceOf = (worker: GatheredWorker, axis: PerformanceAxis): Traced<number> =>
    runStage(
      'performance',
      workerPerformance(
        {
          personId: worker.personId,
          name: worker.name,
          axis,
          attributes: worker.person.attributes,
          style: worker.person.style,
          fatigue: worker.person.fatigue,
          injured: worker.injured,
          styleAffinity: matchType.styleAffinity,
        },
        { tunables },
      ),
      ctx,
      { kind: 'worker', personId: worker.personId, side: worker.side, axis },
    );

  const inRing = new Map<PersonId, Traced<number>>();
  const entertainment = new Map<PersonId, Traced<number>>();
  const stamina = new Map<PersonId, WorkerStaminaLine>();
  for (const worker of workers) {
    inRing.set(worker.personId, performanceOf(worker, 'inRing'));
    entertainment.set(worker.personId, performanceOf(worker, 'entertainment'));
    stamina.set(
      worker.personId,
      staminaCheckOf(
        { name: worker.name, stamina: worker.person.attributes.stamina },
        { durationClass: ctx.durationClass, workerCount: workers.length },
        tunables,
      ),
    );
  }

  const required = <T>(map: ReadonlyMap<PersonId, T>, worker: GatheredWorker): T => {
    const value = map.get(worker.personId);
    if (value === undefined) {
      throw new InvalidArgumentError(
        'matchRater',
        'personId',
        worker.personId,
        'a gathered worker',
      );
    }
    return value;
  };

  const rawWorkRate = workRate(
    {
      durationClass: ctx.durationClass,
      durationLabel,
      sides: sides.map((side) => ({
        side: side.side,
        members: side.workers.map((worker) => ({
          id: worker.personId,
          name: worker.name,
          performance: required(inRing, worker),
          stamina: worker.person.attributes.stamina,
        })),
      })),
      workerCount: workers.length,
      leader: matchLeaderOf(
        workers.map((worker) => ({
          id: worker.personId,
          name: worker.name,
          psychology: worker.person.attributes.psychology,
        })),
      ),
      matchType,
      sideStage: (side, value) =>
        runStage('side', value, ctx, {
          kind: 'side',
          side: side.side,
          personIds: personIdsOf(sides, side.side),
        }),
    },
    rngDeps(ctx),
  );
  const performance = runStage('workRate', rawWorkRate, ctx);

  const tail = rateTail(ctx, {
    kind: 'match',
    performance,
    workers,
    entertainment,
    crowdFactor: matchType.crowdFactor,
    typeName: matchType.name,
  });

  const lines: WorkerLine[] = workers.map((worker) => ({
    personId: worker.personId,
    name: worker.name,
    side: worker.side,
    inRing: required(inRing, worker),
    entertainment: required(entertainment, worker),
    talk: null,
    stamina: required(stamina, worker),
    popularity: worker.popularity,
    momentum: worker.momentum,
  }));

  return {
    kind: 'match',
    score: tail.score,
    stars: tail.stars,
    workRate: performance,
    talk: null,
    crowd: tail.crowd,
    expectation: tail.expectation,
    starPower: tail.starPower,
    slot: ctx.slot,
    workers: lines,
    warnings: [],
    policy: policySummary(ctx),
  };
}
