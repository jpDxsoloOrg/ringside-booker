// The audience helper's world reads (ECO8-02): coverage regions, sparse popularity, marketing,
// the hype seam, and the projection and benchmark helpers built on them.
// Design: docs/design/broadcast.md#audience.
import { describe, expect, it } from 'vitest';
import type { RegionId } from '../../../src/core/ids';
import { coveredRegionIds } from '../../../src/model/entities/network';
import {
  audience,
  audienceInputsFor,
  benchmarkFor,
  benchmarkInputsFor,
  broadcastHypeFor,
  networkBenchmark,
  projectedAudience,
} from '../../../src/systems/broadcast';
import { createEngineTunables } from '../../../src/systems/tunables';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

const TUNABLES = createEngineTunables();

/** A world on the mini map with one network covering it all and a promotion popular in one region. */
function popularIn(popularity: number, marketing = 4): { built: BuiltWorld; regionId: RegionId } {
  const shell = worldBuilder().withGeography('mini').build();
  const regionId = shell.world.tables.regions.ids()[0];
  if (regionId === undefined) {
    throw new Error('The mini map has no regions');
  }
  const built = worldBuilder()
    .withGeography('mini')
    .withNetwork({ name: 'Test TV', kind: 'tv', reachTier: 3 })
    .withPromotion({
      regionalPop: { [regionId]: popularity },
      production: { marketing },
    })
    .build();
  return { built, regionId };
}

function request(built: BuiltWorld) {
  const promotionId = built.ids.promotions.A;
  const networkId = built.ids.networks[0];
  if (promotionId === undefined || networkId === undefined) {
    throw new Error('The test world has no promotion or network');
  }
  return {
    promotionId,
    networkId,
    timeslot: 'evening',
    live: true,
    importance: 'regular',
  } as const;
}

describe('audienceInputsFor', () => {
  it("reads every covered region, the promotion's sparse popularity and its marketing", () => {
    const { built, regionId } = popularIn(55, 7);
    const { world } = built;
    const inputs = audienceInputsFor(world, TUNABLES, request(built));
    const network = world.tables.networks.require(request(built).networkId);
    expect(inputs.regions).toHaveLength(coveredRegionIds(network, world).length);
    const popular = inputs.regions.filter((region) => region.popularity > 0);
    expect(popular).toHaveLength(1);
    const region = world.tables.regions.require(regionId);
    expect(popular[0]).toMatchObject({
      regionName: region.name,
      population: region.population,
      wrestlingInterest: region.wrestlingInterest,
      countryName: world.tables.countries.require(region.countryId).name,
      popularity: 55,
    });
    expect(inputs).toMatchObject({
      networkName: 'Test TV',
      reachTier: 3,
      kind: 'tv',
      timeslot: 'evening',
      live: true,
      importance: 'regular',
      marketingLevel: 7,
      hype: null,
      quality: null,
      swing: false,
    });
  });

  it('passes a show quality through, and leaves hype to the seam (null until ECO3)', () => {
    const { built } = popularIn(40);
    const quality = { score: 72, source: 'show' } as const;
    const inputs = audienceInputsFor(built.world, TUNABLES, { ...request(built), quality });
    expect(inputs.quality).toEqual(quality);
    expect(broadcastHypeFor(built.world, TUNABLES, request(built).promotionId, null)).toBeNull();
  });

  it('projects with the audience formula, and draws more for a more popular promotion', () => {
    const { built } = popularIn(40);
    const projected = projectedAudience(built.world, TUNABLES, request(built));
    const direct = audience(audienceInputsFor(built.world, TUNABLES, request(built)), {
      tunables: TUNABLES,
    });
    expect(projected).toEqual(direct);
    expect(projected.value).toBeGreaterThan(0);
    const bigger = popularIn(80).built;
    expect(projectedAudience(bigger.world, TUNABLES, request(bigger)).value).toBeGreaterThan(
      projected.value,
    );
  });

  it('gives the same numbers on every call (nothing is kept between calls)', () => {
    const { built } = popularIn(40);
    const first = projectedAudience(built.world, TUNABLES, request(built));
    benchmarkFor(built.world, TUNABLES, request(built));
    expect(projectedAudience(built.world, TUNABLES, request(built))).toEqual(first);
  });

  it('refuses a house show', () => {
    const { built } = popularIn(40);
    expect(() =>
      projectedAudience(built.world, TUNABLES, { ...request(built), importance: 'house' }),
    ).toThrow(/house/);
  });
});

describe('benchmarkInputsFor', () => {
  it("reads the network's coverage and leaves the popularity to the benchmark", () => {
    const { built } = popularIn(40);
    const { networkId } = request(built);
    const slot = { networkId, timeslot: 'primeTime', importance: 'major' } as const;
    const inputs = benchmarkInputsFor(built.world, slot);
    expect(inputs.regions.every((region) => !('popularity' in region))).toBe(true);
    expect(inputs).toMatchObject({ networkName: 'Test TV', reachTier: 3, kind: 'tv' });
    expect(benchmarkFor(built.world, TUNABLES, slot)).toEqual(
      networkBenchmark(inputs, { tunables: TUNABLES }),
    );
  });
});
