import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type {
  BookingCard,
  BookingSectionView,
  BookingSegmentView,
  BookingShowRow,
  BookingSlotView,
  BookingValidation,
  CommandResult,
  EventInstanceId,
  MatchOutcome,
  Reason,
  SegmentId,
} from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useHasPromotion } from '@/app/session/sessionStore';
import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { IMPORTANCE_LABELS } from '@/components/ShowChip';
import { useIsMobile } from '@/styles/useMediaQuery';
import { prefersReducedMotion } from '@/styles/useReducedMotion';
import styles from './Booking.module.css';
import { BOOKING_PARAMS } from './bookingUrl';
import { CardBoard, slotRowId } from './CardBoard';
import type { MoveSource } from './CardBoard';
import { issuesBySlot } from './cardSlotProps';
import { SegmentEditorSheet } from './editor/SegmentEditorSheet';
import { useSegmentEditor } from './editor/editorStore';
import { fixProblemsText, RunShowButton, ShowBar } from './ShowBar';
import { useBookingPanels } from './registries/bookingPanels';
import type { BookingPanelContext, BookingPanelDefinition } from './registries/bookingPanels';
import { SlotActions } from './SlotActions';
import { ValidationChecklist } from './ValidationChecklist';

/** Enough rows for every show inside the calendar's horizon, so `?event=` finds far-off shows. */
const SHOW_LIMIT = 60;

/** Most `phoneSummary` lines the phone's sticky bar shows. */
const PHONE_SUMMARY_LINES = 2;

const NO_REASON = 'The game did not say why.';

/** "Mon 11 Jan · Altura Mainstage · 2/6": a show in the picker. */
export function showOptionLabel(row: BookingShowRow): string {
  return `${formatGameDate(row.date, 'dayMonth')} · ${row.name} · ${String(row.filledMain)}/${String(row.slots)}`;
}

/** "Today", "In 1 day", "In 6 days". */
export function daysUntilText(daysUntil: number): string {
  if (daysUntil <= 0) return 'Today';
  return `In ${String(daysUntil)} ${daysUntil === 1 ? 'day' : 'days'}`;
}

/** "3 problems", "1 problem", "No problems". */
function problemsText(errors: number): string {
  if (errors === 0) return 'No problems';
  return `${String(errors)} ${errors === 1 ? 'problem' : 'problems'}`;
}

/** A drop or a Move up / down that the engine has not answered yet. */
interface PendingMove {
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly preShow: boolean;
  /** The card's revision when the move was made; a newer card replaces the override. */
  readonly baseRevision: number | null;
}

/**
 * The card with a pending move drawn as if it had happened: the two slots trade segments. The
 * query cache is never written; the next `booking.card` answer is the truth.
 */
export function withPendingMove(
  sections: readonly BookingSectionView[],
  move: PendingMove | null,
): readonly BookingSectionView[] {
  if (move === null) return sections;
  return sections.map((section) => {
    if (section.preShow !== move.preShow) return section;
    const from = section.slots.find((slot) => slot.slot === move.fromSlot);
    const to = section.slots.find((slot) => slot.slot === move.toSlot);
    if (from === undefined || to === undefined) return section;
    return {
      ...section,
      slots: section.slots.map((slot) => {
        if (slot.slot === move.fromSlot) return { ...slot, segment: to.segment };
        if (slot.slot === move.toSlot) return { ...slot, segment: from.segment };
        return slot;
      }),
    };
  });
}

/** What a failed query says: the engine's first reason, or the transport's message. */
function queryErrorText(error: EngineQueryError | null): string {
  if (error === null) return NO_REASON;
  if (error.kind === 'transport') return error.message;
  return error.reasons[0]?.message ?? NO_REASON;
}

/** The engine's reasons, or one plain line when a refusal came with none. */
function reasonsOf<T>(result: CommandResult<T>): readonly Reason[] {
  if (result.ok) return [];
  return result.reasons.length > 0 ? result.reasons : [{ code: 'unknown', message: NO_REASON }];
}

/** Where a segment sits on the card, or null when it is not on it. */
export function slotOfSegment(
  sections: readonly BookingSectionView[],
  segmentId: string,
): { readonly preShow: boolean; readonly slot: number } | null {
  for (const section of sections) {
    const found = section.slots.find((slot) => slot.segment?.segmentId === segmentId);
    if (found !== undefined) return { preShow: found.preShow, slot: found.slot };
  }
  return null;
}

