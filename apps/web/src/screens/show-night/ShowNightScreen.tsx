import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type {
  CommandResult,
  EventInstanceId,
  LiveShowStateView,
  Reason,
  SegmentId,
  SegmentResultView,
  ShowResultsView,
} from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes, SHOW_NIGHT_ROUTE_PARAM } from '@/app/routes';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { ScoreBug } from '@/components/ScoreBug';
import type { ScoreBugStats } from '@/components/ScoreBug';
import { StarRating } from '@/components/StarRating';
import { Explained } from '@/components/Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import { useReducedMotion } from '@/styles/useReducedMotion';
import { bookingShowUrl } from '@/screens/booking/bookingUrl';
import { ResultsCardBanners } from '@/screens/show-results/resultsCardBannerRegistry';
import { ResultsHeader } from '@/screens/show-results/ResultsBroadcast';
import { CardProgressList, cardProgress } from './CardProgress';
import { SegmentReport } from './SegmentReport';
import {
  finalAnnouncement,
  progressText,
  segmentAnnouncement,
  segmentLine,
  segmentsLeftText,
  segmentTitle,
  SHOW_NIGHT_LABELS,
  STAGE_KICKERS,
} from './showNightText';
import styles from './ShowNight.module.css';
import { useRunNextShortcut } from './useRunNextShortcut';
// Report sections other features add, loaded with this screen's chunk. One line each.
import '@/screens/match-aftermath/registerSegmentReport';
import '@/screens/match-physical/registerSegmentReport';

const SCREEN_TITLE = 'Show night';
const NO_REASON = 'The game did not say why.';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ') || NO_REASON;
}

function isNotFound(error: EngineQueryError | null): boolean {
  return error?.kind === 'rejected' && error.reasons.some((reason) => reason.code === 'notFound');
}

function reasonsOf<T>(result: CommandResult<T>): readonly Reason[] {
  return result.ok ? [] : result.reasons;
}

function ShowNightMessage({
  message,
  body,
}: {
  readonly message: string;
  readonly body: ReactNode;
}) {
  useDocumentTitle(SCREEN_TITLE);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['pageHeading']}>{SCREEN_TITLE}</RouteHeading>
      <EmptyState size="page" icon="live" title={message} body={body} headingLevel={2} />
    </div>
  );
}

function ShowNightNotFound() {
  return (
    <ShowNightMessage
      message="That show can't be run from here"
      body={
        <>
          Only your own shows run on show night.{' '}
          <Link to={routes.game.calendar()}>Open the calendar</Link>
        </>
      }
    />
  );
}

/** Whether the card can go live tonight, read only before the first segment. */
interface Readiness {
  /** False when the show is not on tonight; null while loading. */
  readonly tonight: boolean | null;
  /** Booking errors that keep the show from starting; null while loading. */
  readonly problems: number | null;
}

function useReadiness(eventInstanceId: EventInstanceId, enabled: boolean): Readiness {
  const card = useEngineQuery('booking.card', { eventInstanceId }, { enabled });
  const validation = useEngineQuery('booking.validate', { eventInstanceId }, { enabled });
  return {
    tonight: card.data === undefined ? null : card.data.runsTonight,
    problems: validation.data === undefined ? null : validation.data.errors.length,
  };
}

/** "Fix 3 problems to run the show". */
function fixProblemsText(problems: number): string {
  return `Fix ${String(problems)} ${problems === 1 ? 'problem' : 'problems'} to run the show`;
}

interface ScoreBugArgs {
  readonly live: LiveShowStateView;
  readonly view: ShowResultsView;
  readonly total: number;
}

function Pending() {
  return (
    <span className={styles['pending']}>
      <span aria-hidden="true">–</span>
      <VisuallyHidden>Not yet</VisuallyHidden>
    </span>
  );
}

/** The running score bug: the show so far while it runs, the final score once it is over. */
function scoreStats({ live, view, total }: ScoreBugArgs): ScoreBugStats {
  const run = live.segmentsRun.length;
  const progress = {
    id: 'progress',
    label: 'Segments',
    value: (
      <span className="tabular">
        {String(live.stage === 'finished' ? total : run)}/{String(total)}
      </span>
    ),
  };
  const result = view.result;
  if (live.stage === 'finished' && result !== null) {
    return [
      {
        id: 'score',
        label: 'Score',
        highlight: true,
        tone: 'prestige',
        value: (
          <Explained value={result.score} label="Show score" traceRef={result.scoreTraceRef} />
        ),
      },
      { id: 'stars', label: 'Stars', value: <StarRating value={result.stars} tone="broadcast" /> },
      progress,
    ];
  }
  const soFar = live.scoreSoFar;
  return [
    {
      id: 'score',
      label: 'Score',
      highlight: true,
      tone: 'prestige',
      value:
        soFar === null ? (
          <Pending />
        ) : (
          <Explained value={soFar.score} label="Show score so far" trace={soFar.trace} />
        ),
    },
    {
      id: 'stars',
      label: 'Stars',
      value: soFar === null ? <Pending /> : <StarRating value={soFar.stars} tone="broadcast" />,
    },
    progress,
  ];
}

