import { Link } from 'react-router-dom';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { routes } from '@/app/routes';
import { EmptyState } from '@/components/EmptyState';
import styles from './NotFoundScreen.module.css';

const PAGE_TITLE = 'Page not found';

/** What any unknown path shows, including a mistyped deep link the host served the app for. */
export function NotFoundScreen() {
  useDocumentTitle(PAGE_TITLE);

  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{PAGE_TITLE}</RouteHeading>
      <EmptyState
        size="page"
        icon="search"
        title="There is nothing at this address"
        body={
          <>
            The link may be mistyped or out of date.{' '}
            <Link to={routes.title()}>Back to the main menu</Link>
          </>
        }
      />
    </div>
  );
}
