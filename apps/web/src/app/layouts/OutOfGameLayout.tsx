import { Outlet } from 'react-router-dom';
import { MAIN_CONTENT_ID, SkipLink } from '../a11y/SkipLink';
import styles from './OutOfGameLayout.module.css';

/**
 * The frame for screens outside a game (title, load, new game, settings): centred content with
 * no navigation chrome.
 */
export function OutOfGameLayout() {
  return (
    <div className={styles['layout']}>
      <SkipLink />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles['main']}>
        <Outlet />
      </main>
    </div>
  );
}
