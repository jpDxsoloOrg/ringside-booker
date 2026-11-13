import { useId } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type {
  SegmentResultView,
  ShowResultsView,
  ShowResultView,
  ShowScoreBreakdownView,
  ShowScoreRowView,
} from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef, DataTableLayout } from '@/components/DataTable';
import { formatNumber } from '@/components/format';
import { StarRating } from '@/components/StarRating';
import { WhyButton } from '@/components/Trace';
import { useReducedMotion } from '@/styles/useReducedMotion';
import { BUILTIN_REPORT_LINES } from './builtinReportLines';
import type { ResultsSectionProps } from './resultsSectionRegistry';
import { segmentCardAnchor, useShowReportLines } from './showReportLineRegistry';
import type { ShowReportLineDefinition } from './showReportLineRegistry';
import {
  bestAndWorst,
  breakdownNote,
  headlineText,
  pointsText,
  preShowFactorText,
  rowLabel,
  segmentHighlightText,
  starsText,
  weightText,
} from './showReportText';
import styles from './ShowReport.module.css';

/**
 * The show report at the top of a results page (EVT3-09): the score, the stars and a verdict in
 * words, the best and worst segments, how each slot made up the score, and what changed. Every
 * number is the one `shows.results` gives, and the score keeps its Why? for the full trace.
 */

const NONE = '—';

/**
 * A link to an element lower on the page that scrolls it into view and moves focus there, without
 * a router navigation (which would replay the reveal).
 */
