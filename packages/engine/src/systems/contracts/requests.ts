/**
 * Release requests (ECO4-03): raising one, granting one and refusing one.
 *
 * - `raiseRequest` writes an open request on the worker's concern row. For the player's workers it
 *   publishes `contract.releaseRequested` and waits for an answer; `stopsSkip` copies
 *   `contracts.releaseRequest.stopSkip`, so the `contracts.releaseRequested` gate needs no tunable.
 * - `grantRequest` ends the contract as a quit (`granted`) and pays `contracts.quit.severanceShare`
 *   of the normal severance (`severanceFor(..., 'grant')`).
 * - `refuseRequest` costs the worker `contracts.refuse.moralePenalty` morale through WRK1's morale
 *   door and marks the request refused, which starts the daily walk-out rolls.
 *
 * The player answers with `contracts.answerReleaseRequest`; a rival answers at once by its keep
 * rule (`formulas/aiReleaseDecision.ts`); a request left unanswered past its answer-by date is
 * refused by the system ("Release request ignored").
 *
 * Design: docs/design/contracts.md#unhappy-workers.
 */

import { addDays, type GameDate } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId } from '../../core/ids';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import type { ContractConcern, ReleaseRequest } from '../../model/entities/contract-concern';
import type { Employment } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { applyMoraleChange, type DoorContext } from '../workers/doors';
import type { DoorSource } from '../workers/events';
import { endEmployment, type EndEmploymentResult } from './endEmployment';
import { walkoutChance } from './formulas/walkoutChance';
import { severanceFor } from './severanceFor';
import { hotStorylineFor } from './storyPause';

export const UNHAPPY_DOC_REF = 'contracts.md#unhappy-workers';

/** The reason key of a granted release request. */
export const RELEASE_GRANTED_REASON_KEY = 'contracts.releaseGranted';
/** The reason key of a walk-out. */
export const WALKOUT_REASON_KEY = 'contracts.walkout';
/** The morale reason key of a refused (or ignored) release request. */
export const REFUSED_RELEASE_REASON_KEY = 'contracts.refusedRelease';
export const REFUSED_RELEASE_LABEL = 'Release request refused';
export const IGNORED_RELEASE_LABEL = 'Release request ignored';

type ConcernParts = Pick<ContractConcern, 'unhappy' | 'request'>;

/** Writes `parts` onto the employment's concern row, creating the row when needed. */
export function writeConcern(
  ctx: Pick<DoorContext, 'tx' | 'read'>,
  employment: DeepReadonly<Employment>,
  parts: Partial<ConcernParts>,
): void {
  const concern = ctx.read.tables.contractConcerns.lookupOne('byEmployment', employment.id);
  if (concern !== undefined) {
    const next = { ...concern, ...parts };
    if (
      next.expiryNotice === null &&
      next.unhappy === null &&
      next.request === null &&
      next.ending === null
    ) {
      ctx.tx.delete('contractConcerns', concern.id);
    } else {
      ctx.tx.update('contractConcerns', concern.id, parts);
    }
    return;
  }
  const row = {
    id: ctx.tx.mintId('contractConcerns'),
    employmentId: employment.id,
    personId: employment.personId,
    promotionId: employment.promotionId,
    expiryNotice: null,
    unhappy: parts.unhappy ?? null,
    request: parts.request ?? null,
    ending: null,
  };
  if (row.unhappy !== null || row.request !== null) {
    ctx.tx.insert('contractConcerns', row);
  }
}

/** The worker's release request, or null. */
export function requestOf(
  read: GameWorldView,
  employmentId: EmploymentId,
): DeepReadonly<ReleaseRequest> | null {
  return read.tables.contractConcerns.lookupOne('byEmployment', employmentId)?.request ?? null;
}

/**
 * Writes an open release request dated today. `human` requests publish
 * `contract.releaseRequested` and stop a skip when `contracts.releaseRequest.stopSkip` is on.
 */
