/**
 * Big world speed's knobs (POL4-13): which rival shows count as distant, so the Fast setting
 * simulates them lightly. They change nothing in Full detail. Design:
 * docs/design/show-night.md#big-world-speed.
 */

import { defineTunables } from '../../core/tunables/define';

const CATEGORY = 'Big world speed';
const DOC_REF = 'show-night.md#big-world-speed';

export const bigWorldTunables = defineTunables({
  'bigWorld.regionPopularity': {
    kind: 'number',
    default: 30,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description:
      "Popularity from which a region counts as one of a promotion's regions when Fast looks for shows near yours",
    docRef: DOC_REF,
  },
  'bigWorld.fullDetailReach': {
    kind: 'number',
    default: 40,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: CATEGORY,
    description: 'Rival promotions with at least this much reach always run in full detail',
    docRef: DOC_REF,
  },
});
