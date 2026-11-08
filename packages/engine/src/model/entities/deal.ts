/**
 * Deals: a promotion's agreement with a network to air its shows.
 *
 * A deal covers one event definition (a named weekly show) or, with `eventDefinitionId: null`,
 * every televised show the promotion runs. The terms are stored as plain numbers here; what they
 * are worth and how viewers turn into money belongs to the economy systems.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zNonNegativeCents, zWeekday } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { networksTable } from './network';
import { readSiblingString } from './sibling-tables';

export const DEAL_STATUSES = ['offered', 'active', 'expired', 'cancelled', 'declined'] as const;
export const DealStatusSchema = z.enum(DEAL_STATUSES);
export type DealStatus = z.infer<typeof DealStatusSchema>;

export const DEAL_TIMESLOTS = ['daytime', 'evening', 'primeTime', 'lateNight'] as const;
export const DealTimeslotSchema = z.enum(DEAL_TIMESLOTS);
export type DealTimeslot = z.infer<typeof DealTimeslotSchema>;

export const DealTermsSchema = z.strictObject({
  /** Paid by the network for each show aired. */
  feePerShow: zNonNegativeCents,
  /** Paid by the network per thousand viewers of each show. */
  perThousandViewers: zNonNegativeCents,
  /** Charged to the promotion for each show aired (airtime, production requirements). */
  costPerShow: zNonNegativeCents,
});

export type DealTerms = z.infer<typeof DealTermsSchema>;

export const DealSchema = z
  .strictObject({
    id: zId('deal'),
    networkId: zId('network'),
    promotionId: zId('promotion'),
    /** The show this deal airs, or null for every televised show of the promotion. */
    eventDefinitionId: zId('eventDefinition').nullable(),
    status: DealStatusSchema,
    offeredOn: zGameDate,
    startsOn: zGameDate,
    /** The first day the deal no longer runs. After `startsOn`. */
    endsOn: zGameDate,
    timeslot: DealTimeslotSchema,
    /** The day of the week the show airs, or null when it is not tied to one. */
    weekday: zWeekday.nullable(),
    /** Aired live rather than taped. */
    live: z.boolean(),
    terms: DealTermsSchema,
  })
  .superRefine((deal, context) => {
    if (compareDates(deal.endsOn, deal.startsOn) <= 0) {
      context.addIssue({
        code: 'custom',
        message: 'endsOn must be after startsOn',
        path: ['endsOn'],
      });
    }
  });

export type Deal = z.infer<typeof DealSchema>;

function dealIssues(view: WorldView): IntegrityIssue[] {
  const networks = tableOf(view, networksTable);
  const issues: IntegrityIssue[] = [];
  for (const deal of tableOf(view, dealsTable).values()) {
    if (deal.eventDefinitionId !== null) {
      const owner = readSiblingString(
        view,
        'eventDefinition',
        deal.eventDefinitionId,
        'promotionId',
      );
      if (owner !== null && owner !== deal.promotionId) {
        issues.push({
          code: 'deal.eventDefinitionNotOwned',
          table: 'deals',
          id: deal.id,
          path: 'eventDefinitionId',
          message: `Deal ${deal.id} is for ${deal.promotionId}, but event definition ${deal.eventDefinitionId} belongs to ${owner}`,
        });
      }
    }
    const network = networks.get(deal.networkId);
    if (deal.status === 'active' && network !== undefined && network.status !== 'active') {
      issues.push({
        code: 'deal.networkNotActive',
        table: 'deals',
        id: deal.id,
        path: 'networkId',
        message: `Deal ${deal.id} is active, but network ${deal.networkId} is ${network.status}`,
      });
    }
  }
  return issues;
}

export const dealsTable = defineTable({
  kind: 'deal',
  name: 'deals',
  schema: DealSchema,
  refs: [
    { path: 'networkId', target: 'network', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'eventDefinitionId', target: 'eventDefinition', nullable: true },
  ],
  indexes: [
    { name: 'byPromotion', key: (deal) => deal.promotionId },
    { name: 'byNetwork', key: (deal) => deal.networkId },
  ],
  invariants: [
    {
      name: 'eventDefinitionAndNetworkMatch',
      check(view): IntegrityIssue[] {
        return dealIssues(view);
      },
    },
  ],
});
