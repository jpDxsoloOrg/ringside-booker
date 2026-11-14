/**
 * The contract lifecycle: what `contracts.lifecycle` does each day.
 *
 * In this order, each list in ID order from the `byStatus` index:
 *
 * 1. every active contract whose end date has come (`endsOn <= date`) asks the renewal policies
 *    (`renewals.ts`); the first non-null answer wins, and with no renewal the contract expires
 *    through `endEmployment` (`contracts.endDate`);
 * 2. every signed contract whose start date has come (`startsOn <= date`) becomes active and
 *    publishes `contract.started`. When the person has another active contract and either one is
 *    exclusive, the other one ends first as a quit (`exclusiveDeal`), so an exclusive conflict
 *    never exists;
 * 3. the `afterLifecycle` hooks run (ECO4-02 fills them with expiry notices).
 *
 * Ending before starting means a same-day handover never holds two active contracts. The work is
 * idempotent within a day: run a second time on the same date it finds nothing left to do, which is
 * what lets the player's show night run it before the day (`contracts.beforeShow`). Hooks must be
 * idempotent within a day too.
 *
 * Design: docs/design/contracts.md#lifecycle.
 */

import { compareDates } from '../../core/date';
import { InvalidArgumentError, RegistryError } from '../../core/errors';
import type { PhaseContext } from '../../core/pipeline/context';
import { traced } from '../../core/trace/helpers';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { EmploymentId } from '../../core/ids';
import { canTransition, type Employment } from '../../model/entities/employment';
import type { DeepReadonly } from '../../model/world';
import type { DoorContext } from '../workers/doors';
import { endEmployment } from './endEmployment';
import { renewalPolicies, type RenewalAnswer } from './renewals';
import { renewalTraceRef } from './traceKinds';

/** The reason key of a contract that ran out on its end date. */
export const END_DATE_REASON_KEY = 'contracts.endDate';
/** The reason key of a contract ended because an exclusive deal elsewhere started. */
export const EXCLUSIVE_DEAL_REASON_KEY = 'contracts.exclusiveDeal';

// ---------------------------------------------------------------------------------------------
// afterLifecycle hooks

/** Work that runs right after the day's lifecycle, in the same step. */
export interface AfterLifecycleHook {
  /** `system.camelName`, for example `contracts.expiryNotices`. */
  readonly id: string;
  /** Lower runs first; equal orders run by id. */
  readonly order: number;
  /** Writes through `ctx.tx`. Must be idempotent within a day (it can run twice on show night). */
  readonly run: (ctx: PhaseContext) => void;
}

const afterHooks = new Map<string, AfterLifecycleHook>();

/**
 * Adds an after-lifecycle hook. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number or an id that is
 *   already registered.
 */
export function registerAfterLifecycle(hook: AfterLifecycleHook): () => void {
  if (!PHASE_ID_PATTERN.test(hook.id)) {
    throw new RegistryError(
      `After-lifecycle hook "${hook.id}": the id must look like "system.camelName", for example "contracts.expiryNotices"`,
      { id: hook.id },
    );
  }
  if (!Number.isFinite(hook.order)) {
    throw new RegistryError(
      `After-lifecycle hook "${hook.id}": the order must be a finite number`,
      {
        id: hook.id,
      },
    );
  }
  if (afterHooks.has(hook.id)) {
    throw new RegistryError(
      `After-lifecycle hook "${hook.id}": a hook with this id is already registered`,
      { id: hook.id },
    );
  }
  const stored: AfterLifecycleHook = { ...hook };
  afterHooks.set(hook.id, stored);
  return () => {
    if (afterHooks.get(hook.id) === stored) {
      afterHooks.delete(hook.id);
    }
  };
}

