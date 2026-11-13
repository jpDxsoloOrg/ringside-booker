/**
 * Fixtures for the promotion, employment and group tables: a registry with minimal `people` and
 * `regions` tables, ID helpers and factories for valid rows.
 *
 * `people` is a test table with just an ID and a status, so the "no deceased members" rules have a
 * status to read before the real person schema is in this registry.
 */

import { z } from 'zod';
import { parseGameDate, yearMonthOf, type GameDate } from '../../src/core/date';
import { parseId, type EntityKind, type IdOf } from '../../src/core/ids';
import { cents } from '../../src/core/money';
import { brandsTable, type Brand } from '../../src/model/entities/brand';
import { employmentsTable, type Employment } from '../../src/model/entities/employment';
import { promotionsTable, type Promotion } from '../../src/model/entities/promotion';
import { relationshipsTable, type Relationship } from '../../src/model/entities/relationship';
import { stablesTable, type Stable } from '../../src/model/entities/stable';
import { teamsTable, type Team } from '../../src/model/entities/team';
import { zId } from '../../src/model/primitives';
import { defineTable } from '../../src/model/table-def';
import { createWorld, type World } from '../../src/model/world';
import { stubTable } from './stub-tables';
import { toyMeta } from './toy-registry';

export const TEST_PLAYER_ID = 'player-1';

export const testPeopleTable = defineTable({
  kind: 'person',
  name: 'people',
  schema: z.strictObject({ id: zId('person'), status: z.string().min(1) }),
  refs: [],
  indexes: [],
});

export const COMPANY_REGISTRY = {
  promotions: promotionsTable,
  brands: brandsTable,
  employments: employmentsTable,
  teams: teamsTable,
  stables: stablesTable,
  relationships: relationshipsTable,
  people: testPeopleTable,
  regions: stubTable('region', 'regions'),
} as const;

export type CompanyRegistry = typeof COMPANY_REGISTRY;

const PREFIXES = {
  person: 'per',
  promotion: 'pro',
  brand: 'brd',
  employment: 'emp',
  team: 'tem',
  stable: 'stb',
  relationship: 'rel',
  region: 'reg',
} as const satisfies Partial<Record<EntityKind, string>>;

type FixtureKind = keyof typeof PREFIXES;

/** A readable ID such as `per_0000000003` for serial 3. */
export function testId<K extends FixtureKind>(kind: K, serial: number): IdOf<K> {
  return parseId(kind, `${PREFIXES[kind]}_${String(serial).padStart(10, '0')}`);
}

export function date(text: string): GameDate {
  return parseGameDate(text);
}

export function makePromotion(serial: number, overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: testId('promotion', serial),
    name: `Test Promotion ${String(serial)}`,
    shortName: `TP${String(serial)}`,
    logoRef: 'placeholder:promotion',
    foundedOn: date('2001-04-01'),
    status: 'active',
    homeRegionId: testId('region', 1),
    regionalPop: { [testId('region', 1)]: 42.5 },
    popularityGains: { month: yearMonthOf(date('2026-01-01')), byRegion: {} },
    prestige: 50,
    cash: cents(-12_500),
    style: 'mainstream',
    ownerPersonId: null,
    bookerPersonId: null,
    parentPromotionId: null,
    production: {
      stage: 3,
      camera: 3,
      editing: 2,
      pyro: 0,
      music: 4,
      writing: 5,
      marketing: 1,
      backOffice: 10,
    },
    policies: { catering: 1, travel: 2, medical: 3 },
    color: '#1a2b3c',
    controller: { kind: 'computer' },
    ...overrides,
  };
}

export function makeBrand(
  serial: number,
  promotionSerial: number,
  overrides: Partial<Brand> = {},
): Brand {
  return {
    id: testId('brand', serial),
    promotionId: testId('promotion', promotionSerial),
    name: `Test Brand ${String(serial)}`,
    logoRef: null,
    priority: 0,
    active: true,
    controller: null,
    ...overrides,
  };
}

