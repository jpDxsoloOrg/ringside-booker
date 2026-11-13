import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CalendarShow, CalendarShowDetail, GameDate } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Sheet } from '@/components/Sheet';
import { WhyButton } from '@/components/Trace';
import styles from './Calendar.module.css';
import { IMPORTANCE_LABELS } from './importance';
import { placementTraceInWords, VENUE_NOT_CHOSEN_TEXT } from './placementWording';
import { useShowSheetActions, useShowSheetSections } from './registry';
import type { ShowSheetContext } from './registry';
import { slotsText } from './slotsText';
import { statusText, statusTone } from './statusText';

/** Why the sheet has no show to draw: it is still loading, or the id names none. */
export type ShowSheetGap = 'loading' | 'notFound';

export interface ShowDetailSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * The show: its calendar row, or the fuller `calendar.show` answer once that has arrived (which
   * adds how often it runs and why it is held where it is). Null while there is nothing to draw.
   */
  readonly show: CalendarShow | CalendarShowDetail | null;
  /** What to say while `show` is null. `loading` by default. */
  readonly gap?: ShowSheetGap;
  /** The game's current date. */
  readonly today: GameDate;
  /** Name the promotion among the facts: for a calendar that lists every promotion's shows. */
  readonly showPromotion: boolean;
  /**
   * Calls the show off. Resolves once it is cancelled; rejects with the reason as the error's
   * message when the game refuses. The Cancel show button is only drawn when this is given and
   * the row says the viewer can cancel.
   */
  readonly onCancelShow?: (show: CalendarShow) => Promise<void>;
}

function isDetail(show: CalendarShow | CalendarShowDetail): show is CalendarShowDetail {
  return 'placementTrace' in show;
}

interface Fact {
  readonly term: string;
  readonly value: ReactNode;
}

function dateFact(show: CalendarShow): ReactNode {
  const date = formatGameDate(show.date, 'long');
  if (show.airDate === show.date) return date;
  return (
    <>
      {date}
      <span className={styles['factNote']}>Airs {formatGameDate(show.airDate, 'long')}</span>
    </>
  );
}

function venueFact(show: CalendarShow | CalendarShowDetail): ReactNode {
  // A generic local venue (EVT6) has no venue row, so it comes on the row by name.
  const place = show.venue ?? show.genericVenue ?? null;
  const venueText =
    place === null
      ? 'Venue not chosen yet'
      : `${place.name} (holds ${formatNumber(place.capacity)})`;
  const placementTrace = isDetail(show) ? show.placementTrace : null;
  if (placementTrace === null) return venueText;
  const trace = placementTraceInWords(placementTrace, show.venue?.name ?? null);
  return (
    <span className={styles['factWithWhy']}>
      {venueText}
      <WhyButton
        label="the venue"
        value={show.venue?.name ?? VENUE_NOT_CHOSEN_TEXT}
        panelTitle="Where the show is held"
        source={{ trace }}
      />
    </span>
  );
}

function factsOf(show: CalendarShow | CalendarShowDetail, showPromotion: boolean): Fact[] {
  const facts: Fact[] = [{ term: 'Date', value: dateFact(show) }];
  if (showPromotion) facts.push({ term: 'Promotion', value: show.promotion.name });
  facts.push(
    { term: 'Brand', value: show.brand?.name ?? 'Whole promotion' },
    { term: 'Importance', value: IMPORTANCE_LABELS[show.importance] },
    { term: 'Card', value: slotsText(show.format) },
  );
  if (show.televised !== null) {
    facts.push({ term: 'Television', value: show.televised ? 'Televised' : 'Not televised' });
  }
  if (isDetail(show)) {
    facts.push({ term: 'Runs', value: show.definition?.recurrenceText ?? 'One-off show' });
  }
  facts.push(
    { term: 'Region', value: `${show.region.name}, ${show.region.countryName}` },
    { term: 'Venue', value: venueFact(show) },
    {
      term: 'Status',
      value: <Badge tone={statusTone(show)}>{statusText(show)}</Badge>,
    },
  );
  return facts;
}

/** A node a slot's `render` returned that actually draws something. */
function isDrawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false && node !== '';
}

interface ShowSheetBodyProps {
  readonly show: CalendarShow | CalendarShowDetail;
  readonly context: ShowSheetContext;
  readonly showPromotion: boolean;
}

