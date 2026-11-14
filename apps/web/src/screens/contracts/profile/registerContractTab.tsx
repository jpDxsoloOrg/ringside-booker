/**
 * Adds the Contract tab to every worker profile (ECO4-04), at order 60: after Health (50) and
 * Form (55). Shown while the worker has a signed or active contract. Your own worker's tab shows
 * the terms with Release and any request to leave; a rival's shows the promotion, kind and dates
 * with "Terms private". Imported once by the router, like the other features' tabs; the panel
 * loads with the tab.
 */
import { lazy, Suspense } from 'react';
import { registerProfileTab } from '@/screens/workers/profile/profileTabs';
import type { ProfileTabDefinition } from '@/screens/workers/profile/profileTabs';
import { liveContractIds } from './liveContracts';

const ContractSummary = lazy(async () => {
  const { ContractSummary: Summary } = await import('./ContractSummary');
  return { default: Summary };
});

export const CONTRACT_TAB_ID = 'contract';

export const CONTRACT_TAB: ProfileTabDefinition = {
  id: CONTRACT_TAB_ID,
  label: 'Contract',
  order: 60,
  visible: ({ profile, viewerPromotionId }) =>
    liveContractIds(profile, viewerPromotionId).length > 0,
  render: ({ profile, viewerPromotionId }) => (
    <Suspense fallback={<p role="status">Loading the contract…</p>}>
      <ContractSummary employmentIds={liveContractIds(profile, viewerPromotionId)} />
    </Suspense>
  ),
};

registerProfileTab(CONTRACT_TAB);
