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
  'storylines.heat.startBase': {
    kind: 'number',
    default: 25,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description: 'Heat every new storyline starts from',
    docRef: 'storylines.md#starting-heat',
  },
  'storylines.heat.startStarWeight': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: CATEGORY,
    description:
      "Share of the two best-known members' average home popularity added to starting heat. 0 turns star power off",
    docRef: 'storylines.md#starting-heat',
  },
  'storylines.heat.startMax': {
    kind: 'number',
    default: 60,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description: 'Highest starting heat',
    docRef: 'storylines.md#starting-heat',
  },
  'storylines.heat.decayGraceDays': {
    kind: 'integer',
    default: 7,
    min: 0,
    max: 90,
    unit: 'days',
    category: CATEGORY,
    description: 'Days without progress before heat starts cooling',
    docRef: 'storylines.md#heat-decay',
  },
  'storylines.heat.decayPerDay': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'points/day',
    category: CATEGORY,
    description: 'Heat lost each day after the grace period. 0 means heat never cools',
    docRef: 'storylines.md#heat-decay',
  },
  'storylines.heat.decayFloor': {
    kind: 'number',
    default: 10,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description: 'Cooling never takes heat below this',
    docRef: 'storylines.md#heat-decay',
  },
  'storylines.starterPerPromotion': {
    kind: 'integer',
    default: 2,
    min: 0,
    max: 6,
    unit: 'count',
    category: CATEGORY,
    description: 'Starter storylines each promotion gets at new game. 0 creates none',
    docRef: 'storylines.md#starters',
  },
  'storylines.link.maxPerSegment': {
    kind: 'integer',
    default: 2,
    min: 1,
    max: 12,
    unit: 'count',
    category: CATEGORY,
    description: 'The most storylines one segment can be linked to and count for',
    docRef: 'storylines.md#linking',
  },
});
