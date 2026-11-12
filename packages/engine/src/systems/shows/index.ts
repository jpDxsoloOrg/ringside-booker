/**
 * The shows system: show night. On a show's day it runs the card, rates every segment, scores the
 * show, settles title outcomes and announces what happened (docs/design/show-night.md).
 *
 * EVT3-01 lays the groundwork only: the events, trace kinds, random stream and tunables. The phase
 * and queries are filled in by EVT3-03..05, so the bundle registers nothing yet.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';

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

export const showsSystem: SystemBundle = defineSystem({
  id: 'shows',
  phases: [],
  queries: [],
});
