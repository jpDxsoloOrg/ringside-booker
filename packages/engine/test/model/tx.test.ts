import { describe, expect, it } from 'vitest';
import {
  AppendOnlyError,
  DuplicateIdError,
  EntityNotFoundError,
  InvalidArgumentError,
  InvalidIdError,
  SchemaViolationError,
  TxStateError,
  UniqueIndexError,
} from '../../src/core/errors';
import { createIdFactory, parseId, type TitleId } from '../../src/core/ids';
import type { ChangeSet, Tx, TxResult } from '../../src/model/tx';
import { sequentialIdEntropy } from '../support/ids';
import {
  makeOwner,
  makeWidget,
  ownerId,
  toyMeta,
  widgetId,
  type Widget,
} from '../support/toy-registry';
import {
  emptyTxWorld,
  entryId,
  seededTxWorld,
  snapshotWorld,
  TX_REGISTRY,
  type TxRegistry,
} from '../support/tx-world';
import { createWorld, type WorldView } from '../../src/model/world';

const INDEX_KEYS: readonly string[] = [
  ...Array.from({ length: 20 }, (_unused, index) => `W-${String(index + 1)}`),
  ...Array.from({ length: 5 }, (_unused, index) => ownerId(index + 1)),
];

function snapshot(world: WorldView): string {
  return snapshotWorld(world, INDEX_KEYS);
}

function expectOk<T>(result: TxResult<T>): Extract<TxResult<T>, { ok: true }> {
  if (!result.ok) {
    throw result.error;
  }
  return result;
}

function expectFailed<T>(result: TxResult<T>): Extract<TxResult<T>, { ok: false }> {
  if (result.ok) {
    throw new Error(
      `Expected the transaction to fail, it returned ${JSON.stringify(result.value)}`,
    );
  }
  return result;
}

/** A title ID whose body is `serial` in base32, as `sequentialIdEntropy` mints them. */
function mintedTitleId(start: number): TitleId {
  return createIdFactory(sequentialIdEntropy(start)).next('title', () => false);
}

describe('commit', () => {
  it('applies insert, update and delete and reports them in the ChangeSet', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('commit', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(2)));
        const updated = tx.update('widgets', widgetId(1), { serial: 'W-11' });
        tx.update('owners', ownerId(2), (previous) => ({ ...previous, name: 'Renamed' }));
        tx.delete('widgets', widgetId(3));
        tx.setMeta({ daysSimulated: 4 });
        return updated.serial;
      }),
    );

    expect(result.value).toBe('W-11');
    expect(world.tables.widgets.ids()).toEqual([widgetId(1), widgetId(2), widgetId(9)]);
    expect(world.tables.widgets.require(widgetId(1)).serial).toBe('W-11');
    expect(world.tables.widgets.lookupOne('bySerial', 'W-11')?.id).toBe(widgetId(1));
    expect(world.tables.widgets.lookupOne('bySerial', 'W-1')).toBeUndefined();
    expect(world.tables.widgets.lookup('byOwner', ownerId(2)).map((row) => row.id)).toEqual([
      widgetId(9),
    ]);
    expect(world.tables.owners.require(ownerId(2)).name).toBe('Renamed');
    expect(world.meta.daysSimulated).toBe(4);

    const expected: ChangeSet = {
      meta: true,
      tables: {
        owners: { inserted: [], updated: [ownerId(2)], deleted: [] },
        widgets: { inserted: [widgetId(9)], updated: [widgetId(1)], deleted: [widgetId(3)] },
      },
    };
    expect(result.changes).toEqual(expected);
  });

  it('reads inside the transaction see its own writes', () => {
    const world = seededTxWorld();
    expectOk(
      world.transact('read-your-writes', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(2)));
        expect(tx.view.tables.widgets.has(widgetId(9))).toBe(true);
        expect(tx.view.tables.widgets.lookupOne('bySerial', 'W-9')?.id).toBe(widgetId(9));
        tx.setMeta({ worldName: 'Inside' });
        expect(tx.view.meta.worldName).toBe('Inside');
      }),
    );
  });

  it('lists ChangeSet IDs in canonical order whatever order they were written in', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('order', (tx) => {
        tx.insert('widgets', makeWidget(7, ownerId(1)));
        tx.insert('widgets', makeWidget(5, ownerId(1)));
        tx.insert('widgets', makeWidget(6, ownerId(1)));
      }),
    );
    expect(result.changes.tables['widgets']?.inserted).toEqual([
      widgetId(5),
      widgetId(6),
      widgetId(7),
    ]);
    expect(result.changes.meta).toBe(false);
  });

  it('rejects a duplicate ID, an ID of the wrong kind and an ID change', () => {
    const world = seededTxWorld();
    const duplicate = expectFailed(
      world.transact('dup', (tx) => tx.insert('widgets', makeWidget(1, ownerId(1)))),
    );
    expect(duplicate.error).toBeInstanceOf(DuplicateIdError);

    const wrongKind = expectFailed(
      world.transact('kind', (tx) => {
        tx.insert('owners', makeOwner(8));
        // @ts-expect-error a widget ID on an owner row, as a careless cast could produce
        tx.insert('owners', { ...makeOwner(9), id: widgetId(9) });
      }),
    );
    expect(wrongKind.error).toBeInstanceOf(InvalidIdError);
    expect(world.tables.owners.has(ownerId(8))).toBe(false);

    const idChange = expectFailed(
      world.transact('id-change', (tx) =>
        tx.update('widgets', widgetId(1), (previous) => ({ ...previous, id: widgetId(8) })),
      ),
    );
    expect(idChange.error).toBeInstanceOf(InvalidArgumentError);
    expect(world.tables.widgets.has(widgetId(8))).toBe(false);
  });
});

