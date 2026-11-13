/**
 * Adds the Form tab to the worker profile (MTCH3-04), at order 55, for wrestlers and occasional
 * wrestlers only. Imported once by the router, like the other features' shell hooks; the panel
 * itself loads with the tab, so neither the main bundle nor the profile's chunk carries it.
 */
import { lazy, Suspense } from 'react';
import { registerProfileTab } from '../profileTabs';
import type { ProfileTabContext, ProfileTabDefinition } from '../profileTabs';

const RecentFormPanel = lazy(async () => {
  const { RecentFormPanel: Panel } = await import('./RecentFormPanel');
  return { default: Panel };
});

export const RECENT_FORM_TAB_ID = 'recent-form';

/** True for someone who wrestles, full time or now and then. */
export function hasRecentForm({ profile }: Pick<ProfileTabContext, 'profile'>): boolean {
  const { roles } = profile.header;
  return roles.includes('wrestler') || roles.includes('occasionalWrestler');
}

export const RECENT_FORM_TAB: ProfileTabDefinition = {
  id: RECENT_FORM_TAB_ID,
  label: 'Form',
  order: 55,
  visible: hasRecentForm,
  render: ({ personId }) => (
    <Suspense fallback={<p role="status">Loading recent form…</p>}>
      <RecentFormPanel personId={personId} />
    </Suspense>
  ),
};

registerProfileTab(RECENT_FORM_TAB);
