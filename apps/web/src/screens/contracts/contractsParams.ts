import { isId } from '@ringside/engine';
import type { ContractsTab, EmploymentId, NegotiationId, PersonId } from '@ringside/engine';

/**
 * The Contracts screen's state in the URL, so a reload, Back and the day bar's Contracts button
 * all land in the same place: `?tab=expiring`, `?employment=emp_…` (the open contract) and
 * `?wantsToLeave=1` (only workers who asked to leave). The Negotiation Sheet (ECO5-06) opens from
 * `?negotiation=neg_…` (your talks), `?person=per_…` (a new offer) or `?renew=emp_…` (a renewal),
 * on any tab: `?tab=offers&negotiation=neg_…` and `?tab=free-agents&person=per_…` are the usual
 * pairs.
 */

export const TAB_PARAM = 'tab';
export const EMPLOYMENT_PARAM = 'employment';
export const WANTS_TO_LEAVE_PARAM = 'wantsToLeave';
export const NEGOTIATION_PARAM = 'negotiation';
export const PERSON_PARAM = 'person';
export const RENEW_PARAM = 'renew';

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

/** The tab id the URL names, or null when it names none (registered tabs are checked by the screen). */
export function tabIdFromSearch(search: URLSearchParams): string | null {
  return search.get(TAB_PARAM);
}

/** `search` with any registered tab set. Changing tab closes the open contract and talks. */
export function searchWithTabId(search: URLSearchParams, tab: string): URLSearchParams {
  const next = searchWithNegotiation(search, null);
  next.set(TAB_PARAM, tab);
  next.delete(EMPLOYMENT_PARAM);
  return next;
}

/** What the Negotiation Sheet is open on. */
export type NegotiationTarget =
  | { readonly kind: 'talks'; readonly negotiationId: NegotiationId }
  | { readonly kind: 'signing'; readonly personId: PersonId }
  | { readonly kind: 'renewal'; readonly employmentId: EmploymentId };

/** The open talks, new offer or renewal the URL names, or null. Talks win over the others. */
export function negotiationTargetFromSearch(search: URLSearchParams): NegotiationTarget | null {
  const negotiationId = search.get(NEGOTIATION_PARAM);
  if (isId('negotiation', negotiationId)) return { kind: 'talks', negotiationId };
  const employmentId = search.get(RENEW_PARAM);
  if (isId('employment', employmentId)) return { kind: 'renewal', employmentId };
  const personId = search.get(PERSON_PARAM);
  if (isId('person', personId)) return { kind: 'signing', personId };
  return null;
}

/** `search` with the Negotiation Sheet opened on `target`, or closed with null. */
export function searchWithNegotiation(
  search: URLSearchParams,
  target: NegotiationTarget | null,
): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(NEGOTIATION_PARAM);
  next.delete(PERSON_PARAM);
  next.delete(RENEW_PARAM);
  if (target === null) return next;
  switch (target.kind) {
    case 'talks':
      next.set(NEGOTIATION_PARAM, target.negotiationId);
      break;
    case 'signing':
      next.set(PERSON_PARAM, target.personId);
      break;
    case 'renewal':
      next.set(RENEW_PARAM, target.employmentId);
      break;
  }
  return next;
}

/** The Contracts address for a tab and, optionally, talks to open: `/game/contracts?tab=offers&negotiation=neg_…`. */
export function contractsSearch(tab: string, target: NegotiationTarget | null = null): string {
  const search = searchWithNegotiation(new URLSearchParams({ [TAB_PARAM]: tab }), target);
  return `?${search.toString()}`;
}
