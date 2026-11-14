/**
 * Negotiations (ECO5-01): one row per conversation between a worker and a promotion about a
 * contract, either a new signing or a renewal of the contract the worker already has there.
 *
 * The employment row keeps the lifecycle the foundation promised (`offered → signed → active`):
 * an offer is `offered`, a deal is `signed`, and nothing in between can pay a wage. The back and
 * forth lives here instead: the current offer, the worker's last counter-offer, how much patience
 * is left, the rounds so far and any walk-away cooldown. For a signing the row points at the
 * `offered` employment ECO5-04 creates; for a renewal it points at the live contract, which is
 * changed in place when the renewal is signed.
 *
 * Closed rows stay (that is how a walk-away cooldown is remembered) until the history prune
 * removes them after `contracts.history.closedKeepDays`. Terms and rival offers are private:
 * player queries only show rows of the player's own promotions.
 *
 * Design: docs/design/negotiation.md and docs/design/data-model.md, "Negotiations".
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { PersonId, PromotionId } from '../../core/ids';
import { OfferSchema } from '../../systems/negotiation/offer';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zPositiveInt } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { employmentsTable, type EmploymentStatus } from './employment';

/** What a negotiation is about: a new contract, or more time on the one the worker has. */
export const NEGOTIATION_KINDS = ['signing', 'renewal'] as const;
export const NegotiationKindSchema = z.enum(NEGOTIATION_KINDS);
export type NegotiationKind = z.infer<typeof NegotiationKindSchema>;

export const NEGOTIATION_STATUSES = [
  'submitted',
  'countered',
  'awaitingReview',
  'signed',
  'declined',
  'walkedAway',
  'withdrawn',
  'lapsed',
] as const;
export const NegotiationStatusSchema = z.enum(NEGOTIATION_STATUSES);
export type NegotiationStatus = z.infer<typeof NegotiationStatusSchema>;

/**
 * Statuses of a conversation still going on: the worker has an offer to react to (`submitted`),
 * the promotion has a counter-offer to answer (`countered`), or the worker said yes in principle
 * and decides on `reviewOn` (`awaitingReview`). Every other status is closed for good.
 */
export const OPEN_NEGOTIATION_STATUSES = [
  'submitted',
  'countered',
  'awaitingReview',
] as const satisfies readonly NegotiationStatus[];

/** Statuses that close a negotiation. Each sets `closedOn`. */
export const CLOSED_NEGOTIATION_STATUSES = [
  'signed',
  'declined',
  'walkedAway',
  'withdrawn',
  'lapsed',
] as const satisfies readonly NegotiationStatus[];

/** How a worker can react to an offer. */
export const REACTIONS = ['accept', 'counter', 'reject', 'walkAway', 'refuse'] as const;
export const ReactionSchema = z.enum(REACTIONS);
export type Reaction = z.infer<typeof ReactionSchema>;

/** Who made an offer in a round: the promotion, or the worker with a counter-offer. */
export const NEGOTIATION_PARTIES = ['promotion', 'worker'] as const;
export const NegotiationPartySchema = z.enum(NEGOTIATION_PARTIES);
export type NegotiationParty = z.infer<typeof NegotiationPartySchema>;

/** The most rounds a negotiation's history keeps. */
export const NEGOTIATION_HISTORY_MAX = 12;
/** The most patience a worker can have, and the least. */
export const NEGOTIATION_PATIENCE_MAX = 10;

const zPatience = z.number().int().min(0).max(NEGOTIATION_PATIENCE_MAX);

/** True for a status of a conversation still going on. */
export function isOpenNegotiationStatus(status: NegotiationStatus): boolean {
  return OPEN_NEGOTIATION_STATUSES.some((open) => open === status);
}

export const NegotiationRoundSchema = z.strictObject({
  round: zPositiveInt,
  date: zGameDate,
  by: NegotiationPartySchema,
  offer: OfferSchema,
  /** The worker's reaction to a promotion's offer; null for a counter-offer or while undecided. */
  reaction: ReactionSchema.nullable(),
});

export const NegotiationOutcomeSchema = z.strictObject({
  /** A stable code for why the negotiation closed, such as `signed` or `signedElsewhere`. */
  code: z.string().min(1).max(60),
  /** The promotion the worker went to instead, when that is why it closed. */
  otherPromotionId: zId('promotion').nullable(),
});

