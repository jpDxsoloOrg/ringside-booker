import { CountBadge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import type { NavItem } from '../navigation';
import styles from './AppShell.module.css';
import { NAV_BADGE_LABELS } from './useNavBadges';
import type { NavBadgeCounts } from './useNavBadges';

export interface NavItemContentProps {
  readonly item: NavItem;
  readonly badges: NavBadgeCounts;
  /** Use the item's short label, for the phone bottom bar. */
  readonly short?: boolean;
}

/** Icon, label and count badge: what every nav link shows, wherever it sits. */
export function NavItemContent({ item, badges, short = false }: NavItemContentProps) {
  const count = item.badgeKey === undefined ? 0 : badges[item.badgeKey];
  const label = short ? (item.shortLabel ?? item.label) : item.label;

  return (
    <>
      <Icon name={item.icon} size="md" className={styles['navIcon']} />
      <span className={styles['navLabel']}>{label}</span>
      {item.badgeKey !== undefined && (
        <CountBadge
          count={count}
          label={NAV_BADGE_LABELS[item.badgeKey](count)}
          className={styles['navBadge']}
        />
      )}
    </>
  );
}
