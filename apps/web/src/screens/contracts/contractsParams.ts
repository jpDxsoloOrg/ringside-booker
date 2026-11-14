import { isId } from '@ringside/engine';
import type { ContractsTab, EmploymentId } from '@ringside/engine';

/**
 * The Contracts screen's state in the URL, so a reload, Back and the day bar's Contracts button
 * all land in the same place: `?tab=expiring`, `?employment=emp_…` (the open contract) and
 * `?wantsToLeave=1` (only workers who asked to leave).
 */

export const TAB_PARAM = 'tab';
export const EMPLOYMENT_PARAM = 'employment';
export const WANTS_TO_LEAVE_PARAM = 'wantsToLeave';

export const CONTRACT_TABS: readonly ContractsTab[] = ['active', 'expiring', 'ended'];

/** The tab shown when the URL names none, or one that does not exist. */
export const DEFAULT_CONTRACTS_TAB: ContractsTab = 'active';

export const CONTRACT_TAB_LABELS: Readonly<Record<ContractsTab, string>> = {
  active: 'Active',
  expiring: 'Expiring',
  ended: 'Ended',
};

export function isContractsTab(value: string | null): value is ContractsTab {
  return CONTRACT_TABS.some((tab) => tab === value);
}

export function tabFromSearch(search: URLSearchParams): ContractsTab {
  const asked = search.get(TAB_PARAM);
  return isContractsTab(asked) ? asked : DEFAULT_CONTRACTS_TAB;
}

export function employmentFromSearch(search: URLSearchParams): EmploymentId | null {
  const asked = search.get(EMPLOYMENT_PARAM);
  return isId('employment', asked) ? asked : null;
}

export function wantsToLeaveFromSearch(search: URLSearchParams): boolean {
  return search.get(WANTS_TO_LEAVE_PARAM) === '1';
}

/** `search` with the tab set. Changing tab closes the open contract; the filter stays. */
export function searchWithTab(search: URLSearchParams, tab: ContractsTab): URLSearchParams {
  const next = new URLSearchParams(search);
  next.set(TAB_PARAM, tab);
  next.delete(EMPLOYMENT_PARAM);
  return next;
}

/** `search` with the open contract set, or cleared with null. */
export function searchWithEmployment(
  search: URLSearchParams,
  employmentId: EmploymentId | null,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (employmentId === null) next.delete(EMPLOYMENT_PARAM);
  else next.set(EMPLOYMENT_PARAM, employmentId);
  return next;
}

/** `search` with the "Wants to leave" filter on or off. */
export function searchWithWantsToLeave(search: URLSearchParams, on: boolean): URLSearchParams {
  const next = new URLSearchParams(search);
  if (on) next.set(WANTS_TO_LEAVE_PARAM, '1');
  else next.delete(WANTS_TO_LEAVE_PARAM);
  return next;
}
