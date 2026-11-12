/**
 * The rating previews (MTCH1-06): rate a segment without it happening.
 *
 * - `match.preview`: one night, every number with its trace inline.
 * - `match.previewBatch`: up to 500 nights, summarised (no traces).
 *
 * A preview never writes, never stores a trace (a query has no recorder, so traces travel inline,
 * already bounded by the trace size limits) and never draws from the world's RNG: every roll comes
 * from `detachedStream(meta.seed, 'match.preview', String(seed))`, a stream no registry knows
 * about. The same arguments and seed always give the same answer; a new seed gives a new night.
 *
 * Design: docs/design/match-rating.md#previews.
 */

import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import { detachedStream } from '../../core/rng/registry';
import { matchTypesOf } from '../../model/catalogs';
import {
  PreviewArgsSchema,
  PreviewBatchArgsSchema,
  labPromotionOf,
  previewInputOf,
  requireRegion,
  type PreviewArgs,
  type PreviewBatchArgs,
} from './previewArgs';
import { rateSegment } from './rating/rateSegment';
import type { SegmentRatingInput, SegmentRatingResult } from './rating/types';
import {
  quarterCounts,
  roundTenth,
  scoreHistogram,
  statsOf,
  type HistogramBin,
  type QuarterCount,
  type Stats,
} from './stats';
import { MATCH_PREVIEW_STREAM } from './streams';

/** `match.preview`: the rated segment, every trace inline, and the seed it rolled with. */
export type PreviewResult = SegmentRatingResult & {
  readonly previewSeed: number;
};

/** The star line of a batch: the usual statistics plus how many runs landed on each quarter. */
export interface StarStats extends Stats {
  byQuarter: QuarterCount[];
}

/** `match.previewBatch`: statistics over every run. No traces. */
export interface PreviewBatchResult {
  runs: number;
  score: Stats;
  stars: StarStats;
  /** Null for a talking segment. */
  workRate: Stats | null;
  /** Null for a match. */
  talk: Stats | null;
  crowd: Stats;
  /** The crowd's expectation. It has no roll, so it is the same on every run; rounded to 0.1. */
  expectation: number;
  /** 20 bins of 5 points: 0–5 ... 95–100, the last one closed. */
  histogram: HistogramBin[];
}

/** `match.preview` refusal codes besides those of `rateSegment` and `invalidArgs`. */
export const PREVIEW_REASON_CODES = {
  noCatalog: 'noCatalog',
} as const;

declare module '../../core/api/maps' {
  interface QueryMap {
    'match.preview': { args: PreviewArgs; result: PreviewResult };
    'match.previewBatch': { args: PreviewBatchArgs; result: PreviewBatchResult };
  }
}

/** The rating input for the preview, after the checks a rating cannot make itself. */
export function previewInput(ctx: QueryContext, args: PreviewArgs): SegmentRatingInput {
  const { read } = ctx;
  if (matchTypesOf(read, { includeHidden: true }).length === 0) {
    return refuseQuery({
      code: PREVIEW_REASON_CODES.noCatalog,
      message:
        'This save was started before match types existed. Start a new game to use the Match lab.',
    });
  }
  const promotionId = labPromotionOf(read, ctx.viewer, args.promotionId);
  requireRegion(read, args.regionId);
  return previewInputOf(args, promotionId, ctx.date);
}

/** Rates `input` on the detached stream for `key`. Refuses like `rateSegment`. */
export function rateWithKey(
  ctx: QueryContext,
  input: SegmentRatingInput,
  key: number,
): SegmentRatingResult {
  const { read } = ctx;
  const result = rateSegment(input, {
    read,
    tunables: ctx.tunables,
    mode: 'preview',
    seed: read.meta.seed,
    rng: detachedStream(read.meta.seed, MATCH_PREVIEW_STREAM, String(key)),
  });
  if (!result.ok) {
    return refuseQuery(result.reasons);
  }
  return result.data;
}

/**
 * `match.preview`. Viewer scoping: a worker line carries only what a public profile shows (the
 * performance numbers come from attributes, style and fatigue, all public), popularity in the
 * show's region and momentum (on-screen form, which every viewer sees). Nothing from
 * `development`, `vices`, morale or contract terms is read into a line, so the answer is the same
 * for every viewer. Warnings never refuse a preview; they come back in `warnings`.
 */
export const previewQuery: QueryDefinition<'match.preview'> = defineQuery('match.preview', {
  args: PreviewArgsSchema,
  run: (ctx, args) => ({
    ...rateWithKey(ctx, previewInput(ctx, args), args.previewSeed),
    previewSeed: args.previewSeed,
  }),
});

/**
 * `match.previewBatch`. Run `i` rolls on the detached stream keyed `previewSeed + i`, so run 0 is
 * exactly `match.preview` with the same seed. Same viewer scoping as `match.preview`, and no
 * per-worker lines or traces at all.
 */
export const previewBatchQuery: QueryDefinition<'match.previewBatch'> = defineQuery(
  'match.previewBatch',
  {
    args: PreviewBatchArgsSchema,
    run: (ctx, args) => {
      const scores: number[] = [];
      const stars: number[] = [];
      const workRates: number[] = [];
      const talks: number[] = [];
      const crowds: number[] = [];
      const input = previewInput(ctx, args);
      let expectation = 0;
      for (let run = 0; run < args.runs; run += 1) {
        const result = rateWithKey(ctx, input, args.previewSeed + run);
        scores.push(result.score.value);
        stars.push(result.stars.value);
        crowds.push(result.crowd.value);
        if (result.workRate !== null) {
          workRates.push(result.workRate.value);
        }
        if (result.talk !== null) {
          talks.push(result.talk.value);
        }
        expectation = result.expectation.value;
      }
      return {
        runs: args.runs,
        score: statsOf(scores),
        stars: { ...statsOf(stars), byQuarter: quarterCounts(stars) },
        workRate: workRates.length === 0 ? null : statsOf(workRates),
        talk: talks.length === 0 ? null : statsOf(talks),
        crowd: statsOf(crowds),
        expectation: roundTenth(expectation),
        histogram: scoreHistogram(scores),
      };
    },
  },
);
