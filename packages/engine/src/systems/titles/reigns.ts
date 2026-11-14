/**
 * Writing reigns: `openReign` and `closeReign` are the only code that creates or ends a title
 * reign. Show night's title changes (EVT3, `lost`), retirements (DAY6, `retired`), contracts,
 * closures and call-ups (ECO features), and CRTV1's own award, vacate and retire commands call
 * these instead of writing `titleReigns` their own way. Both throw on misuse; the table's
 * invariants (`openByTitle` unique, `reignsDoNotOverlap`, `holderCountMatchesTitle`) stay the last
 * line of defence.
 *
 * To hand a title over on one day, close the old reign first and then open the new one: the old
 * reign ends on the day the new one starts, which the overlap rule allows.
 *
 * Design: docs/design/titles.md#writing-reigns.
 */

import { InvariantError } from '../../core/errors';
import type { PersonId, SegmentId, TeamId, TitleId, TitleReignId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { ReignEndReason, TitleReign } from '../../model/entities/title-reign';
import { ringNameForTitle } from './helpers/employment';
import { currentReign } from './helpers/holders';

/** What a reign writer needs from its step or command: the day, the transaction and a view. */
export type ReignWriteContext = Pick<PhaseContext, 'date' | 'tx' | 'read'>;

export interface OpenReignInput {
  readonly titleId: TitleId;
  /** The new champions. Their ring names with the title's promotion are kept on the reign. */
  readonly holderIds: readonly PersonId[];
  /** The team they hold it as (tag and trios), or null. */
  readonly teamId: TeamId | null;
  /** The match it was won in; null for an inaugural or awarded reign. */
  readonly wonInSegmentId: SegmentId | null;
}

export interface CloseReignInput {
  readonly reignId: TitleReignId;
  readonly endReason: ReignEndReason;
  /** The match it ended in; null when it ended outside a match. */
  readonly endedInSegmentId: SegmentId | null;
}

/**
 * Starts a reign on `ctx.date` with no defences yet. `holderNamesAtTime` is each holder's ring
 * name with the title's promotion (or its parent), falling back to their default ring name.
 *
 * @throws InvariantError when the title does not exist or already has a current reign.
 */
export function openReign(ctx: ReignWriteContext, input: OpenReignInput): TitleReign {
  const title = ctx.read.tables.titles.get(input.titleId);
  if (title === undefined) {
    throw new InvariantError(`openReign: title ${input.titleId} does not exist`, {
      titleId: input.titleId,
    });
  }
  const open = currentReign(ctx.read, input.titleId);
  if (open !== null) {
    throw new InvariantError(
      `openReign: ${title.name} (${title.id}) already has a current reign (${open.id}); close it first`,
      { titleId: title.id, reignId: open.id },
    );
  }
  const holderIds = [...input.holderIds];
  return ctx.tx.create('titleReigns', {
    titleId: title.id,
    holderIds,
    teamId: input.teamId,
    wonOn: ctx.date,
    lostOn: null,
    wonInSegmentId: input.wonInSegmentId,
    endedInSegmentId: null,
    endReason: null,
    defences: 0,
    holderNamesAtTime: holderIds.map((personId) =>
      ringNameForTitle(ctx.read, personId, title.promotionId, ctx.date),
    ),
  });
}

/**
 * Ends a current reign on `ctx.date`.
 *
 * @throws InvariantError when the reign does not exist or has already ended.
 */
export function closeReign(ctx: ReignWriteContext, input: CloseReignInput): TitleReign {
  const reign = ctx.read.tables.titleReigns.get(input.reignId);
  if (reign === undefined) {
    throw new InvariantError(`closeReign: reign ${input.reignId} does not exist`, {
      reignId: input.reignId,
    });
  }
  if (reign.lostOn !== null) {
    throw new InvariantError(
      `closeReign: reign ${reign.id} of ${reign.titleId} already ended on ${reign.lostOn}`,
      { reignId: reign.id, titleId: reign.titleId },
    );
  }
  return ctx.tx.update('titleReigns', reign.id, {
    lostOn: ctx.date,
    endReason: input.endReason,
    endedInSegmentId: input.endedInSegmentId,
  });
}