describe('rollback', () => {
  it('restores every table, index and the metadata exactly when the body throws mid-way', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const failure = new Error('boom');
    const result = expectFailed(
      world.transact('mid-way', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(2), { serial: 'W-12', tagIds: [ownerId(1)] }));
        tx.update('widgets', widgetId(1), { serial: 'W-13', ownerId: ownerId(2), tagIds: [] });
        tx.delete('widgets', widgetId(2));
        tx.insert('widgets', makeWidget(2, ownerId(2), { serial: 'W-2' }));
        tx.create('owners', {
          name: 'Minted',
          controller: { type: 'computer' },
          homeRegionId: null,
        });
        tx.insert('entries', { id: entryId(2), ownerId: ownerId(2), amount: 10 });
        tx.delete('owners', ownerId(2));
        tx.setMeta({ worldName: 'Changed', daysSimulated: 9 });
        throw failure;
      }),
    );

    expect(result.error).toBe(failure);
    expect(result.label).toBe('mid-way');
    expect(result.rolledBackOps).toBe(8);
    expect(snapshot(world)).toBe(before);
  });

  it('wraps a thrown non-error value in an Error', () => {
    const world = seededTxWorld();
    const result = expectFailed(
      world.transact('odd', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the case under test
        throw 'just a string';
      }),
    );
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain('just a string');
  });

  it('update after delete in the same transaction throws EntityNotFoundError and rolls back', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('update-after-delete', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        tx.delete('widgets', widgetId(1));
        tx.update('widgets', widgetId(1), { serial: 'W-19' });
      }),
    );
    expect(result.error).toBeInstanceOf(EntityNotFoundError);
    expect(result.error.message).toContain(widgetId(1));
    expect(result.rolledBackOps).toBe(2);
    expect(snapshot(world)).toBe(before);
  });

  it('rejects a write through a tx that has already ended', () => {
    const world = seededTxWorld();
    const leaked: { tx: Tx<TxRegistry> | null } = { tx: null };
    expectOk(
      world.transact('leak', (tx) => {
        leaked.tx = tx;
      }),
    );
    expect(() => {
      leaked.tx?.delete('widgets', widgetId(1));
    }).toThrow(TxStateError);
    expect(world.tables.widgets.has(widgetId(1))).toBe(true);
  });
});

