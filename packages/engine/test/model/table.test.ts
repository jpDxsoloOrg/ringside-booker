import { describe, expect, it, vi } from 'vitest';
import { EntityNotFoundError, UniqueIndexError, UnknownIndexError } from '../../src/core/errors';
import { setFastPaths } from '../../src/core/fastPaths';
import { parseId } from '../../src/core/ids';
import { MutableTable } from '../../src/model/table';
import { makeWidget, ownerId, widgetId, widgetsTable, type Widget } from '../support/toy-registry';

function newWidgets(): MutableTable<Widget> {
  return new MutableTable(widgetsTable);
}

function idsOf(rows: readonly Widget[]): string[] {
  return rows.map((row) => row.id);
}

describe('canonical order', () => {
  it('lists IDs in ascending order whatever the insertion order', () => {
    const table = newWidgets();
    table._put(makeWidget(3, ownerId(1)));
    table._put(makeWidget(1, ownerId(1)));
    table._put(makeWidget(2, ownerId(1)));
    expect(table.ids()).toEqual([widgetId(1), widgetId(2), widgetId(3)]);
    expect(idsOf(table.values())).toEqual([widgetId(1), widgetId(2), widgetId(3)]);
    expect(table.entries().map(([key]) => key)).toEqual([widgetId(1), widgetId(2), widgetId(3)]);
  });

  it('compares by UTF-16 code unit, so digits sort before letters', () => {
    const table = newWidgets();
    table._putAt(widgetId(9), makeWidget(9, ownerId(1)));
    const letterId = parseId('title', 'tit_a000000000');
    table._put({ ...makeWidget(10, ownerId(1)), id: letterId });
    expect(table.ids()).toEqual([widgetId(9), letterId]);
  });

  it('rebuilds the sorted ID cache after inserts and deletes but not after updates', () => {
    const table = newWidgets();
    table._put(makeWidget(3, ownerId(1)));
    table._put(makeWidget(1, ownerId(1)));
    table._put(makeWidget(2, ownerId(1)));
    const sortSpy = vi.spyOn(table, '_sortIds');

    expect(table.ids()).toEqual([widgetId(1), widgetId(2), widgetId(3)]);
    expect(sortSpy).toHaveBeenCalledTimes(1);

    table._put(makeWidget(1, ownerId(2), { serial: 'renamed' }));
    expect(table.ids()).toEqual([widgetId(1), widgetId(2), widgetId(3)]);
    expect(table.require(widgetId(1)).serial).toBe('renamed');
    expect(sortSpy).toHaveBeenCalledTimes(1);

    table._delete(widgetId(2));
    expect(table.ids()).toEqual([widgetId(1), widgetId(3)]);
    expect(sortSpy).toHaveBeenCalledTimes(2);

    table._put(makeWidget(0, ownerId(1)));
    expect(table.ids()).toEqual([widgetId(0), widgetId(1), widgetId(3)]);
    expect(sortSpy).toHaveBeenCalledTimes(3);
  });

  it('keeps an ID list returned earlier unchanged after later writes', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1)));
    const before = table.ids();
    table._put(makeWidget(2, ownerId(1)));
    expect(before).toEqual([widgetId(1)]);
    expect(Object.isFrozen(before)).toBe(true);
  });
});

describe('reads', () => {
  it('get, has, require and size', () => {
    const table = newWidgets();
    const widget = makeWidget(1, ownerId(1));
    table._put(widget);
    expect(table.size).toBe(1);
    expect(table.get(widgetId(1))).toBe(widget);
    expect(table.has(widgetId(1))).toBe(true);
    expect(table.get(widgetId(2))).toBeUndefined();
    expect(table.has(widgetId(2))).toBe(false);
    expect(() => table.require(widgetId(2))).toThrow(EntityNotFoundError);
  });

  it('_delete returns the removed row and throws for a missing ID', () => {
    const table = newWidgets();
    const widget = makeWidget(1, ownerId(1));
    table._put(widget);
    expect(table._delete(widgetId(1))).toBe(widget);
    expect(table.size).toBe(0);
    expect(() => table._delete(widgetId(1))).toThrow(EntityNotFoundError);
  });
});

