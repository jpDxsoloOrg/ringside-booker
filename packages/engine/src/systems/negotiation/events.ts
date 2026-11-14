/**
 * The negotiation system's domain events (ECO5-01). Payloads hold IDs and small primitives only.
 *
 * Nothing publishes them yet: ECO5-03 (reactions and counters), ECO5-04 (signings) and ECO5-05
 * (reviews and renewals) do. `contract.signed` sits in the `contract.` family beside ECO4's
 * lifecycle events; a signed renewal also publishes ECO4's `contract.renewed` when it moves the end
 * date.
 *
 * Design: docs/design/negotiation.md and docs/design/day-pipeline.md#domain-events.
 */

import type { GameDate } from '../../core/date';
import type { BrandId, EmploymentId, NegotiationId, PersonId, PromotionId } from '../../core/ids';
import type { NegotiationKind, NegotiationStatus } from '../../model/entities/negotiation';

/** The fields every negotiation event carries. */
interface NegotiationRef {
  negotiationId: NegotiationId;
  personId: PersonId;
  promotionId: PromotionId;
}

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A promotion opened a negotiation with a worker: a first offer, or a renewal offer. */
    'negotiation.opened': NegotiationRef & { kind: NegotiationKind };
    /** The worker answered an offer with a counter-offer; `round` is the round it answers. */
    'negotiation.countered': NegotiationRef & { round: number };
    /** The worker lost patience and walked away; they will not talk again before `cooldownUntil`. */
    'negotiation.walkedAway': NegotiationRef & { cooldownUntil: GameDate };
    /**
     * A negotiation closed for any reason: signed, declined, walked away, withdrawn or lapsed.
     * `outcomeCode` is the stored outcome's code.
     */
    'negotiation.closed': NegotiationRef & { status: NegotiationStatus; outcomeCode: string };
    /**
     * A worker signed: a new contract (`renewal: false`, the `offered` employment is now `signed`)
     * or a renewal of the live contract (`renewal: true`).
     */
    'contract.signed': {
      employmentId: EmploymentId;
      personId: PersonId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      renewal: boolean;
      negotiationId: NegotiationId;
    };
  }
}

export {};
