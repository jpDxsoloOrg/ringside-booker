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

/** The statuses of a deal that has ended: `endedOn` and `endedReason` are set exactly for these. */
export const ENDED_DEAL_STATUSES: readonly DealStatus[] = ['expired', 'cancelled'];

/**
 * Why a deal ended (ECO8-01): it ran to its end date, the network dropped it for low viewers or
 * too many missed airings, the promotion walked away, or the network closed.
 */
export const DEAL_END_REASONS = [
  'expired',
  'lowViewers',
  'missedAirings',
  'byPromotion',
  'networkClosed',
] as const;
export const DealEndReasonSchema = z.enum(DEAL_END_REASONS);
export type DealEndReason = z.infer<typeof DealEndReasonSchema>;

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
    // ECO8-01's lifecycle fields default to null for saves made before them.
    /** The day the deal ended, set exactly when `status` is `expired` or `cancelled`. */
    endedOn: zGameDate.nullable().default(null),
    /** Why the deal ended, set exactly when `endedOn` is. */
    endedReason: DealEndReasonSchema.nullable().default(null),
    /** The last day the deal's terms were renegotiated, or null. */
    renegotiatedOn: zGameDate.nullable().default(null),
    /** The last day the promotion was warned the deal is at risk, so warnings are not repeated. */
    warnedOn: zGameDate.nullable().default(null),
  })
  .superRefine((deal, context) => {
    const ended = ENDED_DEAL_STATUSES.includes(deal.status);
    if (ended !== (deal.endedOn !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'endedOn is set exactly when the deal is expired or cancelled',
        path: ['endedOn'],
      });
    }
    if (ended !== (deal.endedReason !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'endedReason is set exactly when the deal is expired or cancelled',
        path: ['endedReason'],
      });
    }
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
