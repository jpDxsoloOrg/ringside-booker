/**
 * Calendar rows for the gallery and for component tests: shows as `calendar.range`,
 * `calendar.projected` and `calendar.show` return them. Gallery data only; nothing here is read
 * by the game.
 */
import { addDays, parseGameDate, parseId, startDecision } from '@ringside/engine';
import type { CalendarShow, CalendarShowDetail, GameDate } from '@ringside/engine';

/** The month the calendar gallery entries show, and the day they call today. */
export const GALLERY_CALENDAR_MONTH: GameDate = parseGameDate('2027-01-01');
export const GALLERY_CALENDAR_TODAY: GameDate = parseGameDate('2027-01-06');

const OWN_PROMOTION: CalendarShow['promotion'] = {
  id: parseId('promotion', 'pro_0000000001'),
  name: 'Altura Wrestling',
  shortName: 'ALT',
  color: '#38bdf8',
};

const RIVAL_PROMOTIONS: readonly CalendarShow['promotion'][] = [
  {
    id: parseId('promotion', 'pro_0000000002'),
    name: 'Harbour City Pro',
    shortName: 'HCP',
    color: '#fb923c',
  },
  {
    id: parseId('promotion', 'pro_0000000003'),
    name: 'Northern Lights Grappling',
    shortName: 'NLG',
    color: '#a78bfa',
  },
  {
    id: parseId('promotion', 'pro_0000000004'),
    name: 'Tidewater Ring Club',
    shortName: 'TRC',
    color: '#2dd4bf',
  },
];

const HOME_REGION: CalendarShow['region'] = {
  id: parseId('region', 'reg_0000000001'),
  name: 'Altura Valley',
  countryName: 'Meridia',
};

const HOME_VENUE: NonNullable<CalendarShow['venue']> = {
  id: parseId('venue', 'ven_0000000001'),
  name: 'Altura Civic Arena',
  capacity: 12_400,
  kind: 'arena',
};

let showSerial = 0;

/**
 * One calendar row. With no overrides it is the viewer's own regular weekly show, scheduled for
 * the gallery's today, with a venue. Every call gets its own id and key.
 */
export function galleryShow(overrides: Partial<CalendarShow> = {}): CalendarShow {
  showSerial += 1;
  const eventInstanceId = parseId('eventInstance', `evi_${String(showSerial).padStart(10, '0')}`);
  const date = overrides.date ?? GALLERY_CALENDAR_TODAY;
  const status = overrides.status ?? 'scheduled';
  return {
    key: status === 'projected' ? `evd_0000000001|${date}|${String(showSerial)}` : eventInstanceId,
    eventInstanceId: status === 'projected' ? null : eventInstanceId,
    definitionId: parseId('eventDefinition', 'evd_0000000001'),
    promotion: OWN_PROMOTION,
    isOwn: true,
    brand: { id: parseId('brand', 'brd_0000000001'), name: 'Overclock' },
    name: 'Altura Overclock',
    importance: 'regular',
    format: { slots: 6, preShowSlots: 0 },
    televised: true,
    date,
    airDate: date,
    status,
    cancellation: null,
    region: HOME_REGION,
    venue: HOME_VENUE,
    segmentCount: 0,
    canCancel: status === 'scheduled' || status === 'booked',
    ...overrides,
  };
}

/** A rival promotion's row: never the viewer's own, so it can never be cancelled. */
export function galleryRivalShow(
  rivalIndex: number,
  overrides: Partial<CalendarShow> = {},
): CalendarShow {
  const promotion = RIVAL_PROMOTIONS[rivalIndex % RIVAL_PROMOTIONS.length] ?? OWN_PROMOTION;
  return galleryShow({
    promotion,
    isOwn: false,
    canCancel: false,
    brand: null,
    name: `${promotion.shortName} Saturday Showdown`,
    ...overrides,
  });
}

/** The full answer for one show, as `calendar.show` gives it, with the reasoning for its venue. */
export function galleryShowDetail(
  show: CalendarShow,
  overrides: Partial<Pick<CalendarShowDetail, 'placementTrace' | 'definition'>> = {},
): CalendarShowDetail {
  const placement = startDecision<'preferredVenue' | 'notChosen'>(`Where ${show.name} is held`)
    .rule('The show has a preferred venue', show.venue !== null)
    .rule('The preferred venue is open on the day of the show', show.venue !== null)
    .choose(
      show.venue === null ? 'notChosen' : 'preferredVenue',
      show.venue === null
        ? 'No preferred venue could be used, so the venue is still open.'
        : 'The preferred venue is open and free to book.',
    );
  return {
    ...show,
    placementTrace: placement.trace,
    definition: { recurrenceText: 'Every Wednesday' },
    ...overrides,
  };
}

function january(day: number): GameDate {
  return addDays(GALLERY_CALENDAR_MONTH, day - 1);
}

/** Every Saturday of the gallery month, which is when the rivals run. */
const SATURDAYS = [2, 9, 16, 23, 30] as const;
/** The viewer's weekly show runs on Wednesdays. */
const WEDNESDAYS = [6, 13, 20, 27] as const;

/**
 * A static month for the grid and the agenda: the viewer's Wednesday show (one already run, one
 * called off), a flagship at the end of the month, rivals every Saturday, and Saturday the 9th
 * with five shows so the day overflows.
 */
export function galleryMonthShows(): CalendarShow[] {
  const own = WEDNESDAYS.map((day) =>
    galleryShow({
      date: january(day),
      airDate: january(day),
      ...(day === 13
        ? {
            status: 'cancelled' as const,
            cancellation: { reason: 'byPromotion' as const, on: january(5) },
            canCancel: false,
          }
        : {}),
    }),
  );
  const rivals = SATURDAYS.flatMap((day) =>
    Array.from({ length: day === 9 ? 4 : 2 }, (_, rivalIndex) =>
      galleryRivalShow(rivalIndex, {
        date: january(day),
        airDate: january(day),
        importance: rivalIndex === 0 ? 'major' : 'minor',
        ...(day === 2
          ? {
              status: 'cancelled' as const,
              cancellation: { reason: 'notRun' as const, on: january(2) },
            }
          : {}),
      }),
    ),
  );
  return [
    ...own,
    ...rivals,
    galleryShow({
      name: 'Altura Winter Reckoning',
      importance: 'house',
      brand: null,
      date: january(9),
      airDate: january(9),
      televised: false,
    }),
    galleryShow({
      name: 'Altura Crown of the Valley',
      importance: 'flagship',
      brand: null,
      format: { slots: 10, preShowSlots: 2 },
      date: january(31),
      airDate: january(31),
    }),
  ].sort((left, right) => left.date.localeCompare(right.date));
}