interface ReadyPanelProps {
  readonly live: LiveShowStateView;
  readonly view: ShowResultsView;
  readonly readiness: Readiness;
  readonly total: number;
}

/** Before the first segment: what the night holds, or what keeps it from starting. */
function ReadyPanel({ live, view, readiness, total }: ReadyPanelProps) {
  const navigate = useNavigate();
  const book = (label: string) => (
    <Button
      variant="secondary"
      iconStart="booking"
      onClick={() => {
        navigate(bookingShowUrl(view.eventInstanceId));
      }}
    >
      {label}
    </Button>
  );
  if (total === 0) {
    return (
      <EmptyState
        icon="booking"
        headingLevel={2}
        title="Nothing is booked on this show yet"
        body="Book the card first, then come back to go live."
        action={book(SHOW_NIGHT_LABELS.bookCard)}
      />
    );
  }
  if (readiness.tonight === false) {
    return (
      <EmptyState
        icon="calendar"
        headingLevel={2}
        title="This show isn't on tonight"
        body={`It's on ${formatGameDate(live.date, 'long')}. It goes live on its own day.`}
        action={book('Open the card')}
      />
    );
  }
  if (readiness.problems !== null && readiness.problems > 0) {
    return (
      <EmptyState
        icon="warning"
        headingLevel={2}
        title={fixProblemsText(readiness.problems)}
        body="The card has problems that keep the show from starting. Fix them on the card, then come back."
        action={book(SHOW_NIGHT_LABELS.fixCard)}
      />
    );
  }
  return (
    <Panel title="Ready to go live" headingLevel={2} variant="broadcast">
      <p className={styles['lead']}>
        {`The card has ${String(total)} ${total === 1 ? 'segment' : 'segments'}. Run them one at a time and read how each one went, or sim the whole show at once. The results are the same either way.`}
      </p>
    </Panel>
  );
}

interface ShowOverPanelProps {
  readonly view: ShowResultsView;
  readonly resultsTo: string;
  readonly buttonRef: RefObject<HTMLButtonElement>;
}

/** After the last segment: the final score and the way to the full results. */
function ShowOverPanel({ view, resultsTo, buttonRef }: ShowOverPanelProps) {
  const navigate = useNavigate();
  const result = view.result;
  return (
    <Panel title="Show's over" headingLevel={2} variant="broadcast" className={styles['showOver']}>
      {result !== null && (
        <p className={styles['finalScore']}>
          <span className={styles['finalLabel']}>Final score</span>{' '}
          <Explained value={result.score} label="Show score" traceRef={result.scoreTraceRef} />{' '}
          <StarRating value={result.stars} tone="broadcast" />
        </p>
      )}
      <p className={styles['lead']}>
        Every segment has run. The results have the show report and what changed.
      </p>
      <Button
        ref={buttonRef}
        variant="primary"
        iconStart="chevron-right"
        onClick={() => {
          navigate(resultsTo);
        }}
      >
        {SHOW_NIGHT_LABELS.results}
      </Button>
    </Panel>
  );
}

interface LoadedProps {
  readonly eventInstanceId: EventInstanceId;
  readonly live: LiveShowStateView;
  readonly view: ShowResultsView;
}

