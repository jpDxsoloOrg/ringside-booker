import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { EventInstanceId, ShowResultsView, ShowResultView } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes, SHOW_RESULTS_PARAMS, SHOW_RESULTS_ROUTE_PARAM } from '@/app/routes';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { bookingShowUrl } from '@/screens/booking/bookingUrl';
import { CompletedResults, ResultsHeader } from './ResultsBroadcast';
import styles from './ShowResults.module.css';
// Results sections other features add, loaded with this page's chunk (UI-21). One line each.
import '@/screens/promotion-popularity/register';
import '@/screens/match-aftermath/register';
import '@/screens/finances/registerShowMoney';
import '@/screens/box-office/register';

const SCREEN_TITLE = 'Show results';
const NOT_FOUND_TITLE = 'Show not found';
const NO_REASON = 'The game did not say why.';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || NO_REASON;
}

function isNotFound(error: EngineQueryError | null): boolean {
  return error?.kind === 'rejected' && error.reasons.some((reason) => reason.code === 'notFound');
}

interface ResultsMessageProps {
  readonly title: string;
  readonly message: string;
  readonly body: ReactNode;
}

/** A page with nothing to show but a heading and why, such as an unknown show or no world. */
function ResultsMessage({ title, message, body }: ResultsMessageProps) {
  useDocumentTitle(title);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['pageHeading']}>{title}</RouteHeading>
      <EmptyState size="page" icon="history" title={message} body={body} headingLevel={2} />
    </div>
  );
}

function ResultsNotFound() {
  return (
    <ResultsMessage
      title={NOT_FOUND_TITLE}
      message="That show doesn't exist"
      body={
        <>
          Shows that have run are on the calendar.{' '}
          <Link to={routes.game.calendar()}>Open the calendar</Link>
        </>
      }
    />
  );
}

const SKELETON_CARDS = ['1', '2', '3'] as const;

/** The page's shape in quiet blocks while the results load. */
function ResultsLoading() {
  useDocumentTitle(SCREEN_TITLE);
  return (
    <div className={styles['screen']} aria-busy="true">
      <div className={classNames(styles['skeleton'], styles['skeletonHeader'])}>
        <RouteHeading className={styles['pageHeading']}>
          <VisuallyHidden>Loading the results</VisuallyHidden>
        </RouteHeading>
      </div>
      <span className={classNames(styles['skeleton'], styles['skeletonBug'])} />
      {SKELETON_CARDS.map((key) => (
        <span key={key} className={classNames(styles['skeleton'], styles['skeletonCard'])} />
      ))}
    </div>
  );
}

/** A show still to come (or called off): its header and why there are no results yet. */
function NotRunResults({ view }: { readonly view: ShowResultsView }) {
  useDocumentTitle(view.name);
  const navigate = useNavigate();
  const cancelled = view.status === 'cancelled';
  const canBook = view.mine && (view.status === 'scheduled' || view.status === 'booked');
  const date = formatGameDate(view.date, 'long');
  return (
    <div className={styles['screen']}>
      <ResultsHeader view={view} kicker={cancelled ? 'Not run' : 'Coming up'} />
      <EmptyState
        size="page"
        icon="calendar"
        headingLevel={2}
        title={cancelled ? "This show didn't run" : "This show hasn't run yet"}
        body={
          cancelled
            ? `It was set for ${date} and called off.`
            : `It's on ${date}. Its results appear here once it has run.`
        }
        {...(canBook
          ? {
              action: (
                <Button
                  variant="primary"
                  iconStart="booking"
                  onClick={() => {
                    navigate(bookingShowUrl(view.eventInstanceId));
                  }}
                >
                  Book this show
                </Button>
              ),
            }
          : {})}
      />
    </div>
  );
}

interface CompletedPageProps {
  readonly view: ShowResultsView;
  readonly result: ShowResultView;
}

/**
 * The score fans in the show's own region expected, from EVT5's `popularity.showChange`, or null
 * while it loads, when the show changed no popularity, or when the record is gone.
 */
function useShowExpectation(view: ShowResultsView): number | null {
  const query = useEngineQuery('popularity.showChange', { eventInstanceId: view.eventInstanceId });
  const data = query.data;
  if (data?.status !== 'applied') return null;
  for (const country of data.countries) {
    const region = country.regions.find((entry) => entry.regionId === view.region.id);
    if (region !== undefined) return region.expectation;
  }
  return null;
}

/** A finished show's page, with `?reveal=1` playing the reveal and taken out once it ends. */
function CompletedPage({ view, result }: CompletedPageProps) {
  useDocumentTitle(`${view.name} results`);
  const expectation = useShowExpectation(view);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const wantsReveal = searchParams.get(SHOW_RESULTS_PARAMS.reveal) === '1';
  // The reveal starts afresh on each visit that asks for it, even from this same page (a "See
  // results" link followed again). Taking `?reveal` out when it ends does not restart anything.
  const [revealVisit, setRevealVisit] = useState(location.key);
  if (wantsReveal && location.key !== revealVisit) setRevealVisit(location.key);

  // Take ?reveal out of the URL (replacing the entry), so a reload shows everything at once.
  const endReveal = useCallback(() => {
    setSearchParams(
      (current) => {
        if (!current.has(SHOW_RESULTS_PARAMS.reveal)) return current;
        const next = new URLSearchParams(current);
        next.delete(SHOW_RESULTS_PARAMS.reveal);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return (
    <CompletedResults
      key={revealVisit}
      view={view}
      result={result}
      revealRequested={wantsReveal}
      expectation={expectation}
      {...(wantsReveal ? { onRevealEnd: endReveal } : {})}
    />
  );
}

function LoadedShowResults({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('shows.results', { eventInstanceId });
  const view = query.data;

  if (query.status === 'loading') return <ResultsLoading />;
  if (query.status === 'error' || view === undefined) {
    if (isNotFound(query.error)) return <ResultsNotFound />;
    return (
      <ResultsMessage
        title={SCREEN_TITLE}
        message="The results can't be shown"
        body={errorText(query.error)}
      />
    );
  }
  if (view === null) return <ResultsNotFound />;
  if (view.result === null) return <NotRunResults view={view} />;
  return <CompletedPage view={view} result={view.result} />;
}

/**
 * One show's results at `/game/event-history/:eventInstanceId`, broadcast style: the lower third,
 * the final score with its Why?, the show report (verdict, how it was scored, what changed), then
 * every segment in card order. Opened with `?reveal=1` (the
 * Next Day summary's links) the segments come out one at a time, unless motion is reduced. Other
 * features add sections under the card with `registerResultsSection`.
 */
export function ShowResultsScreen() {
  const params = useParams();
  const eventInstanceId = params[SHOW_RESULTS_ROUTE_PARAM];
  if (!isId('eventInstance', eventInstanceId)) return <ResultsNotFound />;
  // Keyed by show, so following a link from one results page to another starts afresh.
  return <LoadedShowResults key={eventInstanceId} eventInstanceId={eventInstanceId} />;
}
