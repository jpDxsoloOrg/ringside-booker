import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isId, startOfMonth } from '@ringside/engine';
import type { CalendarScope, CalendarShow, EventInstanceId, GameDate } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { CALENDAR_PARAMS } from '@/app/routes';
import { useHasPromotion } from '@/app/session/sessionStore';
import { Button, IconButton } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import type { ShowChipTag } from '@/components/ShowChip';
import { useIsMobile } from '@/styles/useMediaQuery';
import { AgendaList } from './AgendaList';
import styles from './Calendar.module.css';
import {
  groupByDate,
  monthParamOf,
  monthTitle,
  monthWeeks,
  parseMonthParam,
  shiftMonth,
} from './calendarMonth';
import { DayMarkers } from './DayMarkers';
import { IMPORTANCE_LABELS, IMPORTANCE_ORDER } from './importance';
import { CALENDAR_DATE_ATTRIBUTE, MonthGrid } from './MonthGrid';
import { useCalendarToolbarItems } from './registry';
import type { CalendarDayMarker } from './registry';
import { ShowDetailSheet } from './ShowDetailSheet';

const SCOPE_OPTIONS: readonly RadioOption<CalendarScope>[] = [
  { value: 'mine', label: 'My shows' },
  { value: 'world', label: 'Whole world' },
];

/** Said in the confirmation when a refusal comes back with no reason of its own. */
const CANCEL_FALLBACK_ERROR = 'The show could not be cancelled.';

const NO_SHOWS: readonly CalendarShow[] = [];

/** What the screen keeps in the URL, so a reload or a shared link lands on the same view. */
interface CalendarUrlChange {
  /** The first day of the month to show. */
  readonly month?: GameDate;
  readonly scope?: CalendarScope;
  /** A stored show to open, or null to close the sheet. */
  readonly show?: EventInstanceId | null;
}

/** The colours and the dashed edge, in words. Colour is never the only cue (see `ShowChip`). */
function CalendarLegend() {
  return (
    <ul className={styles['legend']} aria-label="What the colours mean">
      {IMPORTANCE_ORDER.map((importance) => (
        <li key={importance} className={styles['legendItem']}>
          <span className={styles['legendSwatch']} data-importance={importance} />
          {IMPORTANCE_LABELS[importance]}
        </li>
      ))}
      <li className={styles['legendItem']}>
        <span className={styles['legendDashed']} />
        Dashed = projected
      </li>
    </ul>
  );
}

interface StoredShowSheetProps {
  readonly eventInstanceId: EventInstanceId;
  readonly open: boolean;
  /** The show's row from the month on screen, to draw from while the full answer loads. */
  readonly row: CalendarShow | null;
  readonly today: GameDate;
  readonly showPromotion: boolean;
  readonly onClose: () => void;
}

/** The sheet for a stored show: reads `calendar.show` while it is open and can cancel the show. */
function StoredShowSheet({
  eventInstanceId,
  open,
  row,
  today,
  showPromotion,
  onClose,
}: StoredShowSheetProps) {
  const detail = useEngineQuery('calendar.show', { eventInstanceId }, { enabled: open });
  const cancelShow = useEngineCommand('calendar.cancelShow');
  const announce = useAnnounce();

  const handleCancel = async (show: CalendarShow): Promise<void> => {
    if (show.eventInstanceId === null) return;
    const result = await cancelShow.run({ eventInstanceId: show.eventInstanceId });
    if (!result.ok) {
      throw new Error(result.reasons[0]?.message ?? CANCEL_FALLBACK_ERROR);
    }
    announce('Show cancelled');
  };

  const answered = detail.status !== 'loading';
  const show = detail.data ?? (answered ? null : row);
  return (
    <ShowDetailSheet
      open={open}
      onClose={onClose}
      show={show}
      gap={answered ? 'notFound' : 'loading'}
      today={today}
      showPromotion={showPromotion}
      onCancelShow={handleCancel}
    />
  );
}

interface LoadedCalendarProps {
  readonly today: GameDate;
}