describe('savepoints', () => {
  it('a failing savepoint rolls back only its own writes; outer writes survive and commit', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('outer', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        const inner = tx.savepoint('inner', (innerTx) => {
          innerTx.insert('widgets', makeWidget(10, ownerId(1)));
          innerTx.update('widgets', widgetId(9), { serial: 'W-19' });
          innerTx.setMeta({ worldName: 'Inner' });
          throw new Error('inner failed');
        });
        expect(expectFailed(inner).rolledBackOps).toBe(3);
        expect(expectFailed(inner).label).toBe('inner');
        tx.update('widgets', widgetId(2), { serial: 'W-20' });
        return 'outer done';
      }),
    );

    expect(result.value).toBe('outer done');
    expect(world.tables.widgets.has(widgetId(9))).toBe(true);
    expect(world.tables.widgets.require(widgetId(9)).serial).toBe('W-9');
    expect(world.tables.widgets.has(widgetId(10))).toBe(false);
    expect(world.tables.widgets.lookupOne('bySerial', 'W-19')).toBeUndefined();
    expect(world.meta.worldName).toBe('Toy World');
    expect(result.changes).toEqual({
      meta: false,
      tables: { widgets: { inserted: [widgetId(9)], updated: [widgetId(2)], deleted: [] } },
    });
  });

  it('a successful savepoint reports its own changes and they commit with the outer one', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('outer', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        const inner = expectOk(
          tx.savepoint('inner', (innerTx) => {
            innerTx.delete('widgets', widgetId(3));
          }),
        );
        expect(inner.changes).toEqual({
          meta: false,
          tables: { widgets: { inserted: [], updated: [], deleted: [widgetId(3)] } },
        });
      }),
    );
    expect(result.changes.tables['widgets']).toEqual({
      inserted: [widgetId(9)],
      updated: [],
      deleted: [widgetId(3)],
    });
  });

  it('nested savepoints three deep roll back to the right marks', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('outer', (tx) => {
        tx.insert('widgets', makeWidget(10, ownerId(1)));
        const levelOne = tx.savepoint('one', (oneTx) => {
          oneTx.insert('widgets', makeWidget(11, ownerId(1)));
          const levelTwo = oneTx.savepoint('two', (twoTx) => {
            twoTx.insert('widgets', makeWidget(12, ownerId(1)));
            const levelThree = twoTx.savepoint('three', (threeTx) => {
              threeTx.insert('widgets', makeWidget(13, ownerId(1)));
              threeTx.update('widgets', widgetId(12), { serial: 'W-14' });
              throw new Error('three failed');
            });
            expect(expectFailed(levelThree).rolledBackOps).toBe(2);
            expect(twoTx.view.tables.widgets.has(widgetId(13))).toBe(false);
            expect(twoTx.view.tables.widgets.require(widgetId(12)).serial).toBe('W-12');

            const successfulThree = twoTx.savepoint('three-again', (threeTx) => {
              threeTx.insert('widgets', makeWidget(15, ownerId(1)));
            });
            expect(successfulThree.ok).toBe(true);
            throw new Error('two failed');
          });
          // Level two's own insert and the savepoint it kept are both undone.
          expect(expectFailed(levelTwo).rolledBackOps).toBe(2);
          expect(oneTx.view.tables.widgets.has(widgetId(11))).toBe(true);
          expect(oneTx.view.tables.widgets.has(widgetId(12))).toBe(false);
          expect(oneTx.view.tables.widgets.has(widgetId(15))).toBe(false);
          oneTx.update('widgets', widgetId(11), { serial: 'W-16' });
        });
        expectOk(levelOne);
      }),
    );

    expect(world.tables.widgets.ids()).toEqual([
      widgetId(1),
      widgetId(2),
      widgetId(3),
      widgetId(10),
      widgetId(11),
    ]);
    expect(world.tables.widgets.require(widgetId(11)).serial).toBe('W-16');
    expect(result.changes.tables['widgets']?.inserted).toEqual([widgetId(10), widgetId(11)]);
  });

  it('refuses writes through an outer tx while a savepoint is open', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('outer', (tx) =>
        tx.savepoint('inner', () => tx.insert('widgets', makeWidget(9, ownerId(1)))),
      ),
    );
    expect(expectFailed(result.value).error).toBeInstanceOf(TxStateError);
    expect(world.tables.widgets.has(widgetId(9))).toBe(false);
  });
});

