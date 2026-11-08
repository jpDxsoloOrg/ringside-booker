import type { ReactNode } from 'react';
import type { NavLocation } from '../navigation';
import styles from './AppShell.module.css';

/** What the top bar's end slot is told about the layout it is drawn in. */
export interface TopBarLayout {
  /** True on phones, where the bar is short of room. */
  readonly compact: boolean;
}

export interface TopBarProps {
  /** Where the player is, for the "Section › Page" title. Null on a page no nav item owns. */
  readonly location: NavLocation | null;
  readonly compact: boolean;
  /** Replaces the default page title at the start of the bar. */
  readonly start?: ReactNode;
  /**
   * The end of the bar: the status chips and the day control live here. On a phone it may shrink,
   * so the page title gives way before the day button does.
   */
  readonly end?: ReactNode;
}

/** The bar above the content: the page title at the start, the game status at the end. */
export function TopBar({ location, compact, start, end }: TopBarProps) {
  return (
    <header className={styles['topBar']} data-compact={compact ? 'true' : 'false'}>
      <div className={styles['topBarStart']}>
        {start ?? <PageTitle location={location} compact={compact} />}
      </div>
      {end !== undefined && (
        <div className={styles['topBarEnd']} data-compact={compact ? 'true' : 'false'}>
          {end}
        </div>
      )}
    </header>
  );
}

interface PageTitleProps {
  readonly location: NavLocation | null;
  readonly compact: boolean;
}

/** "Section › Page" on desktop; just the page on a phone. */
function PageTitle({ location, compact }: PageTitleProps) {
  if (location === null) {
    return <p className={styles['pageTitle']}>Ringside Booker</p>;
  }
  if (compact) {
    return <p className={styles['pageTitle']}>{location.item.label}</p>;
  }
  return (
    <p className={styles['pageTitle']}>
      <span className={styles['crumbSection']}>{location.section.label}</span>
      <span className={styles['crumbSeparator']} aria-hidden="true">
        ›
      </span>
      <span>{location.item.label}</span>
    </p>
  );
}
