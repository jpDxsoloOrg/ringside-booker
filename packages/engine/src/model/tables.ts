/**
 * The production table registry: every entity table of a real game world.
 *
 * Entries are keyed by table name and each key must equal its definition's `name` (`createWorld`
 * checks this). That every `EntityKind` is registered exactly once is asserted by the registry test
 * (FND-10) rather than at compile time, so the schema tickets can land in any order.
 */

import { dealsTable } from './entities/deal';
import { continentsTable, countriesTable, regionsTable } from './entities/geography';
import { ledgerEntriesTable } from './entities/ledger-entry';
import { mailTable } from './entities/mail';
import { networksTable } from './entities/network';
import { newsTable } from './entities/news';
import { venuesTable } from './entities/venue';
import type { TableRegistry } from './table-def';
import type { World, WorldView } from './world';

export const TABLES = {
  // FND-06..08 add entries
  // Geography, venues, media, mail, news and the ledger (FND-09)
  continents: continentsTable,
  countries: countriesTable,
  regions: regionsTable,
  venues: venuesTable,
  networks: networksTable,
  deals: dealsTable,
  mail: mailTable,
  news: newsTable,
  ledgerEntries: ledgerEntriesTable,
} as const satisfies TableRegistry;

export type GameTables = typeof TABLES;
/** The writable game world. Internal to the engine. */
export type GameWorld = World<GameTables>;
/** The read-only game world handed to queries, formulas and invariants. */
export type GameWorldView = WorldView<GameTables>;
