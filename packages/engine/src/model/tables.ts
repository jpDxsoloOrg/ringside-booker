/**
 * The production table registry: every entity table of a real game world.
 *
 * Entries are keyed by table name and each key must equal its definition's `name` (`createWorld`
 * checks this). That every `EntityKind` is registered exactly once is asserted by the registry test
 * (FND-10) rather than at compile time, so the schema tickets can land in any order.
 */

import { aftermathsTable } from './entities/aftermath';
import { aiDecisionsTable } from './entities/ai-decision';
import { aiProfilesTable } from './entities/ai-profile';
import { brandsTable } from './entities/brand';
import { dealsTable } from './entities/deal';
import { employmentsTable } from './entities/employment';
import { eventDefinitionsTable } from './entities/event-definition';
import { eventInstancesTable } from './entities/event-instance';
import { contractConcernsTable } from './entities/contract-concern';
import { continentsTable, countriesTable, regionsTable } from './entities/geography';
import { injuriesTable } from './entities/injury';
import { ledgerEntriesTable } from './entities/ledger-entry';
import { mailTable } from './entities/mail';
import { networksTable } from './entities/network';
import { newsTable } from './entities/news';
import { participantsTable } from './entities/participant';
import { peopleTable } from './entities/person';
import { popularityShowChangesTable } from './entities/popularity-show-change';
import { promotionsTable } from './entities/promotion';
import { promotionSnapshotTable } from './entities/promotion-snapshot';
import { relationshipsTable } from './entities/relationship';
import { seasonsTable } from './entities/season';
import { segmentsTable } from './entities/segment';
import { stablesTable } from './entities/stable';
import { storylinesTable } from './entities/storyline';
import { teamsTable } from './entities/team';
import { titlesTable } from './entities/title';
import { titleReignsTable } from './entities/title-reign';
import { venuesTable } from './entities/venue';
import type { TableRegistry } from './table-def';
import type { World, WorldView } from './world';

export const TABLES = {
  // FND-06: people.
  people: peopleTable,
  // FND-07: promotions, brands, employment and groups.
  promotions: promotionsTable,
  brands: brandsTable,
  employments: employmentsTable,
  teams: teamsTable,
  stables: stablesTable,
  relationships: relationshipsTable,
  // FND-08: titles, events, segments, storylines and seasons.
  titles: titlesTable,
  titleReigns: titleReignsTable,
  eventDefinitions: eventDefinitionsTable,
  eventInstances: eventInstancesTable,
  segments: segmentsTable,
  participants: participantsTable,
  storylines: storylinesTable,
  seasons: seasonsTable,
  // FND-09: geography, venues, media, mail, news and the ledger.
  continents: continentsTable,
  countries: countriesTable,
  regions: regionsTable,
  venues: venuesTable,
  networks: networksTable,
  deals: dealsTable,
  mail: mailTable,
  news: newsTable,
  ledgerEntries: ledgerEntriesTable,
  // EVT5-02: what each show did to its promotion's popularity.
  popularityShowChanges: popularityShowChangesTable,
  // MTCH3-03: what each match did to each competitor's popularity and momentum.
  aftermaths: aftermathsTable,
  // DAY2-01: each promotion's weekly history.
  promotionSnapshots: promotionSnapshotTable,
  // AIP1-01: the rival desk's profiles and decision log.
  aiProfiles: aiProfilesTable,
  aiDecisions: aiDecisionsTable,
  // WRK6-03: every injury a person has had.
  injuries: injuriesTable,
  // ECO4-01: per-contract notices, the unhappy clock, release requests and how a contract ended.
  contractConcerns: contractConcernsTable,
} as const satisfies TableRegistry;

export type GameTables = typeof TABLES;
/** The writable game world. Internal to the engine. */
export type GameWorld = World<GameTables>;
/** The read-only game world handed to queries, formulas and invariants. */
export type GameWorldView = WorldView<GameTables>;
