import type { NavBadgeKey } from '../navigation';

export type NavBadgeCounts = Readonly<Record<NavBadgeKey, number>>;

const NO_BADGES: NavBadgeCounts = { unreadMail: 0, pendingDecisions: 0 };

/**
 * The counts nav items show in their badges. All zero until there is mail and decisions to count;
 * the inbox epic replaces the body with engine queries and nothing else in the shell changes.
 */
export function useNavBadges(): NavBadgeCounts {
  return NO_BADGES;
}

/** What a screen reader hears for a badge, such as "3 unread". */
export const NAV_BADGE_LABELS: Readonly<Record<NavBadgeKey, (count: number) => string>> = {
  unreadMail: (count) => `${String(count)} unread`,
  pendingDecisions: (count) => `${String(count)} waiting`,
};
