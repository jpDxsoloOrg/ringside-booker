/**
 * The contracts system's domain events (ECO4-01). Payloads hold IDs and small primitives only;
 * money is in integer cents.
 *
 * Every contract ending goes through `endEmployment`, which publishes exactly one of
 * `contract.expired`, `contract.released` or `contract.quit`. Titles, teams and storylines react
 * to these in their own features.
 *
 * Design: docs/design/contracts.md and docs/design/day-pipeline.md#domain-events.
 */

import type { GameDate } from '../../core/date';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { DoorSource } from '../workers/events';

/** The fields every contract event carries. */
interface ContractRef {
  employmentId: EmploymentId;
  personId: PersonId;
  promotionId: PromotionId;
}

/** How a worker left by their own doing (or by signing an exclusive deal elsewhere). */
export type ContractQuitHow = 'granted' | 'walkedOut' | 'exclusiveDeal';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A signed contract reached its start date and is now active. */
    'contract.started': ContractRef;
    /**
     * An active contract ran out. `reasonKey` is `contracts.endDate` for the end date passing
     * (ECO9 adds `solvency.promotionClosed`).
     */
    'contract.expired': ContractRef & { reasonKey: string };
    /**
     * A contract was ended by its promotion: a release of an active contract, or a signed future
     * deal withdrawn (`mutual: false`). `severance` is in cents (0 when none was paid).
     */
    'contract.released': ContractRef & { severance: number; source: DoorSource; mutual: boolean };
    /** A worker left: a granted release, a walk-out, or an exclusive deal starting elsewhere. */
    'contract.quit': ContractRef & { how: ContractQuitHow; severance: number };
    /** A contract's end date moved later: a renewal by the same promotion. */
    'contract.renewed': ContractRef & {
      previousEndsOn: GameDate;
      endsOn: GameDate;
      source: DoorSource;
    };
  }
}

export {};
