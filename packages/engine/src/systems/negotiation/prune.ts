/**
 * Clearing away old talks (ECO5-05), at the end of `contracts.reviewOffers` each day.
 *
 * A closed negotiation that closed more than `contracts.history.closedKeepDays` ago and whose
 * walk-away cooldown (if any) has passed is deleted. One exception: the talks of a signing that
 * never signed are what tell the contract screens that its `withdrawn` or `declined` employment
 * was only an offer (`isUnsignedOffer`), and that employment may be named elsewhere (news, mail,
 * decision logs), so neither is deleted; the negotiation keeps its outcome and loses its rounds.
 *
 * Design: docs/design/negotiation.md#statuses.
 */

import { addDays, compareDates } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { CLOSED_NEGOTIATION_STATUSES } from '../../model/entities/negotiation';
import { compareIds } from '../../model/table';

/** Deletes (or empties) closed talks past the keep window. */
export function pruneClosedTalks(ctx: PhaseContext): void {
  const keepDays = ctx.tunables.get('contracts.history.closedKeepDays');
  const cutoff = addDays(ctx.date, -keepDays);
  for (const status of CLOSED_NEGOTIATION_STATUSES) {
    const rows = ctx.read.tables.negotiations
      .lookup('byStatus', status)
      .filter(
        (row) =>
          row.closedOn !== null &&
          compareDates(row.closedOn, cutoff) < 0 &&
          (row.cooldownUntil === null || compareDates(row.cooldownUntil, ctx.date) <= 0),
      )
      .sort((left, right) => compareIds(left.id, right.id));
    for (const row of rows) {
      const unsignedOffer = row.kind === 'signing' && row.status !== 'signed';
      if (!unsignedOffer) {
        ctx.tx.delete('negotiations', row.id);
      } else if (row.history.length > 0) {
        ctx.tx.update('negotiations', row.id, { history: [] });
      }
    }
  }
}
