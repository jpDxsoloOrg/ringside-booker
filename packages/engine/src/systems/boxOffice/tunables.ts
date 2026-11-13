/**
 * The box office system's balance numbers: how big a crowd a show is expected to draw (EVT6-01).
 *
 * Every one is 0-means-0: a multiplier at 0 empties the building. Design:
 * docs/design/box-office.md#forecast.
 */

import { defineTunables } from '../../core/tunables/define';
import { venueTunables } from './venueTunables';

const BOX_OFFICE_CATEGORY = 'Box office';
const FORECAST_DOC = 'box-office.md#forecast';
const RECENT_FORM_DOC = 'box-office.md#recent-form';
const FATIGUE_DOC = 'box-office.md#big-show-fatigue';
const TICKET_DOC = 'box-office.md#ticket-price';
const RENT_DOC = 'box-office.md#venue-rent';
const MERCH_DOC = 'box-office.md#live-merch';
const SHARES_DOC = 'box-office.md#worker-shares';

const IMPORTANCE_RANGE = {
  kind: 'number',
  min: 0,
  max: 5,
  step: 0.05,
  unit: 'multiplier',
  category: BOX_OFFICE_CATEGORY,
  docRef: FORECAST_DOC,
} as const;

/** Show-day money (EVT6-04): ticket price and rent multipliers. */
const SHOW_DAY_MULTIPLIER = {
  kind: 'number',
  min: 0,
  max: 5,
  step: 0.05,
  unit: 'multiplier',
  category: BOX_OFFICE_CATEGORY,
} as const;

const TICKET_IMPORTANCE = { ...SHOW_DAY_MULTIPLIER, docRef: TICKET_DOC } as const;
const RENT_KIND = { ...SHOW_DAY_MULTIPLIER, docRef: RENT_DOC } as const;

const WORKER_SHARE_CAP = {
  kind: 'number',
  default: 0.5,
  min: 0,
  max: 1,
  step: 0.05,
  unit: 'ratio',
  category: BOX_OFFICE_CATEGORY,
  docRef: SHARES_DOC,
} as const;

