/**
 * Adds the Shows tab to the promotion profile (AIP4-07) at order 40, the rival desk's slot after
 * Roster. Shown wherever the Decision log is: for a rival, and for your own promotion when the
 * computer runs one of its brands (your own cards are on the booking screen). Imported once by the
 * router, like the other features' shell hooks; the tab itself loads with its panel, so neither
 * the main bundle nor the profile's chunk carries it.
 */
import { lazy, Suspense } from 'react';
import { registerPromotionTab } from '../promotionTabs';
import type { PromotionTabContext, PromotionTabDefinition } from '../promotionTabs';

const ShowsTab = lazy(async () => {
  const { ShowsTab: Tab } = await import('./ShowsTab');
  return { default: Tab };
});

export const SHOWS_TAB_ID = 'shows';

/** The Decision log's rule (`decisionLogVisible`), kept here so the router skips its module. */
export function showsTabVisible({ isOwn, profile }: PromotionTabContext): boolean {
  return !isOwn || profile.header.brands.some((brand) => brand.controlledBy === 'computer');
}

export const SHOWS_TAB: PromotionTabDefinition = {
  id: SHOWS_TAB_ID,
  label: 'Shows',
  order: 40,
  visible: showsTabVisible,
  render: ({ promotionId }) => (
    <Suspense fallback={<p role="status">Loading the shows…</p>}>
      <ShowsTab promotionId={promotionId} />
    </Suspense>
  ),
};

registerPromotionTab(SHOWS_TAB);
