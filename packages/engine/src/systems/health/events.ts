/**
 * The health system's domain events.
 */

import type { ContentKey } from '../../core/content-key';
import type { GameDate } from '../../core/date';
import type { InjuryId, PersonId, SegmentId } from '../../core/ids';
import type { InjurySeverity } from '../../model/catalogs';
import type { InjurySource } from '../../model/entities/injury';
import type { BodyPart } from '../../model/entities/person';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A person's fatigue reached 0 after being above it. */
    'fatigue.cleared': { personId: PersonId };
    /** `health.injure` hurt someone (WRK6-03). `segmentId` is null for an off-screen injury. */
    'injury.sustained': {
      personId: PersonId;
      injuryId: InjuryId;
      kindKey: ContentKey;
      bodyPart: BodyPart;
      severity: InjurySeverity;
      expectedReturn: GameDate;
      source: InjurySource;
      segmentId: SegmentId | null;
    };
    /** Someone's injury reached its return date and they are fit again (WRK6-03). */
    'injury.healed': {
      personId: PersonId;
      injuryId: InjuryId;
      kindKey: ContentKey;
      daysOut: number;
    };
    /** The player saw their workers' new injuries (`health.acknowledgeInjuries`, WRK6-04). */
    'injury.noticed': { injuryIds: InjuryId[] };
  }
}

export {};
