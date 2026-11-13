/**
 * The calendar show sheet's "Crowd" section (EVT6-06), registered from here so EVT1's sheet is
 * not edited: for one of the player's upcoming shows, the expected crowd at its venue (or at the
 * venue the game would pick, while none is chosen) with the forecast's Why? and the fit. Nothing
 * for a rival's show, a projected date or a show that has run. The venue itself is in the sheet's
 * facts row. Imported once by the router, so it is in place before any calendar draws.
 */
import type { CalendarShow, EventInstanceId, GameDate } from '@ringside/engine';
import { compareDates } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
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
    const eventInstanceId = forecastShowId(show, today);
    return eventInstanceId === null ? null : <ForecastLine eventInstanceId={eventInstanceId} />;
  },
};

registerShowSheetSection(CROWD_SECTION);
