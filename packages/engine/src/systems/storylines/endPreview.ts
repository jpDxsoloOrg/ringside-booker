/**
 * `storylines.endPreview` (CRTV3-03): before the player confirms ending one of their storylines,
 * what ending it now would pay, in plain words. Own storylines only.
 *
 * Design: docs/design/storylines.md#commands.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { refuseQuery } from '../../core/api/result';
import type { StorylineId } from '../../core/ids';
import { zId } from '../../model/primitives';
import { endOutcome, endOutcomeMessage, type StorylineEndPayoff } from './lifecycle';
import { editsStorylinesOf } from './rows';
import { STORYLINE_COMMAND_REASONS } from './validation';

/** `storylines.endPreview`: what ending the storyline now would pay, and why. */
export interface StorylineEndPreview {
  linkedSegments: number;
  minSegments: number;
  payoff: StorylineEndPayoff;
  /** "Ending now pays nothing: needs 4 linked segments, has 0." or "Ending now pays off: …" */
  message: string;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'storylines.endPreview': {
      args: { storylineId: StorylineId };
      result: StorylineEndPreview;
    };
  }
}

export const storylinesEndPreviewQuery: QueryDefinition<'storylines.endPreview'> = defineQuery(
  'storylines.endPreview',
  {
    args: z.strictObject({ storylineId: zId('storyline') }),
    run: (ctx, args) => {
      const subject = { kind: 'storyline', id: args.storylineId } as const;
      const storyline = ctx.read.tables.storylines.get(args.storylineId);
      if (storyline === undefined) {
        return refuseQuery({
          code: STORYLINE_COMMAND_REASONS.notFound,
          message: "That storyline doesn't exist.",
          field: 'storylineId',
          subject,
        });
      }
      if (!editsStorylinesOf(ctx.read, ctx.viewer, storyline.promotionId)) {
        const promotion = ctx.read.tables.promotions.get(storyline.promotionId);
        return refuseQuery({
          code: STORYLINE_COMMAND_REASONS.notYours,
          message: `That storyline belongs to ${promotion?.name ?? 'another promotion'}.`,
          subject,
        });
      }
      if (storyline.status === 'ended') {
        return refuseQuery({
          code: STORYLINE_COMMAND_REASONS.ended,
          message: `${storyline.name} has ended; ended storylines can't be changed.`,
          subject,
        });
      }
      const outcome = endOutcome(
        storyline.progressTotals.segments,
        ctx.tunables.get('storylines.payoff.minSegments'),
      );
      return { ...outcome, message: endOutcomeMessage(outcome) };
    },
  },
);
