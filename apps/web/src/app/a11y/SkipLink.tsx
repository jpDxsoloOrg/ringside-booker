import type { MouseEvent } from 'react';
import styles from './a11y.module.css';

/** The id of the element every layout's main content area carries. */
export const MAIN_CONTENT_ID = 'main';

/**
 * "Skip to content": the first thing a keyboard user reaches on a page, hidden until it has focus.
 * It moves focus to the main content area so they do not tab through the whole navigation.
 */
export function SkipLink() {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (main === null) return;
    // Focus directly instead of following the #main fragment, which would add a history entry.
    event.preventDefault();
    // Focusing scrolls the main area into view as well.
    main.focus();
  };

  return (
    <a href={`#${MAIN_CONTENT_ID}`} className={styles['skipLink']} onClick={handleClick}>
      Skip to content
    </a>
  );
}