interface NoticeProps {
  readonly reasons: readonly Reason[];
  readonly onDismiss: () => void;
  /** The card's sections, so a reason about a segment can jump to its slot. */
  readonly sections?: readonly BookingSectionView[];
  readonly onShowSlot?: (preShow: boolean, slot: number) => void;
}

/** A refusal, in the engine's own words, until it is dismissed or the next change succeeds. */
function RefusalNotice({ reasons, onDismiss, sections = [], onShowSlot }: NoticeProps) {
  return (
    <div className={styles['notice']} role="alert">
      <div className={styles['noticeBody']}>
        <p className={styles['noticeTitle']}>That change didn't go through</p>
        <ul className={styles['noticeList']}>
          {reasons.map((reason, index) => {
            const at =
              reason.subject?.kind === 'segment'
                ? slotOfSegment(sections, reason.subject.id)
                : null;
            return (
              <li key={`${reason.code}-${String(index)}`}>
                {at === null || onShowSlot === undefined ? (
                  reason.message
                ) : (
                  <button
                    type="button"
                    className={styles['noticeJump']}
                    onClick={() => {
                      onShowSlot(at.preShow, at.slot);
                    }}
                  >
                    {reason.message}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <IconButton icon="close" label="Dismiss" variant="ghost" size="sm" onClick={onDismiss} />
    </div>
  );
}

interface PanelSlotProps {
  readonly panel: BookingPanelDefinition;
  readonly context: BookingPanelContext;
}

/** A registered panel, headed by its title as a named region when it has one. */
function RegisteredPanel({ panel, context }: PanelSlotProps) {
  const headingId = useId();
  const content = panel.render(context);
  if (content === null || content === undefined || content === false) return null;
  if (panel.title === undefined) return <div className={styles['featurePanel']}>{content}</div>;
  return (
    <section aria-labelledby={headingId} className={styles['featurePanel']}>
      <h3 id={headingId} className={styles['sideHeading']}>
        {panel.title}
      </h3>
      {content}
    </section>
  );
}

interface ShowHeaderProps {
  readonly rows: readonly BookingShowRow[];
  readonly row: BookingShowRow;
  readonly card: BookingCard | null;
  readonly onSelect: (eventInstanceId: EventInstanceId) => void;
  readonly actions: ReactNode;
}

function ShowHeader({ rows, row, card, onSelect, actions }: ShowHeaderProps) {
  const options: readonly SelectOption[] = rows.map((show) => ({
    value: show.eventInstanceId,
    label: showOptionLabel(show),
  }));
  const tonight = card?.runsTonight ?? row.needsBooking;
  return (
    <header className={styles['showHeader']}>
      <div className={styles['showPicker']}>
        <Select
          label="Show"
          options={options}
          value={row.eventInstanceId}
          onValueChange={(value) => {
            if (isId('eventInstance', value)) onSelect(value);
          }}
        />
        <Link
          className={styles['calendarLink']}
          to={routes.game.calendarAt({ month: row.date.slice(0, 7), show: row.eventInstanceId })}
        >
          Open in calendar
        </Link>
      </div>
      <div className={styles['showTitle']}>
        <ul className={styles['showTags']} aria-label="About this show">
          <li>
            <Badge
              tone={
                row.importance === 'major' || row.importance === 'flagship' ? 'prestige' : 'neutral'
              }
            >
              {IMPORTANCE_LABELS[row.importance]}
            </Badge>
          </li>
          {row.brandName !== null && (
            <li>
              <Badge tone="data">{row.brandName}</Badge>
            </li>
          )}
          <li>
            <Badge tone={tonight ? 'positive' : 'data'}>{tonight ? 'Tonight' : 'Scheduled'}</Badge>
          </li>
        </ul>
        <h2 className={styles['showName']}>{row.name}</h2>
        <p className={styles['showMeta']}>
          {formatGameDate(row.date, 'long')}
          {card !== null && (
            <span className={styles['countdown']}>{daysUntilText(card.show.daysUntil)}</span>
          )}
        </p>
      </div>
      <div className={styles['headerActions']}>{actions}</div>
    </header>
  );
}

interface PhoneBarProps {
  readonly card: BookingCard;
  readonly validation: BookingValidation | null;
  readonly summaries: readonly { readonly panel: BookingPanelDefinition; readonly text: string }[];
  readonly busy: boolean;
  readonly onOpenChecklist: () => void;
  readonly onOpenPanel: (panelId: string) => void;
  readonly onRun: () => void;
}

/** The phone's one sticky element: feature summaries, then "3 problems · Run the show". */
function PhoneBar({
  card,
  validation,
  summaries,
  busy,
  onOpenChecklist,
  onOpenPanel,
  onRun,
}: PhoneBarProps) {
  const errors = validation?.errors.length ?? 0;
  const label = validation === null ? 'Checking…' : problemsText(errors);
  return (
    <div className={styles['phoneBar']}>
      {summaries.map(({ panel, text }) => (
        <button
          key={panel.id}
          type="button"
          className={styles['phoneSummary']}
          onClick={() => {
            onOpenPanel(panel.id);
          }}
        >
          {text}
        </button>
      ))}
      <div className={styles['phoneBarRow']}>
        <button
          type="button"
          className={styles['phoneProblems']}
          data-state={errors > 0 ? 'error' : 'ok'}
          onClick={onOpenChecklist}
        >
          {label}
        </button>
        <RunShowButton card={card} validation={validation} busy={busy} onRun={onRun} />
      </div>
    </div>
  );
}

interface ShowBookingProps {
  readonly rows: readonly BookingShowRow[];
  readonly row: BookingShowRow;
  readonly onSelect: (eventInstanceId: EventInstanceId) => void;
  /** The show has run: open its results. */
  readonly onRan: (eventInstanceId: EventInstanceId) => void;
}

/**
 * One show: its header, the card, the checklist, Run the show on its day, and the panels other
 * features add. This is also the show screen: the day stops on a show of yours ("Tonight") and
 * Go to the show opens it here (EVT2-09).
 */
function ShowBooking({ rows, row, onSelect, onRan }: ShowBookingProps) {
  const eventInstanceId = row.eventInstanceId;
  const isMobile = useIsMobile();
  const announce = useAnnounce();
  const panels = useBookingPanels();
  const openNew = useSegmentEditor((state) => state.openNew);
  const openExisting = useSegmentEditor((state) => state.openExisting);
  const cardQuery = useEngineQuery('booking.card', { eventInstanceId });
  const validationQuery = useEngineQuery('booking.validate', { eventInstanceId });
  const moveSegment = useEngineCommand('booking.moveSegment');
  const setResult = useEngineCommand('booking.setResult');
  const removeSegment = useEngineCommand('booking.removeSegment');
  const clearCard = useEngineCommand('booking.clearCard');
  const runTonight = useEngineCommand('shows.runTonight');

  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [refusal, setRefusal] = useState<readonly Reason[] | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [openPanelId, setOpenPanelId] = useState<string | null>(null);

  // A newer card replaces the pending move once it has arrived.
  const cardRevision = cardQuery.revision;
  const cardIsStale = cardQuery.isStale;
  useEffect(() => {
    if (pendingMove === null) return;
    if (cardRevision !== pendingMove.baseRevision && !cardIsStale) setPendingMove(null);
  }, [cardRevision, cardIsStale, pendingMove]);

  const card = cardQuery.data ?? null;
  const validation = validationQuery.data ?? null;

  const showSlot = useCallback((preShow: boolean, slot: number) => {
    setChecklistOpen(false);
    // After the checklist sheet (on a phone) has handed focus back.
    window.setTimeout(() => {
      const row = document.getElementById(slotRowId(preShow, slot));
      if (row === null) return;
      row.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
      row.focus({ preventScroll: true });
    }, 0);
  }, []);

  const settle = <T,>(result: CommandResult<T>, success?: string): boolean => {
    if (result.ok) {
      setRefusal(null);
      if (success !== undefined) announce(success);
      return true;
    }
    setRefusal(reasonsOf(result));
    return false;
  };

  if (cardQuery.status === 'error') {
    return (
      <>
        <ShowHeader rows={rows} row={row} card={null} onSelect={onSelect} actions={null} />
        <EmptyState
          icon="booking"
          title="This card can't be shown"
          body={queryErrorText(cardQuery.error)}
        />
      </>
    );
  }
  if (card === null) {
    return (
      <>
        <ShowHeader rows={rows} row={row} card={null} onSelect={onSelect} actions={null} />
        <p className={styles['muted']} role="status">
          Loading the card…
        </p>
      </>
    );
  }

  const handleMove = (from: BookingSlotView, to: BookingSlotView, how: MoveSource): void => {
    // Moving into an open slot from an open slot changes nothing; a filled slot moves its segment.
    const mover = from.segment ?? to.segment;
    const source = from.segment === null ? to : from;
    const target = from.segment === null ? from : to;
    if (mover === null || source.slot === target.slot) return;
    const swapped = target.segment;
    const message =
      swapped === null
        ? `${source.roleLabel} moved to slot ${String(target.displayNumber)}`
        : `${source.roleLabel} moved to slot ${String(target.displayNumber)}, swapped with ${target.roleLabel}`;
    setPendingMove({
      preShow: source.preShow,
      fromSlot: source.slot,
      toSlot: target.slot,
      baseRevision: cardRevision,
    });
    void (async () => {
      const result = await moveSegment.run({
        segmentId: mover.segmentId,
        toPreShow: target.preShow,
        toSlot: target.slot,
      });
      if (!settle(result, how === 'drag' ? undefined : message)) setPendingMove(null);
    })();
  };

  const handleSetResult = (segmentId: SegmentId, result: MatchOutcome): void => {
    void (async () => {
      settle(await setResult.run({ segmentId, result }), 'Result planned');
    })();
  };

  const handleRemove = async (segment: BookingSegmentView): Promise<void> => {
    const result = await removeSegment.run({ segmentId: segment.segmentId });
    if (!result.ok) throw new Error(reasonsOf(result)[0]?.message ?? NO_REASON);
    settle(result, `${segment.typeName} removed`);
  };

  const handleClear = async (): Promise<void> => {
    const result = await clearCard.run({ eventInstanceId });
    if (!result.ok) throw new Error(reasonsOf(result)[0]?.message ?? NO_REASON);
    settle(result, 'Card cleared');
  };

  const handleRun = (): void => {
    void (async () => {
      const result = await runTonight.run({ eventInstanceId });
      if (settle(result, `${row.name} is over`) && result.ok) onRan(result.data.eventInstanceId);
    })();
  };

  const sections = withPendingMove(card.sections, pendingMove);
  const issues = issuesBySlot(validation?.errors ?? [], validation?.warnings ?? []);
  const canEdit = card.canEdit;
  const context: BookingPanelContext = { eventInstanceId, card, validation };
  const sidePanels = panels.filter((panel) => panel.placement === 'side');
  const belowPanels = panels.filter((panel) => panel.placement === 'below');
  const summaries = panels
    .map((panel) => ({ panel, text: panel.phoneSummary?.(context) ?? null }))
    .filter(
      (entry): entry is { panel: BookingPanelDefinition; text: string } =>
        entry.text !== null && entry.text !== '',
    )
    .slice(0, PHONE_SUMMARY_LINES);
  const openPanel = panels.find((panel) => panel.id === openPanelId) ?? null;
  const runBusy = runTonight.pending;

  const showBar = (
    <ShowBar
      card={card}
      validation={validation}
      busy={runBusy}
      hideRun={isMobile}
      onRun={handleRun}
      onClear={handleClear}
    />
  );

  const board = (
    <CardBoard
      sections={sections}
      issues={issues}
      canReorder={canEdit && !isMobile}
      onMove={handleMove}
      {...(canEdit
        ? {
            onAdd: (slot: BookingSlotView, kind: 'match' | 'angle') => {
              openNew({ eventInstanceId, preShow: slot.preShow, slot: slot.slot, kind });
            },
          }
        : card.editBlock === null
          ? {}
          : { emptyHint: card.editBlock.message })}
      renderActions={(slot, section) =>
        canEdit ? (
          <SlotActions
            slot={slot}
            section={section}
            showMoveButtons={isMobile}
            randomWinners={card.randomWinners}
            onEdit={openExisting}
            onSetResult={handleSetResult}
            onMove={(from, to) => {
              handleMove(from, to, 'button');
            }}
            onRemove={handleRemove}
          />
        ) : null
      }
    />
  );

  return (
    <div className={styles['booking']} data-layout={isMobile ? 'phone' : 'desktop'}>
      <ShowHeader rows={rows} row={row} card={card} onSelect={onSelect} actions={showBar} />
      {refusal !== null && (
        <RefusalNotice
          reasons={refusal}
          sections={card.sections}
          onShowSlot={showSlot}
          onDismiss={() => {
            setRefusal(null);
          }}
        />
      )}
      {!canEdit && card.editBlock !== null && (
        <p className={styles['editBlock']} role="status">
          <span>{card.editBlock.message}</span>
        </p>
      )}
      <div className={styles['columns']}>
        <div className={styles['mainColumn']}>
          {board}
          {isMobile &&
            sidePanels.map((panel) => (
              <RegisteredPanel key={panel.id} panel={panel} context={context} />
            ))}
          {belowPanels.map((panel) => (
            <RegisteredPanel key={panel.id} panel={panel} context={context} />
          ))}
        </div>
        {!isMobile && (
          <aside className={styles['sideColumn']} aria-label="Checks and panels">
            <ValidationChecklist validation={validation} onShowSlot={showSlot} />
            {sidePanels.map((panel) => (
              <RegisteredPanel key={panel.id} panel={panel} context={context} />
            ))}
          </aside>
        )}
      </div>
      {isMobile && (
        <>
          <PhoneBar
            card={card}
            validation={validation}
            summaries={summaries}
            busy={runBusy}
            onOpenChecklist={() => {
              setChecklistOpen(true);
            }}
            onOpenPanel={setOpenPanelId}
            onRun={handleRun}
          />
          <Sheet
            open={checklistOpen}
            onClose={() => {
              setChecklistOpen(false);
            }}
            title={problemsText(validation?.errors.length ?? 0)}
            side="bottom"
          >
            {card.runsTonight && validation !== null && validation.errors.length > 0 && (
              <p className={styles['runHint']}>{fixProblemsText(validation.errors.length)}</p>
            )}
            <ValidationChecklist validation={validation} onShowSlot={showSlot} headingLevel={3} />
          </Sheet>
          <Sheet
            open={openPanel !== null}
            onClose={() => {
              setOpenPanelId(null);
            }}
            title={openPanel?.title ?? 'Details'}
            side="bottom"
          >
            {openPanel?.render(context)}
          </Sheet>
        </>
      )}
      <SegmentEditorSheet card={card} />
    </div>
  );
}

/**
 * Booking for the local seat: picks the show from `?event=` (or the next one to book), writes the
 * choice back to the URL, and draws that show's card. Explains itself when there is nothing to
 * book.
 */
export function BookingView() {
  const hasPromotion = useHasPromotion();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shows = useEngineQuery('booking.shows', { limit: SHOW_LIMIT }, { enabled: hasPromotion });
  const rows = shows.data?.rows ?? [];
  const param = searchParams.get(BOOKING_PARAMS.event);
  const fromParam = rows.find((row) => row.eventInstanceId === param) ?? null;
  const selected =
    fromParam ??
    rows.find((row) => row.eventInstanceId === shows.data?.nextToBookId) ??
    rows[0] ??
    null;
  const selectedId = selected?.eventInstanceId ?? null;

  const select = useCallback(
    (eventInstanceId: EventInstanceId) => {
      const next = new URLSearchParams(searchParams);
      next.set(BOOKING_PARAMS.event, eventInstanceId);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Once a show has run we are on our way to its results: the show list drops it, and the URL must
  // not be pointed at the next show meanwhile (the results route loads lazily).
  const leaving = useRef(false);
  const openResults = useCallback(
    (eventInstanceId: EventInstanceId) => {
      leaving.current = true;
      // The results page plays the segments in one at a time, as after Next Day.
      navigate(routes.game.showResults(eventInstanceId, { reveal: true }));
    },
    [navigate],
  );

  // Write the show actually shown back to the URL, so a reload or a shared link lands on it.
  const loaded = shows.status === 'success';
  useEffect(() => {
    if (leaving.current) return;
    if (loaded && selectedId !== null && param !== selectedId) select(selectedId);
  }, [loaded, param, select, selectedId]);

  if (!hasPromotion) {
    return (
      <EmptyState
        icon="booking"
        title="You don't run a promotion"
        body="Booking is for the shows of a promotion you run. Once you run one, its shows are booked here."
      />
    );
  }
  if (shows.status === 'loading') {
    return (
      <p className={styles['muted']} role="status">
        Loading your shows…
      </p>
    );
  }
  if (shows.status === 'error') {
    return (
      <EmptyState
        icon="booking"
        title="Your shows can't be listed"
        body={queryErrorText(shows.error)}
      />
    );
  }
  if (shows.data?.available === false) {
    return (
      <EmptyState
        icon="booking"
        title="Shows can't be booked in this save"
        body={
          shows.data.unavailableReason ??
          'This save was started before shows could be booked. Start a new game to book shows.'
        }
      />
    );
  }
  if (selected === null) {
    return (
      <EmptyState
        icon="calendar"
        title="No shows to book"
        body="None of your shows are coming up. Shows appear here once they are on your calendar."
        action={
          <Button
            onClick={() => {
              navigate(routes.game.calendar());
            }}
          >
            Open the calendar
          </Button>
        }
      />
    );
  }
  return (
    <ShowBooking
      key={selected.eventInstanceId}
      rows={rows}
      row={selected}
      onSelect={select}
      onRan={openResults}
    />
  );
}
