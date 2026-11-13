/**
 * The office system's balance numbers: how much promotion history is kept at full detail and how
 * the Office compares and charts it. DAY2-02 and DAY2-03 add their own keys here.
 *
 * See docs/design/office.md#history.
 */

import { defineTunables } from '../../core/tunables/define';

const OFFICE_CATEGORY = 'Office';
const OFFICE_DOC = 'office.md#history';

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
});
