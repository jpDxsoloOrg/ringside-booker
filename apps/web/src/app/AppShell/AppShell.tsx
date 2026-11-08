import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsMobile } from '@/styles/useMediaQuery';
import { MAIN_CONTENT_ID, SkipLink } from '../a11y/SkipLink';
import { useOptionalEngineClient } from '../engine/EngineProvider';
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
import { AdvanceSummary } from './day/AdvanceSummary';
import { DayAdvanceProvider } from './day/DayAdvanceProvider';
import { LoadNoticeBanner } from './LoadNoticeBanner';
import { MoreSheet } from './MoreSheet';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { TopBarLayout } from './TopBar';
import { TopBarStatus } from './TopBarStatus';
import { useNavBadges } from './useNavBadges';

export interface AppShellProps {
  /** The navigation to show. The app's own config by default; tests pass their own. */
  readonly sections?: readonly NavSection[];
  /** Replaces the page title at the start of the top bar. */
  readonly topBarStart?: ReactNode;
  /**
   * Draws the end of the top bar, told whether it is compact. The game's status and the day
   * control by default, whenever an engine is running; tests and the gallery pass their own.
   */
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
 *
 * With an engine above it, the top bar ends with the game's status and the day control, and the
 * summary of the last multi-day advance sits at the top of the content. A shell rendered without
 * an engine (some tests) leaves both out.
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

  const hasEngine = useOptionalEngineClient() !== null;
  const layout: TopBarLayout = { compact: isMobile };
  let topBarEnd: ReactNode | undefined;
  if (renderTopBarEnd !== undefined) {
    topBarEnd = renderTopBarEnd(layout);
  } else if (hasEngine) {
    topBarEnd = <TopBarStatus compact={layout.compact} />;
  }

  const shell = (
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
        <div className={styles['content']}>
          {hasEngine && <AdvanceSummary />}
          <LoadNoticeBanner />
          {children ?? <Outlet />}
        </div>
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

  return hasEngine ? <DayAdvanceProvider>{shell}</DayAdvanceProvider> : shell;
}