export function JumpLink({
  targetId,
  children,
  className,
}: {
  readonly targetId: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const jump = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (target === null) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
  return (
    <a href={`#${targetId}`} className={classNames(styles['jump'], className)} onClick={jump}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------------------------
// Headline

interface HeadlineProps {
  readonly view: ShowResultsView;
  readonly result: ShowResultView;
  readonly expectation: number | null;
}

function Highlight({
  kind,
  segment,
}: {
  readonly kind: 'Best' | 'Worst';
  readonly segment: SegmentResultView;
}) {
  return (
    <li className={styles['highlight']} data-kind={kind.toLowerCase()}>
      <span className={styles['highlightKind']}>{kind}</span>
      <JumpLink targetId={segmentCardAnchor(segment.segmentId)}>
        {segmentHighlightText(segment)}
      </JumpLink>
    </li>
  );
}

/** "A solid show: 64, 2.5 stars", the stars drawn, then the best and worst segment. */
export function ReportHeadline({ view, result, expectation }: HeadlineProps) {
  const { best, worst } = bestAndWorst(view.segments);
  return (
    <div className={styles['headline']}>
      <div className={styles['verdictRow']}>
        <StarRating value={result.stars} tone="broadcast" />
        <p className={styles['verdict']} data-part="verdict">
          {headlineText(result, expectation)}
        </p>
      </div>
      {best !== null && (
        <ul className={styles['highlights']} aria-label="Best and worst segment">
          <Highlight kind="Best" segment={best} />
          {worst !== null && <Highlight kind="Worst" segment={worst} />}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// How it was scored

/** One row of the table: a breakdown row, the pre-show factor, or the total. */
interface TableRow {
  readonly id: string;
  readonly kind: ShowScoreRowView['kind'] | 'preShowFactor' | 'total';
  readonly label: string;
  readonly segment: SegmentResultView | undefined;
  readonly row: ShowScoreRowView | null;
  readonly points: number | null;
  readonly note: string | null;
}

function tableRows(
  breakdown: ShowScoreBreakdownView,
  view: ShowResultsView,
  score: number,
): TableRow[] {
  const byId = new Map(
    view.segments.map((segment): [string, SegmentResultView] => [segment.segmentId, segment]),
  );
  const rows: TableRow[] = breakdown.rows.map((row, index) => {
    const segment = row.segmentId === null ? undefined : byId.get(row.segmentId);
    return {
      id: `row-${String(index)}`,
      kind: row.kind,
      label: rowLabel(row, segment),
      segment,
      row,
      points: row.points,
      note: null,
    };
  });
  if (breakdown.preShowFactor !== null) {
    const firstMain = rows.findIndex((entry) => entry.kind === 'segment' && !entry.row?.preShow);
    const factorRow: TableRow = {
      id: 'pre-show-factor',
      kind: 'preShowFactor',
      label: 'Pre-show factor',
      segment: undefined,
      row: null,
      points: null,
      note: preShowFactorText(breakdown.preShowFactor),
    };
    rows.splice(firstMain === -1 ? rows.length : firstMain, 0, factorRow);
  }
  rows.push({
    id: 'total',
    kind: 'total',
    label: 'Show score',
    segment: undefined,
    row: null,
    points: score,
    note: null,
  });
  return rows;
}

function SlotCell({ entry }: { readonly entry: TableRow }) {
  if (entry.segment !== undefined) {
    return <JumpLink targetId={segmentCardAnchor(entry.segment.segmentId)}>{entry.label}</JumpLink>;
  }
  return (
    <span className={styles['rowLabel']} data-kind={entry.kind}>
      {entry.label}
      {entry.note !== null && <span className={styles['rowNote']}>{entry.note}</span>}
    </span>
  );
}

function weightCell(entry: TableRow): ReactNode {
  const row = entry.row;
  if (row?.weight === null || row?.weight === undefined) return NONE;
  if (row.slotWeight !== null && row.slotWeight !== row.weight) {
    return `${weightText(row.slotWeight)} → ${weightText(row.weight)}`;
  }
  return weightText(row.weight);
}

function pointsCell(entry: TableRow): ReactNode {
  if (entry.points === null) return NONE;
  if (entry.kind === 'total') {
    return <strong className={styles['total']}>{formatNumber(entry.points)}</strong>;
  }
  return (
    <span
      className={styles['points']}
      data-tone={entry.points > 0 ? 'positive' : entry.points < 0 ? 'negative' : 'neutral'}
    >
      {pointsText(entry.points)}
    </span>
  );
}

const COLUMNS: readonly ColumnDef<TableRow>[] = [
  {
    id: 'slot',
    header: 'Slot',
    card: 'title',
    cell: (entry) => <SlotCell entry={entry} />,
  },
  {
    id: 'stars',
    header: 'Stars',
    card: 'stat',
    width: 'md',
    cell: (entry) => {
      const rating = entry.segment?.rating;
      if (rating === null || rating === undefined) return NONE;
      return (
        <span className={styles['stars']}>
          <StarRating value={rating.stars} size="sm" tone="broadcast" />
          <span className={styles['starsText']}>{starsText(rating.stars)}</span>
        </span>
      );
    },
  },
  {
    id: 'score',
    header: 'Score',
    numeric: true,
    card: 'stat',
    width: 'xs',
    cell: (entry) => (entry.row?.score === null || entry.row === null ? NONE : entry.row.score),
  },
  {
    id: 'weight',
    header: 'Weight',
    numeric: true,
    card: 'stat',
    width: 'sm',
    cell: weightCell,
  },
  {
    id: 'share',
    header: 'Share of score',
    cardLabel: 'Share',
    numeric: true,
    card: 'stat',
    width: 'sm',
    cell: pointsCell,
  },
];

interface ScoreTableProps {
  readonly view: ShowResultsView;
  readonly result: ShowResultView;
  readonly breakdown: ShowScoreBreakdownView;
  /** `auto` follows the screen; the gallery forces one. */
  readonly layout?: DataTableLayout;
}

/** The "How it was scored" table: one row per slot, its share, and the show score. */
export function ScoreTable({ view, result, breakdown, layout = 'auto' }: ScoreTableProps) {
  return (
    <div className={styles['scoreTable']}>
      <DataTable
        rows={tableRows(breakdown, view, result.score)}
        columns={COLUMNS}
        getRowId={(entry) => entry.id}
        caption="How the show score was worked out, slot by slot"
        density="compact"
        sortable={false}
        layout={layout}
      />
      <p className={styles['note']}>{breakdownNote(breakdown.totalWeight)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// What changed

function ReportLine({
  definition,
  props,
}: {
  readonly definition: ShowReportLineDefinition;
  readonly props: ResultsSectionProps;
}) {
  // Each definition's `line` is a hook; one component per definition keeps its calls stable.
  const content = definition.line(props);
  if (content === null) return null;
  const text = (
    <span className={styles['lineText']} data-tone={content.tone ?? 'neutral'}>
      {content.text}
    </span>
  );
  return (
    <li className={styles['line']} data-line={definition.id}>
      <span className={styles['lineLabel']}>{content.label}</span>
      {content.targetId === undefined ? (
        text
      ) : (
        <JumpLink targetId={content.targetId}>{text}</JumpLink>
      )}
    </li>
  );
}

/** Built-in and registered lines together, lowest order first, ties by id. */
export function orderedReportLines(
  registered: readonly ShowReportLineDefinition[],
): readonly ShowReportLineDefinition[] {
  return [...BUILTIN_REPORT_LINES, ...registered].sort(
    (left, right) =>
      left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/** The "What changed" list: titles and appearances, then every feature's registered line. */
export function WhatChanged({ view }: { readonly view: ShowResultsView }) {
  const registered = useShowReportLines();
  const props: ResultsSectionProps = { eventInstanceId: view.eventInstanceId, view };
  return (
    <div className={styles['whatChanged']}>
      <ul className={styles['lines']}>
        {orderedReportLines(registered).map((definition) => (
          <ReportLine key={definition.id} definition={definition} props={props} />
        ))}
      </ul>
      <p className={styles['noChanges']}>Nothing on this show changed anything you track.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The report

export interface ShowReportProps {
  readonly view: ShowResultsView;
  readonly result: ShowResultView;
  /** The score fans in the show's region expected (EVT5), or null when not known. */
  readonly expectation?: number | null;
  /** 2 on the page itself, 3 inside the gallery. */
  readonly headingLevel?: 2 | 3;
  readonly tableLayout?: DataTableLayout;
}

/** The report: headline, then "How it was scored" beside "What changed" on a wide screen. */
export function ShowReport({
  view,
  result,
  expectation = null,
  headingLevel = 2,
  tableLayout = 'auto',
}: ShowReportProps) {
  const headingId = useId();
  const scoredId = useId();
  const changedId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const SubHeading = headingLevel === 2 ? 'h3' : 'h4';
  const { breakdown } = result;
  return (
    <section className={styles['report']} aria-labelledby={headingId} data-testid="show-report">
      <Heading id={headingId} className={styles['heading']}>
        Show report
      </Heading>
      <ReportHeadline view={view} result={result} expectation={expectation} />
      <div className={styles['columns']}>
        <section className={styles['part']} aria-labelledby={scoredId}>
          <div className={styles['partHeader']}>
            <SubHeading id={scoredId} className={styles['partHeading']}>
              How it was scored
            </SubHeading>
            {result.scoreTraceRef !== null && (
              <WhyButton
                label="Show score"
                value={result.score}
                unit="points"
                panelTitle="Show score"
                source={{ traceRef: result.scoreTraceRef }}
              />
            )}
          </div>
          {breakdown === null ? (
            <p className={styles['note']}>
              The slot-by-slot breakdown is kept for recent shows only.
            </p>
          ) : (
            <ScoreTable view={view} result={result} breakdown={breakdown} layout={tableLayout} />
          )}
        </section>
        <section className={styles['part']} aria-labelledby={changedId}>
          <SubHeading id={changedId} className={styles['partHeading']}>
            What changed
          </SubHeading>
          <WhatChanged view={view} />
        </section>
      </div>
    </section>
  );
}
