// Property checks on seeded random cases: card value counts popularity in the promotion's markets
// only (D-03). Design: docs/design/rival-desk.md#card-value
import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../../src/core/ids';
import { floatBetween, intBetween, pick, RngRegistry } from '../../../src/core/rng';
import { ATTRIBUTE_KEYS } from '../../../src/model/entities/person';
import { PROMOTION_STYLES } from '../../../src/model/entities/promotion-style';
import { cardValue, defaultTaste, type CardValueInputs } from '../../../src/systems/aip';
import { createEngineTunables } from '../../../src/systems/tunables';
import { attributesOf, testRegions } from '../workers/push-fixtures';

const CASES = 300;
const tunables = createEngineTunables();
const regions = testRegions(8);
const marketMinPop = tunables.get('aip.cardValue.marketMinPop');

/** A seeded stream per property. Any registered stream name does; the seed is what sets the cases. */
function casesFor(seed: string) {
  return new RngRegistry(seed).stream('worldgen.people.popularity');
}

type Stream = ReturnType<typeof casesFor>;

/** A random case whose first region is always a market, so the markets are never widened. */
function randomCase(stream: Stream): CardValueInputs {
  const promotionPop: Partial<Record<RegionId, number>> = {};
  const workerPop: Partial<Record<RegionId, number>> = {};
  for (const [index, region] of regions.entries()) {
    const popularity =
      index === 0 ? intBetween(stream, marketMinPop, 90) : intBetween(stream, 0, 60);
    if (popularity > 0) {
      promotionPop[region.id] = popularity;
    }
    const known = intBetween(stream, 0, 80);
    if (known > 0) {
      workerPop[region.id] = known;
    }
  }
  const attributes = attributesOf(0);
  for (const key of ATTRIBUTE_KEYS) {
    attributes[key] = floatBetween(stream, 0, 100);
  }
  return {
    workerName: 'Test Person 001',
    promotionName: 'Test Promotion A',
    workerPop,
    promotionPop,
    regions,
    attributes,
    momentum: intBetween(stream, 0, 1) === 0 ? null : intBetween(stream, -50, 50),
    age: intBetween(stream, 18, 50),
    taste: defaultTaste({ style: pick(stream, PROMOTION_STYLES) }, { tunables }),
  };
}

function isMarket(inputs: CardValueInputs, regionId: RegionId): boolean {
  return (inputs.promotionPop[regionId] ?? 0) >= marketMinPop;
}

describe('card value markets', () => {
  it('raising popularity in a market never lowers card value', () => {
    const stream = casesFor('aip-card-value-market');
    let moved = 0;
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const inputs = randomCase(stream);
      const markets = regions.filter((region) => isMarket(inputs, region.id));
      const raised = pick(stream, markets).id;
      const current = inputs.workerPop[raised] ?? 0;
      const higher = { ...inputs.workerPop, [raised]: intBetween(stream, current, 100) };
      const before = cardValue(inputs, { tunables }).value;
      const after = cardValue({ ...inputs, workerPop: higher }, { tunables }).value;
      expect(after).toBeGreaterThanOrEqual(before);
      moved += after === before ? 0 : 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('raising popularity outside the markets never changes card value', () => {
    const stream = casesFor('aip-card-value-elsewhere');
    let checked = 0;
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const inputs = randomCase(stream);
      const elsewhere = regions.filter((region) => !isMarket(inputs, region.id));
      if (elsewhere.length === 0) {
        continue;
      }
      const raised = pick(stream, elsewhere).id;
      const current = inputs.workerPop[raised] ?? 0;
      const higher = { ...inputs.workerPop, [raised]: intBetween(stream, current, 100) };
      const before = cardValue(inputs, { tunables }).value;
      const after = cardValue({ ...inputs, workerPop: higher }, { tunables }).value;
      expect(after).toBe(before);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(CASES / 2);
  });
});
