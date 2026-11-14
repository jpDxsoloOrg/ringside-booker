import type { EmploymentId, PromotionId, WorkerProfile } from '@ringside/engine';

/**
 * The worker's signed and active contracts, the viewer's own promotion's first, then newest
 * first (the profile's own order). Usually one; a worker on non-exclusive deals can have more.
 */
export function liveContractIds(
  profile: WorkerProfile,
  viewerPromotionId: PromotionId | null,
): EmploymentId[] {
  const live = profile.career.contracts.filter(
    (contract) => contract.status === 'active' || contract.status === 'signed',
  );
  const own = live.filter((contract) => contract.promotionId === viewerPromotionId);
  const others = live.filter((contract) => contract.promotionId !== viewerPromotionId);
  return [...own, ...others].map((contract) => contract.employmentId);
}
