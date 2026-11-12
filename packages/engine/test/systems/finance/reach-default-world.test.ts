// The default world's tiers as company sizes. Design: docs/design/finances.md#reach-and-size and
// docs/design/default-world.md#tier-values
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import { reachOf, type PromotionSize } from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectTraceReplays } from '../../support/trace';
import { loadDefaultWorld } from '../workers/default-world';

/** The tier table in default-world.md, by name, highest tier first. */
const TIERS: readonly {
  tier: string;
  sizes: readonly PromotionSize[];
  names: readonly string[];
}[] = [
  { tier: 'Flagship', sizes: ['continental', 'global'], names: ['Altura'] },
  { tier: 'National', sizes: ['national'], names: ['Tessen', 'Cielo Alto'] },
  {
    tier: 'Regional',
    sizes: ['regional'],
    names: ['Longleaf', 'Blast Furnace', 'Golden Poppy', 'Boreal', 'Ashlar', 'Eisenwerk'],
  },
  { tier: 'Local', sizes: ['local'], names: ['Hardpan', 'Hibari', 'Wattle'] },
];

describe('reach and size in the default world', () => {
  const world = loadDefaultWorld();
  const tunables = createEngineTunables();
  const promotions = world.tables.promotions.values();
  const reachByName = (name: string) => {
    const promotion = promotions.find((row) => row.name.startsWith(name));
    if (promotion === undefined) {
      throw new Error(`The default world has no promotion called ${name}`);
    }
    return reachOf(world, promotion.id, tunables);
  };

  it('covers every promotion in the tier table', () => {
    const listed = TIERS.flatMap((tier) => tier.names);
    expect(listed).toHaveLength(promotions.length);
    for (const name of listed) {
      expect(() => reachByName(name), name).not.toThrow();
    }
  });

  for (const { tier, sizes, names } of TIERS) {
    it(`gives the ${tier} tier the size ${sizes.join(' or ')}`, () => {
      for (const name of names) {
        expect(sizes, name).toContain(reachByName(name).size.value);
      }
    });
  }

  it("puts every tier's lowest reach above the next tier's highest", () => {
    const ranges = TIERS.map(({ names }) => names.map((name) => reachByName(name).reach.value));
    for (let index = 0; index + 1 < ranges.length; index += 1) {
      const lowest = Math.min(...(ranges[index] ?? []));
      const nextHighest = Math.max(...(ranges[index + 1] ?? []));
      expect(lowest, TIERS[index]?.tier).toBeGreaterThan(nextHighest);
    }
  });

  it('keeps the whole Why? (division and clamp included) within the trace limits', () => {
    for (const promotion of promotions) {
      const { reach } = reachOf(world, promotion.id, tunables);
      expectTraceReplays(reach);
      const steps = (reach.trace.children ?? []).map((node) => node.label);
      expect(steps, promotion.name).toContain('Divided by the total of the weights');
      expect(steps.at(-1), promotion.name).toBe('Kept between 0 and 100');
      // The home country line drills down to the regions.
      expect(findTraceNodes(reach.trace, 'input').some((node) => node.ref?.kind === 'region')).toBe(
        true,
      );
    }
  });
});
