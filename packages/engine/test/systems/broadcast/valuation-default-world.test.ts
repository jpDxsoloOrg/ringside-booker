// Deal valuation on the shipped default world (ECO8-03): Altura's shipped deals value close to
// their shipped terms, and Hardpan sees the Texas networks and the right verdicts.
// Design: docs/design/broadcast.md#valuation
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine, type EngineState, type Viewer } from '../../../src/core/api';
import type { EventDefinitionId, NetworkId, PromotionId } from '../../../src/core/ids';
import { coveredRegionIds } from '../../../src/model/entities/network';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import {
  dealValuation,
  type DealRefusalCode,
  type DealValuation,
  type NetworkRow,
} from '../../../src/systems/broadcast';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';
import { startDefaultGame } from '../calendar/default-game';

const TUNABLES = createEngineTunables();
const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'local-player' },
};

interface Game {
  readonly state: EngineState;
  readonly read: GameWorldView;
  readonly engine: Engine;
}

function startAs(promotionKey: string): Game {
  const state = startDefaultGame({ player: { mode: 'existing', promotionKey } });
  return {
    state,
    read: documentToWorld({ state: { world: state.world } }, TABLES),
    engine: createEngine({ state, systems: defaultSystems }),
  };
}

let altura: Game;
let hardpan: Game;

beforeAll(() => {
  altura = startAs('pro-flagship');
  hardpan = startAs('pro-us-texas-indie');
});

function promotionNamed(read: GameWorldView, prefix: string): PromotionId {
  const found = read.tables.promotions.values().find((row) => row.name.startsWith(prefix));
  if (found === undefined) throw new Error(`No promotion named ${prefix}`);
  return found.id;
}

function networkNamed(read: GameWorldView, name: string): NetworkId {
  const found = read.tables.networks.values().find((row) => row.name === name);
  if (found === undefined) throw new Error(`No network named ${name}`);
  return found.id;
}

function showNamed(read: GameWorldView, name: string): EventDefinitionId {
  const found = read.tables.eventDefinitions.values().find((row) => row.name === name);
  if (found === undefined) throw new Error(`No show named ${name}`);
  return found.id;
}

function codes(valuation: DealValuation): DealRefusalCode[] {
  return valuation.refusals.map((refusal) => refusal.code);
}

describe("Altura's shipped deals", () => {
  it('values each shipped deal in its own slot as accepted, near the shipped terms', () => {
    const { read } = altura;
    const promotionId = promotionNamed(read, 'Szn League');
    const deals = read.tables.deals.lookup('byPromotion', promotionId);
    expect(deals).toHaveLength(3);
    for (const deal of deals) {
      const network = read.tables.networks.require(deal.networkId);
      const valuation = dealValuation(read, TUNABLES, {
        promotionId,
        networkId: deal.networkId,
        eventDefinitionId: deal.eventDefinitionId,
        timeslot: deal.timeslot,
        live: deal.live,
        months: 24,
        excludeDealId: deal.id,
      });
      expect({ network: network.name, refusals: valuation.refusals }).toEqual({
        network: network.name,
        refusals: [],
      });
      expect(valuation.verdict).toBe('accept');
      const [offered, shipped] =
        network.kind === 'ppv'
          ? [valuation.terms.perThousandViewers.value, deal.terms.perThousandViewers]
          : [valuation.terms.feePerShow.value, deal.terms.feePerShow];
      expect(offered / shipped, network.name).toBeGreaterThanOrEqual(0.5);
      expect(offered / shipped, network.name).toBeLessThanOrEqual(2);
      expectTraceReplays(valuation.incomePerAiring);
      expectSerialisable(valuation);
    }
  });

  it('collides with itself when the deal being renegotiated is not left out', () => {
    const { read } = altura;
    const promotionId = promotionNamed(read, 'Szn League');
    const mainstage = showNamed(read, 'Mayhem Monday');
    const valuation = dealValuation(read, TUNABLES, {
      promotionId,
      networkId: networkNamed(read, 'National Signal Network'),
      eventDefinitionId: mainstage,
      timeslot: 'primeTime',
      live: true,
      months: 24,
    });
    expect(codes(valuation)).toEqual(['alreadyOnNetwork']);
  });

  it('gives the same verdict, terms and traces every time', () => {
    const { read } = altura;
    const request = {
      promotionId: promotionNamed(read, 'Szn League'),
      networkId: networkNamed(read, 'Kestrel Sports'),
      eventDefinitionId: showNamed(read, 'Mayhem Monday'),
      timeslot: 'evening',
      live: false,
      months: 12,
    } as const;
    expect(dealValuation(read, TUNABLES, request)).toStrictEqual(
      dealValuation(read, TUNABLES, request),
    );
  });
});

