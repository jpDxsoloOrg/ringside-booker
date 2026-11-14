/**
 * Airings (ECO8-01): one row per show a broadcast deal aired, or was due to air and missed.
 *
 * It is the viewers history every later reader shares (show popularity, the dashboard, the
 * network's renewal talks): how many watched, how many the network expected, what it paid and
 * what the airtime cost. `showName` is copied in so the history survives a renamed show.
 *
 * A missed airing (the show was cancelled or never ran) has nothing to report: no viewers, no
 * money and no quality, only the reason.
 *
 * Design: docs/design/broadcast.md#airings-table and docs/design/data-model.md, "Airings".
 */

import { z } from 'zod';
import { TraceRefSchema } from '../../core/trace/store';
import { zGameDate, zId, zNonNegativeCents, zNonNegativeInt, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { zName } from './entity-refinements';

export const AIRING_STATUSES = ['aired', 'missed'] as const;
export const AiringStatusSchema = z.enum(AIRING_STATUSES);
export type AiringStatus = z.infer<typeof AiringStatusSchema>;

/** Where an airing's quality score came from: the show's own rating, or a neutral stand-in. */
export const AIRING_QUALITY_SOURCES = ['show', 'neutral'] as const;
export const AiringQualitySourceSchema = z.enum(AIRING_QUALITY_SOURCES);
export type AiringQualitySource = z.infer<typeof AiringQualitySourceSchema>;

/** Why a due airing was missed: the show was cancelled, or its day passed without it running. */
export const AIRING_MISS_REASONS = ['showCancelled', 'notRun'] as const;
export const AiringMissReasonSchema = z.enum(AIRING_MISS_REASONS);
export type AiringMissReason = z.infer<typeof AiringMissReasonSchema>;

/** The longest show name an airing keeps. */
export const AIRING_SHOW_NAME_MAX = 80;

export const AiringQualitySchema = z.strictObject({
  score: zStat,
  source: AiringQualitySourceSchema,
});

export type AiringQuality = z.infer<typeof AiringQualitySchema>;

export const AiringSchema = z
  .strictObject({
    id: zId('airing'),
    dealId: zId('deal'),
    networkId: zId('network'),
    promotionId: zId('promotion'),
    /** The dated show that aired, or null when it aired from a definition date (no calendar). */
    eventInstanceId: zId('eventInstance').nullable(),
    /** The show's definition, or null for a one-off show. */
    eventDefinitionId: zId('eventDefinition').nullable(),
    /** The show's name when it aired. */
    showName: zName(AIRING_SHOW_NAME_MAX),
    airDate: zGameDate,
    status: AiringStatusSchema,
    /** Set exactly when the airing was missed. */
    missReason: AiringMissReasonSchema.nullable(),
    /** How good the show was, as the audience formula read it; null when missed. */
    quality: AiringQualitySchema.nullable(),
    viewers: zNonNegativeInt,
    expectedViewers: zNonNegativeInt,
    /** Gross paid by the network for this airing. */
    income: zNonNegativeCents,
    /** The part of `income` paid on to others (revenue shares). */
    sharesPaid: zNonNegativeCents,
    /** Airtime charged to the promotion. */
    cost: zNonNegativeCents,
    /** Where the airing's Why? trace is stored, or null when none was recorded. */
    traceRef: TraceRefSchema.nullable(),
  })
  .superRefine((airing, context) => {
    const missed = airing.status === 'missed';
    if (missed !== (airing.missReason !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'missReason is set exactly when the airing was missed',
        path: ['missReason'],
      });
    }
    if (!missed) {
      return;
    }
    for (const field of ['viewers', 'income', 'sharesPaid', 'cost'] as const) {
      if (airing[field] !== 0) {
        context.addIssue({
          code: 'custom',
          message: `A missed airing has ${field} 0`,
          path: [field],
        });
      }
    }
    if (airing.quality !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A missed airing has no quality',
        path: ['quality'],
      });
    }
  });

export type Airing = z.infer<typeof AiringSchema>;

export const airingsTable = defineTable({
  kind: 'airing',
  name: 'airings',
  schema: AiringSchema,
  refs: [
    { path: 'dealId', target: 'deal', nullable: false },
    { path: 'networkId', target: 'network', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'eventInstanceId', target: 'eventInstance', nullable: true },
    { path: 'eventDefinitionId', target: 'eventDefinition', nullable: true },
  ],
  indexes: [
    { name: 'byDeal', key: (airing) => airing.dealId },
    { name: 'byPromotion', key: (airing) => airing.promotionId },
    { name: 'byEventInstance', key: (airing) => airing.eventInstanceId },
    { name: 'byAirDate', key: (airing) => airing.airDate },
  ],
});
