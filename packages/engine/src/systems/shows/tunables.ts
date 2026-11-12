/**
 * The shows system's balance numbers: how a show's segments add up to its score, how a show scored
 * off-screen is scored, how title matches settle and how a show score turns into stars.
 *
 * Declared up front by EVT3-01 so EVT3-02..04 only add code. EVT3 never writes morale, momentum or
 * popularity, so nothing here tunes them. See docs/design/show-night.md.
 */

import { defineTunables } from '../../core/tunables/define';

const SHOWS_CATEGORY = 'Shows';
const SHOW_SCORE_DOC = 'show-night.md#show-score';
const OFFSCREEN_DOC = 'show-night.md#off-screen-score';
const TITLES_DOC = 'show-night.md#title-outcomes';

/** The off-screen score's points for one show importance. */
function importancePoints(defaultPoints: number, description: string) {
  return {
    kind: 'number',
    default: defaultPoints,
    min: -30,
    max: 30,
    step: 0.5,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description,
    docRef: OFFSCREEN_DOC,
  } as const;
}

export const showsTunables = defineTunables({
  'shows.score.preShowFactor': {
    kind: 'number',
    default: 0,
    min: 0,
    max: 2,
    step: 0.05,
    unit: 'multiplier',
    category: SHOWS_CATEGORY,
    description: 'How much pre-show segments count toward the show score (0 = not at all)',
    docRef: SHOW_SCORE_DOC,
  },
  'shows.emptySlotPenalty': {
    kind: 'number',
    default: 5,
    min: 0,
    max: 50,
    step: 0.5,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description: 'Show score lost for each empty main-card slot',
    docRef: SHOW_SCORE_DOC,
  },
  'shows.offscreen.base': {
    kind: 'number',
    default: 12,
    min: 0,
    max: 100,
    step: 1,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description: 'Starting score of a show run off-screen, before prestige and popularity',
    docRef: OFFSCREEN_DOC,
  },
  'shows.offscreen.prestigeWeight': {
    kind: 'number',
    default: 0.3,
    min: 0,
    max: 2,
    step: 0.01,
    unit: 'multiplier',
    category: SHOWS_CATEGORY,
    description: "Points an off-screen show gains per point of its promotion's prestige",
    docRef: OFFSCREEN_DOC,
  },
  'shows.offscreen.popularityWeight': {
    kind: 'number',
    default: 0.35,
    min: 0,
    max: 2,
    step: 0.01,
    unit: 'multiplier',
    category: SHOWS_CATEGORY,
    description: "Points an off-screen show gains per point of its roster's popularity",
    docRef: OFFSCREEN_DOC,
  },
  'shows.offscreen.importance.house': importancePoints(
    -6,
    'Points an off-screen house show gains or loses for its size',
  ),
  'shows.offscreen.importance.minor': importancePoints(
    -3,
    'Points an off-screen minor show gains or loses for its size',
  ),
  'shows.offscreen.importance.regular': importancePoints(
    0,
    'Points an off-screen regular show gains or loses for its size',
  ),
  'shows.offscreen.importance.major': importancePoints(
    4,
    'Points an off-screen major show gains or loses for its size',
  ),
  'shows.offscreen.importance.flagship': importancePoints(
    8,
    'Points an off-screen flagship show gains or loses for its size',
  ),
  'shows.offscreen.spread': {
    kind: 'number',
    default: 8,
    min: 0,
    max: 50,
    step: 0.5,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description: 'Largest random swing either way (0 = no randomness)',
    docRef: OFFSCREEN_DOC,
  },
  'shows.titles.drawCountsAsDefence': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: SHOWS_CATEGORY,
    description: 'A drawn title match counts as a successful defence',
    docRef: TITLES_DOC,
  },
  'shows.stars.zeroAt': {
    kind: 'number',
    default: 35,
    min: 0,
    max: 80,
    step: 1,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description: 'Show score that earns zero stars',
    docRef: SHOW_SCORE_DOC,
  },
  'shows.stars.pointsPerStar': {
    kind: 'number',
    default: 12,
    min: 0,
    max: 30,
    step: 0.5,
    unit: 'points',
    category: SHOWS_CATEGORY,
    description: 'Show score points per star (0 = any score above zero-stars earns 5)',
    docRef: SHOW_SCORE_DOC,
  },
});