describe('ID minting', () => {
  it('create mints sequentialIdEntropy IDs in order and redraws on collision', () => {
    const world = emptyTxWorld();
    world.tables.owners._put(makeOwner(1));
    world.tables.widgets._put(makeWidget(2, ownerId(1), { serial: 'taken' }));
    const result = expectOk(
      world.transact('create', (tx) => {
        const first = tx.create('widgets', {
          serial: 'A',
          ownerId: ownerId(1),
          tagIds: [],
          scores: {},
        });
        const second = tx.create('widgets', {
          serial: 'B',
          ownerId: ownerId(1),
          tagIds: [],
          scores: {},
        });
        const third = tx.create('widgets', {
          serial: 'C',
          ownerId: ownerId(1),
          tagIds: [],
          scores: {},
        });
        return [first, second, third];
      }),
    );
    // Body 1, then body 2 is taken so it is discarded and body 3 drawn, then body 4.
    expect(result.value.map((row) => row.id)).toEqual([widgetId(1), widgetId(3), widgetId(4)]);
    expect(result.value[1]).toEqual({
      id: widgetId(3),
      serial: 'B',
      ownerId: ownerId(1),
      tagIds: [],
      scores: {},
    });
    expect(world.tables.widgets.require(widgetId(4)).serial).toBe('C');
    expect(result.changes.tables['widgets']?.inserted).toEqual([
      widgetId(1),
      widgetId(3),
      widgetId(4),
    ]);
  });

  it('mints from the factory given to createWorld, then from one installed with setIdFactory', () => {
    const world = emptyTxWorld({ idFactory: createIdFactory(sequentialIdEntropy(1)) });
    world.tables.owners._put(makeOwner(1));
    const fields = { serial: 'A', ownerId: ownerId(1), tagIds: [], scores: {} };

    const first = expectOk(world.transact('first', (tx) => tx.create('widgets', fields)));
    expect(first.value.id).toBe(mintedTitleId(1));

    world.setIdFactory(createIdFactory(sequentialIdEntropy(100)));
    const second = expectOk(
      world.transact('second', (tx) => tx.create('widgets', { ...fields, serial: 'B' })),
    );
    expect(second.value.id).toBe(mintedTitleId(100));
    expect(second.value.id).toBe(parseId('title', 'tit_0000000034'));
  });

  it('create with no ID factory installed throws TxStateError and rolls back', () => {
    const world = createWorld(TX_REGISTRY, toyMeta(), { validateWrites: 'always' });
    world.tables.owners._put(makeOwner(1));
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('no-factory', (tx) => {
        tx.insert('owners', makeOwner(2));
        tx.create('widgets', { serial: 'A', ownerId: ownerId(1), tagIds: [], scores: {} });
      }),
    );
    expect(result.error).toBeInstanceOf(TxStateError);
    expect(result.error.message).toContain('no IdFactory installed');
    expect(result.rolledBackOps).toBe(1);
    expect(snapshot(world)).toBe(before);
  });

  it('mintId mints the next free ID without inserting, for a row that names its own ID', () => {
    const world = emptyTxWorld();
    world.tables.owners._put(makeOwner(1));
    world.tables.widgets._put(makeWidget(1, ownerId(1), { serial: 'taken' }));
    const result = expectOk(
      world.transact('mint', (tx) => {
        const id = tx.mintId('widgets');
        const sizeAfterMint = tx.view.tables.widgets.size;
        tx.insert('widgets', makeWidget(2, ownerId(1), { id, serial: `named ${id}` }));
        return { id, sizeAfterMint };
      }),
    );
    // Body 1 is taken, so the minter skips it; minting alone inserts nothing.
    expect(result.value.id).toBe(widgetId(2));
    expect(result.value.sizeAfterMint).toBe(1);
    expect(world.tables.widgets.require(widgetId(2)).serial).toBe(`named ${widgetId(2)}`);
  });

  it('setIdFactory inside an open transaction throws TxStateError', () => {
    const world = emptyTxWorld();
    world.tables.owners._put(makeOwner(1));
    const result = expectOk(
      world.transact('swap', (tx) => {
        expect(() => {
          world.setIdFactory(createIdFactory(sequentialIdEntropy(100)));
        }).toThrow(TxStateError);
        return tx.create('widgets', { serial: 'A', ownerId: ownerId(1), tagIds: [], scores: {} });
      }),
    );
    // The original factory is still installed.
    expect(result.value.id).toBe(mintedTitleId(1));
  });
});

