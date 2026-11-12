// Show reach. Design: docs/design/promotion-popularity.md#show-reach
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import {
  showReach,
  type ReachDealInput,
  type ShowReach,
  type ShowReachInputs,
} from '../../../src/systems/promoPop';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { dealId, networkId, region } from './fixtures';

const DEFAULTS = createEngineTunables();

const texas = region('1', 'Texas');
const oklahoma = region('2', 'Oklahoma');
const louisiana = region('3', 'Louisiana');
const ohio = region('4', 'Ohio');
const maine = region('5', 'Maine');

function nationalDeal(reachTier: ReachDealInput['reachTier'] = 4): ReachDealInput {
  return {
    dealId: dealId('1'),
    networkId: networkId('1'),
    networkName: 'National Signal Network',
    reachTier,
    regions: [texas, oklahoma, louisiana, ohio, maine],
  };
}

function untelevised(): ShowReachInputs {
  return { showRegion: texas, neighbours: [oklahoma, louisiana], deals: [] };
}

function weights(reach: ShowReach): Record<string, number> {
  return Object.fromEntries(reach.regions.map((row) => [row.regionName, row.weight.value]));
}

function checkTraces(reach: ShowReach): void {
  expectSerialisable(reach);
  for (const row of reach.regions) {
    expectTraceReplays(row.weight);
  }
}

function reachWith(inputs: ShowReachInputs, tunables: EngineTunables = DEFAULTS): ShowReach {
  const reach = showReach(inputs, { tunables });
  checkTraces(reach);
  return reach;
}

describe('showReach', () => {
  it('reaches the show region and its neighbours only when the show is not televised', () => {
    const reach = reachWith(untelevised());
    expect(weights(reach)).toEqual({ Texas: 1, Oklahoma: 0.5, Louisiana: 0.5 });
    expect(reach.regions.map((row) => row.source)).toEqual(['show', 'neighbour', 'neighbour']);
    expect(reach.regions.every((row) => row.networkId === null)).toBe(true);
    expect(reach.regions[1]?.label).toBe('Neighbour of Texas');
    const neighbourLines = findTraceNodes(reach.regions[1]!.weight.trace, 'max');
    expect(neighbourLines.map((node) => node.label)).toEqual(['Neighbour of Texas × 0.5']);
  });

  it('reaches every region a tier-4 deal covers at 0.6', () => {
    const reach = reachWith({ showRegion: texas, neighbours: [], deals: [nationalDeal()] });
    expect(weights(reach)).toEqual({
      Texas: 1,
      Oklahoma: 0.6,
      Louisiana: 0.6,
      Ohio: 0.6,
      Maine: 0.6,
    });
    const ohioRow = reach.regions.find((row) => row.regionName === 'Ohio');
    expect(ohioRow).toMatchObject({
      source: 'tv',
      networkId: networkId('1'),
      label: 'TV: National Signal Network',
    });
    expect(findTraceNodes(ohioRow!.weight.trace, 'max').map((node) => node.label)).toEqual([
      'TV: National Signal Network, reach tier 4 × 0.6',
    ]);
  });

  it('gives a neighbour also on TV the larger weight, with both routes in its trace', () => {
    const reach = reachWith({ ...untelevised(), deals: [nationalDeal()] });
    const oklahomaRow = reach.regions.find((row) => row.regionName === 'Oklahoma')!;
    expect(oklahomaRow.weight.value).toBe(0.6);
    expect(oklahomaRow.source).toBe('tv');
    const trace = oklahomaRow.weight.trace;
    expect(findTraceNodes(trace, 'max').map((node) => node.label)).toEqual([
      'Neighbour of Texas × 0.5',
      'TV: National Signal Network, reach tier 4 × 0.6',
    ]);
    expect(findTraceNodes(trace, 'note').map((node) => node.label)).toContain(
      'Reached several ways: the strongest counts',
    );
    expect(findTraceNodes(trace, 'min')[0]).toMatchObject({ label: 'Full reach', applied: false });
  });

  it('keeps the show region at 1 even when it is also a neighbour and on TV', () => {
    const reach = reachWith({
      showRegion: texas,
      neighbours: [texas, oklahoma],
      deals: [nationalDeal()],
    });
    const [first] = reach.regions;
    expect(first).toMatchObject({ regionName: 'Texas', source: 'show', networkId: null });
    expect(first?.weight.value).toBe(1);
    expect(first?.label).toBe('Show region');
  });

  it('takes the larger tier when two deals cover one region', () => {
    const regional: ReachDealInput = {
      dealId: dealId('2'),
      networkId: networkId('2'),
      networkName: 'Gulf Coast Sports',
      reachTier: 1,
      regions: [ohio],
    };
    const strong: ReachDealInput = { ...nationalDeal(3), regions: [ohio] };
    const reach = reachWith({ showRegion: texas, neighbours: [], deals: [regional, strong] });
    const ohioRow = reach.regions.find((row) => row.regionName === 'Ohio')!;
    expect(ohioRow.weight.value).toBe(0.45);
    expect(ohioRow.networkId).toBe(networkId('1'));
    expect(findTraceNodes(ohioRow.weight.trace, 'max')).toHaveLength(2);
  });

  it('drops neighbours when neighbour reach is 0', () => {
    const tunables = createEngineTunables({ 'promoPop.neighbourReach': 0 });
    expect(weights(reachWith(untelevised(), tunables))).toEqual({ Texas: 1 });
    const televised = reachWith({ ...untelevised(), deals: [nationalDeal(2)] }, tunables);
    expect(weights(televised).Oklahoma).toBe(0.3);
  });

  it('drops the TV regions when their tier reach is 0', () => {
    const tunables = createEngineTunables({ 'promoPop.tvReach.tier4': 0 });
    const reach = reachWith({ ...untelevised(), deals: [nationalDeal()] }, tunables);
    expect(weights(reach)).toEqual({ Texas: 1, Oklahoma: 0.5, Louisiana: 0.5 });
  });

  it('orders the show region first, then by weight, then by region id', () => {
    const tierOne: ReachDealInput = { ...nationalDeal(1), regions: [maine, ohio] };
    const reach = reachWith({
      showRegion: texas,
      neighbours: [louisiana, oklahoma],
      deals: [tierOne],
    });
    expect(reach.regions.map((row) => row.regionName)).toEqual([
      'Texas',
      'Oklahoma',
      'Louisiana',
      'Ohio',
      'Maine',
    ]);
  });
});
