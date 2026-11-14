/**
 * The gate `contracts.counterWaiting` (ECO5-05): a skip stops while a worker's counter-offer waits
 * for a player's answer, with "Counter-offer from <ring name> is waiting for your answer".
 *
 * Gates cannot read tunables, so the reaction step copies `contracts.counter.stopSkip` onto the row
 * when it makes the counter (`counterStopsSkip`, only for promotions a human runs) and the gate
 * reads that. The tunable is OFF by default until the Negotiation Sheet (ECO5-06) can answer a
 * counter from the day bar; while it is off, an unanswered counter simply lapses after
 * `contracts.counter.expiryDays`. Computer promotions never stop a skip (their counters are
 * answered in the phase). The hint is ECO4's `contracts`, routed to the Contracts screen.
 *
 * Design: docs/design/negotiation.md#counter.
 */

import { compareDates } from '../../core/date';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import type { Negotiation } from '../../model/entities/negotiation';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { CONTRACTS_ACTION_HINT } from '../contracts/gates';

export const COUNTER_WAITING_GATE_ID = 'contracts.counterWaiting';

/** Counter-offers waiting for a player's answer that stop a skip, soonest to lapse first. */
export function waitingCounters(read: GameWorldView): DeepReadonly<Negotiation>[] {
  return read.tables.negotiations
    .lookup('byStatus', 'countered')
    .filter(
      (row) =>
        row.counterStopsSkip &&
        read.tables.promotions.get(row.promotionId)?.controller.kind === 'human',
    )
    .sort(
      (left, right) =>
        compareDates(
          left.counterExpiresOn ?? left.submittedOn,
          right.counterExpiresOn ?? right.submittedOn,
        ) || compareIds(left.id, right.id),
    );
}

/** The ring name the counter's worker goes by with that promotion. */
function ringNameOf(read: GameWorldView, negotiation: DeepReadonly<Negotiation>): string {
  return (
    read.tables.employments.get(negotiation.employmentId)?.ringName ??
    read.tables.people.get(negotiation.personId)?.defaultRingName ??
    'a worker'
  );
}

export const counterWaitingGate: GateSpec = {
  id: COUNTER_WAITING_GATE_ID,
  label: 'Counter-offer waiting',
  check: (view): GateHit | null => {
    const [first] = waitingCounters(view);
    if (first === undefined) {
      return null;
    }
    return {
      gateId: COUNTER_WAITING_GATE_ID,
      reason: `Counter-offer from ${ringNameOf(view, first)} is waiting for your answer`,
      subject: { kind: 'person', id: first.personId },
      actionHint: CONTRACTS_ACTION_HINT,
    };
  },
};
