/**
 * The draft's gate, `draft.unfinished`: day 1 cannot start while a draft is open. The skip stops
 * with "Finish the draft" and the action hint `draft`, so the UI sends the player to the draft
 * room. Cheap: one index lookup.
 *
 * Design: docs/design/draft.md#gate.
 */

import type { GateSpec } from '../../core/pipeline/gates';
import { openDraft } from './session';

export const DRAFT_GATE_ID = 'draft.unfinished';
export const DRAFT_ACTION_HINT = 'draft';

export const draftUnfinishedGate: GateSpec = {
  id: DRAFT_GATE_ID,
  label: 'Finish the draft',
  check: (view) => {
    const draft = openDraft(view);
    if (draft === null) {
      return null;
    }
    return {
      gateId: DRAFT_GATE_ID,
      reason:
        draft.status === 'complete'
          ? 'Every pick is made: finish the draft to start the season'
          : 'Finish the draft before the season starts',
      subject: { kind: 'draft', id: draft.id },
      actionHint: DRAFT_ACTION_HINT,
    };
  },
};
