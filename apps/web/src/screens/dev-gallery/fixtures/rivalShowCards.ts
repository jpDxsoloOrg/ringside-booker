/**
 * Hand-written `aip.showCards` rows and an `aip.autoFillCard` answer for the gallery (AIP4-07): a
 * rival's aired show with a title main event, a four-way match and a storyline talking segment;
 * a show still to air; a cancelled one; and a booked card with an open slot. No engine runs; the
 * promotions, people and reasons are made up. The Why? buttons get `galleryCardTrace` inline.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  AutoFillResult,
  ShowCardRow,
  ShowCardSegment,
  ShowCardSide,
  ShowCardSlot,
  TraceNode,
  TraceRef,
} from '@ringside/engine';

const DOC = 'rival-booking.md#planning-a-card';

/** A slot's short Why?, the way the rival booker stores it. */
export const galleryCardTrace: TraceNode = {
  kind: 'decision',
  label: 'Slot 6 · Main event',
  value: 'Title match',
  chosen: 'Title match',
  reason: 'The title is due a defence and the champion is the best wrestler on the card',
  considered: [],
  docRef: DOC,
  children: [
    { kind: 'note', label: 'Title due: 34 days since the last defence', value: null },
    { kind: 'note', label: 'The top two wrestlers on the roster by card value', value: null },
    { kind: 'input', label: 'Card score', value: 78 },
  ],
};

/** Every gallery Why? opens the same short breakdown, whatever it points at. */
export const galleryTraceOf: (ref: TraceRef) => TraceNode = () => galleryCardTrace;

let personCount = 0;

function person(name: string): ShowCardSide['people'][number] {
  personCount += 1;
  return {
    personId: parseId('person', `per_${String(personCount).padStart(10, '0')}`),
    name,
    imageRef: null,
  };
}

function side(name: string, options: { isChampions?: boolean } = {}): ShowCardSide {
  return { name, teamId: null, isChampions: options.isChampions ?? false, people: [person(name)] };
}

function team(name: string, members: readonly string[]): ShowCardSide {
  return {
    name,
    teamId: parseId('team', 'tem_0000000001'),
    isChampions: false,
    people: members.map(person),
  };
}

let segmentCount = 0;

function segment(
  typeName: string,
  sides: readonly ShowCardSide[],
  extra: Partial<ShowCardSegment> = {},
): ShowCardSegment {
  segmentCount += 1;
  const segmentId = parseId('segment', `seg_${String(segmentCount).padStart(10, '0')}`);
  const isMatch = extra.kind !== 'angle';
  return {
    segmentId,
    kind: 'match',
    typeName,
    label: sides.map((each) => each.name).join(isMatch ? ' vs ' : ' & '),
    sides: [...sides],
    titles: [],
    storylines: [],
    outcome: null,
    reasonTraceRef: { kind: 'aip.cardSlot', id: segmentId },
    ...extra,
  };
}

function slot(
  displayNumber: number,
  role: ShowCardSlot['role'],
  roleLabel: string,
  filled: ShowCardSegment | null,
): ShowCardSlot {
  return { displayNumber, preShow: false, role, roleLabel, segment: filled };
}

const TITLE = {
  titleId: parseId('title', 'tit_0000000001'),
  name: 'Coastal Heavyweight Title',
  imageRef: null,
};
const STORY = { storylineId: parseId('storyline', 'sty_0000000001'), name: 'The Long Road Back' };

const airedSlots: ShowCardSlot[] = [
  slot(
    1,
    'opener',
    'Opener',
    segment('Singles', [side('Kai Moreno'), side('Rex Hale')], {
      outcome: { kind: 'win', winningSide: 0 },
    }),
  ),
  slot(
    2,
    'midcard',
    'Midcard',
    segment(
      'Tag Team',
      [
        team('Running Axe', ['Vance Troy', 'Ollie Banks']),
        team('Night Shift', ['Dee Carter', 'Mo Price']),
      ],
      { outcome: { kind: 'win', winningSide: 1 } },
    ),
  ),
  slot(
    3,
    'midcard',
    'Midcard',
    segment('Promo', [side('Marisol Ortega-Whitfield'), side('Tommy Vance')], {
      kind: 'angle',
      storylines: [STORY],
    }),
  ),
  slot(
    4,
    'midcard',
    'Midcard',
    segment(
      'Four-Way',
      [
        side('Bastian Thornberry-Klein'),
        side('Jet Lacroix'),
        side('Sunny Okafor'),
        side('Hugo Brandt'),
      ],
      { outcome: { kind: 'win', winningSide: 2 } },
    ),
  ),
  slot(
    5,
    'semiMain',
    'Semi-main',
    segment('Singles', [side('Ana Lucero'), side('Pip Garrow')], {
      outcome: { kind: 'draw', winningSide: null },
      storylines: [STORY],
    }),
  ),
  slot(
    6,
    'mainEvent',
    'Main event',
    segment('Singles', [side('Big Joe Sato', { isChampions: true }), side('Dante Rivers')], {
      titles: [TITLE],
      storylines: [STORY],
      outcome: { kind: 'win', winningSide: 0 },
    }),
  ),
];

