/**
 * Rollback property test: random sequences of writes over the transaction-test registry, each
 * ending in a throw, must leave rows, indexes and metadata exactly as they were.
 *
 * Op choices come from the engine's seeded generator (one seed per sequence) and new IDs from an
 * ID factory over `sequentialIdEntropy`, so every run replays the same 500 sequences. Ops that
 * fail on their own (a duplicate ID, a unique serial clash, an append-only update, a bad row in
 * validate mode) are caught inside the body, as a system would, so sequences mix failed and
 * successful writes and nested savepoints before the final throw.
 */

import { describe, expect, it } from 'vitest';
import { Sfc32, seedState } from '../../src/core/rng/prng';
import type { Tx } from '../../src/model/tx';
import { makeOwner, makeWidget, ownerId, regionId, widgetId } from '../support/toy-registry';
import { entryId, seededTxWorld, snapshotWorld, type TxRegistry } from '../support/tx-world';

const SEQUENCE_COUNT = 500;
const MAX_OPS_PER_SEQUENCE = 14;
const MAX_SAVEPOINT_DEPTH = 3;
/** Every tenth sequence commits instead of throwing, so later sequences start from new states. */
const COMMIT_EVERY = 10;

const OWNER_SERIALS = [1, 2, 3, 4];
const WIDGET_SERIALS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SERIAL_POOL = ['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-6', 'W-7', 'W-8'];
const INDEX_KEYS = [...SERIAL_POOL, ...OWNER_SERIALS.map((serial) => ownerId(serial))];

class SequenceEnd extends Error {}

class Chooser {
  private readonly generator: Sfc32;

  constructor(sequenceIndex: number) {
    this.generator = new Sfc32(seedState('tx-property', String(sequenceIndex)));
  }

  /** An integer in 0..count-1. */
  below(count: number): number {
    return this.generator.nextUint32() % count;
  }

  chance(percent: number): boolean {
    return this.below(100) < percent;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.below(items.length)];
    if (item === undefined) {
      throw new Error('pick from an empty list');
    }
    return item;
  }
}

function randomOwnerId(chooser: Chooser) {
  return ownerId(chooser.pick(OWNER_SERIALS));
}

function randomTags(chooser: Chooser) {
  return Array.from({ length: chooser.below(3) }, () => randomOwnerId(chooser));
}

/**
 * Applies one random write through `tx`. Returns how many journal ops it left behind: 1 for a
 * successful write, 0 for one that failed, and for a savepoint whatever its body kept.
 */
