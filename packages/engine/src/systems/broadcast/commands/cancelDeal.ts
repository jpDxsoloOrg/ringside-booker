/**
 * `broadcast.cancelDeal` (ECO8-05): the promotion walks away from one of its running deals early
 * and pays the network an exit fee (`exitFee`), posted as an Other cost. The deal ends
 * `cancelled`/`byPromotion` at once. `broadcast.cancelPreview` (queries/deals.ts) shows the same
 * fee and Why? before the player confirms.
 *
 * Design: docs/design/broadcast.md#commands.
 */

import { z } from 'zod';
import { defineCommand, type CommandDefinition } from '../../../core/api/command';
import type { DealId } from '../../../core/ids';
import { negate, cents } from '../../../core/money';
import { startCalc, type Traced } from '../../../core/trace';
import type { Deal } from '../../../model/entities/deal';
import { zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import { postMoney } from '../../finance/post';
import type { EngineTunables } from '../../tunables';
import { projectedAudience } from '../audienceInputs';
import { EXIT_FEE_DOC_REF, exitFee } from '../formulas/exitFee';
import { airingsNewestFirst, endDeal } from '../health';
import { promotionWideImportance } from '../valuation';
import { ownActiveDeal } from './shared';

declare module '../../../core/api/maps' {
  interface CommandMap {
    'broadcast.cancelDeal': { args: { dealId: DealId }; result: { exitFee: number } };
  }
}

/** The ledger memo for an exit fee. */
export function exitFeeMemo(networkName: string): string {
  return `Early exit: ${networkName}`.slice(0, 120);
}

/** What walking away from the deal today costs, in whole cents, with its Why?. */
export function exitFeeFor(
  read: GameWorldView,
  tunables: EngineTunables,
  deal: Deal,
): Traced<number> {
  const network = read.tables.networks.require(deal.networkId);
  const last = airingsNewestFirst(read, deal.id).find((airing) => airing.status === 'aired');
  let viewers = last?.viewers ?? 0;
  if (last === undefined) {
    const definition =
      deal.eventDefinitionId === null
        ? undefined
        : read.tables.eventDefinitions.get(deal.eventDefinitionId);
    const importance =
      definition?.importance ?? promotionWideImportance(read, deal.promotionId, network);
    viewers =
      importance === 'house'
        ? 0
        : projectedAudience(read, tunables, {
            promotionId: deal.promotionId,
            networkId: network.id,
            timeslot: deal.timeslot,
            live: deal.live,
            importance,
          }).value;
  }
  return exitFee(
    {
      networkName: network.name,
      kind: network.kind,
      feePerShow: deal.terms.feePerShow,
      perThousandViewers: deal.terms.perThousandViewers,
      viewers,
      viewersFrom: last === undefined ? 'projected' : 'lastAiring',
    },
    { tunables },
  );
}

export const cancelDealCommand: CommandDefinition<'broadcast.cancelDeal'> = defineCommand(
  'broadcast.cancelDeal',
  {
    args: z.strictObject({ dealId: zId('deal') }),
    validate: (read, args, issuedBy) => ownActiveDeal(read, args.dealId, issuedBy).reasons,
    apply: (ctx, args) => {
      const deal = ctx.read.tables.deals.require(args.dealId);
      const network = ctx.read.tables.networks.require(deal.networkId);
      const fee = exitFeeFor(ctx.read, ctx.tunables, deal);
      if (fee.value > 0) {
        postMoney(ctx, {
          promotionId: deal.promotionId,
          category: 'otherCost',
          amount: negate(cents(fee.value)),
          memo: exitFeeMemo(network.name),
          refs: { dealId: deal.id },
          trace: startCalc(exitFeeMemo(network.name), fee, {
            unit: 'money',
            docRef: EXIT_FEE_DOC_REF,
          })
            .multiply('Cost', -1, 'Money paid out comes off the cash')
            .done(),
        });
      }
      endDeal(ctx, deal, 'cancelled', 'byPromotion');
      return { exitFee: fee.value };
    },
  },
);
