/**
 * The Match lab's Simulate (MTCH2-04): resolve a match plan and rate the match with its finish,
 * without anything happening.
 *
 * - `match.simulate`: the preview arguments plus a plan (winner, finish, method). The plan goes
 *   through `resolveMatchOutcome` (MTCH2-03), then the match is rated exactly as `match.preview`
 *   rates it but with the resolution on the input, so the finish effects (MTCH2-02) show in the
 *   work rate and crowd traces.
 * - `match.simulateBatch` (MTCH2-07): the same plan played out up to 500 times, summarised like
 *   `match.previewBatch` plus how often each side won, how many draws and no contests, and how
 *   often each finish came up. The lab's Run with Runs above 1.
 * - `match.resultMode`: whether Random winners decides the viewer's results, for the lab's and the
 *   booking editor's Auto option. The web never reads world settings itself.
 *
 * Like every preview, a simulation never writes, never stores a trace and never draws from the
 * world's RNG: the winner and finish rolls come from detached `match.auto-winner` and `match.finish`
 * streams keyed by the preview seed, the rating rolls from the detached `match.preview` stream. The
 * same arguments always give the same night; the lab picks a fresh seed on every Run.
 *
 * Design: docs/design/match-finishes.md#simulate.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import { detachedStream, type RngStream } from '../../core/rng/registry';
import type { TraceNode } from '../../core/trace';
import type { FinishCategory } from '../../model/catalogs';
import { MAX_SIDE } from '../../model/entities/participant';
import type { MatchOutcome } from '../../model/entities/segment';
import { zContentKey } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import { autoWinnerInputsOf } from './finishes/autoWinnerInputs';
import { randomWinnersActive } from './finishes/randomWinners';
import {
  resolveMatchOutcome,
  type PlannedWinner,
  type ResolveStreamName,
} from './finishes/resolve';
import { PREVIEW_BATCH_MAX_RUNS, PreviewArgsSchema, type PreviewArgs } from './previewArgs';
import {
  previewInput,
  ratingTally,
  rateWithKey,
  type PreviewBatchResult,
  type PreviewResult,
} from './previewQueries';
import type { AutoWinnerSide } from './finishes/autoWinnerInputs';
import type { SegmentRatingInput } from './rating/types';
import { geographyOf } from '../world/geography';
import {
  computeSegmentAftermath,
  type SegmentAftermath,
} from './aftermath/computeSegmentAftermath';

/** `match.simulate`: the preview arguments plus the booking plan. */
export interface SimulateArgs extends PreviewArgs {
  /** Auto, a stored 0-based side, or Draw. */
  winner: PlannedWinner;
  /** The planned finish, or null for Auto. */
  finishKey: ContentKey | null;
  /** The planned method, or null (the default) to let the finish decide. */
  methodKey?: ContentKey | null | undefined;
}

/** Zod schema for {@link SimulateArgs} (strict, like the preview's). */
export const SimulateArgsSchema = PreviewArgsSchema.extend({
  winner: z.union([
    z.literal('auto'),
    z.literal('draw'),
    z.strictObject({ side: z.number().int().min(0).max(MAX_SIDE) }),
  ]),
  finishKey: zContentKey.nullable(),
  methodKey: zContentKey.nullable().default(null),
});

/** `match.simulateBatch`: the Simulate arguments plus how many nights to play out. */
export interface SimulateBatchArgs extends SimulateArgs {
  /** 1 to 500. Run `i` plays out with seed `previewSeed + i`, exactly as `match.simulate` would. */
  runs: number;
}

/** Zod schema for {@link SimulateBatchArgs}. */
export const SimulateBatchArgsSchema = SimulateArgsSchema.extend({
  runs: z.number().int().min(1).max(PREVIEW_BATCH_MAX_RUNS),
});

/** How often one side won over a batch. */
export interface SideWinCount {
  /** Stored 0-based side number. */
  side: number;
  /** The side's competitors' names, in the order a simulated winner lists them. */
  names: string[];
  wins: number;
}

/** How often one finish came up over a batch. */
export interface FinishCount {
  key: ContentKey;
  name: string;
  category: FinishCategory;
  count: number;
}

/**
 * `match.simulateBatch`: `match.previewBatch`'s statistics over the simulated nights (rated with
 * their finishes), plus the outcome counts. Every side is listed, in side order, even with no
 * wins; the side wins, draws and no contests add up to `runs`, and so do the finish counts.
 */
export interface SimulateBatchResult extends PreviewBatchResult {
  sides: SideWinCount[];
  draws: number;
  noContests: number;
  /** Most common first; ties by name. Finishes that never came up are left out. */
  finishes: FinishCount[];
  /** True when Auto was asked for and Random winners decides the viewer's results. */
  randomWinnersMode: boolean;
}

/** The finish a simulated match ended with, as the lab shows it. */
export interface SimulatedFinish {
  key: ContentKey;
  name: string;
  category: FinishCategory;
  summary: string;
  /** A title on the line may change hands with this finish. */
  allowsTitleChange: boolean;
}