export function makeEmployment(
  serial: number,
  personSerial: number,
  promotionSerial: number,
  overrides: Partial<Employment> = {},
): Employment {
  return {
    id: testId('employment', serial),
    personId: testId('person', personSerial),
    promotionId: testId('promotion', promotionSerial),
    brandId: null,
    managerPersonId: null,
    status: 'active',
    offeredOn: date('2025-11-01'),
    startsOn: date('2025-12-01'),
    endsOn: date('2026-12-01'),
    endedOn: null,
    role: 'wrestler',
    ringName: `Test Worker ${String(personSerial)}`,
    gimmickKey: null,
    alignment: 'face',
    push: 'midCard',
    terms: {
      kind: 'written',
      exclusive: true,
      monthlyWage: cents(250_000),
      perAppearanceFee: cents(0),
      signingBonus: cents(0),
      shares: { gateBp: 0, merchBp: 2_500, broadcastBp: 0 },
      appearanceCap: null,
      perks: {
        creativeControl: false,
        noHouseShows: false,
        ironClad: false,
        travelCovered: true,
      },
    },
    morale: 10,
    momentum: null,
    appearancesThisYear: 0,
    lastAppearanceOn: null,
    leave: null,
    ...overrides,
  };
}

export function makeTeam(
  serial: number,
  memberSerials: number[],
  overrides: Partial<Team> = {},
): Team {
  return {
    id: testId('team', serial),
    kind: memberSerials.length === 3 ? 'trio' : 'tag',
    name: `Test Team ${String(serial)}`,
    memberIds: memberSerials.map((memberSerial) => testId('person', memberSerial)),
    experience: 20,
    status: 'active',
    formedOn: date('2025-06-01'),
    splitOn: null,
    ...overrides,
  };
}

export function makeStable(
  serial: number,
  promotionSerial: number,
  memberSerials: number[],
  overrides: Partial<Stable> = {},
): Stable {
  return {
    id: testId('stable', serial),
    promotionId: testId('promotion', promotionSerial),
    name: `Test Stable ${String(serial)}`,
    memberIds: memberSerials.map((memberSerial) => testId('person', memberSerial)),
    leaderId: null,
    status: 'active',
    formedOn: date('2025-06-01'),
    disbandedOn: null,
    imageRef: null,
    ...overrides,
  };
}

export function makeRelationship(
  serial: number,
  personASerial: number,
  personBSerial: number,
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    id: testId('relationship', serial),
    personAId: testId('person', personASerial),
    personBId: testId('person', personBSerial),
    affinity: 25,
    bonds: ['friends'],
    mentorId: null,
    since: date('2024-02-01'),
    lastChangedOn: date('2025-03-01'),
    ...overrides,
  };
}

/** An empty world over the company registry, dated 2026-01-01 with one human player. */
export function emptyCompanyWorld(): World<CompanyRegistry> {
  return createWorld(
    COMPANY_REGISTRY,
    toyMeta({ players: [{ playerId: TEST_PLAYER_ID, displayName: 'Player One' }] }),
  );
}

/**
 * A valid world: one region, five living people, two promotions (the second a developmental
 * territory of the first, run by the human player) with a brand each, active contracts, a tag team,
 * a stable and a relationship.
 */
export function validCompanyWorld(): World<CompanyRegistry> {
  const world = emptyCompanyWorld();
  world.tables.regions._put({ id: testId('region', 1) });
  for (let serial = 1; serial <= 5; serial += 1) {
    world.tables.people._put({ id: testId('person', serial), status: 'active' });
  }
  world.tables.promotions._put(
    makePromotion(1, {
      controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      ownerPersonId: testId('person', 5),
      bookerPersonId: testId('person', 5),
    }),
  );
  world.tables.promotions._put(makePromotion(2, { parentPromotionId: testId('promotion', 1) }));
  world.tables.brands._put(makeBrand(1, 1));
  world.tables.brands._put(
    makeBrand(2, 2, { controller: { kind: 'human', playerId: TEST_PLAYER_ID } }),
  );
  world.tables.employments._put(
    makeEmployment(1, 1, 1, { brandId: testId('brand', 1), managerPersonId: testId('person', 4) }),
  );
  world.tables.employments._put(makeEmployment(2, 2, 1));
  world.tables.employments._put(
    makeEmployment(3, 3, 2, {
      brandId: testId('brand', 2),
      terms: { ...makeEmployment(3, 3, 2).terms, exclusive: false },
    }),
  );
  world.tables.employments._put(
    makeEmployment(4, 3, 1, { terms: { ...makeEmployment(4, 3, 1).terms, exclusive: false } }),
  );
  world.tables.employments._put(
    makeEmployment(5, 1, 2, {
      status: 'released',
      endedOn: date('2025-12-15'),
    }),
  );
  world.tables.teams._put(makeTeam(1, [1, 2]));
  world.tables.stables._put(makeStable(1, 1, [1, 2, 4], { leaderId: testId('person', 4) }));
  world.tables.relationships._put(
    makeRelationship(1, 1, 4, { bonds: ['mentorship'], mentorId: testId('person', 4) }),
  );
  return world;
}