export const boxOfficeTunables = defineTunables({
  'boxOffice.draw.atFullPopularity': {
    kind: 'integer',
    default: 30000,
    min: 0,
    max: 200000,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd a show draws at popularity 100, before the other lines',
    docRef: FORECAST_DOC,
  },
  'boxOffice.draw.curve': {
    kind: 'number',
    default: 3,
    min: 1,
    max: 6,
    step: 0.1,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'How sharply crowds grow with popularity; higher means small companies draw less',
    docRef: FORECAST_DOC,
  },
  'boxOffice.draw.walkUp': {
    kind: 'integer',
    default: 80,
    min: 0,
    max: 5000,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'People who turn up to any show, however unknown the company',
    docRef: FORECAST_DOC,
  },
  'boxOffice.marketing.perLevel': {
    kind: 'number',
    default: 0.04,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd added per marketing level (×(1 + level × this))',
    docRef: FORECAST_DOC,
  },
  'boxOffice.importance.house': {
    ...IMPORTANCE_RANGE,
    default: 0.35,
    description: 'Crowd × this for a house show',
  },
  'boxOffice.importance.minor': {
    ...IMPORTANCE_RANGE,
    default: 0.7,
    description: 'Crowd × this for a minor show',
  },
  'boxOffice.importance.regular': {
    ...IMPORTANCE_RANGE,
    default: 1,
    description: 'Crowd × this for a regular show',
  },
  'boxOffice.importance.major': {
    ...IMPORTANCE_RANGE,
    default: 1.5,
    description: 'Crowd × this for a major show',
  },
  'boxOffice.importance.flagship': {
    ...IMPORTANCE_RANGE,
    default: 2.2,
    description: 'Crowd × this for a flagship show',
  },
  'boxOffice.recentForm.windowDays': {
    kind: 'integer',
    default: 120,
    min: 0,
    max: 730,
    unit: 'days',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far back recent form looks for completed shows',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.minShows': {
    kind: 'integer',
    default: 3,
    min: 0,
    max: 20,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Recent shows needed before recent form moves the crowd',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.par': {
    kind: 'number',
    default: 50,
    min: 0,
    max: 100,
    unit: 'points',
    category: BOX_OFFICE_CATEGORY,
    description: 'A show score that neither helps nor hurts the draw',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.fullSwingPoints': {
    kind: 'number',
    default: 25,
    min: 1,
    max: 100,
    unit: 'points',
    category: BOX_OFFICE_CATEGORY,
    description: 'Average score above or below par that gives the full swing',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.maxSwing': {
    kind: 'number',
    default: 0.15,
    min: 0,
    max: 0.5,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Most recent form can add to or take from the crowd (0 = recent form off)',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.recentForm.countHouseShows': {
    kind: 'boolean',
    default: false,
    unit: 'flag',
    category: BOX_OFFICE_CATEGORY,
    description: 'Count house shows in recent form',
    docRef: RECENT_FORM_DOC,
  },
  'boxOffice.fatigue.windowDays': {
    kind: 'integer',
    default: 28,
    min: 0,
    max: 365,
    unit: 'days',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far back big-show fatigue looks for other big shows',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.freeShows': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 10,
    unit: 'count',
    category: BOX_OFFICE_CATEGORY,
    description: 'Other big shows in the window that cost nothing',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.perExtraShow': {
    kind: 'number',
    default: 0.2,
    min: 0,
    max: 1,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Crowd lost for each other big show beyond the free ones (0 = no fatigue)',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.fatigue.floor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'The least of the crowd fatigue can leave',
    docRef: FATIGUE_DOC,
  },
  'boxOffice.crowd.spread': {
    kind: 'number',
    default: 0.1,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description:
      'How far the real crowd can land from the forecast, either way; also the width of the forecast range',
    docRef: FORECAST_DOC,
  },
  // Show-day money (EVT6-04). Money is in whole cents.
  'boxOffice.ticket.base': {
    kind: 'integer',
    default: 1000,
    min: 0,
    max: 100000,
    unit: 'money',
    category: BOX_OFFICE_CATEGORY,
    description: 'Ticket price every show starts from, before reach and show size',
    docRef: TICKET_DOC,
  },
  'boxOffice.ticket.perReachPoint': {
    kind: 'integer',
    default: 60,
    min: 0,
    max: 10000,
    unit: 'money',
    category: BOX_OFFICE_CATEGORY,
    description: "Ticket price added per point of the company's reach",
    docRef: TICKET_DOC,
  },
  'boxOffice.ticket.importance.house': {
    ...TICKET_IMPORTANCE,
    default: 0.8,
    description: 'Ticket price × this for a house show',
  },
  'boxOffice.ticket.importance.minor': {
    ...TICKET_IMPORTANCE,
    default: 0.9,
    description: 'Ticket price × this for a minor show',
  },
  'boxOffice.ticket.importance.regular': {
    ...TICKET_IMPORTANCE,
    default: 1,
    description: 'Ticket price × this for a regular show',
  },
  'boxOffice.ticket.importance.major': {
    ...TICKET_IMPORTANCE,
    default: 1.5,
    description: 'Ticket price × this for a major show',
  },
  'boxOffice.ticket.importance.flagship': {
    ...TICKET_IMPORTANCE,
    default: 2,
    description: 'Ticket price × this for a flagship show',
  },
  'boxOffice.rent.base': {
    kind: 'integer',
    default: 25000,
    min: 0,
    max: 10000000,
    unit: 'money',
    category: BOX_OFFICE_CATEGORY,
    description: 'Rent every venue charges for a show, however small',
    docRef: RENT_DOC,
  },
  'boxOffice.rent.perSeat': {
    kind: 'integer',
    default: 350,
    min: 0,
    max: 100000,
    unit: 'money',
    category: BOX_OFFICE_CATEGORY,
    description: 'Rent per seat of capacity, charged whether the seat is sold or not',
    docRef: RENT_DOC,
  },
  'boxOffice.rent.kind.hall': {
    ...RENT_KIND,
    default: 1,
    description: 'Seat rent × this in a hall',
  },
  'boxOffice.rent.kind.theatre': {
    ...RENT_KIND,
    default: 1.1,
    description: 'Seat rent × this in a theatre',
  },
  'boxOffice.rent.kind.arena': {
    ...RENT_KIND,
    default: 1.25,
    description: 'Seat rent × this in an arena',
  },
  'boxOffice.rent.kind.stadium': {
    ...RENT_KIND,
    // Above the ticket's 1.4: a stadium has to be close to full to pay for itself, so a regular show
    // moved from an arena to a stadium loses money (calibration in box-office.md).
    default: 3.5,
    description: 'Seat rent × this in a stadium',
  },
  'boxOffice.rent.kind.studio': {
    ...RENT_KIND,
    default: 0.6,
    description: 'Seat rent × this in a studio',
  },
  'boxOffice.rent.kind.outdoor': {
    ...RENT_KIND,
    default: 1.2,
    description: 'Seat rent × this at an outdoor venue',
  },
  'boxOffice.rent.ownVenueFactor': {
    kind: 'number',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.05,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'Share of the rent paid in a venue that belongs to the company',
    docRef: RENT_DOC,
  },
  'boxOffice.merch.perHead': {
    kind: 'integer',
    default: 500,
    min: 0,
    max: 100000,
    unit: 'money',
    category: BOX_OFFICE_CATEGORY,
    description: 'Merch each fan buys at an average show',
    docRef: MERCH_DOC,
  },
  'boxOffice.merch.qualityLow': {
    kind: 'number',
    default: 0.8,
    min: 0,
    max: 3,
    step: 0.05,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'Merch × this after a show scoring 0',
    docRef: MERCH_DOC,
  },
  'boxOffice.merch.qualityHigh': {
    kind: 'number',
    default: 1.2,
    min: 0,
    max: 3,
    step: 0.05,
    unit: 'multiplier',
    category: BOX_OFFICE_CATEGORY,
    description: 'Merch × this after a show scoring 100',
    docRef: MERCH_DOC,
  },
  'boxOffice.merch.spread': {
    kind: 'number',
    default: 0.05,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'ratio',
    category: BOX_OFFICE_CATEGORY,
    description: 'How far merch sales can swing on the night, either way',
    docRef: MERCH_DOC,
  },
  'boxOffice.gate.workerShareCap': {
    ...WORKER_SHARE_CAP,
    description: 'Most of the ticket money worker shares can take',
  },
  'boxOffice.merch.workerShareCap': {
    ...WORKER_SHARE_CAP,
    description: 'Most of the merch money worker shares can take',
  },
  ...venueTunables,
});
