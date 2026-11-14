/**
 * The storylines system's read-side numbers (CRTV3-01): when a storyline shows as Hot, how many
 * active storylines a promotion runs before creating another warns, and how many linked segments a
 * storyline needs before ending it can pay off.
 *
 * Every number here is 0-means-0: setting one to 0 removes exactly the effect its description names.
 * Design: docs/design/storylines.md.
 */

import { defineTunables } from '../../core/tunables/define';

const CATEGORY = 'Storylines';

export const storylinesTunables = defineTunables({
  'storylines.heat.hotFrom': {
    kind: 'number',
    default: 70,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description: 'Heat at which a storyline shows as Hot on the meter (display only)',
    docRef: 'storylines.md#hot-storylines',
  },
  'storylines.activeSoftLimit': {
    kind: 'integer',
    default: 6,
    min: 0,
    max: 30,
    unit: 'count',
    category: CATEGORY,
    description:
      'Active storylines per promotion before creating another shows a warning. 0 never warns',
    docRef: 'storylines.md#commands',
  },
  'storylines.payoff.minSegments': {
    kind: 'integer',
    default: 4,
    min: 0,
    max: 30,
    unit: 'count',
    category: CATEGORY,
    description:
      'Linked segments a storyline needs before ending it can pay off. 0 means any storyline can pay off',
    docRef: 'storylines.md#payoff-threshold',
  },
});
