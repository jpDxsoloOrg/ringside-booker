import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { EntityNotFoundError, RegistryError, UnknownIndexError } from '../../src/core/errors';
import { zId } from '../../src/model/primitives';
import type { ReadonlyTable } from '../../src/model/table';
import { defineTable } from '../../src/model/table-def';
import { TABLES, type GameWorldView } from '../../src/model/tables';
import { createWorld, tableOf, type WorldView } from '../../src/model/world';
import { stubTable } from '../support/stub-tables';
import {
  emptyToyWorld,
  makeWidget,
  ownerId,
  ownersTable,
  toyMeta,
  validToyWorld,
  widgetId,
  widgetsTable,
  type ToyRegistry,
  type Widget,
} from '../support/toy-registry';

describe('createWorld', () => {
  it('builds an empty table per registry entry', () => {
    const world = emptyToyWorld();
    expect(Object.keys(world.tables).sort()).toEqual(['owners', 'regions', 'widgets']);
    for (const table of Object.values(world.tables)) {
      expect(table.size).toBe(0);
      expect(table.ids()).toEqual([]);
      expect(table.values()).toEqual([]);
    }
    expect(world.meta.worldName).toBe('Toy World');
  });

  it('builds a world with one table per entry of the production registry', () => {
    const world = createWorld(TABLES, toyMeta());
    expect(Object.keys(world.tables)).toEqual(Object.keys(TABLES));
  });

  it('throws RegistryError when two entries share a table name', () => {
    const registry = { owners: ownersTable, otherOwners: ownersTable };
    expect(() => createWorld(registry, toyMeta())).toThrow(RegistryError);
  });

  it('throws RegistryError when two tables share a kind', () => {
    const registry = {
      regions: stubTable('region', 'regions'),
      moreRegions: stubTable('region', 'moreRegions'),
    };
    expect(() => createWorld(registry, toyMeta())).toThrow(/share kind region/);
  });
});

describe('reads', () => {
  it('require on a missing ID throws EntityNotFoundError naming the kind and ID', () => {
    const world = emptyToyWorld();
    const missing = widgetId(42);
    expect(() => world.tables.widgets.require(missing)).toThrow(EntityNotFoundError);
    expect(() => world.tables.widgets.require(missing)).toThrow(missing);
    expect(() => world.tables.widgets.require(missing)).toThrow(/title/);
  });

  it('lookup and lookupOne on an unknown index name throw', () => {
    const world = emptyToyWorld();
    expect(() => world.tables.widgets.lookup('byColour', 'red')).toThrow(UnknownIndexError);
    expect(() => world.tables.widgets.lookupOne('byColour', 'red')).toThrow(UnknownIndexError);
  });

  it('tableOf returns a typed table and throws for a definition the world does not hold', () => {
    const view: WorldView<ToyRegistry> = validToyWorld();
    const widgets = tableOf(view, widgetsTable);
    expectTypeOf(widgets).toEqualTypeOf<ReadonlyTable<Widget>>();
    expect(widgets.require(widgetId(1)).ownerId).toBe(ownerId(1));

    const lookalike = defineTable({
      kind: 'title',
      name: 'widgets',
      schema: z.strictObject({ id: zId('title') }),
      refs: [],
      indexes: [],
    });
    expect(() => tableOf(view, lookalike)).toThrow(RegistryError);
  });
});

describe('WorldView', () => {
  it('exposes the same data as the world it views', () => {
    const world = validToyWorld();
    const view: WorldView<ToyRegistry> = world;
    expect(view.tables.widgets.ids()).toEqual(world.tables.widgets.ids());
    expect(view.meta.settings.season.lengthDays).toBe(91);
  });

  it('has no mutator methods and read-only metadata (type test)', () => {
    const world = emptyToyWorld();
    const view: WorldView<ToyRegistry> = world;
    expectTypeOf(view.tables.widgets).toEqualTypeOf<ReadonlyTable<Widget>>();
    expectTypeOf(view.tables.widgets).not.toHaveProperty('_put');
    expectTypeOf(view.tables.widgets).not.toHaveProperty('_putAt');
    expectTypeOf(view.tables.widgets).not.toHaveProperty('_delete');
    expectTypeOf<GameWorldView>().toExtend<WorldView>();

    // Each line below must fail to compile; the function is never called.
    /* eslint-disable @typescript-eslint/no-unsafe-call -- calls to methods a view does not have */
    const writeAttempts = (): void => {
      // @ts-expect-error a view has no _put
      view.tables.widgets._put(makeWidget(1, ownerId(1)));
      // @ts-expect-error a view has no _delete
      view.tables.widgets._delete(widgetId(1));
      // @ts-expect-error view metadata is read-only
      view.meta.worldName = 'Renamed';
      // @ts-expect-error nested metadata is read-only too
      view.meta.settings.season.lengthDays = 30;
      // @ts-expect-error metadata arrays are read-only
      view.meta.players.push({ playerId: 'p2', displayName: 'Two' });
      // @ts-expect-error the tables object is read-only
      view.tables.widgets = world.tables.widgets;
    };
    /* eslint-enable @typescript-eslint/no-unsafe-call */
    expect(typeof writeAttempts).toBe('function');
  });
});
