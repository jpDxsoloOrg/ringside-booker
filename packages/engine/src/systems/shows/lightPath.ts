/**
 * The light path's stored summaries (POL4-13): a distant rival show in a Fast world keeps one
 * line per Why? instead of the full working, so nothing is built, fitted or copied for traces
 * nobody opens. Every number written is the same kind of number the full path writes.
 *
 * A leaf module (core imports only), so the shows, match, workers and promotion popularity systems
 * can all use it. Design: docs/design/show-night.md#big-world-speed.
 */

import { inputOf, type Traced, type TraceValue } from '../../core/trace';
import type { TraceRecordOptions } from '../../core/trace/store';

/** What every light-path summary says after its label. */
export const LIGHT_PATH_NOTE = 'simulated lightly: Big world speed is Fast';

/** How a light-path trace is kept: as a summary from the start. */
export const LIGHT_TRACE_KEPT: TraceRecordOptions = Object.freeze({ summaryOnly: true });

/** A one-line trace for a light-path value: the label, the note and the value, nothing else. */
export function lightSummary<T extends TraceValue>(label: string, value: T): Traced<T> {
  return inputOf(`${label} (${LIGHT_PATH_NOTE})`, value);
}