function ShowSheetBody({ show, context, showPromotion }: ShowSheetBodyProps) {
  const sections = useShowSheetSections();
  const headingIdPrefix = useId();

  return (
    <div className={styles['sheetBody']}>
      <div className={styles['sheetHead']}>
        <ImageSlot
          subject={{ kind: 'event', id: show.definitionId ?? show.key, name: show.name }}
          size="lg"
          decorative
        />
        <p className={styles['sheetLead']}>
          {show.promotion.name}
          <span className={styles['factNote']}>{formatGameDate(show.date, 'dayMonthYear')}</span>
        </p>
      </div>
      {show.status === 'projected' && (
        <p className={styles['sheetNote']}>
          This date is past the stored schedule. It becomes a show you can act on once the schedule
          reaches it.
        </p>
      )}
      <dl className={styles['facts']}>
        {factsOf(show, showPromotion).map((fact) => (
          <div key={fact.term} className={styles['fact']}>
            <dt>{fact.term}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {sections.map((section) => {
        const content = section.render(context);
        if (!isDrawn(content)) return null;
        const headingId = `${headingIdPrefix}-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={headingId} className={styles['sheetSection']}>
            <h3 id={headingId} className={styles['sheetSectionHeading']}>
              {section.title}
            </h3>
            {content}
          </section>
        );
      })}
    </div>
  );
}

const GAP_TITLES: Readonly<Record<ShowSheetGap, string>> = {
  loading: 'Loading show',
  notFound: 'Show not found',
};

/**
 * One show in full, in a side sheet (a bottom sheet on phones): when and where it is, how big its
 * card is, how often it runs and its status. A show the viewer runs and can still call off has a
 * Cancel show button, which asks first.
 *
 * Other features add to it through the slots in `registry.ts`: actions in the footer row and
 * titled sections under the facts.
 */
export function ShowDetailSheet({
  open,
  onClose,
  show,
  gap = 'loading',
  today,
  showPromotion,
  onCancelShow,
}: ShowDetailSheetProps) {
  const actions = useShowSheetActions();
  const [isConfirming, setIsConfirming] = useState(false);
  const wasConfirmingRef = useRef(false);

  // A cancelled show loses its Cancel show button, which is where the confirmation would hand
  // focus back to. When that leaves focus nowhere, it goes to the sheet's title instead.
  useEffect(() => {
    const justClosed = wasConfirmingRef.current && !isConfirming;
    wasConfirmingRef.current = isConfirming;
    if (!justClosed) return undefined;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      document.querySelector<HTMLElement>('[data-sheet-title]')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isConfirming]);

  if (show === null) {
    return (
      <Sheet open={open} onClose={onClose} title={GAP_TITLES[gap]} side="right" size="md">
        {gap === 'loading' ? (
          <p className={styles['sheetNote']} role="status">
            Loading the show…
          </p>
        ) : (
          <EmptyState
            icon="calendar"
            title="That show no longer exists"
            body="It may belong to another game, or the link may be out of date."
          />
        )}
      </Sheet>
    );
  }

  const context: ShowSheetContext = { show, isOwn: show.isOwn, today };
  const drawnActions = actions
    .map((action) => ({ id: action.id, content: action.render(context) }))
    .filter((action) => isDrawn(action.content));
  const canCancel = show.canCancel && onCancelShow !== undefined;
  const footer =
    drawnActions.length > 0 || canCancel ? (
      <div className={styles['sheetActions']}>
        {drawnActions.map((action) => (
          <span key={action.id} className={styles['sheetAction']}>
            {action.content}
          </span>
        ))}
        {canCancel && (
          <Button
            variant="danger"
            className={styles['cancelButton']}
            onClick={() => {
              setIsConfirming(true);
            }}
          >
            Cancel show
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={show.name}
        side="right"
        size="md"
        {...(footer === undefined ? {} : { footer })}
      >
        <ShowSheetBody show={show} context={context} showPromotion={showPromotion} />
      </Sheet>
      {onCancelShow !== undefined && (
        <ConfirmDialog
          open={open && isConfirming}
          onClose={() => {
            setIsConfirming(false);
          }}
          onConfirm={async () => {
            await onCancelShow(show);
          }}
          tone="danger"
          title={`Cancel ${show.name} on ${formatGameDate(show.date, 'dayMonthYear')}?`}
          body="This can't be undone; the date stays empty."
          confirmLabel="Cancel show"
          cancelLabel="Keep show"
        />
      )}
    </>
  );
}
