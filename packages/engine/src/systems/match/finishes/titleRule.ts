/**
 * The title rule (MTCH2-02): a title on the line changes hands only when the method can change
 * titles **and** the finish allows a title change. EVT3 reads it when it stores a title match's
 * result.
 *
 * So a count-out or a disqualification never moves a title (neither the finish nor its method
 * allows it), a draw or no contest never does (nobody won, there is no method), and a clean finish
 * ended by a method that cannot move titles does not either.
 *
 * Design: docs/design/match-finishes.md#title-changes.
 */

import { startDecision, type Traced } from '../../../core/trace';
import { finishEffectLabel } from '../formulas/finishEffect';
import type { FinishEntry } from './allowed';

export const TITLE_CHANGES_DOC_REF = 'match-finishes.md#title-changes';

export const TITLE_RULE_LABEL = 'Can the title change hands?';
export const NO_WINNER_RULE = 'Someone won by a method that can change titles';
export const TITLE_CAN_CHANGE_REASON = 'The method and the finish both allow a title change';

export interface TitleCanChangeInputs {
  readonly finish: Pick<FinishEntry, 'name' | 'allowsTitleChange'>;
  /** The method that ended the match; null for a draw or no contest. */
  readonly method: { readonly name: string; readonly changesTitles: boolean } | null;
}

/** True only when the method can change titles and the finish allows a title change. */
export function titleCanChange(inputs: TitleCanChangeInputs): Traced<boolean> {
  const { finish, method } = inputs;
  const decision = startDecision<'yes' | 'no'>(TITLE_RULE_LABEL, {
    docRef: TITLE_CHANGES_DOC_REF,
  });
  const methodAllows = method?.changesTitles === true;
  decision.rule(
    method === null ? NO_WINNER_RULE : `${method.name} can change titles`,
    methodAllows,
  );
  decision.rule(
    `${finishEffectLabel(finish.name)} allows a title change`,
    finish.allowsTitleChange,
  );
  if (!finish.allowsTitleChange) {
    const chosen = decision.choose(
      'no',
      `${finish.name}: titles can't change hands on this finish`,
    );
    return { value: false, trace: chosen.trace };
  }
  if (method === null) {
    const chosen = decision.choose(
      'no',
      `${finish.name}: nobody won, so titles can't change hands`,
    );
    return { value: false, trace: chosen.trace };
  }
  if (!method.changesTitles) {
    const chosen = decision.choose(
      'no',
      `${method.name}: titles can't change hands by this method`,
    );
    return { value: false, trace: chosen.trace };
  }
  const chosen = decision.choose('yes', TITLE_CAN_CHANGE_REASON);
  return { value: true, trace: chosen.trace };
}
