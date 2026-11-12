/**
 * Soft compression: values near the top of the scale are squeezed, not re-rolled.
 *
 * Above the knee each extra point counts for only `factor` of a point, so a 120 and a 95 still land
 * in order (99 and 89 at the defaults) instead of both pinning at 100. Nothing here is random: how
 * far above the knee a value was still matters.
 *
 * Design: docs/design/match-rating.md#soft-compression.
 */

import { startCalc, traced, type Traced, type TraceNode } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const COMPRESSION_DOC_REF = 'match-rating.md#soft-compression';

export interface SoftCompressionInputs {
  /** The value to compress; its trace becomes the first step. */
  value: Traced<number>;
  /** The result's title, such as "Work rate" or "Crowd". */
  label: string;
}

const SCALE_MIN = 0;
const SCALE_MAX = 100;

/**
 * `value > knee ? knee + (value − knee) × factor : value`, then at most 100 and at least 0. A branch
 * node "Above the knee at 85" records whether the knee was crossed.
 *
 * When the value's trace is a formula (work rate, the crowd score), the compression steps continue
 * that formula under the new title instead of wrapping it, so a trace already near the depth limit
 * (work rate) loses no level. Any other trace becomes the first step of a new formula.
 */
export function softCompression(
  inputs: SoftCompressionInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(inputs.label, inputs.value, {
    unit: 'points',
    docRef: COMPRESSION_DOC_REF,
  });
  const knee = calc.tunable(tunables, 'match.compression.knee', 'Compression knee');
  const crossed = inputs.value.value > knee;
  calc.branch(`Above the knee at ${formatNumber(knee)}`, crossed);
  if (crossed) {
    calc
      .subtract('Down to the knee', knee)
      .multiply(
        'Share of each point above the knee kept',
        calc.tunable(tunables, 'match.compression.factor', 'Compression factor'),
      )
      .add('Back up from the knee', knee);
  }
  const result = calc.min('At most 100', SCALE_MAX).max('At least 0', SCALE_MIN).done();

  const source = inputs.value.trace;
  if (source.kind !== 'formula' || source.children.length === 0) {
    return result;
  }
  // Drop the wrapped source (the first step) and append the compression steps to its own formula.
  const steps: TraceNode[] = (result.trace.children ?? [])
    .slice(1)
    .map((step) => (step.kind === 'branch' ? { ...step, docRef: COMPRESSION_DOC_REF } : step));
  return traced(result.value, {
    ...source,
    label: inputs.label,
    value: result.value,
    children: [...source.children, ...steps],
  });
}
