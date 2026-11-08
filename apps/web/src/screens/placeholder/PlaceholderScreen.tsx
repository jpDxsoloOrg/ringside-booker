import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { EmptyState } from '@/components/EmptyState';
import styles from './PlaceholderScreen.module.css';

export interface PlaceholderScreenProps {
  /** The screen's name, shown as its heading and in the document title. */
  readonly title: string;
}

/** Stands in for a screen whose feature has not been built yet. */
export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  useDocumentTitle(title);

  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{title}</RouteHeading>
      <EmptyState
        size="page"
        icon="settings"
        title="This screen isn't built yet"
        body="It arrives with the feature it belongs to."
      />
    </div>
  );
}
