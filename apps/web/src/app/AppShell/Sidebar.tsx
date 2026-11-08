import { useId } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import type { NavSection } from '../navigation';
import { routes } from '../routes';
import { settingsLinkState } from '../settings/settingsNavigation';
import { classNames } from '@/components/classNames';
import styles from './AppShell.module.css';
import { MainMenuButton } from './MainMenuButton';
import { NavItemContent } from './NavItemContent';
import type { ShellPromotion } from './shellPreview';
import type { NavBadgeCounts } from './useNavBadges';

const navLinkClass = classNames(styles['navLink']);

export interface SidebarProps {
  /** The sections to show, already filtered for the viewer. */
  readonly sections: readonly NavSection[];
  readonly badges: NavBadgeCounts;
  /** The promotion the player runs, for the crest block. Null while unemployed. */
  readonly promotion?: ShellPromotion | null;
  /** Marks the promotion block as sample data. */
  readonly sample?: boolean;
}

/**
 * The desktop left sidebar: the game's wordmark, the promotion's crest and name, every visible
 * section, then settings and "Main menu". The current page has a red-orange rail down its edge.
 */
export function Sidebar({ sections, badges, promotion = null, sample = false }: SidebarProps) {
  const headingIdPrefix = useId();
  // Settings' back link returns to the game screen the player was on.
  const location = useLocation();

  return (
    <div className={styles['sidebar']} data-testid="sidebar">
      <Link to={routes.game.office()} className={styles['brand']}>
        <span>Ringside</span> <span className={styles['brandAccent']}>Booker</span>
      </Link>
      <PromotionBlock promotion={promotion} sample={sample} />
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
          <Link
            to={routes.settings()}
            state={settingsLinkState(`${location.pathname}${location.search}`)}
            className={styles['navLink']}
          >
            <Icon name="settings" size="md" className={styles['navIcon']} decorative />
            <span className={styles['navLabel']}>Settings</span>
          </Link>
        </li>
        <li>
          <MainMenuButton />
        </li>
      </ul>
    </div>
  );
}

interface PromotionBlockProps {
  readonly promotion: ShellPromotion | null;
  readonly sample: boolean;
}

/** The crest and name of the promotion the player runs, or a plain note while unemployed. */
function PromotionBlock({ promotion, sample }: PromotionBlockProps) {
  if (promotion === null) {
    return (
      <div className={styles['promotionBlock']} data-testid="promotion-block">
        <span className={styles['promotionCrestEmpty']}>
          <Icon name="user-search" size="md" decorative />
        </span>
        <p className={styles['promotionText']}>
          <span className={styles['promotionName']}>No promotion</span>
          <span className={styles['promotionTagline']}>Free agent booker</span>
        </p>
      </div>
    );
  }
  return (
    <div className={styles['promotionBlock']} data-testid="promotion-block">
      <ImageSlot
        subject={{
          kind: 'promotion',
          id: promotion.id,
          name: promotion.name,
          shortName: promotion.shortName,
        }}
        size="md"
        decorative
      />
      <p className={styles['promotionText']}>
        <span className={styles['promotionName']}>{promotion.name}</span>
        <span className={styles['promotionTagline']}>
          {promotion.tagline}
          {sample && (
            <Badge tone="neutral" className={styles['promotionSample']}>
              Sample
            </Badge>
          )}
        </span>
      </p>
    </div>
  );
}
