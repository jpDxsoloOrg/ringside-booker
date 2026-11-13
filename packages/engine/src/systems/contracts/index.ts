/**
 * The contracts system (ECO4-01): contracts move along their lifecycle over time.
 *
 * A daily phase (`contracts.lifecycle`, `phases.ts`) starts signed deals on their start date and
 * expires active deals on their end date, after asking the renewal policies (`renewals.ts`; the
 * built-in `contracts.simpleRivalRenewal` keeps rival rosters stocked until ECO6). Every contract
 * ending goes through one door, `endEmployment` (`endEmployment.ts`), which publishes one event
 * (`events.ts`) and pays any severance through `postMoney`. Per-contract state the later tickets
 * need lives in the `contractConcerns` table. Rival contracts are private: nothing here exposes
 * their terms or morale to the player.
 *
 * Layout follows the reference system (`systems/health/`). Design: docs/design/contracts.md.
 */

// The stream and event declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
// Registers the built-in renewal policy.
import './simpleRivalRenewal';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { contractsPhases } from './phases';

export type { ContractQuitHow } from './events';
export { AI_RENEWAL_STREAM } from './streams';
export { CONTRACT_TRACE_KINDS, renewalTraceRef, severanceTraceRef } from './traceKinds';
export { CONTRACTS_TUNABLE_CATEGORY, contractsTunables } from './tunables';
export { titlesHeldBy } from './titles';
export {
  clearRenewalPoliciesForTests,
  registerRenewalPolicy,
  renewalPolicies,
  type RenewalAnswer,
  type RenewalDeps,
  type RenewalPolicy,
} from './renewals';
export { SIMPLE_RIVAL_RENEWAL_POLICY_ID, simpleRivalRenewalPolicy } from './simpleRivalRenewal';
export {
  AI_RENEWAL_RULES,
  aiRenewalDecision,
  computeRenewalDays,
  isPushAtOrAbove,
  SIMPLE_RENEWALS_DOC_REF,
  type AiRenewalChoice,
  type AiRenewalInputs,
  type AiRenewalResult,
} from './formulas/aiRenewalDecision';
export {
  END_EMPLOYMENT_DOC_REF,
  endEmployment,
  SEVERANCE_DOC_REF,
  type EndEmploymentArgs,
  type EndEmploymentResult,
  type EndEmploymentTo,
} from './endEmployment';
export {
  afterLifecycleHooks,
  END_DATE_REASON_KEY,
  EXCLUSIVE_DEAL_REASON_KEY,
  registerAfterLifecycle,
  runContractLifecycle,
  type AfterLifecycleHook,
} from './lifecycle';
export {
  CONTRACT_LIFECYCLE_PHASE_ID,
  contractLifecyclePhase,
  CONTRACTS_BEFORE_SHOW_HOOK_ID,
  contractsBeforeShowHook,
  contractsPhases,
} from './phases';

export const contractsSystem: SystemBundle = defineSystem({
  id: 'contracts',
  phases: contractsPhases,
  gates: [],
  queries: [],
  commands: [],
});
