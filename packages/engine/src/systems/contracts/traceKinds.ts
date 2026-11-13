/**
 * The trace kinds the contracts system stores under.
 *
 * - `contracts.severance`, id = the employment: how a severance payment was worked out.
 * - `contracts.aiRenewal`, id = `<employmentId>:<date>`: why a renewal policy renewed a contract.
 */

import type { GameDate } from '../../core/date';
import type { EmploymentId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';

export const CONTRACT_TRACE_KINDS = {
  severance: 'contracts.severance',
  aiRenewal: 'contracts.aiRenewal',
} as const;

/** Where a contract's severance trace is stored. */
export function severanceTraceRef(employmentId: EmploymentId): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.severance, id: employmentId };
}

/** Where a renewal's trace is stored. */
export function renewalTraceRef(employmentId: EmploymentId, date: GameDate): TraceRef {
  return { kind: CONTRACT_TRACE_KINDS.aiRenewal, id: `${employmentId}:${date}` };
}
