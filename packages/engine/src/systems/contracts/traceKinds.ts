/**
 * The trace kinds the contracts system stores under.
 *
 * - `contracts.severance`, id = the employment: how a severance payment was worked out.
 * - `contracts.aiRenewal`, id = `<employmentId>:<date>`: why a renewal policy renewed a contract.
 * - `contracts.unhappy`, id = the employment: the player's worker's unhappy clock today (ECO4-03,
 *   replaced daily, the player's promotions only).
 * - `contracts.walkout`, id = the employment: today's walk-out chance and roll (ECO4-03, the
 *   player's promotions only).
 * - `contracts.aiRelease`, id = the employment: how a rival answered a release request (ECO4-03).
 */

import type { GameDate } from '../../core/date';
import type { EmploymentId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

export const CONTRACT_TRACE_KINDS = {
  severance: 'contracts.severance',
  aiRenewal: 'contracts.aiRenewal',
  unhappy: 'contracts.unhappy',
  walkout: 'contracts.walkout',
  aiRelease: 'contracts.aiRelease',
} as const;

/** Where a contract's severance trace is stored. */
export function severanceTraceRef(employmentId: EmploymentId): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.severance, id: employmentId };
}

/** Where a renewal's trace is stored. */
export function renewalTraceRef(employmentId: EmploymentId, date: GameDate): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.aiRenewal, id: `${employmentId}:${date}` };
}

/** Where a worker's unhappy clock trace is stored (ECO4-03). */
export function unhappyTraceRef(employmentId: EmploymentId): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.unhappy, id: employmentId };
}

/** Where a worker's latest walk-out roll is stored (ECO4-03). */
export function walkoutTraceRef(employmentId: EmploymentId): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.walkout, id: employmentId };
}

/** Where a rival's answer to a release request is stored (ECO4-03). */
export function aiReleaseTraceRef(employmentId: EmploymentId): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.aiRelease, id: employmentId };
}
