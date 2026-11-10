/**
 * The workers system's balance numbers.
 *
 * Weight classes: each key is the heaviest weight that still counts as that class; anyone over the
 * heavyweight limit is a super heavyweight. See docs/design/workers.md#weight-class.
 *
 * Doors: how popularity gains slow down above a person's anchor, when a tiny stored value is
 * dropped, and where momentum starts. See docs/design/workers.md#doors.
 */

import { defineTunables } from '../../core/tunables/define';

const WORKERS_CATEGORY = 'Workers';
const WEIGHT_CLASS_DOC = 'workers.md#weight-class';
const POPULARITY_DOC = 'workers.md#popularity-door';
const MOMENTUM_DOC = 'workers.md#momentum-door';

/** The lightest and heaviest a person can be (`weightKg` on the person row). */
const WEIGHT_LIMIT_MIN_KG = 40;
const WEIGHT_LIMIT_MAX_KG = 250;

export const workersTunables = defineTunables({
  'workers.weightClass.lightweightMaxKg': {
    kind: 'integer',
    default: 70,
    min: WEIGHT_LIMIT_MIN_KG,
    max: WEIGHT_LIMIT_MAX_KG,
    unit: 'kilograms',
    category: WORKERS_CATEGORY,
    description: 'Heaviest weight that still counts as a lightweight',
    docRef: WEIGHT_CLASS_DOC,
  },
  'workers.weightClass.cruiserweightMaxKg': {
    kind: 'integer',
    default: 93,
    min: WEIGHT_LIMIT_MIN_KG,
    max: WEIGHT_LIMIT_MAX_KG,
    unit: 'kilograms',
    category: WORKERS_CATEGORY,
    description: 'Heaviest weight that still counts as a cruiserweight',
    docRef: WEIGHT_CLASS_DOC,
  },
  'workers.weightClass.lightHeavyweightMaxKg': {
    kind: 'integer',
    default: 105,
    min: WEIGHT_LIMIT_MIN_KG,
    max: WEIGHT_LIMIT_MAX_KG,
    unit: 'kilograms',
    category: WORKERS_CATEGORY,
    description: 'Heaviest weight that still counts as a light heavyweight',
    docRef: WEIGHT_CLASS_DOC,
  },
  'workers.weightClass.heavyweightMaxKg': {
    kind: 'integer',
    default: 130,
    min: WEIGHT_LIMIT_MIN_KG,
    max: WEIGHT_LIMIT_MAX_KG,
    unit: 'kilograms',
    category: WORKERS_CATEGORY,
    description:
      'Heaviest weight that still counts as a heavyweight; anyone over it is a super heavyweight',
    docRef: WEIGHT_CLASS_DOC,
  },
  'workers.popularity.anchorFromCharisma': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: WORKERS_CATEGORY,
    description:
      "How much of a person's charisma sets their popularity anchor; 0 puts every anchor at 0",
    docRef: POPULARITY_DOC,
  },
  'workers.popularity.taperSpan': {
    kind: 'number',
    default: 40,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: WORKERS_CATEGORY,
    description:
      'Points above the anchor over which a popularity gain shrinks to nothing; 0 applies the taper floor straight away',
    docRef: POPULARITY_DOC,
  },
  'workers.popularity.taperFloor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: WORKERS_CATEGORY,
    description:
      'Smallest share of a popularity gain that still lands above the anchor; 0 lets gains stop completely',
    docRef: POPULARITY_DOC,
  },
  'workers.popularity.dropBelow': {
    kind: 'number',
    default: 0,
    min: 0,
    max: 10,
    step: 0.1,
    unit: 'points',
    category: WORKERS_CATEGORY,
    description:
      'A regional popularity that a change leaves below this is removed; 0 removes only exact zeros',
    docRef: POPULARITY_DOC,
  },
  'workers.momentum.initialPopFactor': {
    kind: 'number',
    default: 1,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: WORKERS_CATEGORY,
    description:
      'Share of home-region popularity a first appearance starts momentum from; 0 starts everyone at 0',
    docRef: MOMENTUM_DOC,
  },
});
