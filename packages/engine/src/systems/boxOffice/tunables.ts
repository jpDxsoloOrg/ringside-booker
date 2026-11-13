/**
 * The box office system's balance numbers: how big a crowd a show is expected to draw (EVT6-01).
 *
 * Every one is 0-means-0: a multiplier at 0 empties the building. Design:
 * docs/design/box-office.md#forecast.
 */

import { defineTunables } from '../../core/tunables/define';
import { venueTunables } from './venueTunables';

const BOX_OFFICE_CATEGORY = 'Box office';
const FORECAST_DOC = 'box-office.md#forecast';
const RECENT_FORM_DOC = 'box-office.md#recent-form';
const FATIGUE_DOC = 'box-office.md#big-show-fatigue';

const IMPORTANCE_RANGE = {
  kind: 'number',
  min: 0,
  max: 5,
  step: 0.05,
  unit: 'multiplier',
  category: BOX_OFFICE_CATEGORY,
  docRef: FORECAST_DOC,
} as const;

export const boxOfficeTunables = defineTunables({
  'boxOffice.draw.atFullPopularity': {
    kind: 'integer',
    default: 30000,
    min: 0,
    max: 200000,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd a show draws at popularity 100, before the other lines',
    docRef: FORECAST_DOC,
  },
  'boxOffice.draw.curve': {
    kind: 'number',
    default: 3,
    min: 1,
    max: 6,
    step: 0.1,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'How sharply crowds grow with popularity; higher means small companies draw less',
    docRef: FORECAST_DOC,
  },
  'boxOffice.draw.walkUp': {
    kind: 'integer',
    default: 80,
    min: 0,
    max: 5000,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'People who turn up to any show, however unknown the company',
    docRef: FORECAST_DOC,
  },
  'boxOffice.marketing.perLevel': {
    kind: 'number',
    default: 0.04,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd added per marketing level (×(1 + level × this))',
    docRef: FORECAST_DOC,
  },
  'boxOffice.importance.house': {
    ...IMPORTANCE_RANGE,
    default: 0.35,
    description: 'Crowd × this for a house show',
  },
  'boxOffice.importance.minor': {
    ...IMPORTANCE_RANGE,
    default: 0.7,
    description: 'Crowd × this for a minor show',
  },
  'boxOffice.importance.regular': {
    ...IMPORTANCE_RANGE,
    default: 1,
    description: 'Crowd × this for a regular show',
  },
  'boxOffice.importance.major': {
    ...IMPORTANCE_RANGE,
    default: 1.5,
    description: 'Crowd × this for a major show',
  },
  'boxOffice.importance.flagship': {
    ...IMPORTANCE_RANGE,
    default: 2.2,
    description: 'Crowd × this for a flagship show',
  },
  'boxOffice.recentForm.windowDays': {
    kind: 'integer',
    default: 120,
    min: 0,
    max: 730,
    unit: 'days',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far back recent form looks for completed shows',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.minShows': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 20,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Recent shows needed before recent form moves the crowd',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.par': {
    kind: 'number',
    default: 50,
    min: 0,
    max: 100,
    unit: 'points',
    category: BOX_OFFICE_CATEGORY,
    description: 'A show score that neither helps nor hurts the draw',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.fullSwingPoints': {
    kind: 'number',
    default: 25,
    min: 1,
    max: 100,
    unit: 'points',
    category: BOX_OFFICE_CATEGORY,
    description: 'Average score above or below par that gives the full swing',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.maxSwing': {
    kind: 'number',
    default: 0.15,
    min: 0,
    max: 0.5,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Most recent form can add to or take from the crowd (0 = recent form off)',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.countHouseShows': {
    kind: 'boolean',
    default: false,
    unit: 'flag',
    category: BOX_OFFICE_CATEGORY,
    description: 'Count house shows in recent form',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.fatigue.windowDays': {
    kind: 'integer',
    default: 28,
    min: 0,
    max: 365,
    unit: 'days',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far back big-show fatigue looks for other big shows',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.freeShows': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Other big shows in the window that cost nothing',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.perExtraShow': {
    kind: 'number',
    default: 0.2,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd lost for each other big show beyond the free ones (0 = no fatigue)',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.floor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'The least of the crowd fatigue can leave',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.crowd.spread': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description:
      'How far the real crowd can land from the forecast, either way; also the width of the forecast range',
    docRef: FORECAST_DOC,
  },
  ...venueTunables,
});
