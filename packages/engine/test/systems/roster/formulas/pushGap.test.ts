// The push gap. Design: docs/design/roster.md#push-gap
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../../src/core/trace';
import { PUSH_LEVELS, type Push } from '../../../../src/model/entities/employment';
import {
  computePushGap,
  PUSH_GAP_DOC_REF,
  PUSH_ORDER_REASON,
  pushIndexOf,
} from '../../../../src/systems/roster';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectedPush } from '../../../../src/systems/workers';
import { popEverywhere, testRegions } from '../../workers/push-fixtures';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';
import { expectedOf } from './push-fixtures';

const deps = { tunables: createEngineTunables() };

function gapOf(push: Push, expected: Push) {
  const result = computePushGap({ push, expected: expectedOf(expected) }, deps);
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computePushGap', () => {
  it('counts card positions from the main event down', () => {
    expect(PUSH_LEVELS.map(pushIndexOf)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each<[Push, Push, number]>([
    ['midCard', 'midCard', 0],
    ['enhancement', 'mainEvent', 4],
    ['mainEvent', 'midCard', -2],
    ['lowerCard', 'upperCard', 2],
  ])('%s against an expected %s is %d', (push, expected, steps) => {
    expect(gapOf(push, expected).value).toBe(steps);
  });

  it('shows both card positions as fixed numbers and the expected push inside its own step', () => {
    const result = gapOf('enhancement', 'mainEvent');
    const formula = expectTraceContains(result, { kind: 'formula', label: 'Push gap' });
    expect(formula.docRef).toBe(PUSH_GAP_DOC_REF);
    expect(formula.unit).toBe('count');
    const now = expectTraceContains(result, {
      kind: 'constant',
      label: 'Card position now (0 = main event)',
    });
    expect(now.value).toBe(4);
    expect(now.reason).toBe(PUSH_ORDER_REASON);
    const step = expectTraceContains(result, {
      kind: 'subtract',
      label: 'Card position they expect',
    });
    expect(step.operand).toBe(0);
    const nested = expectTraceContains(result, { kind: 'decision', label: 'Expected push' });
    expect(nested.chosen).toBe('mainEvent');
    expect(findTraceNodes(result.trace, 'tunable')).toEqual([]);
  });

  it("carries WRK1's own expected-push trace, tunables and all", () => {
    const regions = testRegions(2);
    const expected = expectedPush(
      {
        employmentRole: 'wrestler',
        workerPop: popEverywhere(regions, 90),
        promotionPop: popEverywhere(regions, 40),
        promotionName: 'Test Promotion A',
        regions,
      },
      deps,
    );
    expect(expected.value).toBe('mainEvent');
    const result = computePushGap({ push: 'lowerCard', expected }, deps);
    expectTraceReplays(result);
    expect(result.value).toBe(3);
    const nested = expectTraceContains(result, { kind: 'decision', label: 'Expected push' });
    expect(nested).toEqual(expected.trace);
    expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toContain(
      'workers.expectedPush.starPop',
    );
  });
});
