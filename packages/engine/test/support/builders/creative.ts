/**
 * Builders for titles, reigns, event definitions and instances, segments, participants,
 * storylines and seasons.
 *
 * References default to the first row of each kind (`pro_0000000001`, `evi_0000000001`, ...).
 * Defaults:
 *
 * - title `Test Title 001`: an active open-division singles title of prestige 50, introduced on
 *   `TEST_START_DATE`;
 * - title reign: the current (open) reign of person 1, won on `TEST_START_DATE`. Ring names at the
 *   time default to one placeholder per holder, and a closed reign defaults to `endReason: 'lost'`;
 * - event definition `Test Show 001`: a regular televised weekly show on Mondays with
 *   `format: { slots: 6, preShowSlots: 0 }`, active from `TEST_START_DATE`;
 * - event instance `Test Event 001`: a scheduled one-off on `TEST_START_DATE` in `reg_0000000001`
 *   with the same format. A completed instance gets a default result, and a cancelled one is
 *   cancelled by its promotion on its own date;
 * - match and angle: the next free main-card slot of their instance (pass `preShow: true` for the
 *   pre-show, or `slot` to pick one). A match is a singles match with no outcome yet; an angle is a
 *   one-beat promo;
 * - participant: person 1 as a competitor on side 0 of `seg_0000000001`;
 * - storyline `Test Storyline 001`: active, heat 50, person 1 as its face;
 * - season: season 1, active, running 91 days from `TEST_START_DATE`.
 */

import { parseContentKey } from '../../../src/core/content-key';
import {
  EventDefinitionSchema,
  type EventDefinition,
} from '../../../src/model/entities/event-definition';
import {
  EventInstanceSchema,
  type EventInstance,
  type EventResult,
} from '../../../src/model/entities/event-instance';
import { ParticipantSchema, type Participant } from '../../../src/model/entities/participant';
import { SeasonSchema, type Season } from '../../../src/model/entities/season';
import {
  AngleSegmentSchema,
  MatchSegmentSchema,
  type AngleSegment,
  type MatchSegment,
} from '../../../src/model/entities/segment';
import { StorylineSchema, type Storyline } from '../../../src/model/entities/storyline';
import { TitleSchema, type Title } from '../../../src/model/entities/title';
import { TitleReignSchema, type TitleReign } from '../../../src/model/entities/title-reign';
import { TestIds, testId, type TestIdSequence } from '../ids';
import {
  buildRow,
  placeholderName,
  seasonEndDate,
  TEST_START_DATE,
  type DeepPartial,
} from './build-row';

export const DEFAULT_SHOW_SLOTS = 6;
export const DEFAULT_MATCH_TYPE_KEY = parseContentKey('match.singles');
export const DEFAULT_METHOD_KEY = parseContentKey('method.pinfall');
export const DEFAULT_ANGLE_TYPE_KEY = parseContentKey('angle.promo');
export const DEFAULT_BEAT_KEY = parseContentKey('beat.promo');

/** The result a completed event instance gets when the test does not give one. */
export const DEFAULT_EVENT_RESULT: EventResult = {
  score: 50,
  rawScore: 50,
  traceId: null,
  attendance: null,
  gate: null,
  viewers: null,
  ceiling: null,
};

export function aTitle(
  overrides: DeepPartial<Title> = {},
  sequence: TestIdSequence = TestIds,
): Title {
  const defaults: Title = {
    id: overrides.id ?? sequence.id('title'),
    promotionId: testId('promotion'),
    brandId: null,
    name: overrides.name ?? placeholderName('Title', sequence.nextNumber('title')),
    holderCount: 1,
    division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
    prestige: 50,
    status: 'active',
    introducedOn: TEST_START_DATE,
    retiredOn: null,
    imageRef: null,
    color: '#c9a227',
  };
  return buildRow(TitleSchema, 'aTitle', defaults, overrides);
}

export function aTitleReign(
  overrides: DeepPartial<TitleReign> = {},
  sequence: TestIdSequence = TestIds,
): TitleReign {
  const holderIds = overrides.holderIds ?? [testId('person')];
  const lostOn = overrides.lostOn ?? null;
  const defaults: TitleReign = {
    id: overrides.id ?? sequence.id('titleReign'),
    titleId: testId('title'),
    holderIds,
    teamId: null,
    wonOn: TEST_START_DATE,
    lostOn,
    wonInSegmentId: null,
    endedInSegmentId: null,
    endReason: lostOn === null ? null : 'lost',
    defences: 0,
    holderNamesAtTime: holderIds.map((_holderId, index) => placeholderName('Holder', index + 1)),
  };
  return buildRow(TitleReignSchema, 'aTitleReign', defaults, overrides);
}

