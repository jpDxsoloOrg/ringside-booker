import { Outlet } from 'react-router-dom';
import { classNames } from '@/components/classNames';
import { MAIN_CONTENT_ID, SkipLink } from '../a11y/SkipLink';
import styles from './OutOfGameLayout.module.css';

/**
 * How wide the content column may grow: `narrow` (the default) for single-column screens such as
 * the title and settings, `wide` for a screen with side panels, such as the new-game wizard.
 */
export type OutOfGameWidth = 'narrow' | 'wide';

export interface OutOfGameLayoutProps {
  readonly width?: OutOfGameWidth;
}

/**
 * The frame for screens outside a game (title, load, new game, settings): centred content with
 * no navigation chrome.
 */
export function OutOfGameLayout({ width = 'narrow' }: OutOfGameLayoutProps) {
  return (
    <div className={styles['layout']}>
      <SkipLink />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={classNames(styles['main'], width === 'wide' && styles['wide'])}
      >
        <Outlet />
      </main>
    </div>
  );
}
