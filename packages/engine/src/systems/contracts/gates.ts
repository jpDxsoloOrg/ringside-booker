/**
 * The gate `contracts.expiringSoon` (ECO4-02): a skip stops when one of the player's contracts is
 * about to run out, with "Contract expiring soon: <name> (ends <date>)".
 *
 * Gates cannot read tunables, so the lifecycle's `contracts.expiryNotices` hook decides who gets a
 * notice (`notices.ts`) and the gate only reads the `unseenExpiry` index. It skips notices whose
 * contract is no longer active, names the one ending soonest (ties by id), and keeps stopping until
 * the player marks the notices as seen (`contracts.acknowledgeExpiries`), releases the worker or the
 * contract is renewed out of the window.
 *
 * Design: docs/design/contracts.md#expiring-soon.
 */

import { compareDates } from '../../core/date';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import { UNSEEN_EXPIRY_KEY } from '../../model/entities/contract-concern';
import type { Employment } from '../../model/entities/employment';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { plainDate } from '../health/gate';

export const EXPIRING_SOON_GATE_ID = 'contracts.expiringSoon';

/** The web shell's route key for the Contracts screen (ECO4-04). */
export const CONTRACTS_ACTION_HINT = 'contracts';

/** Active contracts with an unseen expiry notice, soonest end date first, ties by id. */
export function unseenExpiringContracts(read: GameWorldView): DeepReadonly<Employment>[] {
  const rows: DeepReadonly<Employment>[] = [];
  for (const concern of read.tables.contractConcerns.lookup('unseenExpiry', UNSEEN_EXPIRY_KEY)) {
    const employment = read.tables.employments.get(concern.employmentId);
    if (employment?.status === 'active' && employment.endsOn !== null) {
      rows.push(employment);
    }
  }
  return rows.sort(
    (left, right) =>
      compareDates(left.endsOn ?? left.startsOn, right.endsOn ?? right.startsOn) ||
      compareIds(left.id, right.id),
  );
}

/** "Contract expiring soon: Big Joe (ends Mar 14, 2031)", plus " and 2 more" when there are others. */
export function expiringSoonReason(waiting: readonly DeepReadonly<Employment>[]): string | null {
  const [first] = waiting;
  if (first?.endsOn == null) {
    return null;
  }
  const more = waiting.length > 1 ? ` and ${String(waiting.length - 1)} more` : '';
  return `Contract expiring soon: ${first.ringName} (ends ${plainDate(first.endsOn)})${more}`;
}

export const expiringSoonGate: GateSpec = {
  id: EXPIRING_SOON_GATE_ID,
  label: 'Contract expiring soon',
  check: (view): GateHit | null => {
    const waiting = unseenExpiringContracts(view);
    const reason = expiringSoonReason(waiting);
    const [first] = waiting;
    if (reason === null || first === undefined) {
      return null;
    }
    return {
      gateId: EXPIRING_SOON_GATE_ID,
      reason,
      subject: { kind: 'employment', id: first.id },
      actionHint: CONTRACTS_ACTION_HINT,
    };
  },
};
