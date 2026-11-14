import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useOptionalEngineClient } from '../engine/EngineProvider';
import { queryKey } from '../engine/queryCache';
import type { NavBadgeKey, NavItem, NavSection } from '../navigation';
import { useHasPromotion } from '../session/sessionStore';

export type NavBadgeCounts = Readonly<Record<NavBadgeKey, number>>;

const COUNTS_KEY = queryKey('contracts.counts', {});
const NO_UNSUBSCRIBE = (): void => undefined;

/**
 * Your workers with an open release request, from `contracts.counts` (ECO4-04). Read straight
 * from the query cache so the shell still draws outside an `EngineProvider` (the shell's own
 * tests), where it is 0.
 */
function useWantsToLeave(enabled: boolean): number {
  const client = useOptionalEngineClient();
  const subscribeEntry = useCallback(
    (onChange: () => void) => client?.cache.subscribe(COUNTS_KEY, onChange) ?? NO_UNSUBSCRIBE,
    [client],
  );
  const entry = useSyncExternalStore(
    subscribeEntry,
    () => client?.cache.peek(COUNTS_KEY),
    () => client?.cache.peek(COUNTS_KEY),
  );
  const subscribeRevision = useCallback(
    (onChange: () => void) => client?.status.subscribe(onChange) ?? NO_UNSUBSCRIBE,
    [client],
  );
  const revision = useSyncExternalStore(
    subscribeRevision,
    () => client?.status.getState().revision ?? 0,
    () => client?.status.getState().revision ?? 0,
  );
  const entryRevision = entry?.revision;
  useEffect(() => {
    if (client === null || !enabled) return;
    if (entryRevision !== undefined && entryRevision >= revision) return;
    void client.fetchQuery('contracts.counts', {});
  }, [client, enabled, entryRevision, revision]);
  if (!enabled || !entry?.outcome.ok) return 0;
  const count: unknown = Reflect.get(Object(entry.outcome.data), 'wantsToLeave');
  return typeof count === 'number' ? count : 0;
}

/**
 * The counts nav items show in their badges. Mail and decisions are zero until the inbox epic
 * replaces them with engine queries; `wantsToLeave` (Contracts) counts your workers with an open
 * release request (ECO4-04).
 */
export function useNavBadges(): NavBadgeCounts {
  const wantsToLeave = useWantsToLeave(useHasPromotion());
  return useMemo(() => ({ unreadMail: 0, pendingDecisions: 0, wantsToLeave }), [wantsToLeave]);
}

/** What a screen reader hears for a badge, such as "3 unread". */
export const NAV_BADGE_LABELS: Readonly<Record<NavBadgeKey, (count: number) => string>> = {
  unreadMail: (count) => `${String(count)} unread`,
  pendingDecisions: (count) => `${String(count)} waiting`,
  wantsToLeave: (count) => `${String(count)} ${count === 1 ? 'wants' : 'want'} to leave`,
};

/**
 * The total of the badges on items that only the More sheet lists, so the phone's More tab can
 * show that something behind it needs a look. Items in the tab bar show their own badge.
 */
export function countBehindMore(
  visibleSections: readonly NavSection[],
  primaries: readonly NavItem[],
  badges: NavBadgeCounts,
): number {
  const inTabBar = new Set(primaries.map((item) => item.id));
  return visibleSections
    .flatMap((section) => section.items)
    .filter((item) => !inTabBar.has(item.id) && item.badgeKey !== undefined)
    .reduce((total, item) => total + (item.badgeKey === undefined ? 0 : badges[item.badgeKey]), 0);
}
