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

export const showsSystem: SystemBundle = defineSystem({
  id: 'shows',
  phases: [],
  queries: [],
});
