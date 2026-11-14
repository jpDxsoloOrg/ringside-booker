/**
 * Fixtures for the geography, venue, media, mail, news and ledger schema tests.
 *
 * The registry holds the nine real tables plus placeholders for the sibling kinds they reference.
 * `people`, `eventInstances` and `employments` are plain stubs. `promotions` and
 * `eventDefinitions` carry the one extra field the invariants here read (a promotion's `status`,
 * an event definition's `promotionId`), so the fixtures stay small. The other production tables
 * are left out: their invariants read sibling tables these fixtures replace with stubs.
 */

import { z } from 'zod';
import { parseContentKey } from '../../src/core/content-key';
import { parseGameDate } from '../../src/core/date';
import { ENTITY_KINDS, parseId, type EntityKind, type IdOf } from '../../src/core/ids';
import { cents } from '../../src/core/money';
import type { Deal } from '../../src/model/entities/deal';
import type { Continent, Country, Region } from '../../src/model/entities/geography';
import type { LedgerEntry } from '../../src/model/entities/ledger-entry';
import type { Mail } from '../../src/model/entities/mail';
import type { Network } from '../../src/model/entities/network';
import type { News } from '../../src/model/entities/news';
import type { Venue } from '../../src/model/entities/venue';
import { zId, type TemplatedText } from '../../src/model/primitives';
import { defineTable } from '../../src/model/table-def';
import { TABLES } from '../../src/model/tables';
import { createWorld, type World } from '../../src/model/world';
import { stubTable } from './stub-tables';
import { toyMeta } from './toy-registry';

/** A readable test ID of `kind`: `testId('region', 3)` is `reg_0000000003`. */
export function testId<K extends EntityKind>(kind: K, serial: number): IdOf<K> {
  return parseId(kind, `${ENTITY_KINDS[kind]}_${String(serial).padStart(10, '0')}`);
}

export const promotionsFakeTable = defineTable({
  kind: 'promotion',
  name: 'promotions',
  schema: z.strictObject({
    id: zId('promotion'),
    status: z.enum(['active', 'dormant', 'closed']),
  }),
  refs: [],
  indexes: [],
});

export const eventDefinitionsFakeTable = defineTable({
  kind: 'eventDefinition',
  name: 'eventDefinitions',
  schema: z.strictObject({ id: zId('eventDefinition'), promotionId: zId('promotion') }),
  refs: [{ path: 'promotionId', target: 'promotion', nullable: false }],
  indexes: [],
});

export const GEO_MEDIA_REGISTRY = {
  continents: TABLES.continents,
  countries: TABLES.countries,
  regions: TABLES.regions,
  venues: TABLES.venues,
  networks: TABLES.networks,
  deals: TABLES.deals,
  mail: TABLES.mail,
  news: TABLES.news,
  ledgerEntries: TABLES.ledgerEntries,
  people: stubTable('person', 'people'),
  promotions: promotionsFakeTable,
  eventDefinitions: eventDefinitionsFakeTable,
  eventInstances: stubTable('eventInstance', 'eventInstances'),
  employments: stubTable('employment', 'employments'),
} as const;

export type GeoMediaRegistry = typeof GEO_MEDIA_REGISTRY;

/** An empty world over `GEO_MEDIA_REGISTRY`, dated 2026-03-15. */
export function emptyGeoMediaWorld(): World<GeoMediaRegistry> {
  const date = parseGameDate('2026-03-15');
  return createWorld(GEO_MEDIA_REGISTRY, toyMeta({ startDate: date, currentDate: date }));
}

export const date = parseGameDate;

/** Templated text with the given content key. */
export function text(key: string, params: TemplatedText['params'] = {}): TemplatedText {
  return { key: parseContentKey(key), params };
}

export function makeContinent(serial: number, overrides: Partial<Continent> = {}): Continent {
  return {
    id: testId('continent', serial),
    name: `Continent ${String(serial)}`,
    code: 'EU',
    ...overrides,
  };
}

export function makeCountry(serial: number, overrides: Partial<Country> = {}): Country {
  return {
    id: testId('country', serial),
    continentId: testId('continent', 1),
    name: `Country ${String(serial)}`,
    code: 'GBR',
    population: 1_000_000,
    wrestlingInterest: 50,
    economy: 60,
    preferredStyle: null,
    ...overrides,
  };
}

export function makeRegion(serial: number, overrides: Partial<Region> = {}): Region {
  return {
    id: testId('region', serial),
    countryId: testId('country', 1),
    name: `Region ${String(serial)}`,
    population: 100_000,
    wrestlingInterest: 40,
    preferredStyle: 'technical',
    neighbourRegionIds: [],
    ...overrides,
  };
}

export function makeVenue(serial: number, overrides: Partial<Venue> = {}): Venue {
  return {
    id: testId('venue', serial),
    name: `Venue ${String(serial)}`,
    regionId: testId('region', 1),
    capacity: 2_500,
    kind: 'hall',
    openedOn: null,
    closedOn: null,
    exclusivePromotionId: null,
    imageRef: null,
    ...overrides,
  };
}

export function makeNetwork(serial: number, overrides: Partial<Network> = {}): Network {
  return {
    id: testId('network', serial),
    name: `Network ${String(serial)}`,
    kind: 'tv',
    reachTier: 2,
    coverage: { continentIds: [], countryIds: [testId('country', 1)], regionIds: [] },
    ownerPromotionId: null,
    status: 'active',
    launchedOn: date('2000-01-01'),
    closedOn: null,
    logoRef: 'placeholder:network',
    ...overrides,
  };
}

export function makeDeal(serial: number, overrides: Partial<Deal> = {}): Deal {
  return {
    id: testId('deal', serial),
    networkId: testId('network', 1),
    promotionId: testId('promotion', 1),
    eventDefinitionId: null,
    status: 'active',
    offeredOn: date('2026-01-01'),
    startsOn: date('2026-02-01'),
    endsOn: date('2027-02-01'),
    timeslot: 'primeTime',
    weekday: 1,
    live: true,
    terms: { feePerShow: cents(500_000), perThousandViewers: cents(150), costPerShow: cents(0) },
    ...overrides,
  };
}

const NO_MESSAGE_REFS: Mail['refs'] = {
  personIds: [],
  promotionIds: [],
  eventInstanceId: null,
  employmentId: null,
};

export function makeMail(serial: number, overrides: Partial<Mail> = {}): Mail {
  return {
    id: testId('mail', serial),
    promotionId: testId('promotion', 1),
    date: date('2026-03-15'),
    category: 'contract',
    from: { kind: 'system' },
    subject: text('mail.contract.subject', {}),
    body: text('mail.contract.body', { amount: 1000 }),
    refs: NO_MESSAGE_REFS,
    read: false,
    archived: false,
    decision: null,
    ...overrides,
  };
}

export function makeNews(serial: number, overrides: Partial<News> = {}): News {
  return {
    id: testId('news', serial),
    date: date('2026-03-15'),
    kind: 'signing',
    headline: text('news.signing.headline', {}),
    body: text('news.signing.body', {}),
    refs: NO_MESSAGE_REFS,
    importance: 2,
    expiresOn: null,
    buzz: 0,
    dedupeKey: null,
    ...overrides,
  };
}

export function makeLedgerEntry(serial: number, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: testId('ledgerEntry', serial),
    promotionId: testId('promotion', 1),
    date: date('2026-03-15'),
    category: 'tickets',
    amount: cents(125_000),
    memo: null,
    refs: { eventInstanceId: null, personId: null, dealId: null },
    traceRef: null,
    ...overrides,
  };
}
