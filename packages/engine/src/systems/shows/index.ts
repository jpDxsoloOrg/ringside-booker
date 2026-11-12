/**
 * The shows system: show night. On a show's day it runs the card, rates every segment, scores the
 * show, settles title outcomes and announces what happened (docs/design/show-night.md).
 *
 * EVT3-01 lays the groundwork: the events, trace kinds, random stream and tunables. EVT3-02 adds the
 * show score formulas and modifier seam. EVT3-03 adds the `shows.runShows` phase and the segment
 * result applier and match outcome resolver seams. Queries arrive with EVT3-05.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { showsPhases } from './phases';

export { SHOWS_OFFSCREEN_STREAM } from './streams';
export {
  RIVAL_SEGMENT_SCORE_TRACE_KIND,
  SEGMENT_SCORE_TRACE_KIND,
  SHOW_SCORE_TRACE_KIND,
  SHOWS_TRACE_KINDS,
  TITLE_OUTCOME_TRACE_KIND,
  segmentScoreTraceRef,
  showScoreTraceRef,
  titleOutcomeTraceRef,
  traceRefFromKey,
} from './traces';
export { showsTunables } from './tunables';
export {
  OFFSCREEN_SHOW_SCORE_DOC_REF,
  offscreenShowScore,
  type OffscreenShowScoreInputs,
} from './formulas/offscreenShowScore';
export {
  SHOW_SCORE_DOC_REF,
  SHOW_SCORE_MAX,
  SHOW_SCORE_MIN,
  showScore,
  type ShowScoreDeps,
  type ShowScoreInputs,
  type ShowScoreResult,
  type ShowSlotInput,
} from './formulas/showScore';
export {
  SHOW_STARS_MAX,
  SHOW_STARS_MIN,
  showStars,
  type ShowStarsInputs,
} from './formulas/showStars';
export {
  SHOW_SCORE_MODIFIER_STAGES,
  listShowScoreModifiers,
  registerShowScoreModifier,
  sortShowScoreModifiers,
  unregisterShowScoreModifier,
  type ShowScoreModifier,
  type ShowScoreModifierStage,
} from './showScoreModifiers';

export { hasShowsToday, runShowsPhase, showsPhases, showsToRunToday } from './phases';
export {
  isSegmentRun,
  showContextOf,
  sidesOf,
  slotRoleInput,
  type ShowContext,
  type ShowSegment,
  type ShowSide,
} from './context';
export { resultPeople, withOutcomeLine, type ResultPeople } from './runSegment';
export {
  BOOKED_RESULT_REASON,
  NO_PLAN_NO_CONTEST_REASON,
  OUTCOME_DECISION_LABEL,
  listSegmentResultAppliers,
  matchOutcomeResolver,
  plannedOrNoContest,
  registerMatchOutcomeResolver,
  registerSegmentResultApplier,
  unregisterMatchOutcomeResolver,
  unregisterSegmentResultApplier,
  type MatchOutcomeDeps,
  type MatchOutcomeInput,
  type MatchOutcomeResolution,
  type MatchOutcomeResolver,
  type MatchOutcomeSide,
  type SegmentResult,
  type SegmentResultApplier,
  type SegmentResultSide,
} from './registries';

export const showsSystem: SystemBundle = defineSystem({
  id: 'shows',
  phases: showsPhases,
  queries: [],
});