export const NegotiationSchema = z
  .strictObject({
    id: zId('negotiation'),
    kind: NegotiationKindSchema,
    personId: zId('person'),
    promotionId: zId('promotion'),
    /** The `offered` employment of a signing, or the live contract a renewal changes. */
    employmentId: zId('employment'),
    status: NegotiationStatusSchema,
    round: zPositiveInt,
    /** The worker's patience when the conversation opened, 0 to 10. */
    startPatience: zPatience,
    /** Patience left; each round that does not please the worker uses some. */
    patience: zPatience,
    /** The promotion's current offer. */
    offer: OfferSchema,
    /** The worker's counter-offer; set exactly while the status is `countered`. */
    lastCounter: OfferSchema.nullable(),
    history: z.array(NegotiationRoundSchema).max(NEGOTIATION_HISTORY_MAX),
    openedOn: zGameDate,
    /** The day the current offer was submitted. */
    submittedOn: zGameDate,
    /** The last day the counter-offer can be answered; set exactly while `countered`. */
    counterExpiresOn: zGameDate.nullable(),
    /** The day the worker decides; set while `awaitingReview`. */
    reviewOn: zGameDate.nullable(),
    /** The day the negotiation closed; set exactly when the status is a closed one. */
    closedOn: zGameDate.nullable(),
    outcome: NegotiationOutcomeSchema.nullable(),
    /** After a walk-away, the worker will not talk to this promotion again before this day. */
    cooldownUntil: zGameDate.nullable(),
    /** The trace id of the worker's latest reaction, `<negotiationId>:<round>`. */
    reactionTraceId: z.string().min(1).nullable(),
    /** The trace id of the review decision, `<negotiationId>:review`. */
    reviewTraceId: z.string().min(1).nullable(),
  })
  .superRefine((row, context) => {
    const issue = (path: string, message: string): void => {
      context.addIssue({ code: 'custom', path: [path], message });
    };
    const open = isOpenNegotiationStatus(row.status);
    if (open && row.closedOn !== null) {
      issue('closedOn', `closedOn must be null while the status is ${row.status}`);
    }
    if (!open && row.closedOn === null) {
      issue('closedOn', `closedOn is required when the status is ${row.status}`);
    }
    const countered = row.status === 'countered';
    if (countered !== (row.lastCounter !== null)) {
      issue(
        'lastCounter',
        countered
          ? 'A countered negotiation needs the counter-offer in lastCounter'
          : `lastCounter must be null while the status is ${row.status}`,
      );
    }
    if (countered !== (row.counterExpiresOn !== null)) {
      issue(
        'counterExpiresOn',
        countered
          ? 'A countered negotiation needs counterExpiresOn'
          : `counterExpiresOn must be null while the status is ${row.status}`,
      );
    }
    if (row.status === 'awaitingReview' && row.reviewOn === null) {
      issue('reviewOn', 'A negotiation awaiting review needs reviewOn');
    }
    if (row.patience > row.startPatience) {
      issue('patience', 'patience cannot be more than startPatience');
    }
    if (compareDates(row.submittedOn, row.openedOn) < 0) {
      issue('submittedOn', 'submittedOn must not be before openedOn');
    }
    if (row.closedOn !== null && compareDates(row.closedOn, row.openedOn) < 0) {
      issue('closedOn', 'closedOn must not be before openedOn');
    }
  });

export type Negotiation = z.infer<typeof NegotiationSchema>;
export type NegotiationRound = z.infer<typeof NegotiationRoundSchema>;
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/** The `byPersonPromotion` index key. Not unique: closed rows stay for their cooldowns. */
export function personPromotionKey(personId: PersonId, promotionId: PromotionId): string {
  return `${personId}|${promotionId}`;
}

// ---------------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------------

function openRows(view: WorldView): Negotiation[] {
  return tableOf(view, negotiationsTable)
    .values()
    .filter((row) => isOpenNegotiationStatus(row.status));
}

/** At most one open negotiation per worker and promotion. */
function checkOneOpenPerPersonPromotion(view: WorldView): IntegrityIssue[] {
  const seen = new Map<string, Negotiation>();
  const issues: IntegrityIssue[] = [];
  for (const row of openRows(view)) {
    const key = personPromotionKey(row.personId, row.promotionId);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, row);
      continue;
    }
    issues.push({
      code: 'negotiations.oneOpenPerPersonPromotion',
      table: 'negotiations',
      id: row.id,
      message: `Person ${row.personId} has more than one open negotiation with ${row.promotionId}: ${first.id}, ${row.id}`,
    });
  }
  return issues;
}

/**
 * An open negotiation's employment belongs to the same person and promotion and has one of the
 * statuses its kind expects. A missing employment is a dangling reference, reported elsewhere.
 */
function checkEmploymentOf(
  view: WorldView,
  kind: Negotiation['kind'],
  code: string,
  expected: readonly EmploymentStatus[],
  describe: string,
): IntegrityIssue[] {
  const employments = tableOf(view, employmentsTable);
  const issues: IntegrityIssue[] = [];
  for (const row of openRows(view)) {
    if (row.kind !== kind) {
      continue;
    }
    const employment = employments.get(row.employmentId);
    if (employment === undefined) {
      continue;
    }
    const samePair =
      employment.personId === row.personId && employment.promotionId === row.promotionId;
    if (samePair && expected.includes(employment.status)) {
      continue;
    }
    issues.push({
      code,
      table: 'negotiations',
      id: row.id,
      path: 'employmentId',
      message: samePair
        ? `Open ${kind} ${row.id} points at ${employment.id}, which is ${employment.status}; it must be ${describe}`
        : `Open ${kind} ${row.id} points at ${employment.id}, a contract of another person or promotion`,
    });
  }
  return issues;
}

export const negotiationsTable = defineTable({
  kind: 'negotiation',
  name: 'negotiations',
  schema: NegotiationSchema,
  refs: [
    { path: 'personId', target: 'person', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'employmentId', target: 'employment', nullable: false },
    { path: 'outcome.otherPromotionId', target: 'promotion', nullable: true },
  ],
  indexes: [
    { name: 'byPerson', key: (row) => row.personId },
    { name: 'byPromotion', key: (row) => row.promotionId },
    { name: 'byEmployment', key: (row) => row.employmentId },
    { name: 'byStatus', key: (row) => row.status },
    { name: 'byPersonPromotion', key: (row) => personPromotionKey(row.personId, row.promotionId) },
  ],
  invariants: [
    { name: 'oneOpenPerPersonPromotion', check: checkOneOpenPerPersonPromotion },
    {
      name: 'signingEmploymentIsOffered',
      check: (view) =>
        checkEmploymentOf(
          view,
          'signing',
          'negotiations.signingEmploymentIsOffered',
          ['offered'],
          'offered',
        ),
    },
    {
      name: 'renewalEmploymentIsLive',
      check: (view) =>
        checkEmploymentOf(
          view,
          'renewal',
          'negotiations.renewalEmploymentIsLive',
          ['signed', 'active'],
          'signed or active',
        ),
    },
  ],
});