/** The screen for a show the engine answered for. */
function ShowNight({ eventInstanceId, live, view }: LoadedProps) {
  useDocumentTitle(`${view.name}: show night`);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const revealOneAtATime = useSettingsStore((state) => state.settings.revealOneAtATime);
  const runNext = useEngineCommand('shows.runNextSegment');
  const runRest = useEngineCommand('shows.runRestOfShow');
  const finish = useEngineCommand('shows.finishShow');
  const readiness = useReadiness(eventInstanceId, live.stage === 'notStarted');
  const busy = runNext.pending || runRest.pending || finish.pending;

  const [selectedId, setSelectedId] = useState<SegmentId | null>(null);
  const [refusal, setRefusal] = useState<readonly Reason[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Set after a command, so the report fades in and the live region reads it once it arrives.
  const [justRan, setJustRan] = useState<SegmentId | null>(null);
  const [simmed, setSimmed] = useState(false);
  const resultsButton = useRef<HTMLButtonElement>(null);
  const upNextId = useId();

  const total = view.segments.length;
  const ranIds = new Set(live.segmentsRun.map((segment) => segment.segmentId));
  const entries = cardProgress(view.segments, ranIds, live.next?.segmentId ?? null);
  const latest = live.segmentsRun.at(-1) ?? null;
  const shownId = selectedId ?? latest?.segmentId ?? null;
  const shown: SegmentResultView | null =
    live.segmentsRun.find((segment) => segment.segmentId === shownId) ?? latest;

  // Read each result out once its answer has arrived (the command lands before the refetch).
  useEffect(() => {
    if (justRan === null) return;
    if (live.stage === 'finished' && view.result !== null) {
      setAnnouncement(finalAnnouncement(view.result.score, view.result.stars));
      setJustRan(null);
      return;
    }
    const segment = live.segmentsRun.find((entry) => entry.segmentId === justRan);
    if (segment === undefined) return;
    setAnnouncement(segmentAnnouncement(segment));
    setJustRan(null);
  }, [justRan, live, view.result]);

  // When the show ends the run buttons go: move focus to See the results if it went with them.
  const wasFinished = useRef(live.stage === 'finished');
  useEffect(() => {
    const finished = live.stage === 'finished' && view.result !== null;
    if (finished && !wasFinished.current) {
      const active = document.activeElement;
      if (active === null || active === document.body) resultsButton.current?.focus();
    }
    wasFinished.current = finished;
  }, [live.stage, view.result]);

  const canRun =
    !busy &&
    live.next !== null &&
    (live.stage === 'live' ||
      (live.stage === 'notStarted' && readiness.tonight === true && readiness.problems === 0));

  const handleRunNext = useCallback((): void => {
    if (!canRun) return;
    void (async () => {
      const result = await runNext.run({ eventInstanceId });
      if (!result.ok) {
        setRefusal(reasonsOf(result));
        return;
      }
      setRefusal(null);
      setSelectedId(null);
      setJustRan(result.data.segmentId);
    })();
  }, [canRun, eventInstanceId, runNext]);

  const handleSimRest = (): void => {
    void (async () => {
      const result = await runRest.run({ eventInstanceId });
      if (!result.ok) {
        setRefusal(reasonsOf(result));
        return;
      }
      setRefusal(null);
      setSelectedId(null);
      setSimmed(result.data.segmentIds.length > 1);
      setJustRan(result.data.segmentIds.at(-1) ?? null);
    })();
  };

  const handleFinish = (): void => {
    void (async () => {
      const result = await finish.run({ eventInstanceId });
      setRefusal(result.ok ? null : reasonsOf(result));
    })();
  };

  useRunNextShortcut(handleRunNext, canRun);

  const finished = live.stage === 'finished';
  // Simmed segments were never seen one by one: with the reveal setting on, the results play them.
  const resultsTo = routes.game.showResults(eventInstanceId, {
    reveal: simmed && revealOneAtATime && !reducedMotion,
  });
  const animated = !reducedMotion && revealOneAtATime;
  const stuck = live.stage === 'live' && live.next === null;

  const progressPanel = (
    <Panel
      title="Running order"
      subtitle={progressText(finished ? total : live.segmentsRun.length, total)}
      headingLevel={2}
      variant="broadcast"
      collapsible={isMobile}
      defaultCollapsed={isMobile}
      className={styles['progressPanel']}
    >
      <CardProgressList
        entries={entries}
        selectedId={shown?.segmentId ?? null}
        onSelect={setSelectedId}
      />
    </Panel>
  );

  return (
    <div
      className={styles['screen']}
      data-layout={isMobile ? 'phone' : 'desktop'}
      data-stage={live.stage}
    >
      <div className={styles['header']}>
        <ResultsHeader view={view} kicker={STAGE_KICKERS[live.stage]} />
        <ScoreBug
          label={finished ? 'Final score' : 'Show so far'}
          stats={scoreStats({ live, view, total })}
          className={styles['scoreBug']}
        />
      </div>

      <div className={styles['columns']}>
        {progressPanel}
        <div className={styles['middle']}>
          {refusal !== null && (
            <div className={styles['refusal']} role="alert">
              {refusal.map((reason, index) => (
                <p key={`${reason.code}-${String(index)}`}>{reason.message}</p>
              ))}
            </div>
          )}
          {finished && (
            <ShowOverPanel view={view} resultsTo={resultsTo} buttonRef={resultsButton} />
          )}
          {live.stage === 'notStarted' && (
            <ReadyPanel live={live} view={view} readiness={readiness} total={total} />
          )}
          {shown !== null && (
            <section className={styles['reportPanel']} aria-labelledby={`${upNextId}-report`}>
              <h2 id={`${upNextId}-report`} className={styles['reportHeading']}>
                {shown.segmentId === latest?.segmentId && !finished ? 'Just now' : 'Report'}
                <span className={styles['reportHeadingSub']}>{segmentTitle(shown)}</span>
              </h2>
              <SegmentReport
                key={shown.segmentId}
                eventInstanceId={eventInstanceId}
                segment={shown}
                view={view}
                headingLevel={3}
                animated={animated && shown.segmentId === latest?.segmentId}
                banners={<ResultsCardBanners eventInstanceId={eventInstanceId} segment={shown} />}
              />
            </section>
          )}
        </div>
      </div>

      <p className={styles['live']} aria-live="polite">
        {announcement}
      </p>

      {!finished && (
        <div className={styles['controls']} role="group" aria-label="Show night controls">
          {live.next !== null && (
            <p id={upNextId} className={styles['upNext']}>
              <span className={styles['upNextLabel']}>Up next</span>{' '}
              {`${segmentTitle(live.next)} · ${segmentLine(live.next)}`}
              {live.segmentsLeft > 1 && (
                <span className={styles['upNextLeft']}>
                  {' '}
                  ({segmentsLeftText(live.segmentsLeft)})
                </span>
              )}
            </p>
          )}
          <div className={styles['buttons']}>
            {stuck ? (
              <Button
                variant="primary"
                iconStart="chevron-right"
                loading={finish.pending}
                onClick={handleFinish}
              >
                {SHOW_NIGHT_LABELS.finish}
              </Button>
            ) : (
              <Button
                variant="primary"
                iconStart="play"
                loading={runNext.pending}
                disabled={!canRun}
                aria-describedby={live.next === null ? undefined : upNextId}
                aria-keyshortcuts="Enter"
                onClick={handleRunNext}
              >
                {SHOW_NIGHT_LABELS.runNext}
              </Button>
            )}
            <Button
              variant="secondary"
              iconStart="fast-forward"
              loading={runRest.pending}
              disabled={!canRun}
              onClick={handleSimRest}
            >
              {SHOW_NIGHT_LABELS.simRest}
            </Button>
            <Button
              variant="ghost"
              iconStart="log-out"
              onClick={() => {
                navigate(routes.game.office());
              }}
            >
              {SHOW_NIGHT_LABELS.leave}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadedShowNight({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const liveQuery = useEngineQuery('shows.liveState', { eventInstanceId });
  const resultsQuery = useEngineQuery('shows.results', { eventInstanceId });
  const live = liveQuery.data;
  const view = resultsQuery.data;

  if (isNotFound(liveQuery.error) || isNotFound(resultsQuery.error)) return <ShowNightNotFound />;
  if (liveQuery.status === 'error' || resultsQuery.status === 'error') {
    return (
      <ShowNightMessage
        message="The show can't be shown"
        body={errorText(liveQuery.error ?? resultsQuery.error)}
      />
    );
  }
  if (live === undefined || view === undefined) {
    return (
      <div className={styles['screen']} aria-busy="true">
        <RouteHeading className={styles['pageHeading']}>
          <VisuallyHidden>Loading the show</VisuallyHidden>
        </RouteHeading>
        <span className={styles['skeleton']} />
      </div>
    );
  }
  if (view === null || view.status === 'cancelled') return <ShowNightNotFound />;
  return <ShowNight eventInstanceId={eventInstanceId} live={live} view={view} />;
}

/**
 * Show night for one of your shows at `/game/show-night/:eventInstanceId` (EVT10-02): the card
 * down the side with each segment done, up next or still to come; the latest segment's report in
 * the middle with the sections other features add; a running "Show so far" score bug. Run next
 * segment (Enter), Sim the rest of the show, or Leave and finish later. After the last segment, the
 * final score and the way to the results.
 */
export function ShowNightScreen() {
  const params = useParams();
  const eventInstanceId = params[SHOW_NIGHT_ROUTE_PARAM];
  if (!isId('eventInstance', eventInstanceId)) return <ShowNightNotFound />;
  return <LoadedShowNight key={eventInstanceId} eventInstanceId={eventInstanceId} />;
}
