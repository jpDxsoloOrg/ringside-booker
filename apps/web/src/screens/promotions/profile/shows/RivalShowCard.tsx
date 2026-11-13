/**
 * One show on a promotion's Shows tab (AIP4-07): a disclosure whose header gives the date, the
 * show's name, its importance, brand and status, and which opens onto the card, slot by slot,
 * each filled slot with the booker's Why?. A card the viewer may not see yet opens onto "Card is
 * revealed when the show airs"; a cancelled show onto the reason. Everything shown comes from
 * `aip.showCards`: the web never works out a role, a title or a reason. Nothing here is a length
 * or a time. Once the show has run, the card opens on its score with the score's Why? and a link
 * to the full results (AIP4-08, EVT3). A computer-booked match that has run carries AIP5's result
 * line inside its slot: winner, method, reason and title badges, each with a Why? (AIP5-05). Design: docs/design/rival-booking.md#show-cards.
 */
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ShowCardRow, ShowCardSlot, TraceNode, TraceRef } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { CardSlot } from '@/components/CardSlot';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { Icon } from '@/components/Icon';
import { IMPORTANCE_LABELS } from '@/components/ShowChip/importance';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import { routes } from '@/app/routes';
import type { Tone } from '@/components/tone';
import { rivalResultSides, rivalSlotKey, toRivalCardSlotProps } from './rivalCardSlotProps';
import { RivalResultLine } from './RivalResultLine';
import styles from './RivalShowCard.module.css';

/** What a cancelled show's status reads. */
export const SHOW_CANCELLED_TEXT = 'Show cancelled';

/** The header's status words: "Completed · Score 62", "Booked", "Show cancelled". */
export function showStatusText(row: Pick<ShowCardRow, 'statusLabel' | 'score'>): string {
  if (row.statusLabel === 'Cancelled') return SHOW_CANCELLED_TEXT;
  if (row.statusLabel === 'Completed' && row.score !== null) {
    return `Completed · Score ${formatNumber(row.score)}`;
  }
  return row.statusLabel;
}

const STATUS_TONES: Readonly<Record<ShowCardRow['statusLabel'], Tone>> = {
  'Coming up': 'neutral',
  Booked: 'data',
  Completed: 'positive',
  'Not run': 'neutral',
  Cancelled: 'negative',
};

/** What a show that ran reads when none of its card is kept (old shows keep only a summary). */
export const DETAILS_KEPT_TEXT = 'Details are kept for the last 4 weeks.';

/** The link from a completed show's card to its results page. */
export const SEE_RESULTS_TEXT = 'See results';

/** The name of the score's Why? button: "Why this score? Rival Weekly, Jan 6". */
export function scoreWhyLabel(row: Pick<ShowCardRow, 'name' | 'date'>): string {
  return `Why this score? ${row.name}, ${formatGameDate(row.date, 'short')}`;
}

/** The name of a slot's Why? button: "Why this segment? Slot 3, Midcard". */
export function slotWhyLabel(slot: Pick<ShowCardSlot, 'displayNumber' | 'roleLabel'>): string {
  return `Why this segment? Slot ${String(slot.displayNumber)}, ${slot.roleLabel}`;
}

/** The name of the card's Why? button: "Why this card? Rival Weekly, Jan 6". */
export function cardWhyLabel(row: Pick<ShowCardRow, 'name' | 'date'>): string {
  return `Why this card? ${row.name}, ${formatGameDate(row.date, 'short')}`;
}

export interface RivalShowCardProps {
  readonly row: ShowCardRow;
  /** Open at first. Closed by default. */
  readonly defaultExpanded?: boolean;
  /**
   * Hands a breakdown over inline instead of fetching the stored one by reference; the gallery
   * uses it, having no engine. Return null to fetch.
   */
  readonly traceOf?: (ref: TraceRef) => TraceNode | null;
  /** The level of the show's heading. 3 by default; the slots sit one level below. */
  readonly headingLevel?: 3 | 4;
  readonly className?: string;
}

function sourceOf(ref: TraceRef | null, traceOf: RivalShowCardProps['traceOf']) {
  return traceSourceOf(ref === null ? null : traceOf?.(ref), ref);
}

/**
 * A completed show's score with its Why? and the link to its results page. Nothing for a show
 * that has not run (or whose score the viewer may not see yet).
 */
function ShowResultLine({
  row,
  traceOf,
}: {
  readonly row: ShowCardRow;
  readonly traceOf: RivalShowCardProps['traceOf'];
}) {
  if (row.statusLabel !== 'Completed' || row.score === null) return null;
  const scoreText = formatNumber(row.score);
  const source = sourceOf(row.scoreTraceRef, traceOf);
  return (
    <div className={styles['result']}>
      <p className={styles['score']}>
        Show score <span className={styles['scoreValue']}>{scoreText}</span>
      </p>
      {source !== null && (
        <WhyButton
          label="Show score"
          value={scoreText}
          buttonLabel={scoreWhyLabel(row)}
          panelTitle={`Why this score? ${row.name}`}
          source={source}
        />
      )}
      <Link className={styles['resultsLink']} to={routes.game.showResults(row.eventInstanceId)}>
        {SEE_RESULTS_TEXT}
        <Icon name="chevron-right" size="sm" decorative />
      </Link>
    </div>
  );
}

