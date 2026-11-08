/**
 * Fixtures for the title, event, segment, storyline and season tables.
 *
 * `SHOW_REGISTRY` holds the eight FND-08 tables plus stubs for the sibling kinds they reference
 * (people, teams, promotions, brands, regions, venues), so these tests do not wait for the
 * schemas that own those kinds. Builders return valid rows; tests override what they are about.
 */

import { parseContentKey, type ContentKey } from '../../src/core/content-key';
import { parseGameDate, type GameDate } from '../../src/core/date';
import { parseId, type EntityKind, type IdOf } from '../../src/core/ids';
import {
  eventDefinitionsTable,
  type EventDefinition,
} from '../../src/model/entities/event-definition';
import { eventInstancesTable, type EventInstance } from '../../src/model/entities/event-instance';
import { participantsTable, type Participant } from '../../src/model/entities/participant';
import { seasonsTable, type Season } from '../../src/model/entities/season';
import {
  segmentsTable,
  type AngleSegment,
  type MatchSegment,
} from '../../src/model/entities/segment';
import { storylinesTable, type Storyline } from '../../src/model/entities/storyline';
import { titlesTable, type Title } from '../../src/model/entities/title';
import { titleReignsTable, type TitleReign } from '../../src/model/entities/title-reign';
import { checkWorld, type IntegrityReport } from '../../src/model/integrity';
import { createWorld, type World } from '../../src/model/world';
import { stubTable } from './stub-tables';
import { toyMeta } from './toy-registry';

export const SHOW_REGISTRY = {
  titles: titlesTable,
  titleReigns: titleReignsTable,
  eventDefinitions: eventDefinitionsTable,
  eventInstances: eventInstancesTable,
  segments: segmentsTable,
  participants: participantsTable,
  storylines: storylinesTable,
  seasons: seasonsTable,
  people: stubTable('person', 'people'),
  teams: stubTable('team', 'teams'),
  promotions: stubTable('promotion', 'promotions'),
  brands: stubTable('brand', 'brands'),
  regions: stubTable('region', 'regions'),
  venues: stubTable('venue', 'venues'),
} as const;

export type ShowRegistry = typeof SHOW_REGISTRY;
export type ShowWorld = World<ShowRegistry>;

/** An ID of `kind` whose body is `serial` padded to ten digits, such as `per_0000000003`. */
export function idOf<K extends EntityKind>(kind: K, prefix: string, serial: number): IdOf<K> {
  return parseId(kind, `${prefix}_${String(serial).padStart(10, '0')}`);
}

export const personId = (serial: number): IdOf<'person'> => idOf('person', 'per', serial);
export const teamId = (serial: number): IdOf<'team'> => idOf('team', 'tem', serial);
export const promotionId = (serial: number): IdOf<'promotion'> => idOf('promotion', 'pro', serial);
export const regionId = (serial: number): IdOf<'region'> => idOf('region', 'reg', serial);
export const titleId = (serial: number): IdOf<'title'> => idOf('title', 'tit', serial);
export const reignId = (serial: number): IdOf<'titleReign'> => idOf('titleReign', 'trn', serial);
export const definitionId = (serial: number): IdOf<'eventDefinition'> =>
  idOf('eventDefinition', 'evd', serial);
export const instanceId = (serial: number): IdOf<'eventInstance'> =>
  idOf('eventInstance', 'evi', serial);
export const segmentId = (serial: number): IdOf<'segment'> => idOf('segment', 'seg', serial);
export const participantId = (serial: number): IdOf<'participant'> =>
  idOf('participant', 'ptc', serial);
export const storylineId = (serial: number): IdOf<'storyline'> => idOf('storyline', 'sty', serial);
export const seasonId = (serial: number): IdOf<'season'> => idOf('season', 'sea', serial);

export const date = (value: string): GameDate => parseGameDate(value);
export const key = (value: string): ContentKey => parseContentKey(value);

export function makeTitle(serial: number, overrides: Partial<Title> = {}): Title {
  return {
    id: titleId(serial),
    promotionId: promotionId(1),
    brandId: null,
    name: `Title ${String(serial)}`,
    holderCount: 1,
    division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
    prestige: 50,
    status: 'active',
    introducedOn: date('2020-01-01'),
    retiredOn: null,
    imageRef: null,
    color: '#c9a227',
    ...overrides,
  };
}

export function makeReign(serial: number, overrides: Partial<TitleReign> = {}): TitleReign {
  return {
    id: reignId(serial),
    titleId: titleId(1),
    holderIds: [personId(1)],
    teamId: null,
    wonOn: date('2026-01-01'),
    lostOn: null,
    wonInSegmentId: null,
    endedInSegmentId: null,
    endReason: null,
    defences: 0,
    holderNamesAtTime: ['Holder One'],
    ...overrides,
  };
}

