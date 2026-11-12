/**
 * A resolved match: who won (or that nobody did), the finish it ended with and the method that
 * ended it (MTCH2-02). One shape for the rater (finish effects read it as
 * `ctx.input.resolution`), `match.simulate` and EVT3, which stores it on the segment as `outcome`
 * plus `match.finishKey`.
 *
 * `methodKey` repeats the win's `outcome.methodKey` so a reader that only wants the method does not
 * have to narrow the outcome first; it is null for a draw or no contest, and the schema checks the
 * two agree.
 *
 * Design: docs/design/match-finishes.md#finish-effects.
 */

import { z } from 'zod';
import type { ContentKey } from '../../../core/content-key';
import { MatchOutcomeSchema, type MatchOutcome } from '../../../model/entities/segment';
import { zContentKey } from '../../../model/primitives';

/** How a match was resolved. */
export interface MatchResolution {
  readonly outcome: MatchOutcome;
  readonly finishKey: ContentKey;
  /** The win's method; null when nobody won. */
  readonly methodKey: ContentKey | null;
}

export const MatchResolutionSchema = z
  .strictObject({
    outcome: MatchOutcomeSchema,
    finishKey: zContentKey,
    methodKey: zContentKey.nullable(),
  })
  .superRefine((resolution, context) => {
    const { outcome, methodKey } = resolution;
    if (outcome.kind === 'win' && methodKey !== outcome.methodKey) {
      context.addIssue({
        code: 'custom',
        message: `a win's methodKey must be the outcome's method (${outcome.methodKey})`,
        path: ['methodKey'],
      });
    }
    if (outcome.kind !== 'win' && methodKey !== null) {
      context.addIssue({
        code: 'custom',
        message: `a ${outcome.kind} has no method`,
        path: ['methodKey'],
      });
    }
  });
