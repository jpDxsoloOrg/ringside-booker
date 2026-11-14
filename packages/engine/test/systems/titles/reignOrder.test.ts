// The order reigns happened in when they started on the same day (CRTV1-07). Reign IDs are random
// in a real game, so the ID must not decide it: the owner's flow (award, award again, vacate, all
// on one day) numbered the reigns backwards when the second reign's ID sorted first.
// Design: docs/design/titles.md#lineage-order
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import {
  compareReignsChronologically,
  type OrderedReign,
} from '../../../src/systems/titles/helpers/reignOrder';
import { testId } from '../../support/ids';
import { START } from './titles-world';

const DAY = addDays(START, 10);

/** IDs that sort the opposite way to the order the reigns happened in. */
function reign(serial: number, overrides: Partial<OrderedReign>): OrderedReign {
  return {
    id: testId('titleReign', serial),
    wonOn: DAY,
    lostOn: DAY,
    endReason: null,
    ...overrides,
  };
}

function order(reigns: readonly OrderedReign[]): number[] {
  return [...reigns].sort(compareReignsChronologically).map((row) => Number(row.id.slice(-2)));
}

describe('compareReignsChronologically', () => {
  it('puts the earlier wonOn first, whatever the IDs', () => {
    expect(order([reign(1, { wonOn: addDays(DAY, 1) }), reign(2, {})])).toEqual([2, 1]);
  });

  it('puts the reign still going after a same-day reign that ended', () => {
    expect(order([reign(1, { lostOn: null }), reign(2, { endReason: 'stripped' })])).toEqual([
      2, 1,
    ]);
  });

  it('puts the reign that ended later after one that ended on the day it started', () => {
    expect(
      order([
        reign(1, { lostOn: addDays(DAY, 3), endReason: 'lost' }),
        reign(2, { endReason: 'lost' }),
      ]),
    ).toEqual([2, 1]);
  });

  it('puts a hand-over before a vacancy when both ended on the day they started', () => {
    // Award to A, award to B (A stripped), vacate B: A came first.
    expect(
      order([reign(1, { endReason: 'vacated' }), reign(2, { endReason: 'stripped' })]),
    ).toEqual([2, 1]);
    expect(order([reign(1, { endReason: 'retired' }), reign(2, { endReason: 'lost' })])).toEqual([
      2, 1,
    ]);
  });

  it('falls back to the ID only when nothing else tells them apart', () => {
    expect(
      order([reign(2, { endReason: 'stripped' }), reign(1, { endReason: 'stripped' })]),
    ).toEqual([1, 2]);
  });
});
