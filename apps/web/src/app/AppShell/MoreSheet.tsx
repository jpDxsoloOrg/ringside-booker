import { useId } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import type { NavSection } from '../navigation';
import { routes } from '../routes';
import { settingsLinkState } from '../settings/settingsNavigation';
import { classNames } from '@/components/classNames';
import styles from './AppShell.module.css';
import { NavItemContent } from './NavItemContent';
import type { NavBadgeCounts } from './useNavBadges';

const navLinkClass = classNames(styles['navLink']);

export interface MoreSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The sections to list, already filtered for the viewer. */
  readonly sections: readonly NavSection[];
  readonly badges: NavBadgeCounts;
}

/**
 * The phone's full navigation, in a bottom sheet behind "More": every visible section and item,
 * then settings and the way back to the main menu. Following a link closes it.
 */
export function MoreSheet({ open, onClose, sections, badges }: MoreSheetProps) {
  const headingIdPrefix = useId();
  // Settings' back link returns to the game screen the player was on.
  const location = useLocation();

  return (
    <Sheet open={open} onClose={onClose} title="Menu" side="bottom" size="lg">
      <div className={styles['moreBody']} data-testid="more-sheet">
        {sections.map((section) => {
          const headingId = `${headingIdPrefix}-${section.id}`;
          return (
            <section
              key={section.id}
              className={styles['navSection']}
              data-nav-section={section.id}
            >
              <h3 id={headingId} className={styles['navSectionHeading']}>
                {section.label}
              </h3>
              <ul className={styles['navList']} aria-labelledby={headingId}>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      to={item.to}
                      className={navLinkClass}
                      data-nav-item={item.id}
                      onClick={onClose}
                    >
                      <NavItemContent item={item} badges={badges} />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <ul className={styles['moreFooter']}>
          <li>
            <Link
              to={routes.settings()}
              state={settingsLinkState(`${location.pathname}${location.search}`)}
              className={styles['navLink']}
              onClick={onClose}
            >
              <Icon name="settings" size="md" className={styles['navIcon']} decorative />
              <span className={styles['navLabel']}>Settings</span>
            </Link>
          </li>
          <li>
            <Link to={routes.title()} className={styles['navLink']} onClick={onClose}>
              <Icon name="log-out" size="md" className={styles['navIcon']} decorative />
              <span className={styles['navLabel']}>Main menu</span>
            </Link>
          </li>
        </ul>
      </div>
    </Sheet>
  );
}
