/**
 * What the results page adds to the calendar, from its own folder (EVT1's files are not edited):
 * the show sheet's "Result" section and "Results" button, and a score badge on completed chips.
 * Imported once by the router, so they are in place before any calendar draws.
 */
import { useNavigate } from 'react-router-dom';
import type { CalendarShow, EventInstanceId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { VisuallyHidden } from '@/components/layout';
import { StarRating } from '@/components/StarRating';
import { Explained } from '@/components/Trace';
import {
  registerShowChipBadge,
  registerShowSheetAction,
  registerShowSheetSection,
} from '@/screens/calendar/registry';
import type {
  ShowChipBadgeDefinition,
  ShowSheetActionDefinition,
  ShowSheetSectionDefinition,
} from '@/screens/calendar/registry';
import styles from './calendarHooks.module.css';

/** The stored id of a show that has run, or null for anything else. */
export function completedShowId(show: CalendarShow): EventInstanceId | null {
  return show.status === 'completed' ? show.eventInstanceId : null;
}

interface ResultLineProps {
  readonly eventInstanceId: EventInstanceId;
  /** The calendar row's score, shown while the page's own answer loads. */
  readonly score: number | null;
}

/** "Score 64 · ★★★" with the score's Why?, from `shows.results`. */
function ResultLine({ eventInstanceId, score }: ResultLineProps) {
  const query = useEngineQuery('shows.results', { eventInstanceId });
  const result = query.data?.result ?? null;
  const shownScore = result?.score ?? score;
  if (shownScore === null) return null;
  return (
    <p className={styles['resultLine']}>
      <span className={styles['score']}>
        Score{' '}
        <Explained value={shownScore} label="Show score" traceRef={result?.scoreTraceRef ?? null} />
      </span>
      {result !== null && (
        <>
          <span aria-hidden="true" className={styles['separator']}>
            ·
          </span>
          <StarRating value={result.stars} size="sm" tone="broadcast" />
        </>
      )}
    </p>
  );
}

function ResultsButton({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      iconStart="history"
      onClick={() => {
        navigate(routes.game.showResults(eventInstanceId));
      }}
    >
      Results
    </Button>
  );
}

/** The sheet's "Result" section: the score with its Why? and the stars, once the show has run. */
export const RESULT_SECTION: ShowSheetSectionDefinition = {
  id: 'shows.result',
  order: 10,
  title: 'Result',
  render: ({ show }) => {
    const eventInstanceId = completedShowId(show);
    return eventInstanceId === null ? null : (
      <ResultLine eventInstanceId={eventInstanceId} score={show.score ?? null} />
    );
  },
};

/** The sheet's "Results" button, to the show's results page, once the show has run. */
export const RESULTS_ACTION: ShowSheetActionDefinition = {
  id: 'shows.results',
  order: 20,
  render: ({ show }) => {
    const eventInstanceId = completedShowId(show);
    return eventInstanceId === null ? null : <ResultsButton eventInstanceId={eventInstanceId} />;
  },
};

/** A small score on a completed show's chip. A cancelled show keeps the chip's "Not run". */
export const SCORE_BADGE: ShowChipBadgeDefinition = {
  id: 'shows.score',
  order: 20,
  render: ({ show }) => {
    const score = show.score ?? null;
    if (show.status !== 'completed' || score === null) return null;
    return (
      <Badge tone="data">
        <VisuallyHidden>Score </VisuallyHidden>
        {score}
      </Badge>
    );
  },
};

registerShowSheetSection(RESULT_SECTION);
registerShowSheetAction(RESULTS_ACTION);
registerShowChipBadge(SCORE_BADGE);