/** `match.simulate`: the resolved result and the rating with its finish effects. */
export interface SimulateResult {
  /** `match.preview`'s answer, rated with the resolution. */
  preview: PreviewResult;
  outcome: MatchOutcome;
  finish: SimulatedFinish;
  /** Null for a draw or no contest. */
  method: { key: ContentKey; name: string } | null;
  /** Stored 0-based side number of the winner; null when nobody won. */
  winningSide: number | null;
  /** The winning side's competitors' names; empty when nobody won. */
  winnerNames: string[];
  /** The "Match result" decision: who won, the finish and the method. */
  resultTrace: TraceNode;
  /** True when Auto was asked for and Random winners decides the viewer's results. */
  randomWinnersMode: boolean;
  /**
   * What the result would do to every competitor's popularity and momentum (MTCH3-03), worked out
   * from the world as it stands with nothing written.
   */
  aftermath: SegmentAftermath;
}

/** `match.resultMode`: how the viewer's results are decided. */
export interface ResultMode {
  /** True when Random winners decides who wins on the viewer's shows. */
  randomWinners: boolean;
}

/** `match.simulate` refusal codes besides `resolveMatchOutcome`'s, the preview's and `invalidArgs`. */
export const SIMULATE_REASON_CODES = {
  /** The same code `match.finishes` refuses with. */
  noFinishCatalog: 'noFinishCatalog',
} as const;

declare module '../../core/api/maps' {
  interface QueryMap {
    'match.simulate': { args: SimulateArgs; result: SimulateResult };
    'match.simulateBatch': { args: SimulateBatchArgs; result: SimulateBatchResult };
    'match.resultMode': { args: Record<string, never>; result: ResultMode };
  }
}

/** Random winners for the viewer's first promotion; false for a viewer who runs none. */
function viewerRandomWinners(read: GameWorldView, viewer: Viewer): boolean {
  const [promotionId] = viewerPromotionIds(read, viewer);
  return promotionId !== undefined && randomWinnersActive(read, { promotionId, brandId: null });
}

/** The detached streams a simulation resolves on, one per name, made on first use. */
function resolveStreams(seed: string, previewSeed: number): (name: ResolveStreamName) => RngStream {
  const streams = new Map<ResolveStreamName, RngStream>();
  return (name) => {
    let stream = streams.get(name);
    if (stream === undefined) {
      stream = detachedStream(seed, name, String(previewSeed));
      streams.set(name, stream);
    }
    return stream;
  };
}

/** What every night of a simulation shares: the checked rating input and the sides. */
interface PreparedSimulation {
  readonly input: SegmentRatingInput;
  readonly sides: readonly AutoWinnerSide[];
  readonly randomWinnersMode: boolean;
}

/** The checks and inputs a simulation needs before its first roll. Refuses like `match.simulate`. */
function prepareSimulation(ctx: QueryContext, args: SimulateArgs): PreparedSimulation {
  const { read } = ctx;
  if (args.kind !== 'match') {
    return refuseQuery({
      code: INVALID_ARGS,
      message: 'kind: only a match has a result to simulate',
      field: 'kind',
    });
  }
  if (read.meta.catalogs.finishes === undefined) {
    return refuseQuery({
      code: SIMULATE_REASON_CODES.noFinishCatalog,
      message: 'This save was started before finishes existed. Start a new game to use finishes.',
    });
  }
  const input = previewInput(ctx, args);
  const sides = autoWinnerInputsOf(read, {
    promotionId: input.promotionId,
    regionId: args.regionId,
    sides: args.sides.map((personIds, side) => ({ side, personIds })),
  });
  const randomWinnersMode = args.winner === 'auto' && viewerRandomWinners(read, ctx.viewer);
  return { input, sides, randomWinnersMode };
}

/** One simulated night, every roll on the detached streams keyed `key`. */
function simulateNight(
  ctx: QueryContext,
  args: SimulateArgs,
  prepared: PreparedSimulation,
  key: number,
): Omit<SimulateResult, 'aftermath'> {
  const { read } = ctx;
  const { catalogs } = read.meta;
  const { input, sides, randomWinnersMode } = prepared;
  const resolved = resolveMatchOutcome(
    {
      matchTypeKey: args.typeKey,
      stipulationKeys: [],
      sides,
      regionName: read.tables.regions.get(args.regionId)?.name ?? args.regionId,
      plan: {
        winner: args.winner,
        finishKey: args.finishKey,
        methodKey: args.methodKey ?? null,
      },
      mode: randomWinnersMode ? 'randomWinners' : 'standard',
    },
    {
      catalogs,
      tunables: ctx.tunables,
      rng: resolveStreams(read.meta.seed, key),
    },
  );
  if (!resolved.ok) {
    return refuseQuery(resolved.reasons);
  }
  const resolution = resolved.resolution.value;
  const rated = rateWithKey(ctx, { ...input, resolution }, key);
  const finishDef = catalogs.finishes?.[resolution.finishKey];
  const methodDef =
    resolution.methodKey === null ? undefined : catalogs.methods?.[resolution.methodKey];
  const winningSide = resolution.outcome.kind === 'win' ? resolution.outcome.winningSide : null;
  return {
    preview: { ...rated, previewSeed: key },
    outcome: resolution.outcome,
    finish: {
      key: resolution.finishKey,
      name: finishDef?.name ?? resolution.finishKey,
      category: finishDef?.category ?? 'clean',
      summary: finishDef?.summary ?? '',
      allowsTitleChange: finishDef?.allowsTitleChange ?? true,
    },
    method:
      resolution.methodKey === null
        ? null
        : { key: resolution.methodKey, name: methodDef?.name ?? resolution.methodKey },
    winningSide,
    winnerNames: winningSide === null ? [] : namesOfSide(sides, winningSide),
    resultTrace: resolved.resolution.trace,
    randomWinnersMode,
  };
}

