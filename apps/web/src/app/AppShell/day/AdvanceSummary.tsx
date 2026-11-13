import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_COMPLETED_SINCE } from '@ringside/engine';
import type { AdvanceResult, GateHit, ShowSummaryView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useHasPromotion } from '@/app/session/sessionStore';
import { Button, IconButton } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import {
  describeAdvance,
  describeRefusal,
  failuresToText,
  MAX_RESULTS_LINKS,
  moreResultsText,
  seeResultsText,
} from './advanceSummaryText';
import type { AdvanceReport } from './DayAdvanceProvider';
import { gateDestination, SHOW_NIGHT_HINT } from './dayControlState';
import { useOptionalDayAdvance } from './DayAdvanceProvider';
import styles from './DayControl.module.css';
import { useOpenResultsAfterShow } from './useOpenResultsAfterShow';

/** What else, besides the report itself, can earn the banner. */
export interface BannerExtras {
  /** True when the advance completed one of your shows: its results are worth a link. */
  readonly hasResults?: boolean;
  /** True when the advance stopped on the day of one of your shows ("Tonight: <Show>"). */
  readonly showNight?: boolean;
}

/**
 * Whether a report earns the banner. A plain Next Day that ran its one day is only announced (the
 * date chip already shows the new day), unless it ran one of your shows; anything longer,
 * anything that stopped early, any failed step and any refusal gets the banner.
 */
export function reportNeedsBanner(
  report: AdvanceReport,
  { hasResults = false, showNight = false }: BannerExtras = {},
): boolean {
  if (report.kind === 'refused') return true;
  const { result, daysRequested } = report;
  return (
    hasResults ||
    showNight ||
    daysRequested > 1 ||
    result.stoppedBy.kind !== 'completed' ||
    result.failures.length > 0
  );
}

type AdvancedReport = Extract<AdvanceReport, { kind: 'advanced' }>;

interface ReportBannerProps<Report extends AdvanceReport = AdvanceReport> {
  readonly report: Report;
  readonly onDismiss: () => void;
}

/** An advance that moved the clock: asks which of your shows it completed, for their links. */
function AdvancedReportBanner({ report, onDismiss }: ReportBannerProps<AdvancedReport>) {
  const completed = useEngineQuery(
    'shows.completedSince',
    {
      from: report.result.startDate,
      to: report.result.endDate,
      scope: 'mine',
      limit: MAX_COMPLETED_SINCE,
    },
    { keepPreviousData: false },
  );
  useOpenResultsAfterShow(report, completed.data);
  // A Next Day that lands on your show day says so, even though the day itself ran in full.
  const gates = useEngineQuery('sim.pendingGates', {});
  const tonight = gates.data?.hits.find((hit) => hit.actionHint === SHOW_NIGHT_HINT) ?? null;
  const results = completed.data ?? [];
  if (!reportNeedsBanner(report, { hasResults: results.length > 0, showNight: tonight !== null })) {
    return null;
  }
  return (
    <AdvanceSummaryBanner
      report={report}
      onDismiss={onDismiss}
      results={results}
      tonight={tonight}
    />
  );
}

/** "Tonight: <Show>" and Go to the show, for the show day the advance stopped on. */
function TonightLine({ hit, said }: { readonly hit: GateHit; readonly said: boolean }) {
  const destination = gateDestination(hit);
  return (
    <>
      {!said && <p className={styles['summaryReason']}>{hit.reason}</p>}
      {destination !== null && (
        <p className={styles['resultsLinks']}>
          <Link to={destination.to} className={styles['resultsLinkFirst']}>
            {destination.label}
          </Link>
        </p>
      )}
    </>
  );
}

/** The banner under the top bar after an advance, from the shell's advance controller. */
export function AdvanceSummary() {
  const advance = useOptionalDayAdvance();
  const hasPromotion = useHasPromotion();
  const report = advance?.report ?? null;
  if (advance === null || report === null) return null;
  // Only your own shows get "See results" links; without a promotion there are none to ask for.
  if (report.kind === 'advanced' && report.result.daysAdvanced > 0 && hasPromotion) {
    return <AdvancedReportBanner report={report} onDismiss={advance.dismissReport} />;
  }
  if (!reportNeedsBanner(report)) return null;
  return <AdvanceSummaryBanner report={report} onDismiss={advance.dismissReport} />;
}

