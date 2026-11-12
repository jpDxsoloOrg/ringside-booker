/**
 * The built-in angle rater (MTCH1-05): the simple talking-segment rating. MTCH5 swaps in a
 * beat-based rater behind the same kind with `registerSegmentRater('angle', rater, { replace: true })`.
 *
 * Per speaker: talk with the angle type's speaker weights and entertainment (`performance` stage).
 * Per side: the side aggregate (`side` stage) inside the speaker score (`talk` stage, compressed).
 * The crowd, score and stars run as for a match, with talk in place of work rate. Angle types have
 * no crowd factor, so it is 1. Injured workers may talk; `segmentWarnings` flags those whose injury
 * rules out talking segments.
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { PersonId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import { speakerScore } from '../formulas/speakerScore';
import { workerPerformance, type PerformanceAxis } from '../formulas/workerPerformance';
import type { RatingContext } from './context';
import {
  gatherSides,
  personIdsOf,
  policySummary,
  rateTail,
  rngDeps,
  type GatheredWorker,
} from './common';
import { runStage } from './runStage';
import type { SegmentRatingResult, WorkerLine } from './types';

/** Angle types carry no crowd factor: the crowd takes a talking segment as it comes. */
export const ANGLE_CROWD_FACTOR = 1;

/** Rates a talking segment. */
export function angleRater(ctx: RatingContext): SegmentRatingResult {
  const { angleType, tunables } = ctx;
  if (angleType === undefined) {
    throw new InvalidArgumentError('angleRater', 'ctx.angleType', undefined, 'an angle type');
  }
  const sides = gatherSides(ctx);
  const workers = sides.flatMap((side) => side.workers);

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
          styleAffinity: [],
          talkWeights: angleType.speakerWeights,
          angleTypeName: angleType.name,
        },
        { tunables },
      ),
      ctx,
      { kind: 'worker', personId: worker.personId, side: worker.side, axis },
    );

  const talk = new Map<PersonId, Traced<number>>();
  const entertainment = new Map<PersonId, Traced<number>>();
  for (const worker of workers) {
    talk.set(worker.personId, performanceOf(worker, 'talk'));
    entertainment.set(worker.personId, performanceOf(worker, 'entertainment'));
  }
  const required = (map: ReadonlyMap<PersonId, Traced<number>>, worker: GatheredWorker) => {
    const value = map.get(worker.personId);
    if (value === undefined) {
      throw new InvalidArgumentError(
        'angleRater',
        'personId',
        worker.personId,
        'a gathered worker',
      );
    }
    return value;
  };

  const rawTalk = speakerScore(
    {
      angleType,
      sides: sides.map((side) => ({
        side: side.side,
        members: side.workers.map((worker) => ({
          id: worker.personId,
          name: worker.name,
          talk: required(talk, worker),
        })),
      })),
      sideStage: (side, value) =>
        runStage('side', value, ctx, {
          kind: 'side',
          side: side.side,
          personIds: personIdsOf(sides, side.side),
        }),
    },
    rngDeps(ctx),
  );
  const performance = runStage('talk', rawTalk, ctx);

  const tail = rateTail(ctx, {
    kind: 'angle',
    performance,
    workers,
    entertainment,
    crowdFactor: ANGLE_CROWD_FACTOR,
    typeName: angleType.name,
  });

  const lines: WorkerLine[] = workers.map((worker) => ({
    personId: worker.personId,
    name: worker.name,
    side: worker.side,
    inRing: null,
    entertainment: required(entertainment, worker),
    talk: required(talk, worker),
    stamina: null,
    popularity: worker.popularity,
    momentum: worker.momentum,
  }));

  return {
    kind: 'angle',
    score: tail.score,
    stars: tail.stars,
    workRate: null,
    talk: performance,
    crowd: tail.crowd,
    expectation: tail.expectation,
    starPower: tail.starPower,
    slot: ctx.slot,
    workers: lines,
    warnings: [],
    policy: policySummary(ctx),
  };
}
