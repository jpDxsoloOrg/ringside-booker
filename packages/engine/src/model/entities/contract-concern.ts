/**
 * Contract concerns (ECO4-01): the per-contract state the contract features keep beside an
 * employment, one row per employment at most.
 *
 * - `expiryNotice`: the "expiring soon" notice for one of the player's contracts (ECO4-02).
 * - `unhappy`: the unhappy clock that leads to a release request or a walk-out (ECO4-03).
 * - `request`: an open or refused release request (ECO4-03).
 * - `ending`: how the contract ended, written by `endEmployment`, so the Ended tab can tell a
 *   walk-out from a granted release without reading the event log.
 *
 * A row whose parts are all null says nothing, so it is deleted rather than stored; the schema
 * refuses one. Rival contracts' rows are private: queries for the player never expose them.
 *
 * Design: docs/design/data-model.md, "Contract concerns", and docs/design/contracts.md#concerns.
 */

import { z } from 'zod';
import { TraceRefSchema } from '../../core/trace/store';
import { zGameDate, zId, zNonNegativeCents, zNonNegativeInt } from '../primitives';
import { defineTable } from '../table-def';

/** How a contract ended, as the Ended tab tells it. */
export const CONTRACT_ENDINGS = [
  'expired',
  'released',
  'withdrawn',
  'granted',
  'walkedOut',
  'exclusiveDeal',
] as const;
export const ContractEndingHowSchema = z.enum(CONTRACT_ENDINGS);
export type ContractEndingHow = z.infer<typeof ContractEndingHowSchema>;

/** Where a release request stands. */
export const RELEASE_REQUEST_STATUSES = ['open', 'refused'] as const;
export const ReleaseRequestStatusSchema = z.enum(RELEASE_REQUEST_STATUSES);
export type ReleaseRequestStatus = z.infer<typeof ReleaseRequestStatusSchema>;

export const ExpiryNoticeSchema = z.strictObject({
  raisedOn: zGameDate,
  /** The day the player saw the notice; null while it is unseen. */
  seenOn: zGameDate.nullable(),
});

export const UnhappyClockSchema = z.strictObject({
  since: zGameDate,
  days: zNonNegativeInt,
});

export const ReleaseRequestSchema = z.strictObject({
  raisedOn: zGameDate,
  answerBy: zGameDate,
  status: ReleaseRequestStatusSchema,
  answeredOn: zGameDate.nullable(),
  mailId: zId('mail').nullable(),
  /** True when the open request stops a long skip until it is answered. */
  stopsSkip: z.boolean(),
});

export const ContractEndingSchema = z.strictObject({
  how: ContractEndingHowSchema,
  /** Severance paid when the contract ended, in cents; 0 when none was due. */
  severance: zNonNegativeCents,
  /** Where the severance trace is stored, or null when nothing was paid. */
  traceRef: TraceRefSchema.nullable(),
});

export const ContractConcernSchema = z
  .strictObject({
    id: zId('contractConcern'),
    employmentId: zId('employment'),
    personId: zId('person'),
    promotionId: zId('promotion'),
    expiryNotice: ExpiryNoticeSchema.nullable(),
    unhappy: UnhappyClockSchema.nullable(),
    request: ReleaseRequestSchema.nullable(),
    ending: ContractEndingSchema.nullable(),
  })
  .refine((row) => !isEmptyConcern(row), {
    message: 'A contract concern with every part null is deleted, never stored',
    path: ['ending'],
  });

export type ContractConcern = z.infer<typeof ContractConcernSchema>;
export type ExpiryNotice = z.infer<typeof ExpiryNoticeSchema>;
export type UnhappyClock = z.infer<typeof UnhappyClockSchema>;
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;
export type ContractEnding = z.infer<typeof ContractEndingSchema>;

/** True when every part of a concern is null, so the row should not exist. */
export function isEmptyConcern(row: {
  readonly expiryNotice: unknown;
  readonly unhappy: unknown;
  readonly request: unknown;
  readonly ending: unknown;
}): boolean {
  return (
    row.expiryNotice === null && row.unhappy === null && row.request === null && row.ending === null
  );
}

/** The `unseenExpiry` index key for rows with an expiry notice the player has not seen. */
export const UNSEEN_EXPIRY_KEY = 'unseen';
/** The `openRequest` index key for open release requests that stop a long skip. */
export const OPEN_REQUEST_KEY = 'open';

export const contractConcernsTable = defineTable({
  kind: 'contractConcern',
  name: 'contractConcerns',
  schema: ContractConcernSchema,
  refs: [
    { path: 'employmentId', target: 'employment', nullable: false },
    { path: 'personId', target: 'person', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'request.mailId', target: 'mail', nullable: true },
  ],
  indexes: [
    { name: 'byEmployment', key: (row) => row.employmentId, unique: true },
    { name: 'byPromotion', key: (row) => row.promotionId },
    {
      name: 'unseenExpiry',
      key: (row) => (row.expiryNotice?.seenOn === null ? UNSEEN_EXPIRY_KEY : null),
    },
    {
      name: 'openRequest',
      key: (row) =>
        row.request?.status === 'open' && row.request.stopsSkip ? OPEN_REQUEST_KEY : null,
    },
  ],
});
