/**
 * The office system's balance numbers: how much promotion history is kept at full detail and how
 * the Office compares and charts it, and which roll-up is the promotion's headline popularity
 * (DAY2-02), and how many low-morale people the average morale's Why? names (DAY2-03).
 *
 * See docs/design/office.md#history and #headline-popularity.
 */

import { defineTunables } from '../../core/tunables/define';

const OFFICE_CATEGORY = 'Office';
const OFFICE_DOC = 'office.md#history';
const HEADLINE_DOC = 'office.md#headline-popularity';
const KPI_DOC = 'office.md#kpis-and-deltas';

/**
 * The D-03 roll-up levels the Office and the top bar can lead with as "the promotion's popularity":
 * the home region's stored value, or the home country's, home continent's or world's roll-up.
 */
export const HEADLINE_SCOPES = ['homeRegion', 'homeCountry', 'homeContinent', 'world'] as const;
export type HeadlineScope = (typeof HEADLINE_SCOPES)[number];

export const officeTunables = defineTunables({
  'office.history.fullDetailWeeks': {
    kind: 'integer',
    default: 52,
    min: 4,
    max: 520,
    unit: 'count',
    category: OFFICE_CATEGORY,
    description: 'Weeks kept at full weekly detail before older weeks are thinned to one per month',
    docRef: OFFICE_DOC,
  },
  'office.trend.weeks': {
    kind: 'integer',
    default: 8,
    min: 2,
    max: 52,
    unit: 'count',
    category: OFFICE_CATEGORY,
    description: 'Weeks shown in a KPI sparkline',
    docRef: OFFICE_DOC,
  },
  'office.delta.lookbackDays': {
    kind: 'integer',
    default: 7,
    min: 1,
    max: 90,
    unit: 'days',
    category: OFFICE_CATEGORY,
    description: 'How far back a KPI delta compares',
    docRef: OFFICE_DOC,
  },
  'office.popularity.headlineScope': {
    kind: 'enum',
    default: 'homeCountry',
    options: HEADLINE_SCOPES,
    unit: 'choice',
    category: OFFICE_CATEGORY,
    description: "Which D-03 roll-up the Office and the top bar show as the promotion's popularity",
    docRef: HEADLINE_DOC,
  },
  'office.morale.namedInWhy': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 10,
    unit: 'count',
    category: OFFICE_CATEGORY,
    description: "Lowest-morale people named in the average morale's Why?",
    docRef: KPI_DOC,
  },
});
