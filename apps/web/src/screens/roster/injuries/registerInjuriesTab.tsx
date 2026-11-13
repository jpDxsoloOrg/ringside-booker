/**
 * Adds the Injuries tab to Your promotion > Roster (WRK6-06), at its reserved order 70, after the
 * role tabs, and tells the day control the tab exists, so the own-injury stop's "Roster" button
 * opens it (`?tab=injuries`). Imported once by the router, like the other features' tabs; the
 * panel loads with the tab, so neither the main bundle nor the roster's chunk carries it.
 */
import { lazy, Suspense } from 'react';
import { INJURIES_TAB_ID, setRosterInjuriesTabAvailable } from '@/app/AppShell/day/dayControlState';
import { isRosterTabRegistered, registerRosterTab } from '../rosterTabRegistry';
import type { RosterTabDefinition } from '../rosterTabRegistry';

const InjuriesPanel = lazy(async () => {
  const { InjuriesTab } = await import('./InjuriesTab');
  return { default: InjuriesTab };
});

export const INJURIES_TAB: RosterTabDefinition = {
  id: INJURIES_TAB_ID,
  label: 'Injuries',
  order: 70,
  render: ({ promotionId }) => (
    <Suspense fallback={<p role="status">Loading injuries…</p>}>
      <InjuriesPanel promotionId={promotionId} />
    </Suspense>
  ),
};

if (!isRosterTabRegistered(INJURIES_TAB_ID)) registerRosterTab(INJURIES_TAB);
setRosterInjuriesTabAvailable(isRosterTabRegistered(INJURIES_TAB_ID));
