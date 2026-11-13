/**
 * The card planner (AIP4), part of the rival desk's `aip` bundle (no system of its own).
 *
 * AIP4-01 lays the groundwork, all pure and read-only: the tunables (`tunables.ts`, category
 * `Rival booking`), the `aip.card` and `aip.autofill` streams (`streams.ts`), the card pool
 * (`pool.ts`: who a show may use today) and the card shape (`formulas/cardShape.ts`: talking slots,
 * the title match cap and whether the main event must be a match). AIP4-02 adds the title picture
 * (`titlePicture.ts`, `challengers.ts`, `titleHistory.ts`, `formulas/titleUrgency.ts`). AIP4-03 fills
 * the rest of the card (`fill.ts`, `storylineSegments.ts`, `talk.ts`, `fallback.ts`,
 * `formulas/matchTypeWeight.ts`). AIP4-04 scores and orders the card (`formulas/cardScore.ts`,
 * `order.ts`) and adds `planCard` (`planCard.ts`), the one entry point that plans a whole show.
 * AIP4-05 books the rivals' shows on show day: the job `aip.bookShow` (`bookShowJob.ts`, which
 * registers itself and the `card` decision kind on import), the booked-card steps
 * (`bookedCardSteps.ts`) and the `aip.cardBooked` event (`events.ts`). Later AIP4 tickets add
 * Auto-fill.
 *
 * Design: docs/design/rival-booking.md.
 */

// The stream and event declarations are types only.
import './streams';
import './events';
// AIP4-05: the show-day booker registers itself as a job on import.
import './bookShowJob';