function LoadedCalendar({ today }: LoadedCalendarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hasPromotion = useHasPromotion();
  const isMobile = useIsMobile();
  const toolbarItems = useCalendarToolbarItems();
  const rootRef = useRef<HTMLDivElement>(null);
  // A projected show has no id to put in the URL, so its sheet is local state.
  const [projectedShow, setProjectedShow] = useState<CalendarShow | null>(null);
  // The day of the show whose sheet was open last, for putting focus back when nothing else can.
  const lastOpenedDateRef = useRef<GameDate | null>(null);
  const openedWithoutOpenerRef = useRef(false);

  const todayMonth = startOfMonth(today);
  const month = parseMonthParam(searchParams.get(CALENDAR_PARAMS.month)) ?? todayMonth;
  // With no promotion there are no shows of your own: the scope is the whole world, no switch.
  const scope: CalendarScope =
    hasPromotion && searchParams.get(CALENDAR_PARAMS.scope) !== 'world' ? 'mine' : 'world';
  const showParam = searchParams.get(CALENDAR_PARAMS.show);
  const openShowId = isId('eventInstance', showParam) ? showParam : null;
  // The stored show the sheet was last opened on. The sheet stays mounted on it after it closes,
  // so it can hand focus back to whatever opened it.
  const [sheetShowId, setSheetShowId] = useState<EventInstanceId | null>(openShowId);
  if (openShowId !== null && openShowId !== sheetShowId) setSheetShowId(openShowId);

  const updateUrl = useCallback(
    (change: CalendarUrlChange): void => {
      const next = new URLSearchParams(searchParams);
      if (change.month !== undefined) {
        // The month the game is in is the default, so it stays out of the URL.
        if (change.month === todayMonth) next.delete(CALENDAR_PARAMS.month);
        else next.set(CALENDAR_PARAMS.month, monthParamOf(change.month));
      }
      if (change.scope !== undefined) {
        if (change.scope === 'mine') next.delete(CALENDAR_PARAMS.scope);
        else next.set(CALENDAR_PARAMS.scope, change.scope);
      }
      if (change.show !== undefined) {
        if (change.show === null) next.delete(CALENDAR_PARAMS.show);
        else next.set(CALENDAR_PARAMS.show, change.show);
      }
      // Replace: the calendar is one page, so Back leaves it instead of stepping through months.
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, todayMonth],
  );

  const weeks = useMemo(() => monthWeeks(month), [month]);
  const from = weeks[0]?.[0] ?? month;
  const to = weeks.at(-1)?.at(-1) ?? month;
  const stored = useEngineQuery('calendar.range', { from, to, scope });
  const projected = useEngineQuery('calendar.projected', { from, to, scope });
  const storedShows = stored.data?.shows ?? NO_SHOWS;
  const projectedShows = projected.data?.shows ?? NO_SHOWS;
  // Stored shows first on each day, then the projected ones.
  const showsByDate = useMemo(
    () => groupByDate([...storedShows, ...projectedShows]),
    [storedShows, projectedShows],
  );
  const isLoading = stored.status === 'loading' || projected.status === 'loading';
  const failed = stored.status === 'error' || projected.status === 'error';
  const isRefreshing = stored.isStale || projected.isStale;

  const tag: ShowChipTag = scope === 'world' ? 'promotion' : 'brand';
  const previousMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const sheetIsOpen = openShowId !== null || projectedShow !== null;

  const openShow = (show: CalendarShow): void => {
    lastOpenedDateRef.current = show.date;
    if (show.eventInstanceId === null) {
      setProjectedShow(show);
      return;
    }
    setProjectedShow(null);
    updateUrl({ show: show.eventInstanceId });
  };

  // The sheet hands focus back to whatever opened it. A sheet opened by a link has no opener, so
  // closing it would leave focus nowhere: it goes to the show's day instead.
  useLayoutEffect(() => {
    if (!sheetIsOpen) return;
    // Read before the sheet moves focus into itself, which it does in a later effect.
    const active = document.activeElement;
    openedWithoutOpenerRef.current = active === null || active === document.body;
  }, [sheetIsOpen]);

  useEffect(() => {
    if (sheetIsOpen || !openedWithoutOpenerRef.current) return undefined;
    openedWithoutOpenerRef.current = false;
    const date = lastOpenedDateRef.current;
    if (date === null) return undefined;
    const timer = window.setTimeout(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      const day = rootRef.current?.querySelector<HTMLElement>(
        `[${CALENDAR_DATE_ATTRIBUTE}="${date}"]`,
      );
      if (day === null || day === undefined) return;
      // A day of the grid takes focus itself; a day of the agenda hands it to its first show.
      const target =
        day instanceof HTMLTableCellElement ? day : day.querySelector<HTMLElement>('button');
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sheetIsOpen]);

  const rowOfOpenShow =
    openShowId === null
      ? null
      : (storedShows.find((show) => show.eventInstanceId === openShowId) ?? null);
  const openShowDate = rowOfOpenShow?.date ?? null;
  // A sheet opened by a link, not a chip, still knows which day to hand focus back to.
  useEffect(() => {
    if (openShowDate !== null) lastOpenedDateRef.current = openShowDate;
  }, [openShowDate]);

  const drawMonth = (markers: readonly CalendarDayMarker[]) => {
    const markersByDate = groupByDate(markers);
    const view = { month, weeks, today, showsByDate, markersByDate, tag, onOpenShow: openShow };
    return isMobile ? <AgendaList {...view} /> : <MonthGrid {...view} />;
  };

  return (
    <div ref={rootRef} className={styles['calendar']}>
      <div className={styles['toolbar']}>
        <div className={styles['monthNav']}>
          <IconButton
            icon="chevron-left"
            label="Previous month"
            disabled={previousMonth === null}
            onClick={() => {
              if (previousMonth !== null) updateUrl({ month: previousMonth });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            iconStart="calendar"
            disabled={month === todayMonth}
            onClick={() => {
              updateUrl({ month: todayMonth });
            }}
          >
            Today
          </Button>
          <IconButton
            icon="chevron-right"
            label="Next month"
            disabled={nextMonth === null}
            onClick={() => {
              if (nextMonth !== null) updateUrl({ month: nextMonth });
            }}
          />
          <h2 className={styles['monthTitle']} aria-live="polite">
            {monthTitle(month)}
          </h2>
        </div>
        {hasPromotion && (
          <div className={styles['scope']}>
            <RadioGroup
              legend="Show"
              layout="row"
              options={SCOPE_OPTIONS}
              value={scope}
              onValueChange={(nextScope) => {
                updateUrl({ scope: nextScope });
              }}
            />
          </div>
        )}
        {toolbarItems.length > 0 && (
          <div className={styles['toolbarItems']}>
            {toolbarItems.map((item) => (
              <span key={item.id} className={styles['toolbarItem']}>
                {item.render({ month, scope, today })}
              </span>
            ))}
          </div>
        )}
      </div>
      <CalendarLegend />
      {failed && (
        <p className={styles['notice']} role="alert">
          The schedule could not be read. Try another month, or reload the game.
        </p>
      )}
      <div className={styles['month']} aria-busy={isLoading || isRefreshing}>
        <DayMarkers range={{ from, to }}>{drawMonth}</DayMarkers>
      </div>
      {sheetShowId !== null && (
        <StoredShowSheet
          // Keyed by show, so a second show never starts from the first one's answer.
          key={sheetShowId}
          eventInstanceId={sheetShowId}
          open={openShowId !== null}
          row={rowOfOpenShow}
          today={today}
          showPromotion={scope === 'world'}
          onClose={() => {
            updateUrl({ show: null });
          }}
        />
      )}
      <ShowDetailSheet
        open={openShowId === null && projectedShow !== null}
        onClose={() => {
          setProjectedShow(null);
        }}
        show={projectedShow}
        today={today}
        showPromotion={scope === 'world'}
      />
    </div>
  );
}

/**
 * The calendar itself, under the screen's heading: a month of shows as a grid on desktop and a
 * weekly agenda on phones, with the sheet for one show. It reads the stored shows
 * (`calendar.range`) and the projected ones past the horizon (`calendar.projected`) for the weeks
 * on screen. The month, the scope and the open show live in the URL.
 */
export function CalendarView() {
  const clock = useEngineQuery('clock.get', {});

  if (clock.status === 'loading') {
    return (
      <p className={styles['notice']} role="status">
        Loading the calendar…
      </p>
    );
  }
  if (clock.data === undefined) {
    return (
      <EmptyState
        size="page"
        icon="calendar"
        title="No game loaded"
        body="Start or load a game to see its shows here."
        headingLevel={2}
      />
    );
  }
  return <LoadedCalendar today={clock.data.date} />;
}
