/**
 * Determinism across a save: a world saved mid-run, loaded and run on must end exactly where an
 * uninterrupted run ends, byte for byte.
 *
 * The day step here is a stand-in for the real pipeline: it changes every wrestler's fatigue and
 * posts a ledger entry through `tx.create`, drawing from one test entropy source for both. The
 * source's position goes into the save's `rng` part and is restored on load; without that the
 * reloaded run would roll different fatigue and mint different IDs. SIM replaces this step with the
 * real pipeline and RNG in its own version of the test.
 */

import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/core/date';
import { createIdFactory, type IdEntropy } from '../../src/core/ids';
import { isJsonObject, type JsonValue } from '../../src/core/json';
import { cents } from '../../src/core/money';
import { TABLES, type GameWorld } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { loadSave } from '../../src/persistence/load';
import { worldToDocument } from '../../src/persistence/world-document';
import { PLACEHOLDER_SIM_STATE, TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../support/saves';
import { tinyWorld } from '../support/worlds';

const TOTAL_DAYS = 30;
const SAVE_AFTER_DAYS = 15;

/** A tiny counter-based generator whose whole state is its position, so it saves as one number. */
class PositionEntropy implements IdEntropy {
  constructor(public position = 0) {}

  nextUint32(): number {
    this.position += 1;
    let mixed = Math.imul(this.position ^ 0x9e3779b9, 0x85ebca6b);
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
    return (mixed ^ (mixed >>> 16)) >>> 0;
  }

  toJson(): JsonValue {
    return { position: this.position };
  }

  static fromJson(state: JsonValue): PositionEntropy {
    const position = isJsonObject(state) ? state['position'] : undefined;
    if (typeof position !== 'number') {
      throw new Error('the rng part has no position');
    }
    return new PositionEntropy(position);
  }
}

/** Installs `entropy` as the world's ID source; the day step draws from it too. */
function attach(world: GameWorld, entropy: PositionEntropy): void {
  world.setIdFactory(createIdFactory(entropy));
}

function runDay(world: GameWorld, entropy: PositionEntropy): void {
  const result = world.transact('test day', (tx) => {
    for (const person of tx.view.tables.people.values()) {
      const change = (entropy.nextUint32() % 11) - 5;
      tx.update('people', person.id, {
        fatigue: Math.min(100, Math.max(0, person.fatigue + change)),
      });
    }
    const [promotionId] = tx.view.tables.promotions.ids();
    if (promotionId === undefined) {
      throw new Error('the world has no promotion');
    }
    const { currentDate, daysSimulated } = tx.view.meta;
    tx.create('ledgerEntries', {
      promotionId,
      date: currentDate,
      category: 'wages',
      amount: cents(-100 * (1 + (entropy.nextUint32() % 1000))),
      memo: null,
      refs: { eventInstanceId: null, personId: null, dealId: null },
    });
    tx.setMeta({ currentDate: addDays(currentDate, 1), daysSimulated: daysSimulated + 1 });
  });
  if (!result.ok) {
    throw result.error;
  }
}

function runDays(world: GameWorld, entropy: PositionEntropy, days: number): void {
  for (let day = 0; day < days; day++) {
    runDay(world, entropy);
  }
}

async function save(world: GameWorld, entropy: PositionEntropy): Promise<Uint8Array> {
  return encodeSave(
    worldToDocument(world, {
      simState: { ...PLACEHOLDER_SIM_STATE, rng: entropy.toJson() },
      headerPromotionId: null,
      savedAt: TEST_SAVED_AT,
      label: 'Continue test',
      engineVersion: TEST_ENGINE_VERSION,
    }),
  );
}

describe('continuing after a save and load', () => {
  it('ends byte-identical to an uninterrupted run', async () => {
    const straight = tinyWorld().world;
    const straightEntropy = new PositionEntropy();
    attach(straight, straightEntropy);
    runDays(straight, straightEntropy, TOTAL_DAYS);
    const straightBytes = await save(straight, straightEntropy);

    const firstHalf = tinyWorld().world;
    const firstEntropy = new PositionEntropy();
    attach(firstHalf, firstEntropy);
    runDays(firstHalf, firstEntropy, SAVE_AFTER_DAYS);
    const report = await loadSave(await save(firstHalf, firstEntropy), TABLES, {
      worldOptions: { validateWrites: 'always' },
    });
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const resumed = report.world;
    const resumedEntropy = PositionEntropy.fromJson(report.doc.state.rng);
    attach(resumed, resumedEntropy);
    runDays(resumed, resumedEntropy, TOTAL_DAYS - SAVE_AFTER_DAYS);
    const resumedBytes = await save(resumed, resumedEntropy);

    expect(resumed.tables.ledgerEntries.size).toBe(straight.tables.ledgerEntries.size);
    expect(Buffer.from(resumedBytes).equals(Buffer.from(straightBytes))).toBe(true);
  });

  it('drifts when the RNG position is not restored, so the test can fail', async () => {
    const straight = tinyWorld().world;
    const straightEntropy = new PositionEntropy();
    attach(straight, straightEntropy);
    runDays(straight, straightEntropy, TOTAL_DAYS);

    const firstHalf = tinyWorld().world;
    const firstEntropy = new PositionEntropy();
    attach(firstHalf, firstEntropy);
    runDays(firstHalf, firstEntropy, SAVE_AFTER_DAYS);
    const report = await loadSave(await save(firstHalf, firstEntropy), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const forgetful = new PositionEntropy();
    attach(report.world, forgetful);
    runDays(report.world, forgetful, TOTAL_DAYS - SAVE_AFTER_DAYS);

    const straightBytes = await save(straight, straightEntropy);
    const forgetfulBytes = await save(report.world, forgetful);
    expect(Buffer.from(forgetfulBytes).equals(Buffer.from(straightBytes))).toBe(false);
  });
});