export function anEventDefinition(
  overrides: DeepPartial<EventDefinition> = {},
  sequence: TestIdSequence = TestIds,
): EventDefinition {
  const defaults: EventDefinition = {
    id: overrides.id ?? sequence.id('eventDefinition'),
    promotionId: testId('promotion'),
    brandId: null,
    name: overrides.name ?? placeholderName('Show', sequence.nextNumber('show')),
    importance: 'regular',
    recurrence: { kind: 'weekly', weekdays: [0] },
    format: { slots: DEFAULT_SHOW_SLOTS, preShowSlots: 0 },
    televised: true,
    preferredRegionId: null,
    preferredVenueId: null,
    activeFrom: TEST_START_DATE,
    activeUntil: null,
    logoRef: null,
  };
  return buildRow(EventDefinitionSchema, 'anEventDefinition', defaults, overrides);
}

export function anEventInstance(
  overrides: DeepPartial<EventInstance> = {},
  sequence: TestIdSequence = TestIds,
): EventInstance {
  const date = overrides.date ?? TEST_START_DATE;
  const defaults: EventInstance = {
    id: overrides.id ?? sequence.id('eventInstance'),
    promotionId: testId('promotion'),
    eventDefinitionId: null,
    brandId: null,
    name: overrides.name ?? placeholderName('Event', sequence.nextNumber('event')),
    importance: 'regular',
    format: { slots: DEFAULT_SHOW_SLOTS, preShowSlots: 0 },
    date,
    airDate: date,
    status: 'scheduled',
    venueId: null,
    genericVenue: null,
    regionId: testId('region'),
    result: overrides.status === 'completed' ? DEFAULT_EVENT_RESULT : null,
    cancellation: overrides.status === 'cancelled' ? { reason: 'byPromotion', on: date } : null,
  };
  return buildRow(EventInstanceSchema, 'anEventInstance', defaults, overrides);
}

type SegmentPlacement = Pick<
  DeepPartial<MatchSegment>,
  'id' | 'eventInstanceId' | 'preShow' | 'slot'
>;

/** The ID, instance, section and slot of a new segment; claims the slot in `sequence`. */
function placeSegment(overrides: SegmentPlacement, sequence: TestIdSequence) {
  const eventInstanceId = overrides.eventInstanceId ?? testId('eventInstance');
  const preShow = overrides.preShow ?? false;
  return {
    id: overrides.id ?? sequence.id('segment'),
    eventInstanceId,
    preShow,
    slot: sequence.slot(eventInstanceId, preShow, overrides.slot),
  };
}

export function aMatch(
  overrides: DeepPartial<MatchSegment> = {},
  sequence: TestIdSequence = TestIds,
): MatchSegment {
  const defaults: MatchSegment = {
    ...placeSegment(overrides, sequence),
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    rating: null,
    kind: 'match',
    match: {
      matchTypeKey: DEFAULT_MATCH_TYPE_KEY,
      stipulationKeys: [],
      titleIds: [],
      finishKey: null,
    },
    outcome: null,
  };
  return buildRow(MatchSegmentSchema, 'aMatch', defaults, overrides);
}

export function anAngle(
  overrides: DeepPartial<AngleSegment> = {},
  sequence: TestIdSequence = TestIds,
): AngleSegment {
  const defaults: AngleSegment = {
    ...placeSegment(overrides, sequence),
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    rating: null,
    kind: 'angle',
    angle: {
      angleTypeKey: DEFAULT_ANGLE_TYPE_KEY,
      beats: [{ beatKey: DEFAULT_BEAT_KEY, personIds: [testId('person')] }],
    },
  };
  return buildRow(AngleSegmentSchema, 'anAngle', defaults, overrides);
}

export function aParticipant(
  overrides: DeepPartial<Participant> = {},
  sequence: TestIdSequence = TestIds,
): Participant {
  const defaults: Participant = {
    id: overrides.id ?? sequence.id('participant'),
    segmentId: testId('segment'),
    personId: testId('person'),
    side: 0,
    role: 'competitor',
    teamId: null,
    entranceOrder: null,
    eliminationOrder: null,
  };
  return buildRow(ParticipantSchema, 'aParticipant', defaults, overrides);
}

export function aStoryline(
  overrides: DeepPartial<Storyline> = {},
  sequence: TestIdSequence = TestIds,
): Storyline {
  const defaults: Storyline = {
    id: overrides.id ?? sequence.id('storyline'),
    promotionId: testId('promotion'),
    brandId: null,
    name: overrides.name ?? placeholderName('Storyline', sequence.nextNumber('storyline')),
    status: 'active',
    startedOn: TEST_START_DATE,
    endedOn: null,
    heat: 50,
    members: [{ personId: testId('person'), side: 'face' }],
    summary: '',
  };
  return buildRow(StorylineSchema, 'aStoryline', defaults, overrides);
}

export function aSeason(
  overrides: DeepPartial<Season> = {},
  sequence: TestIdSequence = TestIds,
): Season {
  const startDate = overrides.startDate ?? TEST_START_DATE;
  const defaults: Season = {
    id: overrides.id ?? sequence.id('season'),
    number: 1,
    startDate,
    endDate: seasonEndDate(startDate),
    status: 'active',
  };
  return buildRow(SeasonSchema, 'aSeason', defaults, overrides);
}
