/**
 * The calendar show sheet's "Crowd" section (EVT6-06), registered from here so EVT1's sheet is
 * not edited: for one of the player's upcoming shows, the expected crowd at its venue (or at the
 * venue the game would pick, while none is chosen) with the forecast's Why? and the fit. For any
 * show that has run, the player's or a rival's, how many came (EVT6-07, from `boxOffice.showCrowd`;
 * a crowd is public, money is not, so no money here). Nothing for a rival's show still to run or a
 * projected date. The venue itself is in the sheet's facts row. Imported once by the router, so it
 * is in place before any calendar draws.
 */
import type { CalendarShow, EventInstanceId, GameDate } from '@ringside/engine';
import { compareDates } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { formatNumber } from '@/components/format';
import { WhyButton } from '@/components/Trace';
import { VenueFitBadge } from '@/components/VenueFitBadge';
import { registerShowSheetSection } from '@/screens/calendar/registry';
import type { ShowSheetSectionDefinition } from '@/screens/calendar/registry';
import { expectedText } from '@/screens/booking/venue/venueText';
import styles from './ShowCrowdSection.module.css';

/** The stored id of one of the player's shows still to run, or null for anything else. */
export function forecastShowId(show: CalendarShow, today: GameDate): EventInstanceId | null {
  if (!show.isOwn || show.eventInstanceId === null) return null;
  if (show.status !== 'scheduled' && show.status !== 'booked') return null;
  return compareDates(show.date, today) < 0 ? null : show.eventInstanceId;
}

/** The stored id of any show that has run, the player's or a rival's, or null for anything else. */
export function ranShowId(show: CalendarShow): EventInstanceId | null {
  return show.status === 'completed' ? show.eventInstanceId : null;
}

/** What the Crowd section says about a show that has run. */
export const SETTLED_CROWD_TEXT = {
  notSettled: 'Box office not settled yet',
  error: 'The crowd could not be loaded.',
} as const;

/** "4,210 came · 92% full at Harbor Arena". */
export function attendanceText(
  attendance: number,
  percentFull: number | null,
  venue: string,
): string {
  const full = percentFull === null ? '' : ` · ${formatNumber(percentFull)}% full`;
  return `${formatNumber(attendance)} came${full} at ${venue}`;
}

/** How many came to a show that has run, with the crowd's Why? while it is kept. */
function AttendanceLine({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('boxOffice.showCrowd', { eventInstanceId });
  const crowd = query.data;
  if (query.error !== null) {
    return <p className={styles['muted']}>{SETTLED_CROWD_TEXT.error}</p>;
  }
  if (crowd === undefined) {
    return (
      <p className={styles['muted']} role="status">
        Counting the crowd…
      </p>
    );
  }
  if (crowd.status === 'notRun') return null;
  if (crowd.status === 'notSettled' || crowd.attendance === null) {
    return <p className={styles['muted']}>{SETTLED_CROWD_TEXT.notSettled}</p>;
  }
  return (
    <p className={styles['line']}>
      <span>
        {attendanceText(crowd.attendance, crowd.percentFull, crowd.venue?.name ?? 'the venue')}
      </span>
      {crowd.attendanceTraceRef === null ? null : (
        <WhyButton
          label="Attendance"
          value={crowd.attendance}
          unit="people"
          source={{ traceRef: crowd.attendanceTraceRef }}
        />
      )}
    </p>
  );
}

/** "Expected 15,100 – 17,500 at Harbor Arena" with its Why? and the fit badge. */
function ForecastLine({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('boxOffice.forecast', { eventInstanceId });
  const forecast = query.data;
  if (query.error !== null) {
    const text =
      query.error.kind === 'rejected'
        ? query.error.reasons.map((reason) => reason.message).join(' ')
        : 'The crowd forecast could not be loaded.';
    return <p className={styles['muted']}>{text}</p>;
  }
  if (forecast === undefined) {
    return (
      <p className={styles['muted']} role="status">
        Working out the crowd…
      </p>
    );
  }
  const where =
    forecast.current === null
      ? `at ${forecast.shown.name} (suggested; not chosen yet)`
      : `at ${forecast.shown.name}`;
  return (
    <p className={styles['line']}>
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

export const CROWD_SECTION: ShowSheetSectionDefinition = {
  id: 'boxOffice.crowd',
  order: 5,
  title: 'Crowd',
  render: ({ show, today }) => {
    const upcoming = forecastShowId(show, today);
    if (upcoming !== null) return <ForecastLine eventInstanceId={upcoming} />;
    const ran = ranShowId(show);
    return ran === null ? null : <AttendanceLine eventInstanceId={ran} />;
  },
};

registerShowSheetSection(CROWD_SECTION);
