/**
 * A promotion's latest title changes (AIP5-05), from `aip.recentTitleChanges`: the title's belt,
 * "<new champion> won the <title>", "beat <previous> · ended a <n>-day reign", the date and a link
 * to the show's results, and the rival booker's reason with its Why? while the breakdown is kept.
 * Changes on your own shows carry no booker's reason, so they show none. Props only: the gallery
 * draws it without an engine; `RecentTitleChangesPanel` feeds it from the query.
 */
import { Link } from 'react-router-dom';
import type { AipTitleChange, TraceNode, TraceRef } from '@ringside/engine';
import { routes } from '@/app/routes';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import styles from './RecentTitleChanges.module.css';

export const NO_TITLE_CHANGES_TEXT = 'No title changes yet';

/** Names joined for a sentence: "A", "A and B", "A, B and C". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** "Dante Rivers won the Coastal Heavyweight Title". */
export function titleChangeHeadline(change: Pick<AipTitleChange, 'newHolderNames' | 'titleName'>) {
  const winners = namesText(change.newHolderNames);
  return `${winners === '' ? 'New champions' : winners} won the ${change.titleName}`;
}

/** "beat Big Joe Sato · ended a 212-day reign", "won the vacant title", or null. */
export function titleChangeDetail(
  change: Pick<AipTitleChange, 'previousHolderNames' | 'previousReignDays'>,
): string {
  if (change.previousHolderNames.length === 0) return 'Won the vacant title';
  const beat = `Beat ${namesText(change.previousHolderNames)}`;
  if (change.previousReignDays === null) return beat;
  return `${beat} · ended a ${formatNumber(change.previousReignDays)}-day reign`;
}

/** The name of a change's Why? button: "Why the change? Coastal Heavyweight Title, Mar 7". */
export function titleChangeWhyLabel(change: Pick<AipTitleChange, 'titleName' | 'wonOn'>): string {
  return `Why the change? ${change.titleName}, ${formatGameDate(change.wonOn, 'short')}`;
}

export interface RecentTitleChangesListProps {
  /** Newest first, as the query gives them. */
  readonly changes: readonly AipTitleChange[];
  /** Hands a breakdown over inline instead of fetching it (the gallery has no engine). */
  readonly traceOf?: ((ref: TraceRef) => TraceNode | null) | undefined;
  /** The empty state's heading level. 3 by default, under the panel's. */
  readonly headingLevel?: 3 | 4;
}

export function RecentTitleChangesList({
  changes,
  traceOf,
  headingLevel = 3,
}: RecentTitleChangesListProps) {
  if (changes.length === 0) {
    return (
      <EmptyState
        icon="titles"
        size="inline"
        headingLevel={headingLevel}
        title={NO_TITLE_CHANGES_TEXT}
      />
    );
  }
  return (
    <ol className={styles['list']} aria-label="Recent title changes">
      {changes.map((change) => {
        const source = traceSourceOf(
          change.traceRef === null ? null : traceOf?.(change.traceRef),
          change.traceRef,
        );
        return (
          <li
            key={`${change.titleId}-${change.wonOn}`}
            className={styles['item']}
            data-part="title-change"
          >
            <ImageSlot
              subject={{ kind: 'title', id: change.titleId, name: change.titleName }}
              size="sm"
              decorative
            />
            <div className={styles['text']}>
              <p className={styles['headline']}>{titleChangeHeadline(change)}</p>
              <p className={styles['detail']}>{titleChangeDetail(change)}</p>
              <p className={styles['when']}>
                <time dateTime={change.wonOn}>{formatGameDate(change.wonOn, 'long')}</time>
                {change.eventInstanceId !== null && (
                  <>
                    {' · '}
                    <Link
                      className={styles['showLink']}
                      to={routes.game.showResults(change.eventInstanceId)}
                    >
                      {change.showName ?? 'See results'}
                    </Link>
                  </>
                )}
              </p>
              {change.reasonText !== null && change.reasonText !== '' && (
                <div className={styles['reason']}>
                  <span>{change.reasonText}</span>
                  {source !== null && (
                    <WhyButton
                      label={change.titleName}
                      value={change.reasonText}
                      buttonLabel={titleChangeWhyLabel(change)}
                      panelTitle={`Why the change? ${change.titleName}`}
                      source={source}
                    />
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
