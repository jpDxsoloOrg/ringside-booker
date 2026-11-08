import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/styles/useMediaQuery';
import { MAIN_CONTENT_ID, SkipLink } from '../a11y/SkipLink';
import {
  findNavLocation,
  mobilePrimaryItems,
  navigationSections,
  visibleNavigation,
} from '../navigation';
import type { NavSection } from '../navigation';
import { useHasPromotion } from '../session/sessionStore';
import styles from './AppShell.module.css';
import { BottomNav } from './BottomNav';
import { MoreSheet } from './MoreSheet';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { TopBarLayout } from './TopBar';
import { useNavBadges } from './useNavBadges';

export interface AppShellProps {
  /** The navigation to show. The app's own config by default; tests pass their own. */
  readonly sections?: readonly NavSection[];
  /** Replaces the page title at the start of the top bar. */
  readonly topBarStart?: ReactNode;
  /** Draws the end of the top bar (status and the day control), told whether it is compact. */
  readonly renderTopBarEnd?: (layout: TopBarLayout) => ReactNode;
  /** The screen to show. The nested route's outlet by default. */
  readonly children?: ReactNode;
}

/**
 * The in-game frame. On desktop: a sectioned sidebar on the left, a top bar, and a main area that
 * scrolls on its own. On phones: a compact top bar, the content, and a fixed bottom tab bar whose
 * "More" button opens the full navigation in a sheet.
 *
 * Everything it lists comes from `navigation.ts`, filtered for whether the local seat runs a
 * promotion, so adding a screen never touches this file.
 */
export function AppShell({
  sections = navigationSections,
  topBarStart,
  renderTopBarEnd,
  children,
}: AppShellProps) {
  const isMobile = useIsMobile();
  const hasPromotion = useHasPromotion();
  const location = useLocation();
  const badges = useNavBadges();

  const visibleSections = useMemo(
    () => visibleNavigation(sections, { hasPromotion }),
    [sections, hasPromotion],
  );
  const primaries = useMemo(() => mobilePrimaryItems(visibleSections), [visibleSections]);
  const navLocation = findNavLocation(visibleSections, location.pathname);

  // The sheet belongs to the page it was opened on, so any navigation closes it.
  const [moreOpenedAt, setMoreOpenedAt] = useState<string | null>(null);
  const moreOpen = isMobile && moreOpenedAt === location.key;
  const moreIsCurrent =
    navLocation !== null && !primaries.some((item) => item.id === navLocation.item.id);

  const topBarEnd = renderTopBarEnd?.({ compact: isMobile });

  return (
    <div className={styles['shell']} data-layout={isMobile ? 'mobile' : 'desktop'}>
      <SkipLink />
      {!isMobile && <Sidebar sections={visibleSections} badges={badges} />}
      <TopBar
        location={navLocation}
        compact={isMobile}
        {...(topBarStart === undefined ? {} : { start: topBarStart })}
        {...(topBarEnd === undefined ? {} : { end: topBarEnd })}
      />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles['main']}>
        <div className={styles['content']}>{children ?? <Outlet />}</div>
      </main>
      {isMobile && (
        <>
          <BottomNav
            items={primaries}
            badges={badges}
            moreIsCurrent={moreIsCurrent}
            moreOpen={moreOpen}
            onOpenMore={() => {
              setMoreOpenedAt(location.key);
            }}
          />
          <MoreSheet
            open={moreOpen}
            onClose={() => {
              setMoreOpenedAt(null);
            }}
            sections={visibleSections}
            badges={badges}
          />
        </>
      )}
    </div>
  );
}