describe('plain indexes', () => {
  it('files rows under their key and lists them in ID order', () => {
    const table = newWidgets();
    table._put(makeWidget(3, ownerId(1)));
    table._put(makeWidget(1, ownerId(1)));
    table._put(makeWidget(2, ownerId(2)));
    expect(idsOf(table.lookup('byOwner', ownerId(1)))).toEqual([widgetId(1), widgetId(3)]);
    expect(idsOf(table.lookup('byOwner', ownerId(2)))).toEqual([widgetId(2)]);
    expect(table.lookup('byOwner', ownerId(9))).toEqual([]);
  });

  it('re-files a row when an update changes its key', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1)));
    table._put(makeWidget(1, ownerId(2)));
    expect(table.lookup('byOwner', ownerId(1))).toEqual([]);
    expect(idsOf(table.lookup('byOwner', ownerId(2)))).toEqual([widgetId(1)]);
  });

  it('keeps sorted lookups right while rows come, change, move and go (POL4-10 cache)', () => {
    const table = newWidgets();
    const owners = [ownerId(1), ownerId(2), ownerId(3)];
    const snapshot = (): string[][] =>
      owners.map((owner) => table.lookup('byOwner', owner).map((row) => `${row.id}:${row.serial}`));
    const fullPath = (): string[][] => {
      const was = setFastPaths(false);
      try {
        return snapshot();
      } finally {
        setFastPaths(was);
      }
    };
    let state = 7;
    const next = (bound: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % bound;
    };
    for (let step = 0; step < 400; step += 1) {
      const serial = 1 + next(12);
      const owner = owners[next(owners.length)] ?? ownerId(1);
      if (next(5) === 0 && table.has(widgetId(serial))) {
        table._delete(widgetId(serial));
      } else {
        // Same owner or a new one, and a new serial text so a stale row would show.
        table._put(makeWidget(serial, owner, { serial: `W-${String(serial)}-${String(step)}` }));
      }
      // Reading every few steps warms the cache in between writes.
      if (next(3) === 0) {
        expect(snapshot()).toEqual(fullPath());
      }
    }
    expect(snapshot()).toEqual(fullPath());
  });

  it('files a row under each key of a multi-key index, once per distinct key', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(2), ownerId(3), ownerId(2)] }));
    table._put(makeWidget(2, ownerId(1), { tagIds: [ownerId(3)] }));
    expect(idsOf(table.lookup('byTaggedOwner', ownerId(2)))).toEqual([widgetId(1)]);
    expect(idsOf(table.lookup('byTaggedOwner', ownerId(3)))).toEqual([widgetId(1), widgetId(2)]);

    table._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(4)] }));
    expect(table.lookup('byTaggedOwner', ownerId(2))).toEqual([]);
    expect(idsOf(table.lookup('byTaggedOwner', ownerId(3)))).toEqual([widgetId(2)]);
    expect(idsOf(table.lookup('byTaggedOwner', ownerId(4)))).toEqual([widgetId(1)]);
  });

  it('leaves a row out of the index when its key is null', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(2)] }));
    table._put(makeWidget(1, ownerId(1), { tagIds: [] }));
    expect(table.lookup('byTaggedOwner', ownerId(2))).toEqual([]);
  });

  it('drops a deleted row from every index', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(2)] }));
    table._delete(widgetId(1));
    expect(table.lookup('byOwner', ownerId(1))).toEqual([]);
    expect(table.lookup('byTaggedOwner', ownerId(2))).toEqual([]);
    expect(table.lookupOne('bySerial', 'W-1')).toBeUndefined();
  });

  it('refuses lookupOne on a non-unique index', () => {
    const table = newWidgets();
    expect(() => table.lookupOne('byOwner', ownerId(1))).toThrow(UnknownIndexError);
  });
});

describe('unique indexes', () => {
  it('finds the one row for a key', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { serial: 'A-1' }));
    expect(table.lookupOne('bySerial', 'A-1')?.id).toBe(widgetId(1));
    expect(table.lookupOne('bySerial', 'missing')).toBeUndefined();
    expect(idsOf(table.lookup('bySerial', 'A-1'))).toEqual([widgetId(1)]);
  });

  it('throws UniqueIndexError for a second row with the same key and changes nothing', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { serial: 'A-1' }));
    let thrown: unknown;
    try {
      table._put(makeWidget(2, ownerId(2), { serial: 'A-1' }));
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UniqueIndexError);
    expect(thrown).toMatchObject({
      code: 'UNIQUE_INDEX',
      details: { table: 'widgets', index: 'bySerial', key: 'A-1' },
    });
    expect(table.has(widgetId(2))).toBe(false);
    expect(table.lookup('byOwner', ownerId(2))).toEqual([]);
  });

  it('lets a row keep its own key on update and frees the old key when it changes', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { serial: 'A-1' }));
    table._put(makeWidget(1, ownerId(2), { serial: 'A-1' }));
    table._put(makeWidget(1, ownerId(2), { serial: 'B-1' }));
    expect(table.lookupOne('bySerial', 'A-1')).toBeUndefined();
    expect(table.lookupOne('bySerial', 'B-1')?.id).toBe(widgetId(1));
    table._put(makeWidget(2, ownerId(1), { serial: 'A-1' }));
    expect(table.lookupOne('bySerial', 'A-1')?.id).toBe(widgetId(2));
  });

  it('refuses an update that moves a row onto a key another row holds', () => {
    const table = newWidgets();
    table._put(makeWidget(1, ownerId(1), { serial: 'A-1' }));
    table._put(makeWidget(2, ownerId(1), { serial: 'B-1' }));
    expect(() => {
      table._put(makeWidget(2, ownerId(3), { serial: 'A-1' }));
    }).toThrow(UniqueIndexError);
    expect(table.require(widgetId(2)).serial).toBe('B-1');
    expect(idsOf(table.lookup('byOwner', ownerId(1)))).toEqual([widgetId(1), widgetId(2)]);
  });
});
