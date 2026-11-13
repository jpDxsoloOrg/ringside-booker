// Expected pushes for the push gap and verdict tests.
import { startDecision, type Traced } from '../../../../src/core/trace';
import type { Push } from '../../../../src/model/entities/employment';
import { EXPECTED_PUSH_DOC_REF } from '../../../../src/systems/workers';

/** A stand-in for WRK1's expected-push decision, labelled the same, that picks `push`. */
export function expectedOf(push: Push): Traced<Push> {
  return startDecision<Push>('Expected push', { docRef: EXPECTED_PUSH_DOC_REF })
    .note('Set by the test')
    .choose(push, 'Set by the test');
}
