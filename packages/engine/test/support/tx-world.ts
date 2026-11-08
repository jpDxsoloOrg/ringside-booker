/**
 * Worlds for transaction tests: the toy registry plus an append-only `entries` table, an ID
 * factory over `sequentialIdEntropy`, and a snapshot helper that captures rows, index lookups and
 * metadata as one string so "restored exactly" is a plain string comparison.
 */

import { z } from 'zod';
import { createIdFactory, parseId, type LedgerEntryId } from '../../src/core/ids';
import { zId } from '../../src/model/primitives';
import { compareIds, type ReadonlyTable } from '../../src/model/table';
import { defineTable } from '../../src/model/table-def';
import {
  createWorld,
  type CreateWorldOptions,
  type World,
  type WorldView,
} from '../../src/model/world';
import { sequentialIdEntropy } from './ids';
import {
  makeOwner,
  makeWidget,
  ownerId,
  regionId,
  TOY_PLAYER_ID,
  TOY_REGISTRY,
  toyMeta,
} from './toy-registry';

const EntrySchema = z.strictObject({
  id: zId('ledgerEntry'),
  ownerId: zId('promotion'),
  amount: z.number().int().min(0).max(1000),
});

export type Entry = z.infer<typeof EntrySchema>;

/** An append-only table, like the money ledger. */
export const entriesTable = defineTable({
  kind: 'ledgerEntry',
  name: 'entries',
  schema: EntrySchema,
  refs: [{ path: 'ownerId', target: 'promotion', nullable: false }],
  indexes: [{ name: 'byOwner', key: (entry) => entry.ownerId }],
  appendOnly: true,
});

export const TX_REGISTRY = { ...TOY_REGISTRY, entries: entriesTable } as const;

export type TxRegistry = typeof TX_REGISTRY;

export function entryId(serial: number): LedgerEntryId {
  return parseId('ledgerEntry', `led_${String(serial).padStart(10, '0')}`);
}

/**
 * An empty transaction-test world with write validation on and an ID factory over
 * `sequentialIdEntropy()` (first minted body `0000000001`). Options override both.
 */
export function emptyTxWorld(options: CreateWorldOptions = {}): World<TxRegistry> {
  return createWorld(TX_REGISTRY, toyMeta(), {
    idFactory: createIdFactory(sequentialIdEntropy()),
    validateWrites: 'always',
    ...options,
  });
}

/**
 * A transaction-test world holding one region, owners 1 and 2, widgets 1 to 3 (serials W-1 to
 * W-3) and one ledger entry. Rows are put straight into the tables, so building it uses no
 * transaction and draws no IDs.
 */
export function seededTxWorld(options: CreateWorldOptions = {}): World<TxRegistry> {
  const world = emptyTxWorld(options);
  world.tables.regions._put({ id: regionId(1) });
  world.tables.owners._put(
    makeOwner(1, {
      controller: { type: 'human', playerId: TOY_PLAYER_ID },
      homeRegionId: regionId(1),
    }),
  );
  world.tables.owners._put(makeOwner(2));
  world.tables.widgets._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(2)] }));
  world.tables.widgets._put(
    makeWidget(2, ownerId(1), { tagIds: [ownerId(1), ownerId(2)], scores: { [ownerId(2)]: 4.5 } }),
  );
  world.tables.widgets._put(makeWidget(3, ownerId(2)));
  world.tables.entries._put({ id: entryId(1), ownerId: ownerId(1), amount: 250 });
  return world;
}

/**
 * Every row of every table in ID order, the metadata, and the result of looking up each of
 * `indexKeys` in every index of every table. Two worlds with equal snapshots have equal rows, equal
 * metadata and equal index contents for those keys (a stale index entry shows up as an extra ID
 * in a lookup, or as a throw when it points at a missing row).
 */
export function snapshotWorld(world: WorldView, indexKeys: readonly string[]): string {
  const tables: Record<string, unknown> = {};
  const indexes: Record<string, unknown> = {};
  const tableEntries: [string, ReadonlyTable][] = Object.entries(world.tables);
  tableEntries.sort(([left], [right]) => compareIds(left, right));
  for (const [tableName, table] of tableEntries) {
    tables[tableName] = table.entries();
    for (const spec of table.def.indexes) {
      for (const key of indexKeys) {
        const found =
          spec.unique === true
            ? [table.lookupOne(spec.name, key)?.id ?? null]
            : table.lookup(spec.name, key).map((row) => row.id);
        if (found.some((id) => id !== null)) {
          indexes[`${tableName}.${spec.name}[${key}]`] = found;
        }
      }
    }
  }
  return JSON.stringify({ meta: world.meta, tables, indexes });
}
