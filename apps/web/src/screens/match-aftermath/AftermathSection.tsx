import type { EventInstanceId, ShowResultsView } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { VisuallyHidden } from '@/components/layout';
import { AftermathResults } from './AftermathResults';
import styles from './AftermathSection.module.css';

/** What the section says when there is nothing to list, in plain words. */
export const AFTERMATH_EMPTY_TEXT = {
  notRun: 'Popularity and momentum change once the show has run.',
  offscreen: "This show wasn't booked match by match, so nobody's popularity or momentum moved.",
  none: "No match on this show changed anyone's popularity or momentum.",
} as const;

const ERROR_TITLE = "Popularity and momentum changes can't be shown";
const NO_REASON = 'The game did not say why.';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || NO_REASON;
}

const SKELETON_ROWS = ['1', '2', '3'] as const;

function AftermathLoading() {
  return (
    <div className={styles['skeleton']} aria-busy="true">
      <VisuallyHidden>Loading the popularity and momentum changes</VisuallyHidden>
      {SKELETON_ROWS.map((key) => (
        <span key={key} className={styles['skeletonRow']} />
      ))}
    </div>
  );
}

export interface AftermathSectionProps {
  readonly eventInstanceId: EventInstanceId;
  readonly view: ShowResultsView;
}

/**
 * The results page's "Popularity & momentum" section (MTCH3-05): what every match on the show did
 * to its competitors, read from the stored aftermaths. Results are public, so rival shows get it
 * too. The heading is the results panel's own.
 */
export function AftermathSection({ eventInstanceId, view }: AftermathSectionProps) {
  const query = useEngineQuery('match.aftermath', { eventInstanceId });
  const data = query.data;
  if (query.status === 'loading') return <AftermathLoading />;
  if (query.status === 'error' || data === undefined) {
    return <EmptyState icon="info" title={ERROR_TITLE} body={errorText(query.error)} />;
  }
  if (data.segments.length === 0) {
    const text =
      view.result === null
        ? AFTERMATH_EMPTY_TEXT.notRun
        : view.offscreen
          ? AFTERMATH_EMPTY_TEXT.offscreen
          : AFTERMATH_EMPTY_TEXT.none;
    return <EmptyState icon="users" title={text} />;
  }
  return <AftermathResults data={data} view={view} />;
}
