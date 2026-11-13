/**
 * Push gap: how many card positions a worker sits below the push they expect (positive), or above
 * it (negative).
 *
 * Design: docs/design/roster.md#push-gap.
 */

import { constantOf, mapTraced, startCalc, type Traced } from '../../../core/trace';
import type { Push } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import { PUSH_ORDER_REASON, pushIndexOf } from '../roleGroups';

export const PUSH_GAP_DOC_REF = 'roster.md#push-gap';

export interface PushGapInputs {
  /** The card position they have now. */
  push: Push;
  /** The card position they expect, as WRK1's `expectedPush` worked it out. */
  expected: Traced<Push>;
}

/**
 * `position now − position expected`, counting card positions from the main event (0) down to
 * enhancement (4). The expected push's own trace sits inside this one. No tunables: the positions
 * are the fixed order of the card. `deps` is taken so every roster formula has the same shape.
 */
export function computePushGap(
  inputs: PushGapInputs,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- every roster formula takes deps
  deps: { tunables: EngineTunables },
): Traced<number> {
  const now = constantOf(
    'Card position now (0 = main event)',
    pushIndexOf(inputs.push),
    PUSH_ORDER_REASON,
  );
  const expected = mapTraced(inputs.expected, 'Card position they expect', pushIndexOf);
  return startCalc('Push gap', now, { unit: 'count', docRef: PUSH_GAP_DOC_REF })
    .subtract('Card position they expect', expected, PUSH_ORDER_REASON)
    .done();
}
