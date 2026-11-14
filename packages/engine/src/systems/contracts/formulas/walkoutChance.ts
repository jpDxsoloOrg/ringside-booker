/**
 * `walkoutChance`: the daily chance that a worker whose release request was refused walks out.
 *
 * An iron-clad contract never walks out, and nor does a worker in a hot storyline (D-09). Anyone
 * else walks out with `contracts.walkout.chancePerDay`, plus `contracts.walkout.extraPerPoint` for
 * every morale point below `contracts.quit.threshold`, capped at `contracts.walkout.maxPerDay`.
 *
 * Design: docs/design/contracts.md#walk-outs.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { hotStorylineText } from '../storyPause';

export const WALKOUTS_DOC_REF = 'contracts.md#walk-outs';

export interface WalkoutChanceInputs {
  /** The worker's morale today, −100 to 100. */
  readonly morale: number;
  /** `contracts.quit.threshold`. */
  readonly threshold: number;
  readonly ironClad: boolean;
  /** The hot storyline that shields them (`hotStorylineFor`), or null. */
  readonly hotStoryline: { readonly name: string; readonly heat: number } | null;
}

export interface WalkoutChanceDeps {
  readonly tunables: EngineTunables;
}

/** The branch text of an iron-clad contract. */
export const IRON_CLAD_NEVER_WALKS = 'Iron-clad contract: never walks out';

/** The daily walk-out chance, 0 to 1, with its Why?. */
export function walkoutChance(
  inputs: WalkoutChanceInputs,
  deps: WalkoutChanceDeps,
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Walk-out chance', 0, {
    unit: 'probability',
    docRef: WALKOUTS_DOC_REF,
    startLabel: 'No chance yet',
  });
  calc.branch(IRON_CLAD_NEVER_WALKS, inputs.ironClad);
  if (inputs.ironClad) {
    return calc.done();
  }
  const hot = inputs.hotStoryline;
  calc.branch(
    hot === null ? 'Not in a hot storyline' : `${hotStorylineText(hot)}: won't walk out (D-09)`,
    hot !== null,
  );
  if (hot !== null) {
    return calc.done();
  }
  calc.add('Daily chance', calc.tunable(tunables, 'contracts.walkout.chancePerDay'));
  const below = Math.max(0, inputs.threshold - inputs.morale);
  const perPoint = calc.tunable(tunables, 'contracts.walkout.extraPerPoint');
  calc.add(`${String(below)} morale points below the threshold`, below * perPoint);
  calc.min('Daily cap', calc.tunable(tunables, 'contracts.walkout.maxPerDay'));
  calc.clamp(0, 1);
  return calc.done();
}