describe('Hardpan', () => {
  function hardpanFriday(network: string, timeslot: 'evening' | 'primeTime'): DealValuation {
    const { read } = hardpan;
    return dealValuation(read, TUNABLES, {
      promotionId: promotionNamed(read, 'Hardpan'),
      networkId: networkNamed(read, network),
      eventDefinitionId: showNamed(read, 'Hardpan Friday'),
      timeslot,
      live: false,
      months: 12,
    });
  }

  it('lists only networks that reach Texas, the local Texas channel among them', () => {
    const { read, engine } = hardpan;
    const result = engine.query(
      'broadcast.networks',
      { promotionId: promotionNamed(read, 'Hardpan') },
      PLAYER,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.reasons));
    const rows: NetworkRow[] = result.data;
    const texas = read.tables.regions.values().find((region) => region.name === 'Texas');
    if (texas === undefined) throw new Error('No Texas');
    for (const row of rows) {
      const network = read.tables.networks.require(row.networkId);
      expect(coveredRegionIds(network, read), row.name).toContain(texas.id);
    }
    const names = rows.map((row) => row.name);
    expect(names).toContain('Bluebonnet Cable 7');
    for (const foreign of [
      'Heathland Television',
      'Kazamidori Television',
      'Televisora Altiplano',
      'Ruhrblick TV',
      'Wattlebird Community TV',
    ]) {
      expect(names).not.toContain(foreign);
    }
    // Sorted by tier, then name.
    const tiers = rows.map((row) => row.reachTier);
    expect(tiers).toEqual([...tiers].sort((left, right) => left - right));
    expect(rows.find((row) => row.name === 'Bluebonnet Cable 7')?.coverageLabel).toBe('Texas');
    expect(rows.find((row) => row.name === 'National Signal Network')?.coverageLabel).toBe(
      'United States',
    );
    expectSerialisable(rows);
  });

  it('gets a yes from the Texas channel for Hardpan Friday, which becomes a TV show', () => {
    const valuation = hardpanFriday('Bluebonnet Cable 7', 'evening');
    expect(valuation.verdict).toBe('accept');
    expect(valuation.becomesTelevised).toBe(true);
    expect(valuation.weekday).toBe(4);
    expect(valuation.projectedViewers.value).toBeGreaterThan(1_000);
    expect(valuation.terms.feePerShow.value).toBeGreaterThan(0);
    expectTraceReplays(valuation.projectedViewers);
  });

  it('is refused by National Signal Network for audience, camera and prime time', () => {
    const valuation = hardpanFriday('National Signal Network', 'primeTime');
    expect(valuation.verdict).toBe('refuse');
    expect(codes(valuation)).toEqual(
      expect.arrayContaining(['audienceTooSmall', 'cameraTooLow', 'timeslotNotAllowed']),
    );
  });

  it('is refused by the Southwest regional channel: a regional deal can still be too big', () => {
    const valuation = hardpanFriday('Caliche Country Sports', 'evening');
    expect(valuation.verdict).toBe('refuse');
    expect(codes(valuation)).toContain('audienceTooSmall');
  });
});