function randomOp(tx: Tx<TxRegistry>, chooser: Chooser, depth: number): number {
  const opCount = depth < MAX_SAVEPOINT_DEPTH ? 12 : 11;
  const op = chooser.below(opCount);
  try {
    switch (op) {
      case 0:
        tx.insert(
          'widgets',
          makeWidget(chooser.pick(WIDGET_SERIALS), randomOwnerId(chooser), {
            serial: chooser.pick(SERIAL_POOL),
            tagIds: randomTags(chooser),
          }),
        );
        return 1;
      case 1:
        tx.create('widgets', {
          serial: chooser.pick(SERIAL_POOL),
          ownerId: randomOwnerId(chooser),
          tagIds: randomTags(chooser),
          scores: chooser.chance(50) ? { [randomOwnerId(chooser)]: chooser.below(10) } : {},
        });
        return 1;
      case 2:
        tx.update(
          'widgets',
          widgetId(chooser.pick(WIDGET_SERIALS)),
          chooser.chance(50)
            ? { serial: chooser.pick(SERIAL_POOL) }
            : { ownerId: randomOwnerId(chooser), tagIds: randomTags(chooser) },
        );
        return 1;
      case 3: {
        const newSerial = chooser.pick(SERIAL_POOL);
        tx.update('widgets', widgetId(chooser.pick(WIDGET_SERIALS)), (previous) => ({
          ...previous,
          serial: newSerial,
          scores: { ...previous.scores, [previous.ownerId]: 1 },
        }));
        return 1;
      }
      case 4:
        tx.delete('widgets', widgetId(chooser.pick(WIDGET_SERIALS)));
        return 1;
      case 5:
        tx.insert(
          'owners',
          makeOwner(chooser.pick(OWNER_SERIALS), {
            homeRegionId: chooser.chance(50) ? regionId(1) : null,
          }),
        );
        return 1;
      case 6:
        tx.update('owners', randomOwnerId(chooser), { name: `Owner v${String(chooser.below(9))}` });
        return 1;
      case 7:
        tx.delete('owners', randomOwnerId(chooser));
        return 1;
      case 8:
        tx.insert('entries', {
          id: entryId(1 + chooser.below(6)),
          ownerId: randomOwnerId(chooser),
          // Out of range one time in five, which validate mode refuses.
          amount: chooser.chance(20) ? 5000 : chooser.below(1001),
        });
        return 1;
      case 9:
        tx.update('entries', entryId(1), { amount: 1 });
        return 1;
      case 10:
        tx.setMeta(
          chooser.chance(50)
            ? { daysSimulated: chooser.below(100) }
            : { worldName: `World ${String(chooser.below(9))}` },
        );
        return 1;
      default:
        return randomSavepoint(tx, chooser, depth + 1);
    }
  } catch (thrown) {
    if (thrown instanceof SequenceEnd) {
      throw thrown;
    }
    return 0;
  }
}

function randomSavepoint(tx: Tx<TxRegistry>, chooser: Chooser, depth: number): number {
  let kept = 0;
  const fails = chooser.chance(50);
  const result = tx.savepoint(`depth-${String(depth)}`, (innerTx) => {
    const opCount = 1 + chooser.below(4);
    for (let i = 0; i < opCount; i += 1) {
      kept += randomOp(innerTx, chooser, depth);
    }
    if (fails) {
      throw new Error('savepoint failed');
    }
  });
  if (result.ok) {
    return kept;
  }
  expect(result.rolledBackOps).toBe(kept);
  return 0;
}

describe('transaction rollback property', () => {
  it(`restores the exact prior state after ${String(SEQUENCE_COUNT)} random failed sequences`, () => {
    const world = seededTxWorld();
    let baseline = snapshotWorld(world, INDEX_KEYS);
    let committed = 0;
    let rolledBackTotal = 0;

    for (let sequence = 0; sequence < SEQUENCE_COUNT; sequence += 1) {
      const chooser = new Chooser(sequence);
      const commits = sequence % COMMIT_EVERY === COMMIT_EVERY - 1;
      let applied = 0;
      const result = world.transact(
        `sequence-${String(sequence)}`,
        (tx) => {
          const opCount = 1 + chooser.below(MAX_OPS_PER_SEQUENCE);
          for (let i = 0; i < opCount; i += 1) {
            applied += randomOp(tx, chooser, 0);
          }
          if (!commits) {
            throw new SequenceEnd(`end of sequence ${String(sequence)}`);
          }
          return applied;
        },
        { validate: sequence % 2 === 0 ? 'always' : 'never' },
      );

      if (commits) {
        expect(result.ok).toBe(true);
        baseline = snapshotWorld(world, INDEX_KEYS);
        committed += 1;
        continue;
      }
      if (result.ok) {
        throw new Error(`sequence ${String(sequence)} should have failed`);
      }
      expect(result.error).toBeInstanceOf(SequenceEnd);
      expect(result.rolledBackOps).toBe(applied);
      rolledBackTotal += result.rolledBackOps;
      expect(snapshotWorld(world, INDEX_KEYS)).toBe(baseline);
    }

    expect(committed).toBe(SEQUENCE_COUNT / COMMIT_EVERY);
    // The sequences really wrote something: on average a few undone ops each.
    expect(rolledBackTotal).toBeGreaterThan(SEQUENCE_COUNT * 2);
  });
});
