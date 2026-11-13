/**
 * Card value tunables (AIP1-04): which regions count as a promotion's markets, how popularity and
 * ability are balanced, and how momentum and age move a worker's worth. Spread into
 * `aipTunables`. Design: docs/design/rival-desk.md#card-value.
 */

import { defineTunables } from '../../core/tunables/define';

const CATEGORY = 'Rival desk';
export const CARD_VALUE_DOC_REF = 'rival-desk.md#card-value';

const WEIGHT_RANGE = { kind: 'number', min: 0, max: 5, step: 0.1, unit: 'ratio' } as const;

export const cardValueTunables = defineTunables({
  'aip.cardValue.marketMinPop': {
    kind: 'number',
    default: 10,
    min: 0,
    max: 100,
    unit: 'points',
    category: CATEGORY,
    description:
      'Popularity a promotion needs in a region for the region to count as one of its markets',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.popularityWeight': {
    ...WEIGHT_RANGE,
    default: 1,
    category: CATEGORY,
    description:
      "How much a worker's popularity in the promotion's markets counts toward card value",
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.abilityWeight': {
    ...WEIGHT_RANGE,
    default: 1,
    category: CATEGORY,
    description:
      "How much a worker's ability, blended by the promotion's taste, counts toward card value",
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.momentumFactor': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: CATEGORY,
    description: 'Card value added per point of momentum; 0 leaves momentum out',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.declineAge': {
    kind: 'number',
    default: 36,
    min: 18,
    max: 60,
    unit: 'years',
    category: CATEGORY,
    description: 'Age after which card value starts to fall',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.declinePerYear': {
    kind: 'number',
    default: 0.04,
    min: 0,
    max: 0.2,
    unit: 'ratio',
    category: CATEGORY,
    description:
      'Share of card value lost for each year past the decline age; 0 turns the decline off',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.ageFloor': {
    kind: 'number',
    default: 0.5,
    min: 0,
    max: 1,
    unit: 'multiplier',
    category: CATEGORY,
    description: 'The least of their card value age can leave a veteran',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.youthAge': {
    kind: 'number',
    default: 26,
    min: 16,
    max: 40,
    unit: 'years',
    category: CATEGORY,
    description: 'Workers younger than this get the youth bonus',
    docRef: CARD_VALUE_DOC_REF,
  },
  'aip.cardValue.youthBonus': {
    kind: 'number',
    default: 6,
    min: 0,
    max: 20,
    unit: 'points',
    category: CATEGORY,
    description:
      'Card value a young worker gains at a promotion whose youth focus is 100; 0 turns it off',
    docRef: CARD_VALUE_DOC_REF,
  },
});