describe('misuse', () => {
  it('re-entrant transact throws TxStateError, failing the outer transaction', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('outer', (tx) => {
        tx.delete('widgets', widgetId(1));
        world.transact('inner', (innerTx) => {
          innerTx.delete('widgets', widgetId(2));
        });
      }),
    );
    expect(result.error).toBeInstanceOf(TxStateError);
    expect(result.error.message).toContain('savepoint');
    expect(snapshot(world)).toBe(before);
    // The world accepts transactions again afterwards.
    expectOk(
      world.transact('after', (tx) => {
        tx.delete('widgets', widgetId(1));
      }),
    );
  });

  it('an async body fails with TxStateError and leaves the world unchanged', async () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    let lateWriteError: unknown = null;
    const result = expectFailed(
      world.transact('async', async (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        await Promise.resolve();
        try {
          tx.insert('widgets', makeWidget(10, ownerId(1)));
        } catch (thrown) {
          lateWriteError = thrown;
        }
      }),
    );
    expect(result.error).toBeInstanceOf(TxStateError);
    expect(result.error.message).toContain('transaction bodies must be synchronous');
    expect(result.rolledBackOps).toBe(1);
    expect(snapshot(world)).toBe(before);

    // A write attempted after the body's first await is refused too.
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(lateWriteError).toBeInstanceOf(TxStateError);
    expect(snapshot(world)).toBe(before);
  });

  it('an async savepoint body fails with TxStateError and rolls back only itself', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('outer', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        // eslint-disable-next-line @typescript-eslint/require-await -- async on purpose
        return tx.savepoint('inner', async (innerTx) => {
          innerTx.insert('widgets', makeWidget(10, ownerId(1)));
        });
      }),
    );
    expect(expectFailed(result.value).error).toBeInstanceOf(TxStateError);
    expect(world.tables.widgets.has(widgetId(9))).toBe(true);
    expect(world.tables.widgets.has(widgetId(10))).toBe(false);
  });
});

