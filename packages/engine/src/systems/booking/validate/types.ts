/**
 * The shapes the booking checks speak in: one issue per problem found, and the validation that
 * gathers them for a card (errors block Lock, warnings never do) with the booking screen's
 * checklist.
 *
 * Design notes: docs/design/booking.md#validation.
 */

import type { GameDate } from '../../../core/date';
import type { PersonId, SegmentId, TitleId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace/types';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { Participant } from '../../../model/entities/participant';
import type { Segment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';

/** An error blocks locking the card; a warning is shown (in amber) and never blocks. */
export type BookingSeverity = 'error' | 'warning';

/** One problem a booking check found on a card. */
export interface BookingIssue {
  /** The check that found it, such as `booking.people`. */
  checkId: string;
  /** What is wrong, such as `personUnavailable`. */
  code: string;
  severity: BookingSeverity;
  /** For the player: names the person, title or slot it is about. */
  message: string;
  segmentId?: SegmentId;
  /** Where the segment is on the card: its section and 0-based slot. */
  slot?: { preShow: boolean; slot: number };
  personId?: PersonId;
  titleId?: TitleId;
}

/** One line of the booking screen's checklist. */
export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  /** How bad it is when the line does not pass. */
  severity: BookingSeverity;
  /** The first problem behind a line that does not pass, or a count; absent when it passes. */
  detail?: string;
  /** The calculation behind the line's number, for its Why? panel. */
  trace?: TraceNode;
}

/** `booking.validate`: everything wrong with a card, and whether its show can run. */
export interface BookingValidation {
  errors: BookingIssue[];
  warnings: BookingIssue[];
  /** True when there are no errors: the show can run (`shows.runTonight`). */
  runnable: boolean;
  checklist: ChecklistItem[];
}

/** What every booking check reads. Built once per validation. */
export interface BookingCheckInput {
  readonly read: GameWorldView;
  readonly instance: DeepReadonly<EventInstance>;
  /** The card in running order: the pre-show first, then the main card, each by slot. */
  readonly segments: readonly DeepReadonly<Segment>[];
  /** Each segment's participants, by side then person id. */
  readonly participantsBySegment: ReadonlyMap<SegmentId, readonly DeepReadonly<Participant>[]>;
  /** The day the check is asked on. Availability is read on the show's date. */
  readonly today: GameDate;
  readonly tunables: EngineTunables;
}

/** An issue as a check returns it; the registry fills in `checkId`. */
export type BookingIssueDraft = Omit<BookingIssue, 'checkId'>;

/** A booking check: one rule, or a group of related rules, run against the whole card. */
export interface BookingCheck {
  /** `system.camelName`, such as `booking.people` or `brands.exclusivity`. */
  readonly id: string;
  /** Lower runs first; ties by id. Built-in checks use 100–190, other features 200 and up. */
  readonly order: number;
  /**
   * The checklist line this check's issues land on when it is not one of the built-in lines;
   * defaults to the check id.
   */
  readonly label?: string;
  run(input: BookingCheckInput): readonly BookingIssueDraft[];
}
