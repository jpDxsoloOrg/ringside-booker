/**
 * The workers system's domain events: one per door (see `doors.ts`).
 *
 * Every payload carries who made the change (`source`) and why (`reasonKey`), so a listener can
 * tell a player's push from a rival booker's, and news can word the story by reason. Payloads hold
 * IDs and small primitives only.
 *
 * Design: docs/design/workers.md#doors.
 */

import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { Alignment, EmploymentRole, Push } from '../../model/entities/employment';

/** Who asked a door for a change. */
export type DoorSource = 'player' | 'ai' | 'system';

/** The fields every employment door event carries. */
interface EmploymentChange {
  employmentId: EmploymentId;
  personId: PersonId;
  promotionId: PromotionId;
  source: DoorSource;
  /** The caller's reason key, such as `match.win`. */
  reasonKey: string;
}

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A worker's card position changed. */
    'employment.pushChanged': EmploymentChange & { from: Push; to: Push };
    /** A worker turned: face, heel or tweener. */
    'employment.alignmentChanged': EmploymentChange & { from: Alignment; to: Alignment };
    /** A worker's job with the promotion changed. */
    'employment.roleChanged': EmploymentChange & { from: EmploymentRole; to: EmploymentRole };
    /** A person's or a promotion's popularity changed in at least one region. */
    'popularity.changed': {
      subjectKind: 'person' | 'promotion';
      /** A person ID or a promotion ID, as `subjectKind` says. */
      subjectId: PersonId | PromotionId;
      /** The worldwide figure before and after the change. */
      worldBefore: number;
      worldAfter: number;
      /** How many regions ended with a different stored value. */
      regionsChanged: number;
      source: DoorSource;
      reasonKey: string;
    };
    /** A worker's momentum changed. `before` is null on their first appearance. */
    'momentum.changed': EmploymentChange & { before: number | null; after: number };
    /** A worker's morale changed. */
    'morale.changed': EmploymentChange & { before: number; after: number };
  }
}

export {};
