/**
 * The workers system's balance numbers: where one weight class ends and the next begins.
 *
 * Each key is the heaviest weight that still counts as that class; anyone over the heavyweight
 * limit is a super heavyweight. See docs/design/workers.md#weight-class.
 */

import { defineTunables } from '../../core/tunables/define';

const WORKERS_CATEGORY = 'Workers';
const WEIGHT_CLASS_DOC = 'workers.md#weight-class';

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
});