/** The competitors' names of one side, as a simulated winner lists them. */
function namesOfSide(sides: readonly AutoWinnerSide[], side: number): string[] {
  return (
    sides.find((entry) => entry.side === side)?.competitors.map((competitor) => competitor.name) ??
    []
  );
}

/**
 * `match.simulate`. Same viewer scoping as `match.preview`; the auto-winner reads popularity in the
 * show's region and the push, momentum and alignment of the show's promotion's contracts, all of
 * which booking shows every viewer. In a Random winners game an Auto winner uses the larger Random
 * winners unpredictability; a booked side or Draw is still honoured, because the lab only predicts.
 */
export const simulateQuery: QueryDefinition<'match.simulate'> = defineQuery('match.simulate', {
  args: SimulateArgsSchema,
  run: (ctx, args) => {
    const prepared = prepareSimulation(ctx, args);
    const night = simulateNight(ctx, args, prepared, args.previewSeed);
    return { ...night, aftermath: simulatedAftermath(ctx, args, prepared, night) };
  },
});

/**
 * The simulated night's aftermath (MTCH3-03): the same computation show night applies, on a match
 * that is on no show. Reads only and rolls nothing; the batch leaves it out.
 */
function simulatedAftermath(
  ctx: QueryContext,
  args: SimulateArgs,
  prepared: PreparedSimulation,
  night: Omit<SimulateResult, 'aftermath'>,
): SegmentAftermath {
  return computeSegmentAftermath(
    ctx.read,
    {
      promotionId: prepared.input.promotionId,
      date: ctx.date,
      regionId: args.regionId,
      televised: args.televised,
      importance: args.importance,
      preShow: args.slotRole === 'preShow',
      sides: args.sides,
      outcome: night.outcome,
      finishKey: night.finish.key,
      score: night.preview.score.value,
    },
    ctx.tunables,
    geographyOf(ctx.read),
  );
}

/**
 * `match.simulateBatch`. Run `i` is `match.simulate` with seed `previewSeed + i`, so run 0 is the
 * single Simulate with the same seed. Same viewer scoping as `match.simulate`; no traces, no worker
 * lines. A plan one night refuses (a Draw with no draw finish) refuses the whole batch.
 */
export const simulateBatchQuery: QueryDefinition<'match.simulateBatch'> = defineQuery(
  'match.simulateBatch',
  {
    args: SimulateBatchArgsSchema,
    run: (ctx, args) => {
      const prepared = prepareSimulation(ctx, args);
      const tally = ratingTally();
      const wins = new Map<number, number>();
      const finishes = new Map<ContentKey, FinishCount>();
      let draws = 0;
      let noContests = 0;
      for (let run = 0; run < args.runs; run += 1) {
        const night = simulateNight(ctx, args, prepared, args.previewSeed + run);
        tally.add(night.preview);
        if (night.outcome.kind === 'draw') {
          draws += 1;
        } else if (night.outcome.kind === 'noContest') {
          noContests += 1;
        } else {
          const side = night.outcome.winningSide;
          wins.set(side, (wins.get(side) ?? 0) + 1);
        }
        const seen = finishes.get(night.finish.key);
        if (seen === undefined) {
          finishes.set(night.finish.key, {
            key: night.finish.key,
            name: night.finish.name,
            category: night.finish.category,
            count: 1,
          });
        } else {
          seen.count += 1;
        }
      }
      return {
        ...tally.summary(),
        sides: prepared.sides.map((side) => ({
          side: side.side,
          names: namesOfSide(prepared.sides, side.side),
          wins: wins.get(side.side) ?? 0,
        })),
        draws,
        noContests,
        finishes: [...finishes.values()].sort(
          (left, right) =>
            right.count - left.count ||
            (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
        ),
        randomWinnersMode: prepared.randomWinnersMode,
      };
    },
  },
);

/** `match.resultMode`: Random winners for the viewer's first promotion. */
export const resultModeQuery: QueryDefinition<'match.resultMode'> = defineQuery(
  'match.resultMode',
  {
    args: z.strictObject({}),
    run: (ctx) => ({ randomWinners: viewerRandomWinners(ctx.read, ctx.viewer) }),
  },
);

export const simulateQueries: readonly QueryDefinition[] = [
  simulateQuery,
  simulateBatchQuery,
  resultModeQuery,
];
