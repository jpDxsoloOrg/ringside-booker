/**
 * The Match lab's Simulate (MTCH2-04): resolve a match plan and rate the match with its finish,
 * without anything happening.
 *
 * - `match.simulate`: the preview arguments plus a plan (winner, finish, method). The plan goes
 *   through `resolveMatchOutcome` (MTCH2-03), then the match is rated exactly as `match.preview`
 *   rates it but with the resolution on the input, so the finish effects (MTCH2-02) show in the
 *   work rate and crowd traces.
 * - `match.resultMode`: whether Random winners decides the viewer's results, for the lab's and the
 *   booking editor's Auto option. The web never reads world settings itself.
 *
 * Like every preview, a simulation never writes, never stores a trace and never draws from the
 * world's RNG: the winner and finish rolls come from detached `match.auto-winner` and `match.finish`
 * streams keyed by the preview seed, the rating rolls from the detached `match.preview` stream. The
 * same arguments always give the same night; Re-roll seed gives a new one.
 *
 * Design: docs/design/match-finishes.md#simulate.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
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
import { PreviewArgsSchema, type PreviewArgs } from './previewArgs';
import { previewInput, rateWithKey, type PreviewResult } from './previewQueries';

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

/**
 * `match.simulate`. Same viewer scoping as `match.preview`; the auto-winner reads popularity in the
 * show's region and the push, momentum and alignment of the show's promotion's contracts, all of
 * which booking shows every viewer. In a Random winners game an Auto winner uses the larger Random
 * winners unpredictability; a booked side or Draw is still honoured, because the lab only predicts.
 */
export const simulateQuery: QueryDefinition<'match.simulate'> = defineQuery('match.simulate', {
  args: SimulateArgsSchema,
  run: (ctx, args) => {
    const { read } = ctx;
    if (args.kind !== 'match') {
      return refuseQuery({
        code: INVALID_ARGS,
        message: 'kind: only a match has a result to simulate',
        field: 'kind',
      });
    }
    const { catalogs } = read.meta;
    if (catalogs.finishes === undefined) {
      return refuseQuery({
        code: SIMULATE_REASON_CODES.noFinishCatalog,
        message: 'This save was started before finishes existed. Start a new game to use finishes.',
      });
    }
    const input = previewInput(ctx, args);
    const promotionId = input.promotionId;
    const randomWinnersMode = args.winner === 'auto' && viewerRandomWinners(read, ctx.viewer);
    const sides = autoWinnerInputsOf(read, {
      promotionId,
      regionId: args.regionId,
      sides: args.sides.map((personIds, side) => ({ side, personIds })),
    });
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
        rng: resolveStreams(read.meta.seed, args.previewSeed),
      },
    );
    if (!resolved.ok) {
      return refuseQuery(resolved.reasons);
    }
    const resolution = resolved.resolution.value;
    const rated = rateWithKey(ctx, { ...input, resolution }, args.previewSeed);
    const finishDef = catalogs.finishes[resolution.finishKey];
    const methodDef =
      resolution.methodKey === null ? undefined : catalogs.methods?.[resolution.methodKey];
    const winningSide = resolution.outcome.kind === 'win' ? resolution.outcome.winningSide : null;
    const winnerNames =
      winningSide === null
        ? []
        : (sides
            .find((side) => side.side === winningSide)
            ?.competitors.map((competitor) => competitor.name) ?? []);
    return {
      preview: { ...rated, previewSeed: args.previewSeed },
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
      winnerNames,
      resultTrace: resolved.resolution.trace,
      randomWinnersMode,
    };
  },
});

/** `match.resultMode`: Random winners for the viewer's first promotion. */
export const resultModeQuery: QueryDefinition<'match.resultMode'> = defineQuery(
  'match.resultMode',
  {
    args: z.strictObject({}),
    run: (ctx) => ({ randomWinners: viewerRandomWinners(ctx.read, ctx.viewer) }),
  },
);

export const simulateQueries: readonly QueryDefinition[] = [simulateQuery, resultModeQuery];
