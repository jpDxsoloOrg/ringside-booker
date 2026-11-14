/**
 * The titles system's balance numbers: where a new title's prestige starts. All in the `Titles`
 * category, documented in docs/design/titles.md. CRTV1-03 adds `titles.orphanGraceDays` with its
 * phase.
 */

import { defineTunables } from '../../core/tunables/define';

export const TITLES_TUNABLE_CATEGORY = 'Titles';

const START_DOC = 'titles.md#starting-prestige';

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
});
