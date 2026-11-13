/**
 * The booking screen's "Venue and crowd" panel (EVT6-06): where the show is held, how many people
 * the venue holds, how many are expected with the forecast's Why?, and how well the two fit. While
 * the show has no venue it shows the one the game would book the day before the show, with the
 * pick's Why?, and offers Pick for me. Change venue opens the picker sheet.
 *
 * It reads `boxOffice.forecast`, which refetches on every world revision, so it follows changes
 * to the card and to the venue. Design: docs/design/box-office.md#venue-commands-and-queries.
 */
import { useState } from 'react';
import type { EventInstanceId, ShowForecast } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { WhyButton } from '@/components/Trace';
import { VenueFitBadge } from '@/components/VenueFitBadge';
import styles from './VenueCrowd.module.css';
import { VenuePickerSheet } from './VenuePickerSheet';
import {
  AUTO_PICK_NOTE,
  capacityText,
  NOT_YOUR_SHOW_TEXT,
  placeText,
  rangeText,
  VENUE_KIND_LABELS,
  venueImageSubject,
} from './venueText';

/** The refusal code `boxOffice.forecast` answers for a show the viewer does not run. */
export const NOT_YOUR_SHOW_CODE = 'boxOffice.notYourShow';

export interface VenueCrowdViewProps {
  readonly forecast: ShowForecast;
  /** Offer Change venue (and Pick for me while no venue is chosen). Read-only when false. */
  readonly canChange: boolean;
  readonly onChangeVenue?: () => void;
  readonly onPickForMe?: () => void;
  /** Pick for me is running. */
  readonly picking?: boolean;
  /** Why Pick for me was refused, shown under the actions. */
  readonly message?: string | null;
}

/** The panel's body from a forecast: no engine access, so the gallery draws it from fixed data. */
export function VenueCrowdView({
  forecast,
  canChange,
  onChangeVenue,
  onPickForMe,
  picking = false,
  message = null,
}: VenueCrowdViewProps) {
  const venue = forecast.shown;
  const notChosen = forecast.current === null;
  return (
    <div className={styles['panel']}>
      <div className={styles['venue']}>
        <ImageSlot subject={venueImageSubject(venue)} size="md" decorative />
        <div className={styles['facts']}>
          {notChosen && <p className={styles['kicker']}>Not chosen yet: suggested</p>}
          <p className={styles['name']}>
            <span>{venue.name}</span>
            {notChosen && forecast.pickTrace !== null && (
              <WhyButton
                label="the suggested venue"
                value={venue.name}
                panelTitle="Why this venue?"
                source={{ trace: forecast.pickTrace }}
              />
            )}
          </p>
          <p className={styles['muted']}>{placeText(venue)}</p>
          <p className={styles['muted']}>
            {VENUE_KIND_LABELS[venue.venueKind]} · {capacityText(venue.capacity)}
          </p>
        </div>
      </div>
      <div className={styles['crowd']}>
        <p className={styles['range']}>
          <span className={styles['rangeLabel']}>Expected</span>
          <span className={styles['figure']}>{rangeText(forecast.low, forecast.high)}</span>
          <WhyButton
            label="Expected crowd"
            value={forecast.demand}
            unit="people"
            source={{ trace: forecast.trace }}
          />
        </p>
        {forecast.cappedByCapacity && (
          <p className={styles['note']}>
            Capped by capacity: about {formatNumber(forecast.demand)} people want to come.
          </p>
        )}
        <VenueFitBadge fit={forecast.fit} className={styles['fit']} />
      </div>
      {notChosen && canChange && <p className={styles['note']}>{AUTO_PICK_NOTE}</p>}
      {canChange && (
        <div className={styles['actions']}>
          <Button iconStart="building" onClick={onChangeVenue}>
            Change venue
          </Button>
          {notChosen && (
            <Button variant="primary" loading={picking} onClick={onPickForMe}>
              Pick for me
            </Button>
          )}
        </div>
      )}
      {message !== null && (
        <p className={styles['error']} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

/** What to say when the forecast was refused or could not be read. */
function refusalText(error: EngineQueryError): string {
  if (error.kind === 'transport') return 'The crowd forecast could not be loaded.';
  if (error.reasons.some((reason) => reason.code === NOT_YOUR_SHOW_CODE)) return NOT_YOUR_SHOW_TEXT;
  return error.reasons.map((reason) => reason.message).join(' ');
}

export interface VenueCrowdPanelProps {
  readonly eventInstanceId: EventInstanceId;
  /** The card can still change (`booking.card`'s `canEdit`): the player runs it and it has not run. */
  readonly canEdit: boolean;
}

/** The panel as the booking screen draws it, reading the forecast and sending the venue commands. */
export function VenueCrowdPanel({ eventInstanceId, canEdit }: VenueCrowdPanelProps) {
  const query = useEngineQuery('boxOffice.forecast', { eventInstanceId });
  const autoVenue = useEngineCommand('booking.autoVenue');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (query.error !== null) {
    return <p className={styles['muted']}>{refusalText(query.error)}</p>;
  }
  const forecast = query.data;
  if (forecast === undefined) {
    return (
      <p className={styles['muted']} role="status">
        Working out the crowd…
      </p>
    );
  }

  const pickForMe = async () => {
    setMessage(null);
    const result = await autoVenue.run({ eventInstanceId });
    if (!result.ok) setMessage(result.reasons.map((reason) => reason.message).join(' '));
  };

  return (
    <>
      <VenueCrowdView
        forecast={forecast}
        canChange={canEdit}
        onChangeVenue={() => {
          setMessage(null);
          setPickerOpen(true);
        }}
        onPickForMe={() => {
          void pickForMe();
        }}
        picking={autoVenue.pending}
        message={message}
      />
      {canEdit && (
        <VenuePickerSheet
          open={pickerOpen}
          onClose={() => {
            setPickerOpen(false);
          }}
          eventInstanceId={eventInstanceId}
        />
      )}
    </>
  );
}
