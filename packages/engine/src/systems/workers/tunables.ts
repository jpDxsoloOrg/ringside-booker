/**
 * The workers system's balance numbers.
 *
 * - Weight class limits: each key is the heaviest weight that still counts as that class; anyone
 *   over the heavyweight limit is a super heavyweight. See docs/design/workers.md#weight-class.
 * - Role rating weights, one per role and attribute, generated in `ratingWeights.ts`. See
 *   docs/design/workers.md#role-ratings.
 * - Expected push: who counts as a promotion's fan base and where each card position starts. See
 *   docs/design/workers.md#expected-push.
 */

import { defineTunables } from '../../core/tunables/define';
import { ratingWeightTunables } from './ratingWeights';

const WORKERS_CATEGORY = 'Workers';
const WEIGHT_CLASS_DOC = 'workers.md#weight-class';

/** The lightest and heaviest a person can be (`weightKg` on the person row). */
const WEIGHT_LIMIT_MIN_KG = 40;
const WEIGHT_LIMIT_MAX_KG = 250;

const EXPECTED_PUSH_DOC = 'workers.md#expected-push';

/** The ends of the popularity scale. */
const POPULARITY_MIN = 0;
const POPULARITY_MAX = 100;

/** The range and slider step every card position threshold shares. */
const PUSH_RATIO_MIN = 0;
const PUSH_RATIO_MAX = 3;
const PUSH_RATIO_STEP = 0.05;

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
  'workers.expectedPush.footprintMinPop': {
    kind: 'number',
    default: 10,
    min: POPULARITY_MIN,
    max: POPULARITY_MAX,
    unit: 'points',
    category: WORKERS_CATEGORY,
    description:
      'Lowest popularity a promotion needs in a region for the region to count as part of its fan base',
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.minPromotionPop': {
    kind: 'number',
    default: 5,
    min: POPULARITY_MIN,
    max: POPULARITY_MAX,
    unit: 'points',
    category: WORKERS_CATEGORY,
    description:
      "Lowest promotion popularity a worker's popularity is measured against, so a tiny promotion does not make everyone a main eventer",
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.starPop': {
    kind: 'number',
    default: 75,
    min: POPULARITY_MIN,
    max: POPULARITY_MAX,
    unit: 'points',
    category: WORKERS_CATEGORY,
    description:
      "Popularity among a promotion's fans at which a worker expects the main event whatever the promotion's size; 100 effectively turns the rule off",
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.mainEventRatio': {
    kind: 'number',
    default: 0.85,
    min: PUSH_RATIO_MIN,
    max: PUSH_RATIO_MAX,
    step: PUSH_RATIO_STEP,
    unit: 'ratio',
    category: WORKERS_CATEGORY,
    description: 'Standing against the promotion at which a worker expects the main event',
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.upperCardRatio': {
    kind: 'number',
    default: 0.65,
    min: PUSH_RATIO_MIN,
    max: PUSH_RATIO_MAX,
    step: PUSH_RATIO_STEP,
    unit: 'ratio',
    category: WORKERS_CATEGORY,
    description: 'Standing against the promotion at which a worker expects the upper card',
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.midCardRatio': {
    kind: 'number',
    default: 0.45,
    min: PUSH_RATIO_MIN,
    max: PUSH_RATIO_MAX,
    step: PUSH_RATIO_STEP,
    unit: 'ratio',
    category: WORKERS_CATEGORY,
    description: 'Standing against the promotion at which a worker expects the mid card',
    docRef: EXPECTED_PUSH_DOC,
  },
  'workers.expectedPush.lowerCardRatio': {
    kind: 'number',
    default: 0.25,
    min: PUSH_RATIO_MIN,
    max: PUSH_RATIO_MAX,
    step: PUSH_RATIO_STEP,
    unit: 'ratio',
    category: WORKERS_CATEGORY,
    description:
      'Standing against the promotion at which a worker expects the lower card; anyone below it expects enhancement work',
    docRef: EXPECTED_PUSH_DOC,
  },
  ...ratingWeightTunables(),
});
