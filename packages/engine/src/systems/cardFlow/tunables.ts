/**
 * The card flow system's production numbers (EVT4-02): the production ceiling a show's score is
 * held to, and the bonus main-card slot a big enough production budget unlocks.
 *
 * Only stage, camera, editing and pyro enter the ceiling. Music, writing, marketing and back
 * office get other jobs from ECO7. See docs/design/card-flow.md#production-ceiling and
 * docs/design/card-flow.md#bonus-slot.
 */

import { defineTunables } from '../../core/tunables/define';
import { EVENT_IMPORTANCES } from '../../model/entities/event-definition';

const PRODUCTION_CATEGORY = 'Production';
const CEILING_DOC = 'card-flow.md#production-ceiling';
const BONUS_SLOT_DOC = 'card-flow.md#bonus-slot';

/** Points of ceiling one level of a production area adds. */
function ceilingWeight(defaultPoints: number, area: string) {
  return {
    kind: 'number',
    default: defaultPoints,
    min: 0,
    max: 10,
    step: 0.5,
    unit: 'points',
    category: PRODUCTION_CATEGORY,
    description: `Ceiling points each level of ${area} adds`,
    docRef: CEILING_DOC,
  } as const;
}

export const cardFlowTunables = defineTunables({
  'production.ceilingBase': {
    kind: 'number',
    default: 40,
    min: 0,
    max: 100,
    step: 0.5,
    unit: 'points',
    category: PRODUCTION_CATEGORY,
    description: 'Ceiling with every area at level 0',
    docRef: CEILING_DOC,
  },
  'production.ceilingWeight.stage': ceilingWeight(1.5, 'stage'),
  'production.ceilingWeight.camera': ceilingWeight(2, 'camera'),
  'production.ceilingWeight.editing': ceilingWeight(1.5, 'editing'),
  'production.ceilingWeight.pyro': ceilingWeight(1, 'pyro'),
  'production.bonusSlotThreshold': {
    kind: 'number',
    default: 90,
    min: 0,
    max: 100,
    step: 0.5,
    unit: 'points',
    category: PRODUCTION_CATEGORY,
    description: 'Production ceiling a promotion needs for its shows to get one extra main slot',
    docRef: BONUS_SLOT_DOC,
  },
  'production.bonusSlotMinImportance': {
    kind: 'enum',
    default: 'regular',
    options: EVENT_IMPORTANCES,
    unit: 'choice',
    category: PRODUCTION_CATEGORY,
    description: 'The smallest show that can get the extra main slot',
    docRef: BONUS_SLOT_DOC,
  },
});
