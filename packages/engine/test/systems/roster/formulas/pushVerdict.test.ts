// The push verdict. Design: docs/design/roster.md#push-verdict
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import type { Push } from '../../../../src/model/entities/employment';
import {
  computePushGap,
  computePushVerdict,
  PUSH_VERDICT_DOC_REF,
  type PushVerdict,
} from '../../../../src/systems/roster';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';
import { expectedOf } from './push-fixtures';

function verdictOf(push: Push, expected: Push, overrides: TunableOverrides = {}) {
  const deps = { tunables: createEngineTunables(overrides) };
  const gap = computePushGap({ push, expected: expectedOf(expected) }, deps);
  expectTraceReplays(gap);
  const verdict = computePushVerdict(gap, deps);
  expectSerialisable(verdict);
  const decision = expectTraceContains(verdict, {
    kind: 'decision',
    label: 'How their push compares',
  });
  expect(decision.chosen).toBe(verdict.value);
  expect(decision.docRef).toBe(PUSH_VERDICT_DOC_REF);
  return { gap, verdict, decision };
}

describe('computePushVerdict', () => {
  it.each<[Push, Push, number, PushVerdict]>([
    ['midCard', 'midCard', 0, 'asExpected'],
    ['enhancement', 'mainEvent', 4, 'expectsMore'],
    ['mainEvent', 'midCard', -2, 'aboveExpected'],
    ['lowerCard', 'midCard', 1, 'expectsMore'],
    ['upperCard', 'midCard', -1, 'aboveExpected'],
  ])('%s against an expected %s: gap %d is %s', (push, expected, steps, wanted) => {
    const { gap, verdict } = verdictOf(push, expected);
    expect(gap.value).toBe(steps);
    expect(verdict.value).toBe(wanted);
  });

  it('names the tunable and keeps the gap and expected-push traces inside', () => {
    const { verdict } = verdictOf('enhancement', 'mainEvent');
    const tunable = expectTraceContains(verdict, { kind: 'tunable' });
    expect(tunable.key).toBe('roster.expectsMoreSteps');
    expect(tunable.value).toBe(1);
    expect(tunable.overridden).toBe(false);
    expectTraceContains(verdict, { kind: 'formula', label: 'Push gap' });
    expectTraceContains(verdict, { kind: 'decision', label: 'Expected push' });
  });

  it('says why in plain words', () => {
    expect(verdictOf('enhancement', 'mainEvent').decision.reason).toBe(
      'Sits 4 card positions below the push they expect',
    );
    expect(verdictOf('mainEvent', 'midCard').decision.reason).toBe(
      'Sits 2 card positions above the push they expect',
    );
    expect(verdictOf('midCard', 'midCard').decision.reason).toBe('Sits at the push they expect');
  });

  describe('with roster.expectsMoreSteps overridden', () => {
    it('at 2, a gap of 1 either way is as expected', () => {
      const overrides = { 'roster.expectsMoreSteps': 2 };
      const below = verdictOf('lowerCard', 'midCard', overrides);
      expect(below.verdict.value).toBe('asExpected');
      expect(below.decision.reason).toBe(
        'Sits 1 card position below the push they expect, fewer than 2',
      );
      expect(verdictOf('upperCard', 'midCard', overrides).verdict.value).toBe('asExpected');
      expect(verdictOf('lowerCard', 'upperCard', overrides).verdict.value).toBe('expectsMore');
      const tunable = expectTraceContains(below.verdict, { kind: 'tunable' });
      expect(tunable.overridden).toBe(true);
      expect(tunable.value).toBe(2);
    });

    it('at 4, only the extreme gap is flagged', () => {
      const overrides = { 'roster.expectsMoreSteps': 4 };
      expect(verdictOf('enhancement', 'mainEvent', overrides).verdict.value).toBe('expectsMore');
      expect(verdictOf('mainEvent', 'enhancement', overrides).verdict.value).toBe('aboveExpected');
      expect(verdictOf('lowerCard', 'mainEvent', overrides).verdict.value).toBe('asExpected');
      expect(verdictOf('mainEvent', 'lowerCard', overrides).verdict.value).toBe('asExpected');
    });
  });
});
