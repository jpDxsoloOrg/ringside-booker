// The audience and the network benchmark on the shipped default world (ECO8-02): the calibration
// targets every default tunable is set for, and the trace limits on the world-wide networks.
// Design: docs/design/broadcast.md#calibration.
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineState } from '../../../src/core/api';
import type { NetworkId, PromotionId } from '../../../src/core/ids';
import type { Traced } from '../../../src/core/trace';
import {
  countTraceNodes,
  TRACE_MAX_DEPTH,
  TRACE_MAX_NODES,
  traceDepth,
} from '../../../src/core/trace/limits';
import type { DealTimeslot } from '../../../src/model/entities/deal';
import type { EventImportance } from '../../../src/model/entities/event-definition';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { benchmarkFor, projectedAudience } from '../../../src/systems/broadcast';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectTraceReplays } from '../../support/trace';
import { startDefaultGame } from '../calendar/default-game';

const TUNABLES = createEngineTunables();

let state: EngineState;
let read: GameWorldView;

beforeAll(() => {
  state = startDefaultGame();
  read = documentToWorld({ state: { world: state.world } }, TABLES);
});

function promotionNamed(prefix: string): PromotionId {
  const found = read.tables.promotions.values().find((row) => row.name.startsWith(prefix));
  if (found === undefined) {
    throw new Error(`No promotion named ${prefix}`);
  }
  return found.id;
}

function networkNamed(name: string): NetworkId {
  const found = read.tables.networks.values().find((row) => row.name === name);
  if (found === undefined) {
    throw new Error(`No network named ${name}`);
  }
  return found.id;
}

function importanceOf(show: string): EventImportance {
  const found = read.tables.eventDefinitions.values().find((row) => row.name === show);
  if (found === undefined) {
    throw new Error(`No show named ${show}`);
  }
  return found.importance;
}

interface Projection {
  readonly viewers: Traced<number>;
  readonly benchmark: Traced<number>;
  readonly ratio: number;
}

function project(
  promotion: string,
  show: string,
  network: string,
  timeslot: DealTimeslot,
  live: boolean,
): Projection {
  const networkId = networkNamed(network);
  const importance = importanceOf(show);
  const viewers = projectedAudience(read, TUNABLES, {
    promotionId: promotionNamed(promotion),
    networkId,
    timeslot,
    live,
    importance,
  });
  const benchmark = benchmarkFor(read, TUNABLES, { networkId, timeslot, importance });
  return { viewers, benchmark, ratio: viewers.value / benchmark.value };
}

describe('audience calibration on the default world', () => {
  it('puts Altura Mainstage on National Signal Network at 1.5M–4M, well above the benchmark', () => {
    const mainstage = project(
      'Szn League',
      'Altura Mainstage',
      'National Signal Network',
      'primeTime',
      true,
    );
    expect(mainstage.viewers.value).toBeGreaterThanOrEqual(1_500_000);
    expect(mainstage.viewers.value).toBeLessThanOrEqual(4_000_000);
    expect(mainstage.ratio).toBeGreaterThanOrEqual(1.1);
    expectTraceReplays(mainstage.viewers);
    expectTraceReplays(mainstage.benchmark);
  });

  it('puts Altura Overclock on Kestrel Sports at or above the benchmark', () => {
    const overclock = project(
      'Szn League',
      'Altura Overclock',
      'Kestrel Sports',
      'primeTime',
      true,
    );
    expect(overclock.ratio).toBeGreaterThanOrEqual(1);
  });

  it('sells Altura Showcase on Turnstile Pay-Per-View to 50k–400k buyers', () => {
    const showcase = project(
      'Szn League',
      'Altura Showcase',
      'Turnstile Pay-Per-View',
      'primeTime',
      true,
    );
    expect(showcase.viewers.value).toBeGreaterThanOrEqual(50_000);
    expect(showcase.viewers.value).toBeLessThanOrEqual(400_000);
  });

  it('starts every shipped deal at least 0.9 × its benchmark, so none starts at risk', () => {
    const deals = read.tables.deals.values().filter((deal) => deal.status === 'active');
    expect(deals.length).toBeGreaterThanOrEqual(7);
    const tessen = networkNamed('Kazamidori Television');
    expect(deals.some((deal) => deal.networkId === tessen)).toBe(true);
    for (const deal of deals) {
      const network = read.tables.networks.require(deal.networkId);
      const definition =
        deal.eventDefinitionId === null
          ? undefined
          : read.tables.eventDefinitions.require(deal.eventDefinitionId);
      // A promotion-wide pay-per-view deal airs the promotion's major shows.
      const importance = definition?.importance ?? (network.kind === 'ppv' ? 'major' : 'regular');
      const request = { networkId: deal.networkId, timeslot: deal.timeslot, importance };
      const viewers = projectedAudience(read, TUNABLES, {
        ...request,
        promotionId: deal.promotionId,
        live: deal.live,
      });
      const benchmark = benchmarkFor(read, TUNABLES, request);
      const name = `${read.tables.promotions.require(deal.promotionId).name} on ${network.name}`;
      expect(viewers.value / benchmark.value, name).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('gives Hardpan Friday a small, healthy audience on its Texas channel', () => {
    const local = project('Hardpan', 'Hardpan Friday', 'Bluebonnet Cable 7', 'evening', false);
    expect(local.ratio).toBeGreaterThanOrEqual(1.5);
    expect(local.viewers.value).toBeGreaterThanOrEqual(2_000);
    expect(local.viewers.value).toBeLessThanOrEqual(20_000);
    // The worked example in broadcast.md#calibration.
    expect(local.viewers.value).toBe(3962);
    expect(local.benchmark.value).toBe(1616);
  });

  it('leaves Hardpan Friday far under what National Signal Network expects', () => {
    const national = project(
      'Hardpan',
      'Hardpan Friday',
      'National Signal Network',
      'evening',
      false,
    );
    expect(national.ratio).toBeLessThan(0.1);
  });
});

describe('audience traces on the default world', () => {
  it('stay inside the trace limits on every network, the world-wide ones included', () => {
    const altura = promotionNamed('Szn League');
    for (const network of read.tables.networks.values()) {
      const request = {
        networkId: network.id,
        timeslot: 'primeTime',
        importance: 'major',
      } as const;
      const traces = [
        projectedAudience(read, TUNABLES, { ...request, promotionId: altura, live: true }),
        benchmarkFor(read, TUNABLES, request),
      ];
      for (const traced of traces) {
        expect(countTraceNodes(traced.trace), network.name).toBeLessThanOrEqual(TRACE_MAX_NODES);
        expect(traceDepth(traced.trace), network.name).toBeLessThanOrEqual(TRACE_MAX_DEPTH);
        // The audience's own steps are never cut: every multiplier keeps its own line.
        const audienceTrace = traced.trace.label.startsWith('What ')
          ? traced.trace.children?.[0]
          : traced.trace;
        const steps = audienceTrace?.children?.map((node) => node.label) ?? [];
        expect(steps, network.name).toContain('Show quality');
        expect(steps.at(-1), network.name).toBe('Rounded down to whole viewers');
        expectTraceReplays(traced);
      }
    }
  });
});
