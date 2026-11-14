/**
 * `broadcast.proposeDeal` (ECO8-05): the promotion offers a network a show (or every show) in a
 * slot, live or taped, for a number of months. The network signs exactly the terms
 * `broadcast.valuation` previews, or refuses with every reason it has.
 *
 * Design: docs/design/broadcast.md#commands.
 */

import { z } from 'zod';
import { defineCommand, type CommandDefinition } from '../../../core/api/command';
import { InvariantError } from '../../../core/errors';
import type { DealId, EventDefinitionId, NetworkId, PromotionId } from '../../../core/ids';
import { cents } from '../../../core/money';
import { DealTimeslotSchema, type DealTimeslot } from '../../../model/entities/deal';
import { zId } from '../../../model/primitives';
import { dealHealthTraceRef } from '../traces';
import { dealValuation, type DealValuationRequest } from '../valuation';
import { promotionReasons, refusalReasons, showReasons } from './shared';

export interface ProposeDealArgs {
  promotionId: PromotionId;
  networkId: NetworkId;
  /** The show, or null for every televised show (every major show on pay-per-view). */
  eventDefinitionId: EventDefinitionId | null;
  timeslot: DealTimeslot;
  live: boolean;
  months: number;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'broadcast.proposeDeal': { args: ProposeDealArgs; result: { dealId: DealId } };
  }
}

function requestOf(args: ProposeDealArgs): DealValuationRequest {
  return {
    promotionId: args.promotionId,
    networkId: args.networkId,
    eventDefinitionId: args.eventDefinitionId,
    timeslot: args.timeslot,
    live: args.live,
    months: args.months,
  };
}

export const proposeDealCommand: CommandDefinition<'broadcast.proposeDeal'> = defineCommand(
  'broadcast.proposeDeal',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      networkId: zId('network'),
      eventDefinitionId: zId('eventDefinition').nullable(),
      timeslot: DealTimeslotSchema,
      live: z.boolean(),
      // Any whole number of months: the network says when it is outside the lengths it signs.
      months: z.number().int().min(1).max(1200),
    }),
    validate: (read, args, issuedBy, env) => {
      const reasons = promotionReasons(read, args.promotionId, issuedBy);
      if (reasons.length > 0) {
        return reasons;
      }
      const showProblems = showReasons(
        read,
        args.promotionId,
        args.networkId,
        args.eventDefinitionId,
      );
      if (showProblems.length > 0) {
        return showProblems;
      }
      return refusalReasons(dealValuation(read, env.tunables, requestOf(args)), args.networkId);
    },
    apply: (ctx, args) => {
      // The same valuation `validate` and the preview ran, on the same world: the same terms.
      const valuation = dealValuation(ctx.read, ctx.tunables, requestOf(args));
      if (valuation.verdict !== 'accept') {
        throw new InvariantError(
          `broadcast.proposeDeal: the network refused in apply after accepting in validate (${valuation.refusals.map((refusal) => refusal.code).join(', ')})`,
        );
      }
      const deal = ctx.tx.create('deals', {
        networkId: args.networkId,
        promotionId: args.promotionId,
        eventDefinitionId: args.eventDefinitionId,
        status: 'active',
        offeredOn: ctx.date,
        startsOn: valuation.startsOn,
        endsOn: valuation.endsOn,
        timeslot: args.timeslot,
        weekday: valuation.weekday,
        live: args.live,
        terms: {
          feePerShow: cents(valuation.terms.feePerShow.value),
          perThousandViewers: cents(valuation.terms.perThousandViewers.value),
          costPerShow: cents(valuation.terms.costPerShow.value),
        },
        endedOn: null,
        endedReason: null,
        renegotiatedOn: null,
        warnedOn: null,
      });
      if (valuation.becomesTelevised && args.eventDefinitionId !== null) {
        ctx.tx.update('eventDefinitions', args.eventDefinitionId, { televised: true });
      }
      // The deal's opening note: why the network signed. Deal health replaces it after an airing.
      ctx.recordTrace(dealHealthTraceRef(deal.id), ctx.date, {
        value: valuation.verdict,
        trace: valuation.verdictTrace,
      });
      ctx.publish('broadcast.dealSigned', {
        dealId: deal.id,
        promotionId: args.promotionId,
        networkId: args.networkId,
      });
      return { dealId: deal.id };
    },
  },
);
