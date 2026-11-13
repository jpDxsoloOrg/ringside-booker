/**
 * The Office's "Next show" panel (DAY2-06, as EVT1-05 describes it), registered from the
 * calendar's own folder: the player's next show from `calendar.nextShow` as a lower third with its
 * date and how far away it is, importance, brand, card size in slots (never a running time, D-10)
 * and venue, then EVT6's expected crowd with its Why?, and links to the calendar and to Booking.
 * With no show of the player's on the calendar it says so and links to the calendar.
 */
import { Link } from 'react-router-dom';
import type { CalendarShow, EventInstanceId, GameDate, NextShowView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { LowerThird } from '@/components/LowerThird';
import type { LowerThirdMetaItem } from '@/components/LowerThird';
import { Panel } from '@/components/Panel';
import { WhyButton } from '@/components/Trace';
import { VenueFitBadge } from '@/components/VenueFitBadge';
import { bookingShowUrl } from '@/screens/booking/bookingUrl';
import { expectedText } from '@/screens/booking/venue/venueText';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import { IMPORTANCE_LABELS } from './importance';
import styles from './officePanel.module.css';
import { slotsText } from './slotsText';

/** The panel's id in the Office registry. */
export const NEXT_SHOW_PANEL_ID = 'calendar.nextShow';

/** The panel's title. */
export const NEXT_SHOW_TITLE = 'Next show';

/** What the panel says with no show of the player's on the calendar. */
export const NO_SHOWS_TEXT = 'No shows on the calendar';

/** Said while the show has no venue yet. */
export const VENUE_NOT_CHOSEN_TEXT = 'Venue not chosen yet';

/** "Today", "Tomorrow" or "In 3 days". */
export function daysAwayText(daysUntil: number): string {
  if (daysUntil <= 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `In ${String(daysUntil)} days`;
}

/** The show's venue: a real one, the generic local venue it is booked into, or not chosen yet. */
export function venueText(show: Pick<CalendarShow, 'venue' | 'genericVenue'>): string {
  if (show.venue !== null) return show.venue.name;
  if (show.genericVenue != null) return show.genericVenue.name;
  return VENUE_NOT_CHOSEN_TEXT;
}

/** The facts row under the show's name: date, importance, card size and venue. */
export function nextShowMeta(show: CalendarShow): LowerThirdMetaItem[] {
  return [
    { id: 'date', icon: 'calendar', label: formatGameDate(show.date, 'dayMonthYear') },
    { id: 'importance', icon: 'star', label: IMPORTANCE_LABELS[show.importance] },
    { id: 'slots', icon: 'layers', label: slotsText(show.format) },
    { id: 'venue', icon: 'building', label: venueText(show) },
  ];
}

/**
 * The Booking link's words, as the calendar sheet's button says them: "Go to the show" on its day,
 * "Edit card" once something is booked, else "Book this show".
 */
export function bookingLinkText(
  show: Pick<CalendarShow, 'date' | 'segmentCount'>,
  today: GameDate,
): string {
  if (show.date === today) return 'Go to the show';
  return show.segmentCount > 0 ? 'Edit card' : 'Book this show';
}

/** The stored id of the show when the player can still forecast and book it, else null. */
export function openShowId(show: CalendarShow, today: GameDate): EventInstanceId | null {
  if (!show.isOwn || show.eventInstanceId === null) return null;
  if (show.status !== 'scheduled' && show.status !== 'booked') return null;
  return show.date < today ? null : show.eventInstanceId;
}

/** "Expected 15,100 – 17,500 at Harbor Arena" with its Why? and the fit (EVT6). */
function CrowdLine({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('boxOffice.forecast', { eventInstanceId });
  const forecast = query.data;
  // A forecast the engine refuses (no venue anywhere to forecast) leaves the line out.
  if (forecast === undefined) return null;
  const where =
    forecast.current === null
      ? `at ${forecast.shown.name} (suggested)`
      : `at ${forecast.shown.name}`;
  return (
    <p className={styles['crowd']}>
      <span>
        {expectedText(forecast.low, forecast.high)} {where}
      </span>
      <WhyButton
        label="Expected crowd"
        value={forecast.demand}
        unit="people"
        source={{ trace: forecast.trace }}
      />
      <VenueFitBadge fit={forecast.fit} />
    </p>
  );
}

export interface NextShowPanelProps {
  /** `calendar.nextShow` for the player's own shows; null when none is scheduled. */
  readonly next: NextShowView | null;
  readonly today: GameDate;
}

/** The player's next show, or "No shows on the calendar" with a link to the calendar. */
export function NextShowPanel({ next, today }: NextShowPanelProps) {
  if (next === null) {
    return (
      <Panel title={NEXT_SHOW_TITLE}>
        <EmptyState
          icon="calendar"
          title={NO_SHOWS_TEXT}
          headingLevel={3}
          body={
            <Link className={styles['link']} to={routes.game.calendar()}>
              Open calendar
            </Link>
          }
        />
      </Panel>
    );
  }
  const { show, daysUntil } = next;
  const showId = openShowId(show, today);
  return (
    <Panel title={NEXT_SHOW_TITLE} padding="none">
      <LowerThird
        kicker={daysAwayText(daysUntil)}
        title={show.name}
        headingLevel={3}
        meta={nextShowMeta(show)}
        {...(show.brand === null ? {} : { badge: show.brand.name })}
        accent={show.importance === 'major' || show.importance === 'flagship' ? 'prestige' : 'data'}
        footer={
          <span className={styles['links']}>
            <Link
              className={styles['link']}
              to={
                show.eventInstanceId === null
                  ? routes.game.calendar()
                  : routes.game.calendarAt({ show: show.eventInstanceId })
              }
            >
              <Icon name="calendar" size="sm" decorative />
              Open calendar
            </Link>
            {showId !== null && (
              <Link className={styles['link']} to={bookingShowUrl(showId)}>
                <Icon name="booking" size="sm" decorative />
                {bookingLinkText(show, today)}
              </Link>
            )}
          </span>
        }
      >
        {showId !== null && <CrowdLine eventInstanceId={showId} />}
      </LowerThird>
    </Panel>
  );
}

/** Asks the engine for the player's next show and draws it. Nothing until the first answer. */
function NextShowPanelLoader({ today }: { readonly today: GameDate }) {
  const query = useEngineQuery('calendar.nextShow', { scope: 'mine' }, { keepPreviousData: true });
  if (query.data === undefined) return null;
  return <NextShowPanel next={query.data} today={today} />;
}

registerOfficePanel({
  id: NEXT_SHOW_PANEL_ID,
  order: 50,
  column: 'main',
  render: ({ dashboard }) => <NextShowPanelLoader today={dashboard.clock.date} />,
});
