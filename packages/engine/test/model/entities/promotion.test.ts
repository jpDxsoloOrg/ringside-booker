import { describe, expect, it } from 'vitest';
import { ControllerSchema } from '../../../src/model/controller';
import { BrandSchema, brandsTable } from '../../../src/model/entities/brand';
import {
  findParentCycles,
  PromotionSchema,
  promotionsTable,
} from '../../../src/model/entities/promotion';
import { PROMOTION_STYLES } from '../../../src/model/entities/promotion-style';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import {
  COMPANY_REGISTRY,
  makeBrand,
  makePromotion,
  testId,
  validCompanyWorld,
} from '../../support/company-fixtures';
import { referenceFieldPaths } from '../../support/ref-fields';
import { issuePaths, parseIssues } from '../../support/schema-issues';

describe('ControllerSchema', () => {
  it('accepts a computer controller', () => {
    expect(ControllerSchema.safeParse({ kind: 'computer' }).success).toBe(true);
  });

  it('accepts a human controller with a player ID', () => {
    expect(ControllerSchema.safeParse({ kind: 'human', playerId: 'player-1' }).success).toBe(true);
  });

  it('rejects a human controller with an empty player ID', () => {
    expect(ControllerSchema.safeParse({ kind: 'human', playerId: '' }).success).toBe(false);
  });

  it('rejects a player ID longer than 64 characters', () => {
    expect(ControllerSchema.safeParse({ kind: 'human', playerId: 'p'.repeat(65) }).success).toBe(
      false,
    );
  });

  it('rejects a computer controller carrying a player ID and an unknown kind', () => {
    expect(ControllerSchema.safeParse({ kind: 'computer', playerId: 'player-1' }).success).toBe(
      false,
    );
    expect(ControllerSchema.safeParse({ kind: 'ghost' }).success).toBe(false);
  });
});

describe('PromotionSchema', () => {
  it('accepts a complete valid promotion', () => {
    expect(parseIssues(PromotionSchema, makePromotion(1))).toEqual([]);
  });

  it('accepts negative cash, a human controller and a developmental parent', () => {
    const promotion = makePromotion(2, {
      parentPromotionId: testId('promotion', 1),
      controller: { kind: 'human', playerId: 'player-1' },
    });
    expect(parseIssues(PromotionSchema, promotion)).toEqual([]);
  });

  it('rejects a promotion that is its own parent', () => {
    const promotion = makePromotion(1, { parentPromotionId: testId('promotion', 1) });
    expect(issuePaths(PromotionSchema, promotion)).toEqual(['parentPromotionId']);
  });

  it('rejects a production level of 11 and accepts 10', () => {
    const atMax = makePromotion(1, { production: { ...makePromotion(1).production, pyro: 10 } });
    const overMax = makePromotion(1, { production: { ...makePromotion(1).production, pyro: 11 } });
    expect(parseIssues(PromotionSchema, atMax)).toEqual([]);
    expect(issuePaths(PromotionSchema, overMax)).toEqual(['production.pyro']);
  });

  it('rejects a fractional production level', () => {
    const promotion = makePromotion(1, {
      production: { ...makePromotion(1).production, stage: 2.5 },
    });
    expect(issuePaths(PromotionSchema, promotion)).toEqual(['production.stage']);
  });

  it.each(['ab', 'A', 'ABCDEFGHI', 'AB-1'])('rejects shortName %j', (shortName) => {
    expect(issuePaths(PromotionSchema, makePromotion(1, { shortName }))).toEqual(['shortName']);
  });

  it.each(['AB', 'RB2026', 'ABCDEFGH'])('accepts shortName %j', (shortName) => {
    expect(parseIssues(PromotionSchema, makePromotion(1, { shortName }))).toEqual([]);
  });

  it('rejects a human controller with an empty player ID', () => {
    const promotion = makePromotion(1, { controller: { kind: 'human', playerId: '' } });
    expect(issuePaths(PromotionSchema, promotion)).toEqual(['controller.playerId']);
  });

  it('rejects an explicit zero in regionalPop', () => {
    const promotion = makePromotion(1, { regionalPop: { [testId('region', 2)]: 0 } });
    expect(issuePaths(PromotionSchema, promotion)).toEqual([`regionalPop.${testId('region', 2)}`]);
  });

  it('rejects a regionalPop key that is not a region ID', () => {
    const promotion = makePromotion(1, { regionalPop: { [testId('person', 2)]: 10 } });
    expect(PromotionSchema.safeParse(promotion).success).toBe(false);
  });

  it('rejects a policy tier outside 0-3', () => {
    const promotion = { ...makePromotion(1), policies: { catering: 4, travel: 0, medical: 0 } };
    expect(issuePaths(PromotionSchema, promotion)).toEqual(['policies.catering']);
  });

  it('rejects a colour that is not #rrggbb', () => {
    expect(issuePaths(PromotionSchema, makePromotion(1, { color: '#abc' }))).toEqual(['color']);
  });

  it('accepts every promotion style and rejects an unknown one', () => {
    for (const style of PROMOTION_STYLES) {
      expect(parseIssues(PromotionSchema, makePromotion(1, { style }))).toEqual([]);
    }
    expect(issuePaths(PromotionSchema, { ...makePromotion(1), style: 'lucha' })).toEqual(['style']);
  });

  it('rejects an unknown field', () => {
    expect(PromotionSchema.safeParse({ ...makePromotion(1), playerOwned: true }).success).toBe(
      false,
    );
  });
});

