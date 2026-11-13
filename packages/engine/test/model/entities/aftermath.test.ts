// The aftermaths table (MTCH3-03). Design: docs/design/data-model.md, "Aftermaths".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../../src/core/ids';
import { AftermathSchema, aftermathsTable } from '../../../src/model/entities/aftermath';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { anAftermath } from '../../support/builders/aftermath';
import { testId } from '../../support/ids';
import { tinyWorld } from '../../support/worlds';

const BEFORE_AFTERMATHS = new URL(
  '../../fixtures/saves/v1-tiny-before-aftermaths.json',
  import.meta.url,
);

function edit(world: GameWorld, body: Parameters<GameWorld['transact']>[1]): void {
  const result = world.transact('edit', body);
  if (!result.ok) {
    throw result.error;
  }
}

function firstRow(world: GameWorld) {
  const [row] = world.tables.aftermaths.values();
  if (row === undefined) {
    throw new Error('tinyWorld should have aftermath rows');
  }
  return row;
}

describe('AftermathSchema', () => {
  it('accepts the default row and a contracted worker whose momentum started this match', () => {
    expect(AftermathSchema.safeParse(anAftermath()).success).toBe(true);
    const started = anAftermath({
      momentum: { employmentId: testId('employment'), before: null, after: 7 },
      traceIds: { momentum: 'match.momentumGain:x' },
    });
    expect(started.momentum?.before).toBeNull();
  });

  it('refuses a no contest, popularity outside 0..100 and momentum outside -100..100', () => {
    const row = anAftermath();
    expect(AftermathSchema.safeParse({ ...row, outcome: 'noContest' }).success).toBe(false);
    expect(
      AftermathSchema.safeParse({
        ...row,
        popularity: { delta: 1, byRegion: { [row.showRegionId]: { before: 99, after: 101 } } },
      }).success,
    ).toBe(false);
    expect(
      AftermathSchema.safeParse({
        ...row,
        momentum: { employmentId: testId('employment'), before: 0, after: 120 },
      }).success,
    ).toBe(false);
  });

  it('has no key about minutes, length, duration or role', () => {
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.push(key);
          walk(inner);
        }
      }
    };
    walk(
      anAftermath({
        momentum: { employmentId: testId('employment'), before: 1, after: 2 },
        traceIds: { momentum: 'match.momentumGain:x' },
      }),
    );
    expect(keys.filter((key) => /minute|length|duration|role/i.test(key))).toEqual([]);
  });
});

describe('aftermaths table', () => {
  it('is registered under prefix aft with its indexes', () => {
    expect(TABLES.aftermaths).toBe(aftermathsTable);
    expect(aftermathsTable.indexes.map((index) => index.name)).toEqual([
      'bySegment',
      'byPerson',
      'byEventInstance',
      'bySegmentPerson',
    ]);
    expect(firstRow(tinyWorld().world).id).toMatch(/^aft_/);
  });

  it('passes every check in tinyWorld', () => {
    const { world } = tinyWorld();
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('refuses a second row for the same match and person', () => {
    const { world } = tinyWorld();
    const row = firstRow(world);
    const result = world.transact('duplicate', (tx) => {
      tx.insert('aftermaths', { ...row, id: tx.mintId('aftermaths') });
    });
    expect(result.ok).toBe(false);
  });

  it('reports a dangling region and employment', () => {
    const { world } = tinyWorld();
    const row = firstRow(world);
    const missingRegion = testId('region', 99);
    edit(world, (tx) => {
      tx.update('aftermaths', row.id, {
        popularity: {
          delta: row.popularity.delta,
          byRegion: { [missingRegion]: { before: 1, after: 2 } } as Record<
            RegionId,
            { before: number; after: number }
          >,
        },
        momentum: { employmentId: testId('employment', 99), before: 0, after: 1 },
      });
    });
    const paths = checkWorld(world, TABLES, { only: ['refs'] }).issues.map((issue) => [
      issue.code,
      issue.path,
    ]);
    expect(paths).toEqual(
      expect.arrayContaining([
        ['ref.dangling', `popularity.byRegion{${missingRegion}}`],
        ['ref.dangling', 'momentum.employmentId'],
      ]),
    );
  });

  it('flags a row whose show or promotion is not its segment’s', () => {
    const { world, ids } = tinyWorld();
    const row = firstRow(world);
    const otherPromotion = ids.promotions.B;
    if (otherPromotion === undefined) {
      throw new Error('tinyWorld has promotion B');
    }
    edit(world, (tx) => {
      tx.update('aftermaths', row.id, { promotionId: otherPromotion });
    });
    expect(
      checkWorld(world, TABLES, { only: ['invariants'] }).issues.map((issue) => issue.code),
    ).toEqual(['aftermaths.promotionMismatch']);
  });
});

describe('saves written before the aftermaths table', () => {
  it('load with an empty aftermaths table', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_AFTERMATHS)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.aftermaths).toEqual([]);
  });
});
