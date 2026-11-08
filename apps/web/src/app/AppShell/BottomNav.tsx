import { NavLink } from 'react-router-dom';
import { CountBadge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import type { NavItem } from '../navigation';
import { classNames } from '@/components/classNames';
import styles from './AppShell.module.css';
import { NavItemContent } from './NavItemContent';
import type { NavBadgeCounts } from './useNavBadges';

const tabClass = classNames(styles['tab']);

export interface BottomNavProps {
  /** The phone primaries in slot order (up to four). */
  readonly items: readonly NavItem[];
  readonly badges: NavBadgeCounts;
  /** Whether the current page lives behind "More" rather than in one of the tabs. */
  readonly moreIsCurrent: boolean;
  readonly moreOpen: boolean;
  readonly onOpenMore: () => void;
  /** The badge counts of the items only the More sheet lists, added up. 0 shows no badge. */
  readonly moreCount?: number;
}

/**
 * The phone tab bar, fixed to the bottom edge: the four primaries and "More", each an icon over a
 * condensed capital label. The current tab turns red-orange with a bar along its top edge.
 */
export function BottomNav({
  items,
  badges,
  moreIsCurrent,
  moreOpen,
  onOpenMore,
  moreCount = 0,
}: BottomNavProps) {
  return (
    <nav aria-label="Primary" className={styles['bottomNav']} data-testid="bottom-nav">
      <ul className={styles['bottomNavList']}>
        {items.map((item) => (
          <li key={item.id}>
            <NavLink to={item.to} className={tabClass} data-nav-item={item.id}>
              <NavItemContent item={item} badges={badges} short />
            </NavLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={styles['tab']}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            data-current={moreIsCurrent ? 'true' : 'false'}
            onClick={onOpenMore}
          >
            <Icon name="more" size="md" className={styles['navIcon']} decorative />
            <span className={styles['navLabel']}>More</span>
            <CountBadge
              count={moreCount}
              label={`${String(moreCount)} waiting in More`}
              className={styles['navBadge']}
            />
          </button>
        </li>
      </ul>
    </nav>
  );
}