describe('table rules', () => {
  it('append-only tables reject update and delete with AppendOnlyError', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const updated = expectFailed(
      world.transact('update-ledger', (tx) => {
        tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5 });
        tx.update('entries', entryId(1), { amount: 1 });
      }),
    );
    expect(updated.error).toBeInstanceOf(AppendOnlyError);
    expect(updated.error.message).toContain('entries');
    const deleted = expectFailed(
      world.transact('delete-ledger', (tx) => {
        tx.delete('entries', entryId(1));
      }),
    );
    expect(deleted.error).toBeInstanceOf(AppendOnlyError);
    expect(snapshot(world)).toBe(before);

    const inserted = expectOk(
      world.transact('append', (tx) =>
        tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5 }),
      ),
    );
    expect(inserted.changes.tables['entries']?.inserted).toEqual([entryId(2)]);
  });

  it("'pruneOnly' tables reject update with AppendOnlyError but allow delete", () => {
    const registry = {
      ...TX_REGISTRY,
      entries: { ...TX_REGISTRY.entries, appendOnly: 'pruneOnly' as const },
    };
    const world = createWorld(registry, toyMeta(), {
      idFactory: createIdFactory(sequentialIdEntropy()),
      validateWrites: 'always',
    });
    world.tables.owners._put(makeOwner(1));
    world.tables.entries._put({ id: entryId(1), ownerId: ownerId(1), amount: 250 });

    const updated = expectFailed(
      world.transact('edit-log', (tx) => {
        tx.update('entries', entryId(1), { amount: 1 });
      }),
    );
    expect(updated.error).toBeInstanceOf(AppendOnlyError);
    expect(world.tables.entries.require(entryId(1)).amount).toBe(250);

    const pruned = expectOk(
      world.transact('prune-log', (tx) => {
        tx.delete('entries', entryId(1));
      }),
    );
    expect(pruned.changes.tables['entries']?.deleted).toEqual([entryId(1)]);
    expect(world.tables.entries.get(entryId(1))).toBeUndefined();
  });

  it('a unique index violation throws UniqueIndexError and rolls back the whole transaction', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('unique', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        tx.update('widgets', widgetId(3), { serial: 'W-15' });
        tx.update('widgets', widgetId(9), { serial: 'W-1' });
      }),
    );
    expect(result.error).toBeInstanceOf(UniqueIndexError);
    expect(result.rolledBackOps).toBe(2);
    expect(snapshot(world)).toBe(before);
    expect(world.tables.widgets.lookupOne('bySerial', 'W-3')?.id).toBe(widgetId(3));
  });
});

describe('write validation', () => {
  it('an out-of-range row field throws SchemaViolationError naming the path', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('bad-row', (tx) => {
        tx.insert('widgets', makeWidget(9, ownerId(1)));
        tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5000 });
      }),
    );
    expect(result.error).toBeInstanceOf(SchemaViolationError);
    if (!(result.error instanceof SchemaViolationError)) {
      throw result.error;
    }
    expect(result.error.paths).toEqual(['$.amount']);
    expect(result.error.message).toContain('$.amount');
    expect(snapshot(world)).toBe(before);
  });

  it('an out-of-range metadata field throws SchemaViolationError naming the path', () => {
    const world = seededTxWorld();
    const before = snapshot(world);
    const result = expectFailed(
      world.transact('bad-meta', (tx) => {
        tx.setMeta({ worldName: 'Fine' });
        tx.setMeta({
          settings: { ...tx.view.meta.settings, season: { lengthDays: 5 }, extra: {} },
        });
      }),
    );
    expect(result.error).toBeInstanceOf(SchemaViolationError);
    expect(result.error.message).toContain('$.settings.season.lengthDays');
    expect(snapshot(world)).toBe(before);
  });

  it('an update is validated against the whole row', () => {
    const world = seededTxWorld();
    const result = expectFailed(
      world.transact('bad-update', (tx) => tx.update('widgets', widgetId(1), { serial: '' })),
    );
    expect(result.error).toBeInstanceOf(SchemaViolationError);
    expect(result.error.message).toContain('$.serial');
  });

  it('returned rows are deep-frozen in validate mode', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('freeze', (tx) => {
        const inserted = tx.insert('widgets', makeWidget(9, ownerId(1), { tagIds: [ownerId(2)] }));
        const updated = tx.update('widgets', widgetId(1), { serial: 'W-19' });
        return { inserted, updated };
      }),
    );
    const { inserted, updated } = result.value;
    expect(Object.isFrozen(inserted)).toBe(true);
    expect(Object.isFrozen(inserted.tagIds)).toBe(true);
    expect(() => {
      inserted.serial = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      inserted.tagIds.push(ownerId(1));
    }).toThrow(TypeError);
    expect(() => {
      updated.scores['x'] = 1;
    }).toThrow(TypeError);
    expect(world.tables.widgets.require(widgetId(9))).toBe(inserted);
    expect(Object.isFrozen(world.meta)).toBe(false);
    expectOk(
      world.transact('meta', (tx) => {
        tx.setMeta({ daysSimulated: 1 });
      }),
    );
    expect(Object.isFrozen(world.meta.settings)).toBe(true);
  });

  it('skips validation and freezing when the world turns it off', () => {
    const world = seededTxWorld({ validateWrites: 'never' });
    const result = expectOk(
      world.transact('lenient', (tx) =>
        tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5000 }),
      ),
    );
    expect(Object.isFrozen(result.value)).toBe(false);
  });

  it('a per-call option overrides the world setting both ways', () => {
    const strictWorld = seededTxWorld({ validateWrites: 'always' });
    expectOk(
      strictWorld.transact(
        'lenient-call',
        (tx) => tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5000 }),
        { validate: 'never' },
      ),
    );

    const lenientWorld = seededTxWorld({ validateWrites: 'never' });
    const failed = expectFailed(
      lenientWorld.transact(
        'strict-call',
        (tx) => tx.insert('entries', { id: entryId(2), ownerId: ownerId(1), amount: 5000 }),
        { validate: 'always' },
      ),
    );
    expect(failed.error).toBeInstanceOf(SchemaViolationError);
  });
});

