/**
 * The booking system: putting matches and angles on a show's card.
 *
 * So far (EVT2-01) the engine core the booking screen and the rival booker stand on: who may read
 * a card and whether it can still change (`control.ts`, on top of the calendar's one definition of
 * who runs a show), the segment draft an editor fills in (`draft.ts`), the readers that list a card
 * in running order (`card.ts`) and the card writer (`writer.ts`), the one way segments are written.
 * Commands, queries and gates come with the next EVT2 tickets. Nothing here is random, so the
 * system has no random stream. See docs/design/booking.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system.
import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { bookingGates } from './gates';
import { bookingQueries } from './queries';

export { cardSegments, hasCard } from './card';
export {
  canReadCard,
  EDIT_BLOCK_CODES,
  editBlockOf,
  type CardShow,
  type EditBlockCode,
} from './control';
export {
  AngleDetailsDraftSchema,
  AngleDraftSchema,
  draftFromSegment,
  emptyCrew,
  MatchDetailsDraftSchema,
  MatchDraftSchema,
  ParticipantDraftSchema,
  SegmentDraftSchema,
  type AngleDraft,
  type MatchDraft,
  type ParticipantDraft,
  type SegmentDraft,
  type SegmentDraftInput,
} from './draft';
export {
  clearCard,
  moveSegment,
  PARK_SLOT,
  removeSegment,
  setPlannedOutcome,
  STRUCTURAL_PROBLEM_CODES,
  structuralProblems,
  writeSegment,
  type CardPosition,
  type CardTarget,
  type StructuralCheck,
  type StructuralProblemCode,
  type WriteSegmentArgs,
} from './writer';

// The booking screen's reads and the show-day gate (EVT2-03).
export { bookingGates, SHOW_NEEDS_BOOKING_GATE_ID, showNeedsBookingGate } from './gates';
export {
  availableWorkersQuery,
  BOOKING_UNAVAILABLE_REASON,
  bookingQueries,
  cardQuery,
  DEFAULT_BOOKING_SHOWS,
  MAX_BOOKING_SHOWS,
  MAX_WORKER_SEARCH,
  showsQuery,
  WORKER_PICK_KINDS,
  type AvailableTeamRow,
  type AvailableWorkerRow,
  type AvailableWorkersView,
  type BookingShowRow,
  type BookingShowsView,
  type WorkerPickKind,
} from './queries';
export {
  AVAILABILITY_LABELS,
  availabilityLabel,
  availabilityView,
  buildCardView,
  slotLabel,
  type AvailabilityView,
  type BookingCard,
  type BookingPersonView,
  type BookingResultView,
  type BookingSectionView,
  type BookingSegmentView,
  type BookingShowView,
  type BookingSideView,
  type BookingSlotView,
  type BookingTitleOption,
  type BookingTitleView,
  type CardViewDeps,
} from './view';

export const bookingSystem: SystemBundle = defineSystem({
  id: 'booking',
  queries: bookingQueries,
  commands: [],
  gates: bookingGates,
});