describe('BrandSchema', () => {
  it('accepts a brand with controller null', () => {
    expect(parseIssues(BrandSchema, makeBrand(1, 1, { controller: null }))).toEqual([]);
  });

  it('accepts a brand with its own human controller', () => {
    const brand = makeBrand(1, 1, { controller: { kind: 'human', playerId: 'player-2' } });
    expect(parseIssues(BrandSchema, brand)).toEqual([]);
  });

  it('rejects a negative priority and a name over 40 characters', () => {
    expect(issuePaths(BrandSchema, makeBrand(1, 1, { priority: -1 }))).toEqual(['priority']);
    expect(issuePaths(BrandSchema, makeBrand(1, 1, { name: 'B'.repeat(41) }))).toEqual(['name']);
  });
});

describe('findParentCycles', () => {
  const first = testId('promotion', 1);
  const second = testId('promotion', 2);
  const third = testId('promotion', 3);

  it('finds nothing in a chain without loops', () => {
    const parents = new Map([
      [first, null],
      [second, first],
      [third, second],
    ]);
    expect(findParentCycles(parents)).toEqual([]);
  });

  it('reports a loop once, starting from its smallest ID', () => {
    const parents = new Map([
      [third, second],
      [second, third],
      [first, third],
    ]);
    expect(findParentCycles(parents)).toEqual([[second, third]]);
  });

  it('stops at a parent that is not in the map', () => {
    expect(findParentCycles(new Map([[first, second]]))).toEqual([]);
  });
});

describe('promotion and brand tables in a world', () => {
  it('a valid world has no integrity issues', () => {
    const report = checkWorld(validCompanyWorld(), COMPANY_REGISTRY, { validateRows: true });
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports a promotion parent cycle A -> B -> A', () => {
    const world = validCompanyWorld();
    world.tables.promotions._put(
      makePromotion(1, {
        parentPromotionId: testId('promotion', 2),
        controller: { kind: 'human', playerId: 'player-1' },
      }),
    );
    const report = checkWorld(world, COMPANY_REGISTRY, { only: ['invariants'] });
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'promotions.parentCycle',
        table: 'promotions',
        id: testId('promotion', 1),
        path: 'parentPromotionId',
      }),
    ]);
  });

  it('reports a human controller whose player is not in the world', () => {
    const world = validCompanyWorld();
    world.tables.brands._put(
      makeBrand(3, 1, { controller: { kind: 'human', playerId: 'someone-else' } }),
    );
    const report = checkWorld(world, COMPANY_REGISTRY, { only: ['refs'] });
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.unknownPlayer',
        table: 'brands',
        id: testId('brand', 3),
        path: 'controller.playerId',
        missingId: 'someone-else',
      }),
    ]);
  });

  it('reports a missing home region and a missing owner', () => {
    const world = validCompanyWorld();
    world.tables.promotions._put(
      makePromotion(3, {
        homeRegionId: testId('region', 9),
        regionalPop: {},
        ownerPersonId: testId('person', 99),
      }),
    );
    const report = checkWorld(world, COMPANY_REGISTRY, { only: ['refs'] });
    expect(report.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['ref.dangling', 'homeRegionId'],
      ['ref.dangling', 'ownerPersonId'],
    ]);
  });

  it('indexes promotions by status and brands by promotion', () => {
    const world = validCompanyWorld();
    world.tables.promotions._put(makePromotion(3, { status: 'dormant' }));
    expect(world.tables.promotions.lookup('byStatus', 'dormant').map((row) => row.id)).toEqual([
      testId('promotion', 3),
    ]);
    expect(
      world.tables.brands.lookup('byPromotion', testId('promotion', 2)).map((row) => row.id),
    ).toEqual([testId('brand', 2)]);
  });
});

describe('reference fields', () => {
  it.each([promotionsTable, brandsTable])('$name declares every ID field as a ref', (table) => {
    const declared = new Set(table.refs.map((spec) => spec.path));
    const undeclared = referenceFieldPaths(table.schema).filter((path) => !declared.has(path));
    expect(undeclared).toEqual([]);
  });

  it('promotions and brands carry a controller; the registry has the six company tables', () => {
    expect(Object.keys(PromotionSchema.shape)).toContain('controller');
    expect(Object.keys(BrandSchema.shape)).toContain('controller');
    expect(Object.keys(TABLES)).toEqual(
      expect.arrayContaining([
        'promotions',
        'brands',
        'employments',
        'teams',
        'stables',
        'relationships',
      ]),
    );
  });
});