function CardBody({
  row,
  traceOf,
  slotHeadingLevel,
}: {
  readonly row: ShowCardRow;
  readonly traceOf: RivalShowCardProps['traceOf'];
  readonly slotHeadingLevel: 4;
}) {
  if (!row.revealed) {
    return (
      <EmptyState
        icon="calendar"
        size="inline"
        headingLevel={slotHeadingLevel}
        title={row.hiddenText ?? 'Card is revealed when the show airs'}
      />
    );
  }
  if (row.statusLabel === 'Cancelled') {
    return (
      <div className={styles['cancelled']}>
        <p className={styles['cancelledTitle']}>{SHOW_CANCELLED_TEXT}</p>
        {row.cancelledReason !== null && (
          <p className={styles['cancelledReason']}>{row.cancelledReason}</p>
        )}
      </div>
    );
  }
  const result = <ShowResultLine row={row} traceOf={traceOf} />;
  if (row.slots.length === 0) {
    return (
      <>
        {result}
        <EmptyState
          icon="calendar"
          size="inline"
          headingLevel={slotHeadingLevel}
          title={row.statusLabel === 'Completed' ? DETAILS_KEPT_TEXT : 'Nothing is on this card'}
        />
      </>
    );
  }
  return (
    <>
      {result}
      <ol className={styles['slots']} aria-label={`${row.name} card`}>
        {row.slots.map((slot) => {
          const source =
            slot.segment === null ? null : sourceOf(slot.segment.reasonTraceRef, traceOf);
          return (
            <li key={rivalSlotKey(slot)} data-segment-kind={slot.segment?.kind ?? 'open'}>
              <CardSlot
                {...toRivalCardSlotProps(slot)}
                headingLevel={slotHeadingLevel}
                emptyTitle="Open slot"
                {...(slot.segment !== null && slot.segment.decision !== null
                  ? {
                      result: (
                        <RivalResultLine
                          view={slot.segment.decision}
                          sides={rivalResultSides(slot.segment)}
                          matchLabel={slot.segment.label}
                          traceOf={traceOf}
                        />
                      ),
                    }
                  : {})}
                {...(slot.segment !== null && source !== null
                  ? {
                      actions: (
                        <WhyButton
                          label={`slot ${String(slot.displayNumber)}`}
                          value={slot.segment.label}
                          buttonLabel={slotWhyLabel(slot)}
                          panelTitle={`Why this segment? ${slot.segment.label}`}
                          source={source}
                        />
                      ),
                    }
                  : {})}
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * A show as a disclosure: the header button (44px tall) opens and closes its card. A "Why this
 * card?" button sits beside it while the plan's breakdown is kept. On a phone the header wraps to
 * two lines, date and status first, then the name.
 */
export function RivalShowCard({
  row,
  defaultExpanded = false,
  traceOf,
  headingLevel = 3,
  className,
}: RivalShowCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const planSource = sourceOf(row.planTraceRef, traceOf);
  const statusText = showStatusText(row);
  return (
    <article
      className={classNames(styles['show'], className)}
      data-status={row.status}
      data-revealed={row.revealed}
    >
      <div className={styles['header']}>
        <Heading className={styles['heading']}>
          <button
            type="button"
            className={styles['toggle']}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            <Icon
              name="chevron-down"
              decorative
              className={classNames(styles['chevron'], expanded && styles['chevronOpen'])}
            />
            <time className={styles['date']} dateTime={row.date}>
              {formatGameDate(row.date, 'dayMonth')}
            </time>
            <span className={styles['name']}>{row.name}</span>
            <span className={styles['tags']}>
              <Badge tone="neutral">{IMPORTANCE_LABELS[row.importance]}</Badge>
              {row.brandName !== null && <span className={styles['brand']}>{row.brandName}</span>}
            </span>
            <Badge tone={STATUS_TONES[row.statusLabel]} className={styles['status']}>
              {statusText}
            </Badge>
          </button>
        </Heading>
        {planSource !== null && (
          <span className={styles['why']}>
            <WhyButton
              label={row.name}
              value={statusText}
              buttonLabel={cardWhyLabel(row)}
              panelTitle={`Why this card? ${row.name}`}
              source={planSource}
            />
          </span>
        )}
      </div>
      <div id={bodyId} className={styles['body']} hidden={!expanded}>
        {expanded && <CardBody row={row} traceOf={traceOf} slotHeadingLevel={4} />}
      </div>
    </article>
  );
}