/** "See results: <show>" for up to three shows the advance completed, then "and N more". */
function ResultsLinks({ results }: { readonly results: readonly ShowSummaryView[] }) {
  const more = moreResultsText(results.length);
  return (
    <ul className={styles['resultsLinks']} aria-label="Results">
      {results.slice(0, MAX_RESULTS_LINKS).map((show, index) => (
        <li key={show.eventInstanceId}>
          <Link
            to={routes.game.showResults(show.eventInstanceId, { reveal: true })}
            className={index === 0 ? styles['resultsLinkFirst'] : styles['resultsLink']}
          >
            {seeResultsText(show)}
          </Link>
        </li>
      ))}
      {more !== null && <li className={styles['resultsMore']}>{more}</li>}
    </ul>
  );
}

export interface AdvanceSummaryBannerProps {
  readonly report: AdvanceReport;
  readonly onDismiss: () => void;
  /**
   * The region's name. The shell shows one banner, so the default is enough there; a page that
   * shows several at once (the gallery) gives each its own, so every region is told apart.
   */
  readonly label?: string;
  /** Your shows the advance completed, newest first: each gets a "See results" link. */
  readonly results?: readonly ShowSummaryView[];
  /** The show day the advance stopped on, if any: "Tonight: <Show>" and Go to the show. */
  readonly tonight?: GateHit | null;
}

/**
 * "Advanced 30 days to Friday, March 14, 2031", why it stopped, and a link to any background
 * steps that failed. It stays until dismissed or until the next advance replaces it.
 */
export function AdvanceSummaryBanner({
  report,
  onDismiss,
  label = 'Last advance',
  results = [],
  tonight = null,
}: AdvanceSummaryBannerProps) {
  const [failuresOpen, setFailuresOpen] = useState(false);
  const text =
    report.kind === 'advanced' ? describeAdvance(report.result) : describeRefusal(report.reasons);
  const tone = report.kind === 'refused' ? 'warning' : 'info';

  return (
    <section
      className={styles['summary']}
      data-tone={tone}
      aria-label={label}
      data-testid="advance-summary"
    >
      <div className={styles['summaryBody']}>
        <p className={styles['summaryHeadline']}>{text.headline}</p>
        {text.reason !== null && <p className={styles['summaryReason']}>{text.reason}</p>}
        {results.length > 0 && <ResultsLinks results={results} />}
        {tonight !== null && <TonightLine hit={tonight} said={text.reason === tonight.reason} />}
        {report.kind === 'advanced' && text.failures !== null && (
          <>
            <button
              type="button"
              className={styles['failureLink']}
              aria-haspopup="dialog"
              onClick={() => {
                setFailuresOpen(true);
              }}
            >
              <Icon name="warning" decorative />
              {text.failures}
            </button>
            <FailuresSheet
              open={failuresOpen}
              onClose={() => {
                setFailuresOpen(false);
              }}
              failures={report.result.failures}
            />
          </>
        )}
      </div>
      <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
    </section>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

interface FailuresSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly failures: AdvanceResult['failures'];
}

/** Every step that failed during the advance: date, step id and message, ready to copy. */
function FailuresSheet({ open, onClose, failures }: FailuresSheetProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(failuresToText(failures));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setCopyState('idle');
        onClose();
      }}
      title="Background steps that failed"
      footer={
        <div className={styles['sheetFooter']}>
          <p className={styles['copyStatus']} role="status">
            {copyState === 'copied' && 'Copied'}
            {copyState === 'failed' && "Couldn't copy. Select the text instead."}
          </p>
          <Button
            variant="secondary"
            iconStart="clipboard"
            onClick={() => {
              void copy();
            }}
          >
            Copy details
          </Button>
        </div>
      }
    >
      <p className={styles['fieldHint']}>
        The rest of each day ran as normal. These steps were skipped and their changes undone.
      </p>
      <ol className={styles['failureList']}>
        {failures.map((failure, index) => (
          <li
            key={`${failure.date}-${failure.stepId}-${String(index)}`}
            className={styles['failure']}
          >
            <p className={styles['failureMeta']}>
              <span>{formatGameDate(failure.date, 'short')}</span>
              <code className={styles['stepId']}>{failure.stepId}</code>
            </p>
            <p className={styles['failureMessage']}>{failure.message}</p>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
