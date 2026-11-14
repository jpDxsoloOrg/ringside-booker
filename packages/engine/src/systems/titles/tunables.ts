/**
 * The titles system's balance numbers: where a new title's prestige starts, and how long a champion
 * may be gone before the title is vacated (CRTV1-03). All in the `Titles` category, documented in
 * docs/design/titles.md.
 */

import { defineTunables } from '../../core/tunables/define';

export const TITLES_TUNABLE_CATEGORY = 'Titles';

const START_DOC = 'titles.md#starting-prestige';
const ORPHAN_DOC = 'titles.md#orphaned-champions';

/** A 0..100 starting prestige for one tier. */
function tierBase(defaultValue: number, description: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: 0,
    max: 100,
    unit: 'points',
    category: TITLES_TUNABLE_CATEGORY,
    description,
    docRef: START_DOC,
  } as const;
}

export const titlesTunables = defineTunables({
  'titles.startPrestige.world': tierBase(55, 'Starting prestige of a new World title'),
  'titles.startPrestige.secondary': tierBase(35, 'Starting prestige of a new Secondary title'),
  'titles.startPrestige.specialty': tierBase(20, 'Starting prestige of a new Specialty title'),
  'titles.startPrestige.promotionAnchor': tierBase(
    50,
    'Promotion prestige at which a new title gets no adjustment',
  ),
  'titles.startPrestige.promotionWeight': {
    kind: 'number',
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: TITLES_TUNABLE_CATEGORY,
    description:
      "Share of the promotion's prestige above or below the anchor a new title starts with; 0 turns it off",
    docRef: START_DOC,
  },
  'titles.orphanGraceDays': {
    kind: 'integer',
    default: 7,
    min: 0,
    max: 365,
    unit: 'days',
    category: TITLES_TUNABLE_CATEGORY,
    description:
      "Days a champion may be without a contract with the title's promotion (or its parent) before the title is vacated. 0 vacates on the first day.",
    docRef: ORPHAN_DOC,
  },
});