export function raiseRequest(
  ctx: DoorContext,
  employment: DeepReadonly<Employment>,
  human: boolean,
): void {
  const request: ReleaseRequest = {
    raisedOn: ctx.date,
    answerBy: addDays(ctx.date, ctx.tunables.get('contracts.releaseRequest.answerDays')),
    status: 'open',
    answeredOn: null,
    mailId: null,
    stopsSkip: human && ctx.tunables.get('contracts.releaseRequest.stopSkip'),
  };
  writeConcern(ctx, employment, { request });
  if (human) {
    ctx.publish('contract.releaseRequested', {
      employmentId: employment.id,
      personId: employment.personId,
      promotionId: employment.promotionId,
    });
  }
}

/** The share of normal severance a granted request pays today, with its Why?. */
export function grantSeverance(
  ctx: Pick<DoorContext, 'read' | 'date' | 'tunables'>,
  employmentId: EmploymentId,
): Traced<number> {
  return severanceFor(ctx.read, employmentId, ctx.date, ctx.tunables, 'grant');
}

/** Grants a release request: the contract ends as a quit (`granted`) with the reduced severance. */
export function grantRequest(
  ctx: DoorContext,
  employmentId: EmploymentId,
  source: DoorSource,
): EndEmploymentResult {
  const employment = ctx.read.tables.employments.require(employmentId);
  return endEmployment(ctx, {
    employmentId,
    to: 'quit',
    how: 'granted',
    reasonKey: RELEASE_GRANTED_REASON_KEY,
    source,
    severance: grantSeverance(ctx, employmentId),
    memo: `Severance (release request granted): ${employment.ringName}`,
  });
}

/** The morale change a refusal costs, as one tunable line (0 or less). */
export function refusalMoraleDelta(tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Morale change', 0, {
    unit: 'points',
    docRef: UNHAPPY_DOC_REF,
    startLabel: 'No change yet',
  });
  return calc
    .subtract('Refused a release request', calc.tunable(tunables, 'contracts.refuse.moralePenalty'))
    .done();
}

/**
 * Refuses the worker's open release request: the morale hit through WRK1's door (none at a penalty
 * of 0), the request marked refused on `answeredOn`, and `contract.releaseRefused`. `source` is
 * `player`, `ai` (a rival's rule) or `system` (left unanswered, "Release request ignored").
 */
export function refuseRequest(
  ctx: DoorContext,
  employmentId: EmploymentId,
  source: DoorSource,
  answeredOn: GameDate,
): void {
  const employment = ctx.read.tables.employments.require(employmentId);
  const request = requestOf(ctx.read, employmentId);
  if (request?.status !== 'open') {
    throw new InvalidArgumentError(
      'refuseRequest',
      'employmentId',
      employmentId,
      'a contract with an open release request',
    );
  }
  const delta = refusalMoraleDelta(ctx.tunables);
  if (delta.value !== 0) {
    applyMoraleChange(ctx, {
      employmentId,
      delta,
      source,
      reason: {
        key: REFUSED_RELEASE_REASON_KEY,
        label: source === 'system' ? IGNORED_RELEASE_LABEL : REFUSED_RELEASE_LABEL,
      },
    });
  }
  writeConcern(ctx, employment, {
    request: { ...request, status: 'refused', answeredOn, stopsSkip: false },
  });
  ctx.publish('contract.releaseRefused', {
    employmentId,
    personId: employment.personId,
    promotionId: employment.promotionId,
    source,
  });
}

/** Today's walk-out chance for a worker at `morale` (their own, unless given). */
export function walkoutChanceFor(
  read: GameWorldView,
  employment: DeepReadonly<Employment>,
  tunables: EngineTunables,
  morale: number = employment.morale,
): Traced<number> {
  return walkoutChance(
    {
      morale,
      threshold: tunables.get('contracts.quit.threshold'),
      ironClad: employment.terms.perks.ironClad,
      hotStoryline: hotStorylineFor(read, employment.personId, employment.promotionId, tunables),
    },
    { tunables },
  );
}
