/**
 * The production table registry: every entity table of a real game world.
 *
 * Entries are keyed by table name and each key must equal its definition's `name` (`createWorld`
 * checks this). That every `EntityKind` is registered exactly once is asserted by the registry test
 * (FND-10) rather than at compile time, so the schema tickets can land in any order.
 */

import { brandsTable } from './entities/brand';
import { employmentsTable } from './entities/employment';
import { promotionsTable } from './entities/promotion';
import { relationshipsTable } from './entities/relationship';
import { stablesTable } from './entities/stable';
import { teamsTable } from './entities/team';
import type { TableRegistry } from './table-def';
import type { World, WorldView } from './world';

export const TABLES = {
  // FND-06, FND-08 and FND-09 add the remaining entries.
  promotions: promotionsTable,
  brands: brandsTable,
  employments: employmentsTable,
  teams: teamsTable,
  stables: stablesTable,
  relationships: relationshipsTable,
} as const satisfies TableRegistry;

export type GameTables = typeof TABLES;
/** The writable game world. Internal to the engine. */
export type GameWorld = World<GameTables>;
/** The read-only game world handed to queries, formulas and invariants. */
export type GameWorldView = WorldView<GameTables>;
