// The schema changes of EVT5-02: a promotion's monthly gain tally and the per-show popularity
// record. Design: docs/design/data-model.md
import { describe, expect, it } from 'vitest';
import { isYearMonth, parseGameDate, yearMonthOf } from '../../../src/core/date';
import { checkWorld } from '../../../src/model/integrity';
import { PopularityShowChangeSchema } from '../../../src/model/entities/popularity-show-change';
import { PromotionSchema } from '../../../src/model/entities/promotion';
import { TABLES } from '../../../src/model/tables';
import { aPopularityShowChange } from '../../support/builders/popularity';
import { aPromotion } from '../../support/builders/promotions';
import { testId } from '../../support/ids';
import { tinyWorld } from '../../support/worlds';

describe('yearMonthOf', () => {
  it.each([
    ['2026-01-05', '2026-01'],
    ['2026-12-31', '2026-12'],
    ['1900-02-28', '1900-02'],
  ])('puts %s in %s', (date, month) => {
    expect(yearMonthOf(parseGameDate(date))).toBe(month);
  });

  it.each(['2026-00', '2026-13', '26-01', '2026-1', '2026-01-01', 202601])(
    'refuses %s as a month',
    (value) => {
      expect(isYearMonth(value)).toBe(false);
    },
  );
});

describe('promotions.popularityGains', () => {
  it('starts empty in the month of the start date on a built promotion', () => {
    expect(aPromotion().popularityGains).toEqual({ month: '2026-01', byRegion: {} });
  });

  it.each([
    ['a stored 0', { month: '2026-01', byRegion: { [testId('region')]: 0 } }],
    ['a gain over 100', { month: '2026-01', byRegion: { [testId('region')]: 101 } }],
    ['a bad month', { month: '2026-13', byRegion: {} }],
    ['a key that is not a region', { month: '2026-01', byRegion: { [testId('person')]: 1 } }],
  ])('refuses %s', (_label, popularityGains) => {
    expect(PromotionSchema.safeParse({ ...aPromotion(), popularityGains }).success).toBe(false);
  });

  it('checks the tally keys as region references', () => {
    expect(TABLES.promotions.refs).toContainEqual({
      path: 'popularityGains.byRegion{}',
      target: 'region',
      nullable: false,
    });
  });
});

describe('popularityShowChanges', () => {
  const tvRegion = {
    source: 'tv',
    networkId: testId('network'),
    weight: 0.3,
    expectation: 4,
    before: 0,
    after: 0.9,
    capped: false,
  } as const;

  it('accepts the default row and a TV region with its network', () => {
    expect(PopularityShowChangeSchema.safeParse(aPopularityShowChange()).success).toBe(true);
    const row = aPopularityShowChange({ regions: { [testId('region', 3)]: tvRegion } });
    expect(PopularityShowChangeSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    ['a TV region without its network', { ...tvRegion, networkId: null }],
    ['a network on a neighbour', { ...tvRegion, source: 'neighbour' }],
    ['a weight of 0', { ...tvRegion, weight: 0 }],
    ['a weight over 1', { ...tvRegion, weight: 1.2 }],
    ['popularity over 100', { ...tvRegion, after: 100.5 }],
    ['an unknown field', { ...tvRegion, extra: 1 }],
  ])('refuses %s', (_label, region) => {
    const row = { ...aPopularityShowChange(), regions: { [testId('region')]: region } };
    expect(PopularityShowChangeSchema.safeParse(row).success).toBe(false);
  });

  it('has no field for minutes, length, duration or role', () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(aPopularityShowChange({ regions: { [testId('region', 3)]: tvRegion } }));
    expect(keys).toContain('capped');
    expect([...keys].filter((field) => /minute|length|duration|role/i.test(field))).toEqual([]);
  });

  it('declares its references and indexes', () => {
    const table = TABLES.popularityShowChanges;
    expect(table.refs).toEqual([
      { path: 'eventInstanceId', target: 'eventInstance', nullable: false },
      { path: 'promotionId', target: 'promotion', nullable: false },
      { path: 'regions{}', target: 'region', nullable: false },
    ]);
    expect(table.indexes.map((index) => [index.name, index.unique ?? false])).toEqual([
      ['byEventInstance', true],
      ['byPromotion', false],
    ]);
  });

  it('passes the integrity check in the tiny world', () => {
    const { world } = tinyWorld();
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });

  it('reports a region entry naming a network that does not exist', () => {
    const { world } = tinyWorld();
    const [row] = world.tables.popularityShowChanges.values();
    if (row === undefined) {
      expect.fail('the tiny world has a record');
    }
    const result = world.transact('add a dangling network', (tx) => {
      tx.update('popularityShowChanges', row.id, {
        regions: {
          ...row.regions,
          [testId('region', 3)]: { ...tvRegion, networkId: testId('network', 99) },
        },
      });
    });
    expect(result.ok).toBe(true);
    expect(checkWorld(world, TABLES).issues).toMatchObject([
      {
        code: 'popularityShowChange.unknownNetwork',
        table: 'popularityShowChanges',
        id: row.id,
        path: `regions{${testId('region', 3)}}.networkId`,
      },
    ]);
  });

  it('refuses a second record for the same show', () => {
    const { world } = tinyWorld();
    const [row] = world.tables.popularityShowChanges.values();
    if (row === undefined) {
      expect.fail('the tiny world has a record');
    }
    const result = world.transact('add a duplicate', (tx) => {
      tx.create('popularityShowChanges', {
        eventInstanceId: row.eventInstanceId,
        promotionId: row.promotionId,
        date: row.date,
        score: row.score,
        worldBefore: row.worldBefore,
        worldAfter: row.worldAfter,
        regions: row.regions,
      });
    });
    expect(result.ok).toBe(false);
  });
});
