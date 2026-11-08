import { Link, useLocation } from 'react-router-dom';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { isNoWorldRedirect } from '@/app/RequireWorld';
import { routes } from '@/app/routes';
import { settingsLinkState } from '@/app/settings/settingsNavigation';
import styles from './HomePlaceholderScreen.module.css';

/** Stand-in title screen until the real one (with save slots) arrives. */
export function HomePlaceholderScreen() {
  useDocumentTitle(null);
  const location = useLocation();
  const cameFromGameRoute = isNoWorldRedirect(location.state);

  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['title']}>Ringside Booker</RouteHeading>
      <p className={styles['version']}>Version {__APP_VERSION__}</p>
      {cameFromGameRoute && (
        <p className={styles['notice']} role="status">
          Load or start a game first.
        </p>
      )}
      <ul className={styles['links']}>
        <li>
          <Link to={routes.newGame()}>New game</Link>
        </li>
        <li>
          <Link to={routes.load()}>Load game</Link>
        </li>
        <li>
          <Link to={routes.settings()} state={settingsLinkState(routes.title())}>
            Settings
          </Link>
        </li>
        <li>
          <Link to={routes.dev.gallery()}>Gallery</Link>
        </li>
      </ul>
    </div>
  );
}
