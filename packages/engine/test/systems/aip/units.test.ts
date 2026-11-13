// Which promotions and brands the computer runs (AIP1-01). Design: docs/design/rival-desk.md#units
import { describe, expect, it } from 'vitest';
import { aiUnitKey } from '../../../src/model/entities/ai-profile';
import { computerUnits, unitControllerOf, unitCovers } from '../../../src/systems/aip';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;

/**
 * - A: human promotion; brand 0 run by the promotion, brand 1 a computer GM brand, brand 2 an
 *   inactive computer brand;
 * - B: computer promotion; brand 3 run by the promotion, brand 4 a human-run brand;
 * - C: computer promotion, dormant; D: computer promotion, closed.
 */
function unitsWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: HUMAN }, (promotion) =>
      promotion
        .withBrand({ controller: null })
        .withBrand({ controller: COMPUTER })
        .withBrand({ controller: COMPUTER, active: false }),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withBrand({ controller: null }).withBrand({ controller: HUMAN }),
    )
    .withPromotion({ controller: COMPUTER, status: 'dormant' })
    .withPromotion({ controller: COMPUTER, status: 'closed' })
    .build();
}

function brand(built: BuiltWorld, index: number) {
  const id = built.ids.brands[index];
  if (id === undefined) {
    throw new Error(`no brand ${String(index)}`);
  }
  return id;
}

function promotion(built: BuiltWorld, label: 'A' | 'B' | 'C' | 'D') {
  const id = built.ids.promotions[label];
  if (id === undefined) {
    throw new Error(`no promotion ${label}`);
  }
  return id;
}

describe('computerUnits', () => {
  it('lists computer promotions and computer brands of human promotions, sorted by key', () => {
    const built = unitsWorld();
    const units = computerUnits(built.world);
    const proA = promotion(built, 'A');
    const proB = promotion(built, 'B');
    const proC = promotion(built, 'C');
    expect(units).toEqual(
      [
        {
          promotionId: proA,
          brandId: brand(built, 1),
          key: aiUnitKey(proA, brand(built, 1)),
          excludedBrandIds: [],
        },
        {
          promotionId: proB,
          brandId: null,
          key: aiUnitKey(proB, null),
          excludedBrandIds: [brand(built, 4)],
        },
        { promotionId: proC, brandId: null, key: aiUnitKey(proC, null), excludedBrandIds: [] },
      ].sort((left, right) => (left.key < right.key ? -1 : 1)),
    );
  });

  it('leaves out the human promotion, its own brands and closed promotions', () => {
    const built = unitsWorld();
    const keys = computerUnits(built.world).map((unit) => unit.key);
    expect(keys).not.toContain(aiUnitKey(promotion(built, 'A'), null));
    expect(keys).not.toContain(aiUnitKey(promotion(built, 'A'), brand(built, 0)));
    expect(keys).not.toContain(aiUnitKey(promotion(built, 'A'), brand(built, 2)));
    expect(keys).not.toContain(aiUnitKey(promotion(built, 'D'), null));
  });

  it('does not make a null-controller brand of a computer promotion its own unit', () => {
    const built = unitsWorld();
    const keys = computerUnits(built.world).map((unit) => unit.key);
    expect(keys).not.toContain(aiUnitKey(promotion(built, 'B'), brand(built, 3)));
  });
});

describe('unitControllerOf', () => {
  it("uses the brand's own controller when it has one, else the promotion's", () => {
    const built = unitsWorld();
    const proA = promotion(built, 'A');
    const proB = promotion(built, 'B');
    expect(unitControllerOf(built.world, proA, null)).toEqual(HUMAN);
    expect(unitControllerOf(built.world, proA, brand(built, 0))).toEqual(HUMAN);
    expect(unitControllerOf(built.world, proA, brand(built, 1))).toEqual(COMPUTER);
    expect(unitControllerOf(built.world, proB, brand(built, 3))).toEqual(COMPUTER);
    expect(unitControllerOf(built.world, proB, brand(built, 4))).toEqual(HUMAN);
  });
});

describe('unitCovers', () => {
  it("keeps a computer promotion's unit off its human-run brand", () => {
    const built = unitsWorld();
    const proB = promotion(built, 'B');
    const unit = computerUnits(built.world).find(
      (candidate) => candidate.key === aiUnitKey(proB, null),
    );
    if (unit === undefined) {
      throw new Error('no unit for B');
    }
    expect(unitCovers(unit, proB, null)).toBe(true);
    expect(unitCovers(unit, proB, brand(built, 3))).toBe(true);
    expect(unitCovers(unit, proB, brand(built, 4))).toBe(false);
    expect(unitCovers(unit, promotion(built, 'A'), null)).toBe(false);
  });

  it('keeps a computer GM brand to its own brand', () => {
    const built = unitsWorld();
    const proA = promotion(built, 'A');
    const unit = computerUnits(built.world).find((candidate) => candidate.promotionId === proA);
    if (unit === undefined) {
      throw new Error('no unit in A');
    }
    expect(unitCovers(unit, proA, brand(built, 1))).toBe(true);
    expect(unitCovers(unit, proA, brand(built, 0))).toBe(false);
    expect(unitCovers(unit, proA, null)).toBe(false);
  });
});