export { AUTOFILL_STREAM, CARD_PLAN_STREAM } from './streams';
export {
  aipCardTunables,
  CARD_POOL_DOC_REF,
  CHALLENGERS_DOC_REF,
  FALLBACK_DOC_REF,
  FILLING_DOC_REF,
  importanceBonusKey,
  MATCH_FAMILIES,
  MATCH_TYPES_DOC_REF,
  STORYLINES_DOC_REF,
  TALKING_DOC_REF,
  typeWeightKey,
  type MatchFamily,
  type TypeWeightKey,
  TITLE_PICTURE_DOC_REF,
  type ImportanceBonusKey,
  CARD_SCORE_DOC_REF,
  CARD_SHAPE_DOC_REF,
  ORDERING_DOC_REF,
  PLAN_CARD_DOC_REF,
  RIVAL_BOOKING_CATEGORY,
  SHOW_DAY_DOC_REF,
  talkShareKey,
  TITLE_CAP_DOC_REF,
  titleCapKey,
  type TalkShareKey,
  type TitleCapKey,
} from './tunables';
export {
  appearanceCapReason,
  buildCardPool,
  CARD_EMPLOYMENT_ROLES,
  NO_HOUSE_SHOWS_REASON,
  talkValueOf,
  tiredReason,
  type CardPoolArgs,
  type CardPoolShow,
} from './pool';
export {
  MAIN_EVENT_RULE,
  mainEventMustBeMatch,
  NEUTRAL_TALK_TASTE,
  NO_BACK_TO_BACK_REASON,
  talkRoomFor,
  talkSlotsFor,
  titleMatchCapFor,
  type TalkSlotsInputs,
  type TitleMatchCapInputs,
} from './formulas/cardShape';
export {
  daysSinceText,
  NEUTRAL_TITLE_FOCUS,
  titleUrgency,
  type TitleUrgencyInputs,
} from './formulas/titleUrgency';
export {
  lastDefenceOf,
  recentChallengersOf,
  recentTitleMatchIds,
  type LastDefence,
} from './titleHistory';
export {
  contenderText,
  NO_FRESH_CHALLENGER,
  ONLY_CONTENDER_REASON,
  pairedForTonightText,
  pickChallengers,
  VACANT_CONTENDERS_REASON,
  WEIGHTED_PICK_REASON,
  type ChallengerArgs,
  type ChallengerDeps,
} from './challengers';
export {
  capText,
  CHAMPION_AVAILABLE_RULE,
  decideTitlePicture,
  DEFEND_REASON,
  dueText,
  MATCH_TYPE_LABEL,
  NO_CHALLENGER_REASON,
  NO_DEFENCE_YET_NOTE,
  NO_MATCH_TYPE_REASON,
  VACANT_RULE,
  type TitlePictureArgs,
  type TitlePictureDeps,
} from './titlePicture';
export {
  familyPlaceOf,
  fewTeamsText,
  freeWrestlersText,
  plainTypeText,
  variantText,
  type FamilyPlace,
  MATCH_FAMILY_LABELS,
  matchFamilyOf,
  matchTypeWeight,
  unusualTasteText,
  type MatchTypeWeightInputs,
} from './formulas/matchTypeWeight';
export {
  CardBook,
  FALLBACK_LEVELS,
  findWorker,
  isFreeToWrestle,
  levelText,
  rankedText,
  seatRulesFor,
  seatWorker,
  type CardBookings,
  type FallbackLevel,
  type Seat,
  type SeatRules,
} from './fallback';
export { BookerNotes } from './notes';
export { firstTypeOfFamily, matchSegment, matchupLabel, type MatchSegmentSpec } from './matchDraft';
export {
  buildTalkSegment,
  INJURED_CAN_TALK,
  NO_TALKER_REASON,
  speakersLabel,
  type TalkSegmentArgs,
  type TalkSegmentDeps,
} from './talk';
export {
  NO_ROOM_REASON,
  NOBODY_FREE_REASON,
  planStorylineSegment,
  storylineNote,
  storylinesForShow,
  type CardRoom,
  type StorylineDeps,
  type StorylineOutcome,
} from './storylineSegments';
export {
  ALL_WEIGHTS_ZERO,
  bookMatchOfType,
  FILLER_NOTE,
  fillCard,
  NOT_ENOUGH_WORKERS,
  reserveText,
  sidesOf,
  stepDownText,
  TALK_INSTEAD,
  STORY_ON_CARD,
  TALK_SLOT_NOTE,
  titleMatchNote,
  titleSegmentOf,
  type FillCardArgs,
  type FillCardDeps,
} from './fill';
export {
  cardScore,
  cardScoreLabel,
  featuredText,
  NO_FEATURED_NOTE,
  NOBODY_IN_IT_NOTE,
  storylineHeatText,
  cardScoreText,
  type CardScoreInputs,
  type FeaturedKind,
} from './formulas/cardScore';
export {
  ASCENDING_RULE,
  CANNOT_SPACE_NOTE,
  HOT_OPENER_RULE,
  MAIN_EVENT_ANY_RULE,
  MAIN_EVENT_FIXED_NOTE,
  MAIN_EVENT_MATCH_RULE,
  NO_MATCH_TO_CLOSE,
  NO_ROOM_ON_CARD,
  OPENER_GIVES_WAY,
  orderCard,
  PRE_SHOW_RULE,
  slotKeyOf,
  SPACED_RULE,
  type CardOrder,
  type CardPlacement,
  type FixedSegment,
  type OrderCardOptions,
} from './order';
export {
  cancelReason,
  cardPlanLabel,
  NOTHING_LEFT_REASON,
  planCard,
  slotTraceLabel,
  type CardPlan,
  type PlanCardArgs,
  type PlanCardDeps,
  type PlanCardMode,
  type PlanCounts,
  type PlannedPlacement,
  type PlanOpenSlot,
} from './planCard';
export type {
  CardCandidate,
  CardFill,
  OpenCardSlot,
  PlannedSegment,
  PlannedSegmentSource,
  SkippedStoryline,
  CardExclusion,
  CardPool,
  CardTeam,
  CardTitle,
  ChallengerPick,
  ContractBlock,
  PlannedSide,
  PlannedTitleMatch,
  SkippedTitle,
  TitlePicture,
} from './types';
export {
  BOOK_SHOW_JOB_ID,
  bookShowSavepointLabel,
  CARD_BOOKED_SUMMARY_KEY,
  CARD_DECISION_KIND,
  CARD_PLAN_TRACE_KIND,
  CARD_SLOT_TRACE_KIND,
  cardBookedText,
  NO_PLANNED_RESULT_CODE,
  runBookShow,
  SHOW_CANCELLED_SUMMARY_KEY,
  showCancelledText,
  slotSummaryTrace,
} from './bookShowJob';
export {
  bookedCardSteps,
  registerBookedCardStep,
  type BookedCardInput,
  type BookedCardStep,
  type BookedCardStepSpec,
  type ShowBookingContext,
} from './bookedCardSteps';
export {
  AIP_PRUNE_CARD_DETAIL_PHASE_ID,
  cardDetailCutoff,
  pruneCardDetailPhase,
} from './pruneCardDetail';
// AIP4-06: Auto-fill for the player's own card and the Shows tab's cards.
export {
  aipCardCommands,
  AUTO_FILL_COMMAND,
  AUTO_FILL_REASON_CODES,
  autoFillCardCommand,
  CARD_FULL_MESSAGE,
  NO_CATALOG_MESSAGE,
  SHOW_NOT_FOUND_MESSAGE,
  type AutoFillCardArgs,
  type AutoFilledSlot,
  type AutoFillOpenSlot,
  type AutoFillReasonCode,
  type AutoFillResult,
} from './commands';
export {
  aipShowCardsQuery,
  CANCELLATION_REASON_TEXT,
  CARD_HIDDEN_TEXT,
  DEFAULT_PAST_SHOWS,
  DEFAULT_UPCOMING_SHOWS,
  MAX_PAST_SHOWS,
  MAX_UPCOMING_SHOWS,
  SHOW_CARD_STATUS_LABELS,
  type ShowCardPerson,
  type ShowCardRow,
  type ShowCards,
  type ShowCardsArgs,
  type ShowCardSegment,
  type ShowCardSide,
  type ShowCardSlot,
  type ShowCardStatusLabel,
} from './queries';
