/**
 * Contract negotiation on Business › Contracts (ECO5-06): the Free agents (order 40) and Offers
 * (order 50, with a count of counter-offers waiting) tabs, Renew on your contracts (their sheet
 * and every Expiring row), and the worker profile's Offer contract / Renew contract action. Imported once by the router, like the other features'
 * registrations; each tab's panel loads with the tab.
 */
import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { useSessionStore } from '@/app/session/sessionStore';
import { EmptyState } from '@/components/EmptyState';
import { registerContractsTab } from '../contractsTabs';
import type { ContractsTabContext } from '../contractsTabs';
import { registerContractRowAction } from '../rowActions';
import { CounteredOffersBadge } from '../offers/OffersTab';
import { registerProfileAction } from '@/screens/workers/profile/profileActions';
import { ProfileContractAction } from './ProfileContractAction';
import { isRenewable, RenewAction } from './RenewAction';

const FreeAgentsTab = lazy(async () => {
  const { FreeAgentsTab: Tab } = await import('../freeAgents/FreeAgentsTab');
  return { default: Tab };
});

const OffersTab = lazy(async () => {
  const { OffersTab: Tab } = await import('../offers/OffersTab');
  return { default: Tab };
});

export const FREE_AGENTS_TAB_ID = 'free-agents';
export const OFFERS_TAB_ID = 'offers';
export const RENEW_ACTION_ID = 'renew';

const NO_PROMOTION_TEXT = 'Run a promotion to talk contracts.';

function withPromotion(
  context: ContractsTabContext,
  draw: (promotionId: NonNullable<ContractsTabContext['promotionId']>) => ReactNode,
): ReactNode {
  if (context.promotionId === null) {
    return <EmptyState icon="contracts" title={NO_PROMOTION_TEXT} />;
  }
  return <Suspense fallback={<p role="status">Loading…</p>}>{draw(context.promotionId)}</Suspense>;
}

registerContractsTab({
  id: FREE_AGENTS_TAB_ID,
  label: 'Free agents',
  order: 40,
  render: (context) =>
    withPromotion(context, (promotionId) => (
      <FreeAgentsTab promotionId={promotionId} openNegotiation={context.openNegotiation} />
    )),
});

registerContractsTab({
  id: OFFERS_TAB_ID,
  label: 'Offers',
  order: 50,
  badge: CounteredOffersBadge,
  render: (context) =>
    withPromotion(context, (promotionId) => (
      <OffersTab promotionId={promotionId} openNegotiation={context.openNegotiation} />
    )),
});

registerContractRowAction({
  id: RENEW_ACTION_ID,
  label: 'Renew',
  visible: (row) => isRenewable(row, useSessionStore.getState().seat?.promotionId ?? null),
  render: RenewAction,
  onExpiringRows: true,
});

export const CONTRACT_PROFILE_ACTION_ID = 'contract';

registerProfileAction({
  id: CONTRACT_PROFILE_ACTION_ID,
  order: 10,
  render: (context) => <ProfileContractAction context={context} />,
});