/** Every registered after-lifecycle hook, in the order they run: by `order`, then id. */
export function afterLifecycleHooks(): AfterLifecycleHook[] {
  return [...afterHooks.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------------------------
// The day's work

function askPolicies(ctx: PhaseContext, employment: DeepReadonly<Employment>): RenewalAnswer {
  const deps = { tunables: ctx.tunables, rng: ctx.rng };
  for (const policy of renewalPolicies()) {
    const answer = policy.decide(ctx.read, employment, ctx.date, deps);
    if (answer !== null) {
      return answer;
    }
  }
  return null;
}

/** Step 1: renew or expire every active contract whose end date has come. */
function endDueContracts(ctx: PhaseContext): void {
  const due = ctx.read.tables.employments
    .lookup('byStatus', 'active')
    .filter(
      (employment) => employment.endsOn !== null && compareDates(employment.endsOn, ctx.date) <= 0,
    );
  for (const employment of due) {
    const answer = askPolicies(ctx, employment);
    if (answer?.renew === true) {
      renew(ctx, employment, answer);
      continue;
    }
    endEmployment(ctx, {
      employmentId: employment.id,
      to: 'expired',
      reasonKey: END_DATE_REASON_KEY,
      source: 'system',
    });
  }
}

function renew(
  ctx: PhaseContext,
  employment: DeepReadonly<Employment>,
  answer: Extract<RenewalAnswer, { renew: true }>,
): void {
  const previousEndsOn = employment.endsOn;
  if (previousEndsOn === null || compareDates(answer.endsOn, ctx.date) <= 0) {
    throw new InvalidArgumentError(
      'contracts.lifecycle',
      'endsOn',
      answer.endsOn,
      `a renewed end date after ${ctx.date}`,
    );
  }
  ctx.tx.update('employments', employment.id, { endsOn: answer.endsOn });
  const promotion = ctx.read.tables.promotions.get(employment.promotionId);
  ctx.recordTrace(
    renewalTraceRef(employment.id, ctx.date),
    ctx.date,
    traced(answer.trace.value, answer.trace),
    { summaryOnly: promotion?.controller.kind !== 'human' },
  );
  ctx.publish('contract.renewed', {
    employmentId: employment.id,
    personId: employment.personId,
    promotionId: employment.promotionId,
    previousEndsOn,
    endsOn: answer.endsOn,
    source: promotion?.controller.kind === 'human' ? 'player' : 'ai',
  });
}

/** Step 2: start every signed contract whose start date has come. */
function startDueContracts(ctx: PhaseContext): void {
  const due = ctx.read.tables.employments
    .lookup('byStatus', 'signed')
    .filter((employment) => compareDates(employment.startsOn, ctx.date) <= 0);
  for (const signed of due) {
    startContract(ctx, signed.id);
  }
}

/**
 * Starts one signed contract (`signed → active`) and publishes `contract.started`. When the person
 * has another active contract and either one is exclusive, the other one ends first as a quit
 * (`exclusiveDeal`), so an exclusive conflict never exists. The lifecycle calls it for every
 * contract whose start date has come; a signing that starts today calls it straight away
 * (ECO5-05's `signNegotiation`), so it does not depend on the phase order.
 *
 * @throws InvalidArgumentError when the employment is not `signed`.
 */
export function startContract(ctx: DoorContext, employmentId: EmploymentId): void {
  const signed = ctx.read.tables.employments.require(employmentId);
  if (!canTransition(signed.status, 'active')) {
    throw new InvalidArgumentError(
      'startContract',
      'employmentId',
      employmentId,
      `a signed employment (it is ${signed.status})`,
    );
  }
  for (const other of ctx.read.tables.employments.lookup('byPerson', signed.personId)) {
    if (
      other.id !== signed.id &&
      other.status === 'active' &&
      (other.terms.exclusive || signed.terms.exclusive)
    ) {
      endEmployment(ctx, {
        employmentId: other.id,
        to: 'quit',
        how: 'exclusiveDeal',
        reasonKey: EXCLUSIVE_DEAL_REASON_KEY,
        source: 'system',
        severance: null,
      });
    }
  }
  ctx.tx.update('employments', signed.id, { status: 'active' });
  ctx.publish('contract.started', {
    employmentId: signed.id,
    personId: signed.personId,
    promotionId: signed.promotionId,
  });
}

/** The whole day's lifecycle: ends, then starts, then the hooks. */
export function runContractLifecycle(ctx: PhaseContext): void {
  endDueContracts(ctx);
  startDueContracts(ctx);
  for (const hook of afterLifecycleHooks()) {
    hook.run(ctx);
  }
}
