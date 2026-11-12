/**
 * The method that ends a match (MTCH2-02): pinfall, submission, count-out and so on.
 *
 * A draw or no contest has no method. A booked method the finish lists is kept. Otherwise a finish
 * with one method uses it without a roll, and one with several picks by a seeded weighted roll over
 * the finish's method weights.
 *
 * Design: docs/design/match-finishes.md#method.
 */

import type { ContentKey } from '../../../core/content-key';
import { InvalidArgumentError } from '../../../core/errors';
import { rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { startDecision, type Traced } from '../../../core/trace';
import type { FinishEntry } from './allowed';

export const METHOD_DOC_REF = 'match-finishes.md#method';

export const METHOD_DECISION_LABEL = 'How the match ended';
export const NO_METHOD_NOTE = 'No method: nobody won';
export const BOOKED_METHOD_REASON = 'Booked method';
export const ONLY_METHOD_REASON = 'Only method this finish allows';
export const METHOD_BY_ROLL_REASON = 'Picked by weighted roll';
/** The option a no-method decision records; the returned value is null. */
export const NO_METHOD_OPTION = 'none';

export interface ChooseMethodInputs {
  readonly finish: FinishEntry;
  /** The method the booker chose, or null to let the match decide. */
  readonly plannedMethodKey: ContentKey | null;
  /** Method names by key, for the trace; a key without a name shows as the key. */
  readonly methodNames: Readonly<Record<string, string>>;
}

/**
 * The method a match ends with, or null for a draw or no contest. The trace of a null pick chooses
 * `NO_METHOD_OPTION`.
 *
 * @throws InvalidArgumentError when `plannedMethodKey` is not one of the finish's methods (the
 *   caller checks this first and refuses with a reason; see MTCH2-03).
 */
export function chooseMethod(
  inputs: ChooseMethodInputs,
  deps: { readonly rng: RngStream },
): Traced<ContentKey | null> {
  const { finish, plannedMethodKey } = inputs;
  const nameOf = (key: string): string => inputs.methodNames[key] ?? key;
  // The trace's options are the methods' names ("Pinfall"), or "name (key)" when two methods share
  // a name, so the Why? reads as words; the returned value is the method's content key.
  const nameCounts = new Map<string, number>();
  for (const method of finish.methods) {
    const name = nameOf(method.methodKey);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const optionOf = (key: string): string => {
    const name = nameOf(key);
    return (nameCounts.get(name) ?? 0) > 1 ? `${name} (${key})` : name;
  };
  const decision = startDecision<string>(METHOD_DECISION_LABEL, { docRef: METHOD_DOC_REF });
  if (finish.outcomeKind !== 'win' || finish.methods.length === 0) {
    const none = decision.note(NO_METHOD_NOTE).choose(NO_METHOD_OPTION, NO_METHOD_NOTE);
    return { value: null, trace: none.trace };
  }
  if (plannedMethodKey !== null) {
    if (!finish.methods.some((method) => method.methodKey === plannedMethodKey)) {
      throw new InvalidArgumentError(
        'chooseMethod',
        'plannedMethodKey',
        plannedMethodKey,
        `one of the methods of ${finish.key}`,
      );
    }
    const kept = decision
      .consider(nameOf(plannedMethodKey), 1)
      .choose(nameOf(plannedMethodKey), BOOKED_METHOD_REASON);
    return { value: plannedMethodKey, trace: kept.trace };
  }
  for (const method of finish.methods) {
    decision.consider(optionOf(method.methodKey), method.weight);
  }
  const [only] = finish.methods;
  if (finish.methods.length === 1 && only !== undefined) {
    const chosen = decision.choose(optionOf(only.methodKey), ONLY_METHOD_REASON);
    return { value: only.methodKey, trace: chosen.trace };
  }
  const picked = rollWeighted(
    deps.rng,
    finish.methods.map((method) => ({ item: method.methodKey, weight: method.weight })),
    'Method',
    nameOf,
  );
  const chosen = decision.roll(picked.roll).choose(optionOf(picked.value), METHOD_BY_ROLL_REASON);
  return { value: picked.value, trace: chosen.trace };
}
