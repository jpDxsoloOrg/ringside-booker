/**
 * The card planner (AIP4), part of the rival desk's `aip` bundle (no system of its own).
 *
 * AIP4-01 lays the groundwork, all pure and read-only: the tunables (`tunables.ts`, category
 * `Rival booking`), the `aip.card` and `aip.autofill` streams (`streams.ts`), the card pool
 * (`pool.ts`: who a show may use today) and the card shape (`formulas/cardShape.ts`: talking slots,
 * the title match cap and whether the main event must be a match). AIP4-02 adds the title picture
 * (`titlePicture.ts`, `challengers.ts`, `titleHistory.ts`, `formulas/titleUrgency.ts`). AIP4-03 fills
 * the rest of the card (`fill.ts`, `storylineSegments.ts`, `talk.ts`, `fallback.ts`,
 * `formulas/matchTypeWeight.ts`). Later AIP4 tickets order and write the card, and add Auto-fill.
 *
 * Design: docs/design/rival-booking.md.
 */

// The stream declarations are types only.
import './streams';

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
  CARD_SHAPE_DOC_REF,
  RIVAL_BOOKING_CATEGORY,
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
export { lastDefenceOf, recentChallengersOf, type LastDefence } from './titleHistory';
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
  TALK_SLOT_NOTE,
  titleMatchNote,
  titleSegmentOf,
  type FillCardArgs,
  type FillCardDeps,
} from './fill';
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
