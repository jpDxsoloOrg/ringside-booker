/**
 * Rival results (AIP5), part of the rival desk's `aip` bundle (no system of its own): a rival
 * booker picks its matches' winners and decides when a title changes hands, with a Why? on each.
 *
 * AIP5-01 lays the groundwork: the tunables (`tunables.ts`), the `aip.winners` and `aip.titles`
 * streams (`streams.ts`), the `aip.winner` and `aip.title` trace kinds (`traces.ts`), the `winner`
 * and `title` decision kinds (`decisionKinds.ts`, registered on import), the computer-only guard
 * for the booked-card step (`guard.ts`), the input gatherer (`inputs.ts`) and the popularity
 * history seam (`history.ts`). Design: docs/design/rival-booking.md#winners and #title-changes.
 */

// The stream declarations are types only; the decision kinds register on import.
import './streams';
import './decisionKinds';
// AIP5-04: the booked-card step registers on import.
import './decideResults';

export { TITLES_STREAM, WINNERS_STREAM } from './streams';
export {
  aipResultsTunables,
  REIGN_BAND_NUMBERS,
  reignBandChanceKey,
  reignBandDaysKey,
  reignBandProblems,
  reignBandsAsSet,
  reignBandsOf,
  TITLE_CHANGES_DOC_REF,
  titleImportanceKey,
  WINNERS_DOC_REF,
  type ReignBand,
  type ReignBandChanceKey,
  type ReignBandDaysKey,
  type ReignBandNumber,
  type TitleImportanceKey,
} from './tunables';
export { TITLE_TRACE_KIND, titleTraceRef, WINNER_TRACE_KIND, winnerTraceRef } from './traces';
export { TITLE_DECISION_KIND, WINNER_DECISION_KIND } from './decisionKinds';
export { isComputerBooked } from './guard';
export {
  PUSH_INDEX,
  rivalSegmentInputsOf,
  rivalShowContextOf,
  STORED_TITLE_TASTE_LABEL,
  STYLE_TITLE_TASTE_LABEL,
  titleTasteOf,
  type FeaturedRole,
  type RivalChallengerSide,
  type RivalOpenReign,
  type RivalSegmentInputs,
  type RivalShowContext,
  type RivalSide,
  type RivalStorylineContext,
  type RivalTitleContext,
} from './inputs';
export {
  NO_POPULARITY_HISTORY_NOTE,
  popularityHistoryOf,
  registerPopularityHistorySource,
  type PopularityHistorySource,
  type PopularityReading,
} from './history';
export {
  bookedResultLabel,
  decideResults,
  DECIDE_RESULTS_STEP_ID,
  DECIDE_RESULTS_STEP_ORDER,
  type TitlePlanKind,
} from './decideResults';
export {
  METHOD_LABEL,
  METHOD_ROLL,
  NO_CHANGE_METHODS_RULE,
  ONLY_METHOD_NOTE,
  pickRivalMethod,
  TITLE_CHANGE_METHODS_RULE,
  type RivalMethodArgs,
  type RivalMethodDeps,
} from './method';
export {
  BEST_VALUE_REASON,
  CHAMPION_ABSENT_NOTE,
  followsText,
  NO_DRAWS_ON_TITLES_NOTE,
  NO_METHOD_NOTE,
  NOBODY_CAN_HOLD_NOTE,
  ONLY_ONE_FIT_NOTE,
  resultsSummaryText,
  TITLE_CHANGE_SUMMARY_KEY,
  TITLE_CROWN_SUMMARY_KEY,
  TITLE_RETAIN_SUMMARY_KEY,
  TITLE_VACANT_SUMMARY_KEY,
  titleChangeText,
  titleCrownText,
  titleRetainText,
  titleVacantText,
  VACANT_TITLE_NOTE,
  WINNERS_BOOKED_SUMMARY_KEY,
  winnersBookedText,
} from './texts';
export {
  REASON_NOT_KEPT,
  segmentDecisionView,
  showDecisionsOf,
  titleDecisionOf,
  type SegmentDecisionTitle,
  type SegmentDecisionView,
  type SegmentDecisionWinner,
  type SegmentTitleActual,
  type SegmentTitlePlan,
} from './view';
export {
  aipRecentTitleChangesQuery,
  aipSegmentDecisionQuery,
  DEFAULT_TITLE_CHANGES_LIMIT,
  MAX_TITLE_CHANGES_LIMIT,
  NO_DECISION_MESSAGE,
  NOT_REVEALED_MESSAGE,
  SEGMENT_NOT_FOUND,
  type AipRecentTitleChanges,
  type AipRecentTitleChangesArgs,
  type AipSegmentDecisionArgs,
  type AipTitleChange,
} from './queries';
