import { useId } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { NavSection } from '../navigation';
import { routes } from '../routes';
import { classNames } from '@/components/classNames';
import styles from './AppShell.module.css';
import { NavItemContent } from './NavItemContent';
import type { NavBadgeCounts } from './useNavBadges';

const navLinkClass = classNames(styles['navLink']);

export interface SidebarProps {
  /** The sections to show, already filtered for the viewer. */
  readonly sections: readonly NavSection[];
  readonly badges: NavBadgeCounts;
}

/** The desktop left sidebar: the game's name, every visible section, then settings and exit. */
export function Sidebar({ sections, badges }: SidebarProps) {
  const headingIdPrefix = useId();

  return (
    <div className={styles['sidebar']} data-testid="sidebar">
      <Link to={routes.game.office()} className={styles['brand']}>
        Ringside Booker
      </Link>
      <nav aria-label="Main" className={styles['sidebarNav']}>
        {sections.map((section) => {
          const headingId = `${headingIdPrefix}-${section.id}`;
          return (
            <section
              key={section.id}
              className={styles['navSection']}
              data-nav-section={section.id}
            >
              <h2 id={headingId} className={styles['navSectionHeading']}>
                {section.label}
              </h2>
              <ul className={styles['navList']} aria-labelledby={headingId}>
                {section.items.map((item) => (
                  <li key={item.id}>
                    <NavLink to={item.to} className={navLinkClass} data-nav-item={item.id}>
                      <NavItemContent item={item} badges={badges} />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
      <ul className={styles['sidebarFooter']}>
        <li>
          <Link to={routes.settings()} className={styles['navLink']}>
            <Icon name="settings" size="md" className={styles['navIcon']} decorative />
            <span className={styles['navLabel']}>Settings</span>
          </Link>
        </li>
        <li>
          <Link to={routes.title()} className={styles['navLink']}>
            <Icon name="log-out" size="md" className={styles['navIcon']} decorative />
            <span className={styles['navLabel']}>Main menu</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
