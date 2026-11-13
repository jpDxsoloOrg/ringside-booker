import type { AipDecisionLog, AipDecisionLogEntry, TraceNode } from '@ringside/engine';
import { renderTemplatedText } from '@/text/renderTemplatedText';
import '@/text/catalogs/aip';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { formatGameDate, formatNumber } from '../format';
import { traceSourceOf, WhyButton } from '../Trace';
import styles from './DecisionLogList.module.css';

export interface DecisionLogListProps {
  /** The `aip.decisionLog` answer: the entries so far (older pages appended), chips and counts. */
  readonly log: AipDecisionLog;
  /** The kind the chips filter by, or null for All. */
  readonly selectedKind: string | null;
  /** Called with the chip picked: a kind, or null for All. */
  readonly onKindChange: (kind: string | null) => void;
  /** Loads the next page; the button shows only while the log has one (`nextBefore`). */
  readonly onLoadOlder?: () => void;
  /** True while an older page is on its way. */
  readonly loadingOlder?: boolean;
  /**
   * The Why? to show inline for an entry, instead of fetching its stored one by `traceRef`. For
   * the gallery, which has no engine to fetch from.
   */
  readonly traceOf?: (entry: AipDecisionLogEntry) => TraceNode | null;
  readonly className?: string | undefined;
}

/** "1 plan hidden until it airs", "2 plans hidden until they air". */
export function hiddenPlansText(count: number): string {
  return count === 1
    ? '1 plan hidden until it airs'
    : `${formatNumber(count)} plans hidden until they air`;
}

/**
 * A rival desk's decision log (`aip.decisionLog`), newest first: filter chips built from the kinds
 * the log has (All, then one per kind), then a row per decision with its date, its kind's chip,
 * the decision in words and its Why? while the breakdown is kept. Plans that have not aired are
 * counted, never described. The chip labels come from the engine, so a new kind of decision
 * needs nothing here.
 */
export function DecisionLogList({
  log,
  selectedKind,
  onKindChange,
  onLoadOlder,
  loadingOlder = false,
  traceOf,
  className,
}: DecisionLogListProps) {
  const chips: readonly { readonly kind: string | null; readonly label: string }[] = [
    { kind: null, label: 'All' },
    ...log.kinds.map((kind) => ({ kind: kind.kind, label: kind.chip })),
  ];
  return (
    <div className={classNames(styles['decisionLog'], className)}>
      {log.kinds.length > 0 && (
        <div className={styles['chips']} role="group" aria-label="Show decisions of kind">
          {chips.map((chip) => {
            const pressed = chip.kind === selectedKind;
            return (
              <button
                key={chip.kind ?? 'all'}
                type="button"
                className={styles['chip']}
                aria-pressed={pressed}
                onClick={() => {
                  onKindChange(chip.kind);
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
      {log.hiddenCount > 0 && (
        <p className={styles['hidden']}>{hiddenPlansText(log.hiddenCount)}</p>
      )}
      {log.entries.length === 0 ? (
        <EmptyState
          icon="history"
          size="inline"
          headingLevel={4}
          title="No decisions yet"
          body="Rival desks review their rosters once a week."
        />
      ) : (
        <ol className={styles['entries']} aria-label="Decisions, newest first">
          {log.entries.map((entry) => {
            const text = renderTemplatedText(entry.summary);
            const date = formatGameDate(entry.date, 'short');
            const source = traceSourceOf(traceOf?.(entry), entry.traceRef);
            return (
              <li key={entry.decisionId} className={styles['entry']} data-kind={entry.kind}>
                <time className={styles['date']} dateTime={entry.date}>
                  {date}
                </time>
                <Badge tone="data" className={styles['kind']}>
                  {entry.chip}
                </Badge>
                <span className={styles['summary']}>{text}</span>
                <span className={styles['why']}>
                  {source === null ? (
                    <span className={styles['noWhy']}>Breakdown no longer kept</span>
                  ) : (
                    <WhyButton label={entry.chip} value={date} source={source} panelTitle={text} />
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {log.nextBefore !== null && onLoadOlder !== undefined && (
        <Button variant="secondary" size="sm" loading={loadingOlder} onClick={onLoadOlder}>
          Load older
        </Button>
      )}
    </div>
  );
}
