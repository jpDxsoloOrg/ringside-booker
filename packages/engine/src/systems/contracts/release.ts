/**
 * `releaseEmployment`: let a worker go, paying what the contract still owes them.
 *
 * The one function every release goes through: the player's `contracts.release` command, ECO9's
 * budget cuts and SOC6's conduct releases. It works out the severance with `severanceFor`, scales
 * it by an optional factor (a factor of 0, "Fired for cause", pays nothing), and ends the contract
 * through `endEmployment`: an active contract becomes `released`, a signed deal that has not started
 * becomes `withdrawn`. A worker whose morale is at or below `contracts.severance.mutualMorale` is
 * glad to go, so the release is mutual.
 *
 * Design: docs/design/contracts.md#severance.
 */

import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId, LedgerEntryId } from '../../core/ids';
import { startCalc } from '../../core/trace/calc';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import type { DoorContext } from '../workers/doors';
import type { DoorSource } from '../workers/events';
import { endEmployment, SEVERANCE_DOC_REF } from './endEmployment';
import { severanceFor } from './severanceFor';

/** The reason key of a release by the promotion. */
export const RELEASE_REASON_KEY = 'contracts.release';

export interface ReleaseEmploymentArgs {
  readonly employmentId: EmploymentId;
  readonly source: DoorSource;
  /** A stable key for listeners and news, such as `contracts.release` or `finance.budgetCut`. */
  readonly reasonKey: string;
  /** Scales the severance, with the line it adds to the Why?: `{ value: 0, label: 'Fired for cause' }`. */
  readonly severanceFactor?: { readonly value: number; readonly label: string };
}

export interface ReleaseEmploymentResult {
  /** `released` for a contract that had started, `withdrawn` for a signed deal that had not. */
  readonly to: 'released' | 'withdrawn';
  readonly mutual: boolean;
  /** The severance paid, in whole cents (0 when none). */
  readonly severance: number;
  /** Where the severance trace is stored, or null when nothing was paid. */
  readonly traceRef: TraceRef | null;
  readonly ledgerEntryId: LedgerEntryId | null;
  /** The severance ledger row's Why?, or null when nothing was paid. */
  readonly ledgerTraceRef: TraceRef | null;
}

/** The severance `releaseEmployment` would pay: `severanceFor`, times any factor. */
export function releaseSeverance(
  ctx: Pick<DoorContext, 'read' | 'date' | 'tunables'>,
  employmentId: EmploymentId,
  severanceFactor?: ReleaseEmploymentArgs['severanceFactor'],
): Traced<number> {
  const base = severanceFor(ctx.read, employmentId, ctx.date, ctx.tunables, 'release');
  if (severanceFactor === undefined) {
    return base;
  }
  if (!Number.isFinite(severanceFactor.value) || severanceFactor.value < 0) {
    throw new InvalidArgumentError(
      'releaseEmployment',
      'severanceFactor',
      severanceFactor.value,
      'a factor of zero or more',
    );
  }
  return startCalc('Severance', base, { unit: 'money', docRef: SEVERANCE_DOC_REF })
    .multiply(severanceFactor.label, severanceFactor.value)
    .round('floor', 'To whole cents')
    .done();
}

/**
 * Releases a worker. Throws `InvalidArgumentError` (rolling the caller's step back) for an unknown
 * employment, one that is neither active nor signed, or a negative factor. Does not check who may
 * release whom: the command does that, and ECO9/SOC6 decide for their own promotions.
 */
export function releaseEmployment(
  ctx: DoorContext,
  args: ReleaseEmploymentArgs,
): ReleaseEmploymentResult {
  const employment = ctx.read.tables.employments.get(args.employmentId);
  if (employment === undefined) {
    throw new InvalidArgumentError(
      'releaseEmployment',
      'employmentId',
      args.employmentId,
      'an existing employment',
    );
  }
  if (employment.status !== 'active' && employment.status !== 'signed') {
    throw new InvalidArgumentError(
      'releaseEmployment',
      'employmentId',
      args.employmentId,
      `an active or signed contract (this one is ${employment.status})`,
    );
  }
  const severance = releaseSeverance(ctx, employment.id, args.severanceFactor);
  const to = employment.status === 'active' ? 'released' : 'withdrawn';
  const mutual =
    to === 'released' && employment.morale <= ctx.tunables.get('contracts.severance.mutualMorale');
  const ended = endEmployment(ctx, {
    employmentId: employment.id,
    to,
    reasonKey: args.reasonKey,
    source: args.source,
    mutual,
    severance,
  });
  return {
    to,
    mutual,
    severance: ended.severance,
    traceRef: ended.traceRef,
    ledgerEntryId: ended.ledgerEntryId,
    ledgerTraceRef: ended.ledgerTraceRef,
  };
}
