import { useEffect } from 'react';

/** The game's name, the last part of every document title. */
export const APP_TITLE = 'Ringside Booker';

/** The full document title for a page: `Roster · Ringside Booker`, or just the game's name. */
export function documentTitleFor(pageTitle: string | null): string {
  return pageTitle === null || pageTitle === '' ? APP_TITLE : `${pageTitle} · ${APP_TITLE}`;
}

/**
 * Sets `document.title` while the calling screen is shown, so browser tabs, history and screen
 * readers name the page. Pass null on a screen that is the game itself, such as the title screen.
 */
export function useDocumentTitle(pageTitle: string | null): void {
  useEffect(() => {
    document.title = documentTitleFor(pageTitle);
  }, [pageTitle]);
}