const BASE: Omit<ShowCardRow, 'eventInstanceId' | 'name' | 'date' | 'airDate'> = {
  importance: 'regular',
  brandName: 'Coastal Live',
  status: 'completed',
  statusLabel: 'Completed',
  revealed: true,
  hiddenText: null,
  cancelledReason: null,
  planTraceRef: { kind: 'aip.cardPlan', id: 'evi_0000000001' },
  score: 72,
  slots: [],
};

/** A rival's show that has aired, with its whole card. */
export const galleryAiredShow: ShowCardRow = {
  ...BASE,
  eventInstanceId: parseId('eventInstance', 'evi_0000000001'),
  name: 'Coastal Championship Wrestling Saturday Night Spectacular',
  date: parseGameDate('2026-03-07'),
  airDate: parseGameDate('2026-03-07'),
  importance: 'major',
  slots: airedSlots,
};

/** A rival's show still to air: nothing about its card is shown. */
export const galleryHiddenShow: ShowCardRow = {
  ...BASE,
  eventInstanceId: parseId('eventInstance', 'evi_0000000002'),
  name: 'Coastal Live',
  date: parseGameDate('2026-03-14'),
  airDate: parseGameDate('2026-03-14'),
  status: 'booked',
  statusLabel: 'Booked',
  revealed: false,
  hiddenText: 'Card is revealed when the show airs',
  planTraceRef: null,
  score: null,
};

/** A rival's show the booker called off. */
export const galleryCancelledShow: ShowCardRow = {
  ...BASE,
  eventInstanceId: parseId('eventInstance', 'evi_0000000003'),
  name: 'Coastal Live: Harbour Town',
  date: parseGameDate('2026-02-28'),
  airDate: parseGameDate('2026-02-28'),
  importance: 'house',
  brandName: null,
  status: 'cancelled',
  statusLabel: 'Cancelled',
  cancelledReason: 'Only 3 wrestlers available, needs 5',
  score: null,
};

/** A booked card the viewer may see (their own), with one slot still open. */
export const galleryOpenSlotShow: ShowCardRow = {
  ...BASE,
  eventInstanceId: parseId('eventInstance', 'evi_0000000004'),
  name: 'Coastal Live',
  date: parseGameDate('2026-03-21'),
  airDate: parseGameDate('2026-03-21'),
  status: 'booked',
  statusLabel: 'Booked',
  score: null,
  slots: [
    slot(1, 'opener', 'Opener', segment('Singles', [side('Kai Moreno'), side('Jet Lacroix')])),
    slot(2, 'midcard', 'Midcard', null),
    slot(
      3,
      'mainEvent',
      'Main event',
      segment('Singles', [side('Big Joe Sato', { isChampions: true }), side('Ana Lucero')], {
        titles: [TITLE],
      }),
    ),
  ],
};

/** Auto-fill's answer for a card with one segment already booked and one slot it left open. */
export const galleryAutoFillResult: AutoFillResult = {
  filled: [
    {
      segmentId: parseId('segment', 'seg_0000000101'),
      preShow: true,
      displayNumber: 1,
      roleLabel: 'Pre-show',
      label: 'Jet Lacroix vs Hugo Brandt',
      headline: ['Two midcarders who have not met yet', 'Card score 41'],
      traceRef: { kind: 'aip.cardSlot', id: 'seg_0000000101' },
    },
    {
      segmentId: parseId('segment', 'seg_0000000102'),
      preShow: false,
      displayNumber: 3,
      roleLabel: 'Midcard',
      label: 'Marisol Ortega-Whitfield & Tommy Vance',
      headline: ['The Long Road Back needs a segment this week', 'Card score 55'],
      traceRef: { kind: 'aip.cardSlot', id: 'seg_0000000102' },
    },
    {
      segmentId: parseId('segment', 'seg_0000000103'),
      preShow: false,
      displayNumber: 6,
      roleLabel: 'Main event',
      label: 'Big Joe Sato vs Dante Rivers',
      headline: [
        'Title due: 34 days since the last defence',
        'The top two wrestlers on the roster by card value',
        'Card score 78',
      ],
      traceRef: { kind: 'aip.cardSlot', id: 'seg_0000000103' },
    },
  ],
  open: [{ displayNumber: 4, preShow: false, reason: 'No one left who is fit to wrestle' }],
  kept: 2,
  message: null,
};
