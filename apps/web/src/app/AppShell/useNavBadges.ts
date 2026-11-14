import { useMemo } from 'react';
import { useEngineQuery } from '../engine/useEngineQuery';
import type { NavBadgeKey, NavItem, NavSection } from '../navigation';
import { useHasPromotion } from '../session/sessionStore';

export type NavBadgeCounts = Readonly<Record<NavBadgeKey, number>>;

/**
 * The counts nav items show in their badges. Mail and decisions are zero until the inbox epic
 * replaces them with engine queries; `wantsToLeave` (Contracts) counts your workers with an open
 * release request (ECO4-04, `contracts.counts`).
 */
export function useNavBadges(): NavBadgeCounts {
  const hasPromotion = useHasPromotion();
  const contracts = useEngineQuery(
    'contracts.counts',
    {},
    { enabled: hasPromotion, keepPreviousData: true },
  );
  const wantsToLeave =
    hasPromotion && contracts.status === 'success' ? (contracts.data?.wantsToLeave ?? 0) : 0;
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
