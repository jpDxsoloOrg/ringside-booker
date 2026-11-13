/**
 * Big-show fatigue: fans can only afford so many big nights out. A major or flagship show draws
 * less when the promotion has run other big shows in the weeks before it; the first few are free.
 * Smaller shows are never affected. Design: docs/design/box-office.md#big-show-fatigue.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { isBigShow } from '../bigShows';

export const BIG_SHOW_FATIGUE_DOC_REF = 'box-office.md#big-show-fatigue';

export interface BigShowFatigueInputs {
  readonly importance: EventImportance;
  /** The promotion's other big shows in the fatigue window before this one. */
  readonly bigShowsBefore: number;
}

/** The fatigue multiplier on a show's crowd, `floor`..1. Deterministic: no rolls. */
export function computeBigShowFatigue(
  inputs: BigShowFatigueInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Big-show fatigue',
    constantOf('No fatigue', 1, 'A multiplier of 1 leaves the crowd as it is'),
    { unit: 'multiplier', docRef: BIG_SHOW_FATIGUE_DOC_REF },
  );
  if (!isBigShow(inputs.importance)) {
    calc.note('Not a big show');
    return calc.done();
  }
  const windowDays = tunables.get('boxOffice.fatigue.windowDays');
  const label = `Other big shows in the last ${String(windowDays)} days`;
  const extra = startCalc(
    'Big shows beyond the free ones',
    inputOf(label, inputs.bigShowsBefore, undefined, 'count'),
    { unit: 'count' },
  );
  extra.subtract(
    'Free big shows',
    extra.tunable(tunables, 'boxOffice.fatigue.freeShows', 'Free big shows'),
  );
  extra.max('Never below 0', constantOf('None', 0, 'Fewer shows than the free ones cost nothing'));
  extra.multiply(
    'Crowd lost per extra show',
    extra.tunable(tunables, 'boxOffice.fatigue.perExtraShow', 'Crowd lost per extra show'),
  );
  calc.subtract(label, extra.done());
  calc.max('Fatigue floor', calc.tunable(tunables, 'boxOffice.fatigue.floor', 'Fatigue floor'));
  return calc.done();
}
