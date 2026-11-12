/**
 * Size and speed smoke test for saves: a 300-wrestler world with 5,000 ledger entries must pack
 * small and load fast. The bounds are generous on purpose (CI machines vary); the test logs the
 * real numbers so a slow drift shows up in the output long before it fails.
 */

import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/core/date';
import { LEDGER_COST_CATEGORIES } from '../../src/model/entities/ledger-entry';
import { ledgerEntryTraceRef } from '../../src/systems/finance/traces';
import { cents } from '../../src/core/money';
import { TABLES } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { loadSave } from '../../src/persistence/load';
import { TEST_START_DATE } from '../support/builders/build-row';
import { testSaveDocument } from '../support/saves';
import { rosterWorld } from '../support/worlds';

const ROSTER_SIZE = 300;
const LEDGER_ENTRIES = 5_000;
const MAX_ENCODED_BYTES = 2 * 1024 * 1024;
const MAX_ROUND_TRIP_MS = 1_500;

/** Real time in ms. The engine never reads the clock; this test measures the machine, not the game. */
function now(): number {
  // eslint-disable-next-line no-restricted-properties -- a speed test has to read the real clock
  return performance.now();
}

describe('save size and speed', () => {
  it(`packs rosterWorld(${String(ROSTER_SIZE)}) with ${String(LEDGER_ENTRIES)} ledger entries under 2 MB and round-trips under 1.5 s`, async () => {
    const { world, ids } = rosterWorld(ROSTER_SIZE);
    const promotionId = ids.promotions.A;
    if (promotionId === undefined) {
      throw new Error('rosterWorld has no promotion');
    }
    const result = world.transact(
      'post ledger entries',
      (tx) => {
        for (let i = 0; i < LEDGER_ENTRIES; i++) {
          // Every row carries a trace ref, as rows posted through postMoney do.
          const id = tx.mintId('ledgerEntries');
          tx.insert('ledgerEntries', {
            id,
            promotionId,
            date: addDays(TEST_START_DATE, i % 365),
            category: LEDGER_COST_CATEGORIES[i % LEDGER_COST_CATEGORIES.length] ?? 'otherCost',
            amount: cents(-(1_000 + ((i * 7_919) % 500_000))),
            memo: i % 10 === 0 ? `Test memo ${String(i)}` : null,
            refs: {
              eventInstanceId: null,
              personId: ids.people[i % ROSTER_SIZE] ?? null,
              dealId: null,
            },
            traceRef: ledgerEntryTraceRef({ id }, true),
          });
        }
      },
      { validate: 'never' },
    );
    expect(result.ok).toBe(true);
    const doc = testSaveDocument(world, { headerPromotionId: promotionId });

    const encodeStart = now();
    const bytes = await encodeSave(doc);
    const encodeMs = now() - encodeStart;
    const loadStart = now();
    const report = await loadSave(bytes, TABLES);
    const loadMs = now() - loadStart;

    console.log(
      `save smoke test: ${String(bytes.length)} bytes gzipped, encode ${encodeMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms`,
    );
    expect(report.ok).toBe(true);
    expect(bytes.length).toBeLessThan(MAX_ENCODED_BYTES);
    expect(encodeMs + loadMs).toBeLessThan(MAX_ROUND_TRIP_MS);
  });
});
