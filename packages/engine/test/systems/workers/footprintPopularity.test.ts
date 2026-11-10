// Popularity among a promotion's fans. Design: docs/design/workers.md#expected-push
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  fanBaseOf,
  footprintPopularity,
  footprintPopularityValue,
  NO_FANS_NOTE,
  type FootprintPopularityInputs,
} from '../../../src/systems/workers';
import { testId } from '../../support/ids';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';
import { popEverywhere, testRegions } from './push-fixtures';

const PROMOTION = 'Test Promotion A';
const regions = testRegions(3);
const first = testId('region', 1);
const second = testId('region', 2);
const third = testId('region', 3);

function footprintOf(
  inputs: Omit<FootprintPopularityInputs, 'promotionName'>,
  overrides: TunableOverrides = {},
) {
  const deps = { tunables: createEngineTunables(overrides) };
  const full = { ...inputs, promotionName: PROMOTION };
  const result = footprintPopularity(full, deps);
  expectTraceReplays(result);
  // The plain twin must give the very same number.
  expect(footprintPopularityValue(full, deps)).toBe(result.value);
  return result;
}

describe('fanBaseOf', () => {
  it('keeps the regions at or above the minimum, heaviest first', () => {
    const fanBase = fanBaseOf({ [first]: 9.9, [second]: 10, [third]: 60 }, regions, 10);
    expect(fanBase.widened).toBe(false);
    expect(fanBase.members.map((member) => member.region.id)).toEqual([third, second]);
    // 800,000 people × 60 ÷ 100
    expect(fanBase.members[0]?.weight).toBe(480_000);
  });

  it('falls back to every region with any popularity when none reach the minimum', () => {
    const fanBase = fanBaseOf({ [first]: 4, [third]: 9 }, regions, 10);
    expect(fanBase.widened).toBe(true);
    expect(fanBase.members.map((member) => member.region.id)).toEqual([third, first]);
  });

  it('is empty for a promotion nobody knows', () => {
    expect(fanBaseOf({}, regions, 10).members).toEqual([]);
  });

  it('leaves out a region nobody lives in', () => {
    const empty = [{ id: testId('region', 9), name: 'Test Region 009', population: 0 }];
    expect(fanBaseOf({ [testId('region', 9)]: 80 }, empty, 10).members).toEqual([]);
  });

  it('breaks a tie in weight by region ID', () => {
    const twins = [
      { id: second, name: 'Test Region 002', population: 500_000 },
      { id: first, name: 'Test Region 001', population: 500_000 },
    ];
    const fanBase = fanBaseOf({ [first]: 50, [second]: 50 }, twins, 10);
    expect(fanBase.members.map((member) => member.region.id)).toEqual([first, second]);
  });
});

describe('footprintPopularity', () => {
  it('is the mean of the subject over the fan base, weighted by fans', () => {
    // Fans: 1,000,000 × 50% = 500,000 and 900,000 × 20% = 180,000. The third region is not in
    // the fan base, so being a star there counts for nothing.
    const result = footprintOf({
      subjectPop: { [first]: 30, [second]: 80, [third]: 100 },
      promotionPop: { [first]: 50, [second]: 20 },
      regions,
    });
    expect(result.value).toBeCloseTo((500_000 * 30 + 180_000 * 80) / 680_000, 10);
    const formula = expectTraceContains(result, { kind: 'formula' });
    expect(formula.label).toBe(`Popularity where ${PROMOTION} draws`);
    expect(formula.unit).toBe('points');
    expect(formula.docRef).toBe('workers.md#expected-push');
    expect(findTraceNodes(result.trace, 'add').map((node) => node.label)).toEqual([
      'Test Region 001: popularity 30 × 500 thousand fans',
      'Test Region 002: popularity 80 × 180 thousand fans',
    ]);
    expect(expectTraceContains(result, { kind: 'divide' }).label).toBe('All fans: 680 thousand');
    expectTraceContains(result, {
      kind: 'note',
      label: `Fan base: 2 regions where ${PROMOTION} has at least 10 popularity`,
    });
  });

  it('names the fan base tunable', () => {
    const result = footprintOf({
      subjectPop: popEverywhere(regions, 40),
      promotionPop: popEverywhere(regions, 40),
      regions,
    });
    const minPop = expectTraceContains(result, { kind: 'tunable' });
    expect(minPop.key).toBe('workers.expectedPush.footprintMinPop');
    expect(minPop.value).toBe(10);
  });

  it('gives the promotion its own popularity with its fans', () => {
    const promotionPop = { [first]: 50, [second]: 20 };
    const result = footprintOf({ subjectPop: promotionPop, promotionPop, regions });
    expect(result.value).toBeCloseTo((500_000 * 50 + 180_000 * 20) / 680_000, 10);
  });

  it('moves the fan base when the minimum is overridden', () => {
    const inputs = {
      subjectPop: { [first]: 30, [second]: 80 },
      promotionPop: { [first]: 50, [second]: 20 },
      regions,
    };
    const narrowed = footprintOf(inputs, { 'workers.expectedPush.footprintMinPop': 25 });
    expect(narrowed.value).toBe(30);
    expect(findTraceNodes(narrowed.trace, 'add')).toHaveLength(1);
  });

  it('says so when no region reaches the minimum and every known region counts', () => {
    const result = footprintOf({
      subjectPop: { [first]: 60 },
      promotionPop: { [first]: 4, [second]: 2 },
      regions,
    });
    expect(result.value).toBeCloseTo((40_000 * 60) / 58_000, 10);
    expectTraceContains(result, {
      kind: 'note',
      label: `${PROMOTION} has not reached 10 popularity anywhere, so all 2 regions it is known in count`,
    });
  });

  it('gives 0 with a note for a promotion with no fans', () => {
    const result = footprintOf({
      subjectPop: popEverywhere(regions, 90),
      promotionPop: {},
      regions,
    });
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_FANS_NOTE });
  });

  it('lists the five heaviest regions and adds the rest as one line', () => {
    const many = testRegions(8);
    const result = footprintOf({
      subjectPop: popEverywhere(many, 42),
      promotionPop: popEverywhere(many, 50),
      regions: many,
    });
    expect(result.value).toBeCloseTo(42, 10);
    const labels = findTraceNodes(result.trace, 'add').map((node) => node.label);
    expect(labels).toHaveLength(6);
    expect(labels[0]).toBe('Test Region 001: popularity 42 × 500 thousand fans');
    expect(labels[5]).toBe('3 other regions');
  });

  it('writes large fan counts in millions', () => {
    const big = [{ id: first, name: 'Test Region 001', population: 24_000_000 }];
    const result = footprintOf({
      subjectPop: { [first]: 10 },
      promotionPop: { [first]: 50 },
      regions: big,
    });
    expect(findTraceNodes(result.trace, 'add')[0]?.label).toBe(
      'Test Region 001: popularity 10 × 12 million fans',
    );
  });
});
