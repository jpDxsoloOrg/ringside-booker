/**
 * Renewal policies: who gets a say when an active contract reaches its end date.
 *
 * Before `contracts.lifecycle` expires a contract it asks every registered policy in turn (by
 * `order`, then id). The first answer that is not null wins: `{ renew: false }` lets the contract
 * run out, `{ renew: true, endsOn, trace }` extends it. A renewal writes only `endsOn`, records the
 * trace at `contracts.aiRenewal` / `<employmentId>:<date>` and publishes `contract.renewed`. When
 * every policy answers null the contract expires.
 *
 * The built-in policy is the simple rival renewal (`simpleRivalRenewal.ts`, a D-01 stopgap until
 * ECO6). ECO5 adds the player's renewals; ECO6 replaces the rival rule.
 *
 * Module-level, like `registerSetupStep`: a system registers at module load and tests remove what
 * they added. Design: docs/design/contracts.md#lifecycle.
 */

import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { StreamName } from '../../core/rng/streams';
import type { RngStream } from '../../core/rng/registry';
import type { TraceNode } from '../../core/trace/types';
import type { Employment } from '../../model/entities/employment';
import type { DeepReadonly } from '../../model/world';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';

/** What a renewal policy can read besides the world. */
export interface RenewalDeps {
  readonly tunables: EngineTunables;
  readonly rng: (name: StreamName) => RngStream;
}

/** A policy's answer. Null means "not mine to decide": the next policy is asked. */
export type RenewalAnswer =
  | { readonly renew: false }
  | { readonly renew: true; readonly endsOn: GameDate; readonly trace: TraceNode }
  | null;

export interface RenewalPolicy {
  /** `system.camelName`, for example `contracts.simpleRivalRenewal`. */
  readonly id: string;
  /** Lower is asked first; equal orders by id. */
  readonly order: number;
  /**
   * Decides for one active contract whose end date has come. Reads only; the lifecycle writes the
   * answer. A renewal's `endsOn` must be after `date`.
   */
  readonly decide: (
    read: GameWorldView,
    employment: DeepReadonly<Employment>,
    date: GameDate,
    deps: RenewalDeps,
  ) => RenewalAnswer;
}

const policies = new Map<string, RenewalPolicy>();

/**
 * Adds a renewal policy. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id, an order that is not a finite number, or an id that
 *   is already registered.
 */
export function registerRenewalPolicy(policy: RenewalPolicy): () => void {
  if (!PHASE_ID_PATTERN.test(policy.id)) {
    throw new RegistryError(
      `Renewal policy "${policy.id}": the id must look like "system.camelName", for example "contracts.simpleRivalRenewal"`,
      { id: policy.id },
    );
  }
  if (!Number.isFinite(policy.order)) {
    throw new RegistryError(`Renewal policy "${policy.id}": the order must be a finite number`, {
      id: policy.id,
    });
  }
  if (policies.has(policy.id)) {
    throw new RegistryError(
      `Renewal policy "${policy.id}": a policy with this id is already registered`,
      { id: policy.id },
    );
  }
  const stored: RenewalPolicy = { ...policy };
  policies.set(policy.id, stored);
  return () => {
    if (policies.get(policy.id) === stored) {
      policies.delete(policy.id);
    }
  };
}

/** Every registered policy, in the order they are asked: by `order`, then id. */
export function renewalPolicies(): RenewalPolicy[] {
  return [...policies.values()].sort(
    (left, right) =>
      left.order - right.order || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
  );
}

/**
 * Removes every policy, built-in ones included, and returns a function that puts them all back
 * (for tests that want to install only their own).
 */
export function clearRenewalPoliciesForTests(): () => void {
  const saved = [...policies.values()];
  policies.clear();
  return () => {
    policies.clear();
    for (const policy of saved) {
      policies.set(policy.id, policy);
    }
  };
}
