/**
 * Push verdict: whether a worker's push is below, at or above what they expect, which drives the
 * roster's "expects more" marker.
 *
 * Design: docs/design/roster.md#push-verdict.
 */

import { startDecision, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';

export const PUSH_VERDICT_DOC_REF = 'roster.md#push-verdict';

export const PUSH_VERDICTS = ['expectsMore', 'asExpected', 'aboveExpected'] as const;
export type PushVerdict = (typeof PUSH_VERDICTS)[number];

function positionsText(count: number): string {
  return count === 1 ? '1 card position' : `${String(count)} card positions`;
}

/**
 * With `n = roster.expectsMoreSteps`: a gap of `n` or more is `expectsMore`, a gap of `-n` or less
 * is `aboveExpected`, anything between is `asExpected`.
 */
export function computePushVerdict(
  gap: Traced<number>,
  deps: { tunables: EngineTunables },
): Traced<PushVerdict> {
  const decision = startDecision<PushVerdict>('How their push compares', {
    docRef: PUSH_VERDICT_DOC_REF,
  });
  const steps = decision.tunable(
    deps.tunables,
    'roster.expectsMoreSteps',
    'Card positions off before it counts',
  );
  const below = gap.value >= steps;
  const above = gap.value <= -steps;
  decision.rule(`Sits ${positionsText(steps)} or more below the push they expect`, below);
  decision.rule(`Sits ${positionsText(steps)} or more above the push they expect`, above);
  decision.consider('expectsMore', gap, `A gap of ${String(steps)} or more`);
  decision.consider('aboveExpected', gap.value, `A gap of -${String(steps)} or less`);
  decision.consider('asExpected', gap.value, 'Anything in between');

  if (below) {
    return decision.choose(
      'expectsMore',
      `Sits ${positionsText(gap.value)} below the push they expect`,
    );
  }
  if (above) {
    return decision.choose(
      'aboveExpected',
      `Sits ${positionsText(-gap.value)} above the push they expect`,
    );
  }
  if (gap.value === 0) {
    return decision.choose('asExpected', 'Sits at the push they expect');
  }
  const side = gap.value > 0 ? 'below' : 'above';
  return decision.choose(
    'asExpected',
    `Sits ${positionsText(Math.abs(gap.value))} ${side} the push they expect, fewer than ${String(steps)}`,
  );
}
