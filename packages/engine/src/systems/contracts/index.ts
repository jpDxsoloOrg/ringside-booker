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
// Registers the built-in renewal policies and the expiry-notice hook.
import './simpleRivalRenewal';
import './playerAutoRenewal';
import './notices';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { contractsCommands } from './commands';
import { expiringSoonGate, releaseRequestedGate } from './gates';
import { contractsPhases } from './phases';
import { contractsQueries } from './queries';

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

// ECO4-02: severance, releases, contract queries and the "expiring soon" stop.
export {
  DAYS_PER_MONTH,
  severance,
  SEVERANCE_FORMULA_DOC_REF,
  type SeveranceDeps,
  type SeveranceInputs,
} from './formulas/severance';
export { severanceFor, type SeveranceMode } from './severanceFor';
export {
  RELEASE_REASON_KEY,
  releaseEmployment,
  releaseSeverance,
  type ReleaseEmploymentArgs,
  type ReleaseEmploymentResult,
} from './release';
export { RELEASE_REASON_CODES, releaseRefusals, type ReleaseReasonCode } from './rules';
export {
  ACKNOWLEDGE_MAX_EXPIRIES,
  acknowledgeExpiriesCommand,
  contractsCommands,
  releaseCommand,
  type ReleaseResult,
} from './commands';
export {
  CONTRACTS_ACTION_HINT,
  EXPIRING_SOON_GATE_ID,
  expiringSoonGate,
  expiringSoonReason,
  unseenExpiringContracts,
} from './gates';
export {
  EXPIRY_NOTICES_HOOK_ID,
  expiryNoticesHook,
  humanPromotionIds,
  raiseExpiryNotices,
} from './notices';
export {
  PLAYER_AUTO_RENEWAL_NOTE,
  PLAYER_AUTO_RENEWAL_POLICY_ID,
  PLAYER_RENEWALS_DOC_REF,
  playerAutoRenewalPolicy,
} from './playerAutoRenewal';
export {
  CONTRACT_PERK_KEYS,
  changesSinceQuery,
  contractsQueries,
  countsQuery,
  detailQuery,
  listQuery,
  releasePreviewQuery,
  type ContractChange,
  type ContractChanges,
  type ContractCounts,
  type ContractDetail,
  type ContractEndReason,
  type ContractPerkKey,
  type ContractRow,
  type ContractsTab,
  type HeldTitle,
  type OwnContractDetail,
  type PrivateContractDetail,
  type ReleasePreview,
  type ReleaseWarning,
  type ReleaseWarningCode,
} from './queries';

// ECO4-03: unhappy workers, release requests, refusals and walk-outs.
export { WALKOUT_STREAM } from './streams';
export { aiReleaseTraceRef, unhappyTraceRef, walkoutTraceRef } from './traceKinds';
export { grantShare } from './severanceFor';
export { hotStorylineFor, hotStorylineText, type HotStoryline } from './storyPause';
export {
  IRON_CLAD_NEVER_WALKS,
  walkoutChance,
  WALKOUTS_DOC_REF,
  type WalkoutChanceDeps,
  type WalkoutChanceInputs,
} from './formulas/walkoutChance';
export {
  AI_RELEASE_RULES,
  aiReleaseDecision,
  RIVAL_RULES_DOC_REF,
  type AiReleaseChoice,
  type AiReleaseInputs,
} from './formulas/aiReleaseDecision';
export {
  grantRequest,
  grantSeverance,
  IGNORED_RELEASE_LABEL,
  raiseRequest,
  refusalMoraleDelta,
  refuseRequest,
  REFUSED_RELEASE_LABEL,
  REFUSED_RELEASE_REASON_KEY,
  RELEASE_GRANTED_REASON_KEY,
  requestOf,
  UNHAPPY_DOC_REF,
  WALKOUT_REASON_KEY,
  walkoutChanceFor,
} from './requests';
export { runUnhappyWorkers } from './unhappy';
export { UNHAPPY_WORKERS_PHASE_ID, unhappyWorkersPhase } from './phases';
export {
  openReleaseRequests,
  RELEASE_REQUESTED_GATE_ID,
  releaseRequestedGate,
  releaseRequestedReason,
} from './gates';
export { ANSWER_REASON_CODES, answerRefusals, type AnswerReasonCode } from './rules';
export {
  answerReleaseRequestCommand,
  type AnswerReleaseResult,
  type ReleaseAnswer,
} from './commands';
export {
  answerPreviewQuery,
  type AnswerPreview,
  type RequestView,
  type UnhappyView,
  type WalkoutView,
} from './queries';

export const contractsSystem: SystemBundle = defineSystem({
  id: 'contracts',
  phases: contractsPhases,
  gates: [expiringSoonGate, releaseRequestedGate],
  queries: contractsQueries,
  commands: contractsCommands,
});