describe('ChangeSet', () => {
  function changesFor(body: (tx: Tx<TxRegistry>) => void): ChangeSet {
    return expectOk(seededTxWorld().transact('changes', body)).changes;
  }

  it('insert then update reports the row as inserted only', () => {
    const changes = changesFor((tx) => {
      tx.insert('widgets', makeWidget(9, ownerId(1)));
      tx.update('widgets', widgetId(9), { serial: 'W-19' });
    });
    expect(changes.tables['widgets']).toEqual({
      inserted: [widgetId(9)],
      updated: [],
      deleted: [],
    });
  });

  it('insert then delete reports nothing', () => {
    const changes = changesFor((tx) => {
      tx.insert('widgets', makeWidget(9, ownerId(1)));
      tx.delete('widgets', widgetId(9));
    });
    expect(changes).toEqual({ meta: false, tables: {} });
  });

  it('update then delete reports the row as deleted only', () => {
    const changes = changesFor((tx) => {
      tx.update('widgets', widgetId(1), { serial: 'W-19' });
      tx.update('widgets', widgetId(1), { serial: 'W-18' });
      tx.delete('widgets', widgetId(1));
    });
    expect(changes.tables['widgets']).toEqual({
      inserted: [],
      updated: [],
      deleted: [widgetId(1)],
    });
  });

  it('delete then insert of the same ID reports an update', () => {
    const changes = changesFor((tx) => {
      tx.delete('widgets', widgetId(1));
      tx.insert('widgets', makeWidget(1, ownerId(2)));
    });
    expect(changes.tables['widgets']).toEqual({
      inserted: [],
      updated: [widgetId(1)],
      deleted: [],
    });
  });

  it('is plain JSON that survives structuredClone and a JSON round trip', () => {
    const changes = changesFor((tx) => {
      tx.insert('widgets', makeWidget(9, ownerId(1)));
      tx.update('owners', ownerId(1), { name: 'Renamed' });
      tx.delete('widgets', widgetId(3));
      tx.setMeta({ daysSimulated: 2 });
    });
    expect(structuredClone(changes)).toEqual(changes);
    expect(JSON.parse(JSON.stringify(changes))).toEqual(changes);
    expect(Object.getPrototypeOf(changes)).toBe(Object.prototype);
  });

  it('widget rows written through the Tx keep the Widget type', () => {
    const world = seededTxWorld();
    const result = expectOk(
      world.transact('typed', (tx): Widget => tx.update('widgets', widgetId(1), { tagIds: [] })),
    );
    expect(result.value.tagIds).toEqual([]);
  });
});
