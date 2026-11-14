/**
 * `broadcast.renegotiate` (ECO8-05): extends one of the promotion's running deals at what the
 * network would pay today, for the same show, timeslot and live. The new end date counts from the
 * old one (or from today when that has passed). Terms can go down as well as up; the preview shows
 * both. Rivals' deals renew through the same valuation (`health.ts`).
 *
 * Design: docs/design/broadcast.md#commands.
 */

import { z } from 'zod';
import { defineCommand, type CommandDefinition } from '../../../core/api/command';
import { InvariantError } from '../../../core/errors';
import type { DealId } from '../../../core/ids';
import type { GameDate } from '../../../core/date';
import { zId } from '../../../model/primitives';
import { applyRenegotiation, revalueDeal } from '../health';
import { ownActiveDeal, refusalReasons } from './shared';

export interface RenegotiateArgs {
  dealId: DealId;
  months: number;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'broadcast.renegotiate': { args: RenegotiateArgs; result: { endsOn: GameDate } };
  }
}

export const renegotiateCommand: CommandDefinition<'broadcast.renegotiate'> = defineCommand(
  'broadcast.renegotiate',
  {
    args: z.strictObject({
      dealId: zId('deal'),
      months: z.number().int().min(1).max(1200),
    }),
    validate: (read, args, issuedBy, env) => {
      const { deal, reasons } = ownActiveDeal(read, args.dealId, issuedBy);
      if (deal === null) {
        return reasons;
      }
      return refusalReasons(revalueDeal(read, env.tunables, deal, args.months), deal.networkId);
    },
    apply: (ctx, args) => {
      const deal = ctx.read.tables.deals.require(args.dealId);
      const valuation = revalueDeal(ctx.read, ctx.tunables, deal, args.months);
      if (valuation.verdict !== 'accept') {
        throw new InvariantError(
          'broadcast.renegotiate: the network refused in apply after accepting in validate',
        );
      }
      return { endsOn: applyRenegotiation(ctx, deal, valuation, args.months) };
    },
  },
);
