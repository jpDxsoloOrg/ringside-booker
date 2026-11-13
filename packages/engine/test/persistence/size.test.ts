/**
 * Size and speed smoke test for saves: a 300-wrestler world with 5,000 ledger entries must pack
 * small and load fast. The speed bound is CPU time against a reference workload measured in the
 * same process (see support/cpu-budget.ts), so a busy machine does not fail it; the test logs the
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
import { measureBestAgainstReferenceAsync } from '../support/cpu-budget';
import { rosterWorld } from '../support/worlds';

const ROSTER_SIZE = 300;
const LEDGER_ENTRIES = 5_000;
const MAX_ENCODED_BYTES = 2 * 1024 * 1024;
/**
 * The most reference workloads an encode and load may cost together: the old 1.5 s bound over the
 * reference's 50 ms on a laptop. A round trip costs about 2, alone or under load.
 */
const ROUND_TRIP_REFERENCE_BUDGET = 30;

describe('save size and speed', () => {
  it(`packs rosterWorld(${String(ROSTER_SIZE)}) with ${String(LEDGER_ENTRIES)} ledger entries under 2 MB and round-trips within the CPU budget`, async () => {
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

    let bytes: Uint8Array = new Uint8Array();
    let loaded = false;
    // The cheapest of three round trips: one now and then pays for a garbage collection.
    const timing = await measureBestAgainstReferenceAsync(async () => {
      bytes = await encodeSave(doc);
      loaded = (await loadSave(bytes, TABLES)).ok;
    }, 3);

    console.log(
      `save smoke test: ${String(bytes.length)} bytes gzipped, round trip ${timing.workMs.toFixed(0)} ms of CPU time against ${timing.referenceMs.toFixed(1)} ms for the reference`,
    );
    expect(loaded).toBe(true);
    expect(bytes.length).toBeLessThan(MAX_ENCODED_BYTES);
    expect(timing.ratio).toBeLessThan(ROUND_TRIP_REFERENCE_BUDGET);
  });
});
