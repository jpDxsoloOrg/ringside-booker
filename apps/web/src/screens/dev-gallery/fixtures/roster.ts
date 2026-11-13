import { parseGameDate, parseId } from '@ringside/engine';
import type { Push, PushVerdict, RosterExplanation, RosterRow } from '@ringside/engine';

/**
 * Roster rows as `roster.rows` and `roster.summary.topByPopularity` give them, for the roster's
 * gallery entries and the Office panel's tests. Gallery data only: fictional names, fixed numbers.
 */

const PROMOTION = parseId('promotion', 'pro_0000000001');
const BRAND = parseId('brand', 'brd_0000000001');

interface RowSeed {
  readonly number: number;
  readonly ringName: string;
  readonly push: Exclude<Push, 'none'>;
  readonly expectedPush: Exclude<Push, 'none'>;
  readonly verdict: PushVerdict;
  readonly steps: number;
  readonly popularity: number;
  readonly momentum: number | null;
}

function rosterRow(seed: RowSeed): RosterRow {
  const padded = String(seed.number).padStart(10, '0');
  return {
    employmentId: parseId('employment', `emp_${padded}`),
    personId: parseId('person', `per_${padded}`),
    promotionId: PROMOTION,
    brandId: BRAND,
    brandName: 'Gallery Mainstage',
    group: 'wrestlers',
    role: 'wrestler',
    ringName: seed.ringName,
    imageRef: null,
    gender: seed.number % 2 === 0 ? 'female' : 'male',
    age: 24 + seed.number,
    alignment: seed.number % 3 === 0 ? 'heel' : 'face',
    push: seed.push,
    expectedPush: seed.expectedPush,
    pushGap: { steps: seed.steps, verdict: seed.verdict },
    overall: { value: 80 - seed.number * 3.5, grade: seed.number < 3 ? 'B+' : 'B-' },
    popularity: seed.popularity,
    momentum: { value: seed.momentum, traceRef: null },
    morale: { value: 0, traceRef: null },
    availability: { status: 'available', reason: null, until: null },
    endsOn: parseGameDate('2028-01-31'),
    daysLeft: 400 + seed.number * 30,
  };
}

/** One wrestler who sits a step below what they expect, for the single Set push sheet. */
export const gallerySinglePushRow: RosterRow = rosterRow({
  number: 2,
  ringName: 'Gallery Name Two',
  push: 'upperCard',
  expectedPush: 'mainEvent',
  verdict: 'expectsMore',
  steps: 1,
  popularity: 71.2,
  momentum: -2,
});

/** Five wrestlers, most popular first: the Office panel's rows. The fourth has not appeared yet. */
export const galleryTopOfRoster: readonly RosterRow[] = [
  rosterRow({
    number: 1,
    ringName: 'Gallery Name One',
    push: 'mainEvent',
    expectedPush: 'mainEvent',
    verdict: 'asExpected',
    steps: 0,
    popularity: 78.4,
    momentum: 6,
  }),
  gallerySinglePushRow,
  rosterRow({
    number: 3,
    ringName: 'Gallery Name With A Very Long Ring Name Three',
    push: 'mainEvent',
    expectedPush: 'upperCard',
    verdict: 'aboveExpected',
    steps: -1,
    popularity: 64.9,
    momentum: 3,
  }),
  rosterRow({
    number: 4,
    ringName: 'Gallery Name Four',
    push: 'midCard',
    expectedPush: 'upperCard',
    verdict: 'expectsMore',
    steps: 1,
    popularity: 58,
    momentum: null,
  }),
  rosterRow({
    number: 5,
    ringName: 'Gallery Name Five',
    push: 'midCard',
    expectedPush: 'midCard',
    verdict: 'asExpected',
    steps: 0,
    popularity: 52.6,
    momentum: 1,
  }),
];

/** Three wrestlers on two card positions, for the bulk Set push sheet. */
export const galleryBulkPushRows: readonly RosterRow[] = galleryTopOfRoster.slice(2, 5);

/** What the stand-in engine answers for a popularity Why? in the gallery: one region's share. */
export function galleryPopularityExplanation(row: RosterRow): RosterExplanation {
  return {
    employmentId: row.employmentId,
    metric: 'popularity',
    label: 'Popularity',
    value: row.popularity,
    unit: null,
    trace: {
      kind: 'formula',
      label: `${row.ringName} popularity with Gallery Promotion's fans`,
      value: row.popularity,
      children: [
        { kind: 'input', label: 'Popularity in Gallery Region', value: row.popularity },
        { kind: 'input', label: "Gallery Region's share of the fans", value: '100%' },
      ],
    },
  };
}
