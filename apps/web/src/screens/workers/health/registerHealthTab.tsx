/**
 * Adds the Health tab to every worker profile (WRK6-05), at order 50: right after the built-in
 * Career tab and before the Form tab (55). Shown for everyone, rival workers included, because
 * health is public. Imported once by the router, like the other features' tabs; the panel loads
 * with the tab, so neither the main bundle nor the profile's chunk carries it. `?tab=health` opens
 * it, which is where the own-injury stop sends the player.
 */
import { lazy, Suspense } from 'react';
import { registerProfileTab } from '../profile/profileTabs';
import type { ProfileTabDefinition } from '../profile/profileTabs';

const HealthPanel = lazy(async () => {
  const { HealthPanel: Panel } = await import('./HealthTab');
  return { default: Panel };
});

export const HEALTH_TAB_ID = 'health';

export const HEALTH_TAB: ProfileTabDefinition = {
  id: HEALTH_TAB_ID,
  label: 'Health',
  order: 50,
  visible: () => true,
  render: ({ personId }) => (
    <Suspense fallback={<p role="status">Loading health…</p>}>
      <HealthPanel personId={personId} />
    </Suspense>
  ),
};

registerProfileTab(HEALTH_TAB);
