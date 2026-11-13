/**
 * The card planner (AIP4), part of the rival desk's `aip` bundle (no system of its own).
 *
 * AIP4-01 lays the groundwork, all pure and read-only: the tunables (`tunables.ts`, category
 * `Rival booking`), the `aip.card` and `aip.autofill` streams (`streams.ts`), the card pool
 * (`pool.ts`: who a show may use today) and the card shape (`formulas/cardShape.ts`: talking slots,
 * the title match cap and whether the main event must be a match). AIP4-02 adds the title picture
 * (`titlePicture.ts`, `challengers.ts`, `titleHistory.ts`, `formulas/titleUrgency.ts`). Later AIP4
 * tickets add the picking, the talking segments and Auto-fill here.
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
  importanceBonusKey,
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
export type {
  CardCandidate,
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