export function makeDefinition(
  serial: number,
  overrides: Partial<EventDefinition> = {},
): EventDefinition {
  return {
    id: definitionId(serial),
    promotionId: promotionId(1),
    brandId: null,
    name: `Weekly Show ${String(serial)}`,
    importance: 'regular',
    recurrence: { kind: 'weekly', weekdays: [0] },
    format: { slots: 6, preShowSlots: 0 },
    televised: true,
    preferredRegionId: null,
    preferredVenueId: null,
    activeFrom: date('2026-01-01'),
    activeUntil: null,
    logoRef: null,
    ...overrides,
  };
}

export function makeInstance(
  serial: number,
  overrides: Partial<EventInstance> = {},
): EventInstance {
  return {
    id: instanceId(serial),
    promotionId: promotionId(1),
    eventDefinitionId: null,
    brandId: null,
    name: `Show ${String(serial)}`,
    importance: 'regular',
    format: { slots: 6, preShowSlots: 2 },
    date: date('2026-01-05'),
    airDate: date('2026-01-05'),
    status: 'booked',
    venueId: null,
    regionId: regionId(1),
    result: null,
    ...overrides,
  };
}

const NO_CREW = { refereeId: null, producerId: null, announcerIds: [] };

export function makeMatch(serial: number, overrides: Partial<MatchSegment> = {}): MatchSegment {
  return {
    id: segmentId(serial),
    eventInstanceId: instanceId(1),
    slot: 0,
    preShow: false,
    label: null,
    storylineIds: [],
    crew: NO_CREW,
    rating: null,
    kind: 'match',
    match: {
      matchTypeKey: key('match.singles'),
      stipulationKeys: [],
      titleIds: [],
      finishKey: null,
    },
    outcome: null,
    ...overrides,
  };
}

export function makeAngle(serial: number, overrides: Partial<AngleSegment> = {}): AngleSegment {
  return {
    id: segmentId(serial),
    eventInstanceId: instanceId(1),
    slot: 0,
    preShow: false,
    label: null,
    storylineIds: [],
    crew: NO_CREW,
    rating: null,
    kind: 'angle',
    angle: {
      angleTypeKey: key('angle.promo'),
      beats: [{ beatKey: key('beat.callout'), personIds: [personId(1)] }],
    },
    ...overrides,
  };
}

export function makeParticipant(serial: number, overrides: Partial<Participant> = {}): Participant {
  return {
    id: participantId(serial),
    segmentId: segmentId(1),
    personId: personId(1),
    side: 0,
    role: 'competitor',
    teamId: null,
    entranceOrder: null,
    eliminationOrder: null,
    ...overrides,
  };
}

export function makeStoryline(serial: number, overrides: Partial<Storyline> = {}): Storyline {
  return {
    id: storylineId(serial),
    promotionId: promotionId(1),
    brandId: null,
    name: `Storyline ${String(serial)}`,
    status: 'active',
    startedOn: date('2026-01-01'),
    endedOn: null,
    heat: 40,
    members: [
      { personId: personId(1), side: 'face' },
      { personId: personId(2), side: 'heel' },
    ],
    summary: 'Two rivals who cannot stand each other.',
    ...overrides,
  };
}

export function makeSeason(serial: number, overrides: Partial<Season> = {}): Season {
  return {
    id: seasonId(serial),
    number: serial,
    startDate: date('2026-01-01'),
    endDate: date('2026-03-31'),
    status: 'active',
    ...overrides,
  };
}

/** An empty world on the show registry with people 1-8, team 1, promotions 1-2 and region 1. */
export function emptyShowWorld(): ShowWorld {
  const world = createWorld(SHOW_REGISTRY, toyMeta());
  for (let serial = 1; serial <= 8; serial += 1) {
    world.tables.people._put({ id: personId(serial) });
  }
  world.tables.teams._put({ id: teamId(1) });
  world.tables.promotions._put({ id: promotionId(1) });
  world.tables.promotions._put({ id: promotionId(2) });
  world.tables.regions._put({ id: regionId(1) });
  return world;
}

/** Puts a match with person 1 competing on side 0 and person 2 on side 1. */
export function putSinglesMatch(
  world: ShowWorld,
  serial: number,
  overrides: Partial<MatchSegment> = {},
): MatchSegment {
  const segment = makeMatch(serial, overrides);
  world.tables.segments._put(segment);
  world.tables.participants._put(
    makeParticipant(serial * 10, { segmentId: segment.id, personId: personId(1), side: 0 }),
  );
  world.tables.participants._put(
    makeParticipant(serial * 10 + 1, { segmentId: segment.id, personId: personId(2), side: 1 }),
  );
  return segment;
}

export function check(world: ShowWorld): IntegrityReport {
  return checkWorld(world, SHOW_REGISTRY, { validateRows: true });
}

/** The issue codes of a report, for compact assertions. */
export function issueCodes(report: IntegrityReport): string[] {
  return report.issues.map((issue) => issue.code);
}
