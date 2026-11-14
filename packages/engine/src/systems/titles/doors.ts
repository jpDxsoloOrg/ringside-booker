/**
 * The title doors: vacate, retire and reactivate a title (CRTV1-03).
 *
 * The booker's commands (`titles.vacate`, `titles.retire`, `titles.reactivate`), the daily
 * orphaned-champion rule and later features that take titles away outside a match (ECO4 contracts,
 * ECO9 closures, ECO11 call-ups) all go through these, so a vacancy or a retirement always closes
 * the reign the same way, records the same Why? and publishes one event. None of them decides
 * whether the change is allowed: callers check first. None of them touches morale, momentum,
 * popularity or prestige; features that care listen to the events.
 *
 * Design: docs/design/titles.md#commands.
 */

import type { Controller } from '../../core/api/controller';
import { InvariantError } from '../../core/errors';
import type { TitleId, TitleReignId } from '../../core/ids';
import { startDecision } from '../../core/trace/decision';
import type { Traced } from '../../core/trace/types';
import type { StepContext } from '../../core/pipeline/context';
import type { Title } from '../../model/entities/title';
import type { DeepReadonly } from '../../model/world';
import type { DoorSource } from '../workers/events';
import { currentReign } from './helpers/holders';
import { closeReign } from './reigns';
import { titleVacancyTraceRef } from './traces';

/** What a title door needs from its step or command. */
export type TitleDoorContext = Pick<
  StepContext,
  'date' | 'tx' | 'read' | 'publish' | 'recordTrace'
>;

/** The `reasonKey` of a vacancy the booker asked for. */
export const BOOKER_VACANCY_REASON_KEY = 'booker';
/** The `reasonKey` of a vacancy made by the orphaned-champion rule. */
export const ORPHANED_VACANCY_REASON_KEY = 'orphaned';

/** The Why? of a vacancy the booker asked for. */
export function bookerVacancyExplanation(): Traced<string> {
  return startDecision<string>('How the reign ended').choose('vacated', 'Vacated by the booker');
}

/** A command's `DoorSource`: a human's call is the player's, the computer's the AI's. */
export function titleSourceOf(issuedBy: DeepReadonly<Controller>): DoorSource {
  return issuedBy.kind === 'human' ? 'player' : 'ai';
}

function requireTitle(ctx: TitleDoorContext, titleId: TitleId, door: string): Title {
  const title = ctx.read.tables.titles.get(titleId);
  if (title === undefined) {
    throw new InvariantError(`${door}: title ${titleId} does not exist`, { titleId });
  }
  return title;
}

export interface VacateTitleInput {
  readonly titleId: TitleId;
  /** A stable key for listeners: `booker`, `orphaned` or the caller's own (`contracts.release`). */
  readonly reasonKey: string;
  readonly source: DoorSource;
  /** The Why? stored at `titles.vacancy` / the closed reign. */
  readonly explanation: Traced<string>;
}

/**
 * Ends the title's current reign as `vacated` on `ctx.date`, records `explanation` at
 * `titles.vacancy` / the reign and publishes `title.vacated`. Returns the closed reign's id.
 *
 * @throws InvariantError when the title does not exist or is already vacant.
 */
export function vacateTitle(ctx: TitleDoorContext, input: VacateTitleInput): TitleReignId {
  const title = requireTitle(ctx, input.titleId, 'vacateTitle');
  const reign = currentReign(ctx.read, title.id);
  if (reign === null) {
    throw new InvariantError(`vacateTitle: ${title.name} (${title.id}) is already vacant`, {
      titleId: title.id,
    });
  }
  closeReign(ctx, { reignId: reign.id, endReason: 'vacated', endedInSegmentId: null });
  ctx.recordTrace(titleVacancyTraceRef(reign.id), ctx.date, input.explanation);
  ctx.publish('title.vacated', {
    titleId: title.id,
    promotionId: title.promotionId,
    reignId: reign.id,
    holderIds: [...reign.holderIds],
    reasonKey: input.reasonKey,
    source: input.source,
  });
  return reign.id;
}

export interface TitleStatusInput {
  readonly titleId: TitleId;
  readonly source: DoorSource;
}

/**
 * Retires the title on `ctx.date`: a current reign ends `retired`, the title gets `status:
 * 'retired'` and `retiredOn`, and `title.retired` is published. `introducedOn` and the lineage stay.
 * Returns the reign it ended, or null when the title was vacant.
 *
 * @throws InvariantError when the title does not exist or is already retired.
 */
export function retireTitle(ctx: TitleDoorContext, input: TitleStatusInput): TitleReignId | null {
  const title = requireTitle(ctx, input.titleId, 'retireTitle');
  if (title.status === 'retired') {
    throw new InvariantError(`retireTitle: ${title.name} (${title.id}) is already retired`, {
      titleId: title.id,
    });
  }
  const reign = currentReign(ctx.read, title.id);
  if (reign !== null) {
    closeReign(ctx, { reignId: reign.id, endReason: 'retired', endedInSegmentId: null });
  }
  ctx.tx.update('titles', title.id, { status: 'retired', retiredOn: ctx.date });
  const endedReignId = reign?.id ?? null;
  ctx.publish('title.retired', {
    titleId: title.id,
    promotionId: title.promotionId,
    endedReignId,
    source: input.source,
  });
  return endedReignId;
}

/**
 * Brings a retired title back, vacant: `status: 'active'`, `retiredOn: null`, and
 * `title.reactivated`. `introducedOn` and the lineage stay.
 *
 * @throws InvariantError when the title does not exist or is not retired.
 */
export function reactivateTitle(ctx: TitleDoorContext, input: TitleStatusInput): void {
  const title = requireTitle(ctx, input.titleId, 'reactivateTitle');
  if (title.status !== 'retired') {
    throw new InvariantError(`reactivateTitle: ${title.name} (${title.id}) is not retired`, {
      titleId: title.id,
    });
  }
  ctx.tx.update('titles', title.id, { status: 'active', retiredOn: null });
  ctx.publish('title.reactivated', {
    titleId: title.id,
    promotionId: title.promotionId,
    source: input.source,
  });
}
