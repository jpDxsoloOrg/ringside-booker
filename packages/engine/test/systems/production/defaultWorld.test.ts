// The popularity ceiling in the default world (ECO7-01). Design:
// docs/design/production.md#popularity-ceiling
import { describe, expect, it } from 'vitest';
import { popularityCeiling, popularityDrag } from '../../../src/systems/production';
import { createEngineTunables } from '../../../src/systems/tunables';
import { loadDefaultWorld } from '../workers/default-world';

describe('the popularity ceiling in the default world', () => {
  const world = loadDefaultWorld();
  const tunables = createEngineTunables();
  const regionNames = new Map<string, string>(
    world.tables.regions.values().map((region) => [region.id, region.name]),
  );

  it('starts no active promotion above its ceiling in any region', () => {
    const over: string[] = [];
    const active = world.tables.promotions.values().filter((row) => row.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    for (const promotion of active) {
      const ceiling = popularityCeiling(
        {
          promotionName: promotion.name,
          marketing: promotion.production.marketing,
          backOffice: promotion.production.backOffice,
        },
        { tunables },
      );
      for (const [regionId, popularity] of Object.entries(promotion.regionalPop)) {
        const regionName = regionNames.get(regionId) ?? regionId;
        const drag = popularityDrag({ regionName, popularity, ceiling }, { tunables });
        if (popularity > ceiling.value || drag.value > 0) {
          over.push(
            `${promotion.name} in ${regionName}: popularity ${String(popularity)} over ceiling ${String(ceiling.value)}`,
          );
        }
      }
    }
    expect(over).toEqual([]);
  });

  it('gives Hardpan 30 and Altura 95', () => {
    const ceilingOf = (name: string) => {
      const promotion = world.tables.promotions.values().find((row) => row.name.startsWith(name));
      if (promotion === undefined) {
        throw new Error(`The default world has no promotion called ${name}`);
      }
      return popularityCeiling(
        {
          promotionName: promotion.name,
          marketing: promotion.production.marketing,
          backOffice: promotion.production.backOffice,
        },
        { tunables },
      ).value;
    };
    expect(ceilingOf('Hardpan')).toBe(30);
    expect(ceilingOf('Altura')).toBe(95);
  });
});
