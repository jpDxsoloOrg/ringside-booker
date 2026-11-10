import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ImageSlot } from '@/components/ImageSlot';
import { Ticker } from '@/components/Ticker';
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
import { EnginePromotion } from './EnginePromotion';
import { LoadNoticeBanner } from './LoadNoticeBanner';
import { MoreSheet } from './MoreSheet';
import { NextDaySlot } from './NextDaySlot';
import { shellPreview } from './shellPreview';
import type { ShellPromotion } from './shellPreview';
import { Sidebar } from './Sidebar';
import { StatusStrip } from './StatusStrip';
import { TopBar } from './TopBar';
import type { TopBarLayout } from './TopBar';
import { TopBarStatus } from './TopBarStatus';
import { countBehindMore, useNavBadges } from './useNavBadges';

export interface AppShellProps {
  /** The navigation to show. The app's own config by default; tests pass their own. */
  readonly sections?: readonly NavSection[];
  /** Replaces the page title at the start of the top bar. */
  readonly topBarStart?: ReactNode;
  /**
   * Draws the end of the top bar (status and the day control), told whether it is compact. By
   * default it is the game's status and the day control whenever an engine is running, and the
   * sample status strip with the unwired Next Day bug while no world answers; tests and the
   * gallery pass their own.
   */
  readonly renderTopBarEnd?: (layout: TopBarLayout) => ReactNode;
  /**
   * The strip along the bottom edge, such as the news `Ticker`: under the content on desktop and
   * just above the tab bar on a phone. Sample headlines by default; `null` leaves it out.
   */
  readonly ticker?: ReactNode;
  /** The screen to show. The nested route's outlet by default. */
  readonly children?: ReactNode;
}

/**
 * The in-game frame (docs/design/visual-identity.md). On desktop: a sidebar on the left with the
 * game's name, the promotion's crest and the sectioned navigation; a top bar with the page title,
 * the status strip and the live Next Day bug; a main area that scrolls on its own; and the ticker
 * along the bottom. On phones: a compact top bar that keeps Next Day, the content, the ticker and
 * a fixed bottom tab bar whose "More" button opens the full navigation in a sheet.
 *
 * Everything it lists comes from `navigation.ts`, filtered for whether the local seat runs a
 * promotion, so adding a screen never touches this file.
 *
 * With an engine above it and a world loaded, the top bar ends with the game's status and the day
 * control, and the summary of the last multi-day advance sits at the top of the content. Without
 * an engine (some tests) or a world that answers (the dev helper's faked world), the top bar shows
 * the sample status strip and the unwired Next Day bug instead, marked as a sample.
 */
export function AppShell({
  sections = navigationSections,
  topBarStart,
  renderTopBarEnd,
  ticker,
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
  const preview = useMemo(() => shellPreview({ hasPromotion }), [hasPromotion]);
  const navLocation = findNavLocation(visibleSections, location.pathname);

  // The sheet belongs to the page it was opened on, so any navigation closes it.
  const [moreOpenedAt, setMoreOpenedAt] = useState<string | null>(null);
  const moreOpen = isMobile && moreOpenedAt === location.key;
  const moreIsCurrent =
    navLocation !== null && !primaries.some((item) => item.id === navLocation.item.id);

  const hasEngine = useOptionalEngineClient() !== null;
  const layout: TopBarLayout = { compact: isMobile };
  const sampleTopBarEnd = (
    <>
      <StatusStrip status={preview.status} compact={isMobile} sample />
      <NextDaySlot {...layout} />
    </>
  );
  let topBarEnd: ReactNode;
  if (renderTopBarEnd !== undefined) {
    topBarEnd = renderTopBarEnd(layout);
  } else if (hasEngine) {
    topBarEnd = <TopBarStatus compact={layout.compact} fallback={sampleTopBarEnd} />;
  } else {
    topBarEnd = sampleTopBarEnd;
  }
  const tickerContent =
    ticker === undefined ? (
      <Ticker label={preview.tickerLabel} items={preview.headlines} ariaLabel="News ticker" />
    ) : (
      ticker
    );
  const renderShell = (promotion: ShellPromotion | null, sample: boolean) => {
    const crest =
      isMobile && promotion !== null ? (
        <ImageSlot
          subject={{
            kind: 'promotion',
            id: promotion.id,
            name: promotion.name,
            shortName: promotion.shortName,
          }}
          size="sm"
          decorative
        />
      ) : undefined;

    return (
      <div
        className={styles['shell']}
        data-layout={isMobile ? 'mobile' : 'desktop'}
        data-ticker={tickerContent === null ? 'off' : 'on'}
      >
        <SkipLink />
        {!isMobile && (
          <Sidebar
            sections={visibleSections}
            badges={badges}
            promotion={promotion}
            sample={sample}
          />
        )}
        <TopBar
          location={navLocation}
          compact={isMobile}
          {...(crest === undefined ? {} : { crest })}
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
        {tickerContent !== null && (
          <div className={styles['tickerSlot']} data-testid="ticker-slot">
            {tickerContent}
          </div>
        )}
        {isMobile && (
          <>
            <BottomNav
              items={primaries}
              badges={badges}
              moreCount={countBehindMore(visibleSections, primaries, badges)}
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
  };

  // With an engine the crest shows the promotion the save runs (UI-18); without one, the sample.
  return hasEngine ? (
    <DayAdvanceProvider>
      <EnginePromotion fallback={preview.promotion}>{renderShell}</EnginePromotion>
    </DayAdvanceProvider>
  ) : (
    renderShell(preview.promotion, true)
  );
}
