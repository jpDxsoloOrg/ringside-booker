/**
 * Recent form: good recent shows bring more people back, poor ones fewer.
 *
 * The average score of the promotion's recent shows is compared with a fixed par, not with its
 * popularity: the show score is already judged against what the crowd expected (D-02), so
 * comparing with popularity would punish a popular company twice. A promotion with too few recent
 * shows gets no swing either way. Design: docs/design/box-office.md#recent-form.
 */

import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const RECENT_FORM_DOC_REF = 'box-office.md#recent-form';

export interface RecentFormMultiplierInputs {
  /** The average score of the counted recent shows, or null when none counted. */
  readonly averageScore: number | null;
  readonly showCount: number;
}

const NO_CHANGE_REASON = 'A multiplier of 1 leaves the crowd as it is';

/** The recent-form multiplier on the crowd, 1 ± `maxSwing`. Deterministic: no rolls. */
export function computeRecentFormMultiplier(
  inputs: RecentFormMultiplierInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Recent form', constantOf('No change', 1, NO_CHANGE_REASON), {
    unit: 'multiplier',
    docRef: RECENT_FORM_DOC_REF,
  });
  const minShows = tunables.get('boxOffice.recentForm.minShows');
  const tooFew = inputs.showCount < minShows || inputs.averageScore === null;
  calc.branch(`Fewer than ${String(minShows)} recent shows`, tooFew);
  if (tooFew) {
    calc.note(
      `Not enough recent shows (${String(inputs.showCount)} of ${String(Math.max(minShows, 1))})`,
    );
    return calc.done();
  }
  const swing = startCalc(
    'Swing from recent shows',
    inputOf('Average score of recent shows', inputs.averageScore, undefined, 'points'),
    { unit: 'ratio' },
  );
  swing.subtract('Par score', swing.tunable(tunables, 'boxOffice.recentForm.par', 'Par score'));
  swing.divide(
    'Points above par for the full swing',
    swing.tunable(tunables, 'boxOffice.recentForm.fullSwingPoints', 'Full swing'),
  );
  swing.clamp(-1, 1, 'No more than the full swing either way');
  swing.multiply(
    'Largest swing',
    swing.tunable(tunables, 'boxOffice.recentForm.maxSwing', 'Largest swing'),
  );
  calc.add(
    `${String(inputs.showCount)} recent shows averaging ${formatNumber(inputs.averageScore)}`,
    swing.done(),
  );
  return calc.done();
}
