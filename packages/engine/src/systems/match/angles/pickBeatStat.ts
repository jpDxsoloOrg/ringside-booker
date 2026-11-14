/**
 * Picks the stat a person is scored on in a beat group (MTCH5-02). Pure and untraced: the
 * `beatWorkerValue` formula traces the choice, and MTCH5-03's query can call it to show the pick
 * without building a trace.
 *
 * The candidates are already adjusted for morale and momentum (and the manager's share), so the
 * adjustments can change which stat wins. Design: docs/design/angle-rating.md#beat-worker-value.
 */

import { InvalidArgumentError } from '../../../core/errors';
import type { BeatStat } from './beatStats';

/** One stat of a beat's mix after the adjustments. */
export interface BeatStatCandidate {
  stat: BeatStat;
  /** The person's own value after popularity share, morale and momentum. */
  own: number;
  /** The manager's value after their share and morale, or null when no manager can stand in. */
  managerValue: number | null;
}

/** The winning stat and value, and whether the manager's talking won it. */
export interface PickedBeatStat {
  stat: BeatStat;
  value: number;
  viaManager: boolean;
}

/**
 * The highest value among every candidate's own and manager values. A tie goes to the stat listed
 * earlier in the beat, then to the person's own value over the manager's.
 *
 * @throws InvalidArgumentError when there are no candidates.
 */
export function pickBeatStat(candidates: readonly BeatStatCandidate[]): PickedBeatStat {
  let best: PickedBeatStat | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.own > best.value) {
      best = { stat: candidate.stat, value: candidate.own, viaManager: false };
    }
    if (candidate.managerValue !== null && candidate.managerValue > best.value) {
      best = { stat: candidate.stat, value: candidate.managerValue, viaManager: true };
    }
  }
  if (best === null) {
    throw new InvalidArgumentError('pickBeatStat', 'candidates', 0, 'at least one stat');
  }
  return best;
}
