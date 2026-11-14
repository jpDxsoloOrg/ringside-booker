// The storyline Why? panels in the panel's words (CRTV4-07 audit): heat after a linked segment,
// a Sandbox game's hand-set heat, and the payoff when a storyline ends. The heat steps come from
// the engine's own formula; the hand-set heat and the payoff are the traces the real engine
// records for `storylines.setHeat` and `storylines.end`, so the words checked here are the ones a
// player reads. Design: docs/design/storylines.md#heat-after-segment, #payoff, #sandbox-heat.
import {
  controllerViewer,
  createEngine,
  createEngineTunables,
  defaultSystems,
  heatAfterSegment,
  initialEngineState,
  payoffQuality,
  storylineHeatTraceRef,
  storylinePayoffTraceRef,
} from '@ringside/engine';
import type { Controller, StorylineId, TraceNode, TraceRef } from '@ringside/engine';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder } from '@ringside/engine/testing';
import { describe, expect, it } from 'vitest';
import { traceToText } from './traceToText';
import { describeTraceNode } from './wording';

const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const VIEWER = controllerViewer(PLAYER);
const STORY = 'Test Ashfall Rivalry';

/** A tunable key or a code where words belong, or a value the panel could not word. */
const RAW_KEY = /\bstorylines\.[a-z]|\b[a-z]+[A-Z][a-zA-Z]*\b|undefined|NaN|\[object/;

function nodes(root: TraceNode): TraceNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}

/** Every row's sentence (not its details, where a setting's key belongs). */
function sentences(root: TraceNode): string[] {
  return nodes(root).map((node) => describeTraceNode(node).text);
}

function tunableRows(root: TraceNode) {
  return nodes(root).flatMap((node) =>
    node.kind === 'tunable' ? [{ node, line: describeTraceNode(node) }] : [],
  );
}

function expectWorded(trace: TraceNode): void {
  for (const sentence of sentences(trace)) {
    expect(sentence.trim()).not.toBe('');
    expect(sentence).not.toMatch(RAW_KEY);
  }
  expect(traceToText(trace)).not.toMatch(/undefined|NaN|\[object/);
  for (const { node, line } of tunableRows(trace)) {
    expect(line.text.startsWith(`${node.label}: `)).toBe(true);
    expect(line.details).toContain(node.key);
    expect(node.key).toMatch(/^storylines\.(heat|payoff|link)\./);
  }
}

/** The heat step as the applier builds it, for one linked segment. */
function heatStep(fields: { segmentScore: number; nthOnShow?: number; preShow?: boolean }) {
  return heatAfterSegment(
    {
      heatBefore: 50,
      segmentScore: fields.segmentScore,
      storylineName: STORY,
      segmentLabel: 'Slot 3',
      nthOnShow: fields.nthOnShow ?? 1,
      preShow: fields.preShow ?? false,
    },
    { tunables: createEngineTunables() },
  ).trace;
}

describe('the heat-after-segment Why?, in words', () => {
  const cases: readonly (readonly [string, TraceNode])[] = [
    ['a first segment', heatStep({ segmentScore: 80 })],
    ['a second segment tonight', heatStep({ segmentScore: 80, nthOnShow: 2 })],
    ['a pre-show segment', heatStep({ segmentScore: 30, preShow: true })],
    ['a capped step', heatStep({ segmentScore: 100 })],
  ];

  it.each(cases)('%s: every row is worded, settings by label with their key', (_name, trace) => {
    expectWorded(trace);
    expect(tunableRows(trace).length).toBeGreaterThan(0);
  });

  it('names the segment and the storyline and shows each step', () => {
    const [first, second, preShow, capped] = cases.map(([, trace]) => traceToText(trace));
    expect(first).toContain("Heat after 'Slot 3'");
    expect(first).toContain("Heat before 'Slot 3'");
    expect(first).toContain(`Storyline: ${STORY}`);
    expect(first).toContain("Gap to the segment's score");
    expect(first).toContain('Pull per segment');
    expect(first).toContain('storylines.heat.pull');
    expect(second).toContain('Second linked segment for this story tonight');
    expect(second).toContain('storylines.heat.repeatFactor');
    expect(preShow).toContain('Pre-show segment');
    expect(preShow).toContain('storylines.heat.preShowFactor');
    // 50 toward 100 at 0.4 is a 20-point step, held to the 15-point maximum.
    expect(capped).toContain('Most heat one segment can move');
    expect(capped).toContain('storylines.heat.maxStep');
  });
});

describe('the payoff strength Why?, in words', () => {
  it('a too-short story says it pays nothing and why', () => {
    const trace = payoffQuality(
      { storylineName: STORY, countedSegments: 2, heat: 85, finalePlayed: false },
      { tunables: createEngineTunables() },
    ).trace;
    expectWorded(trace);
    expect(trace.label).toBe('Payoff strength');
    expect(traceToText(trace)).toContain('No payoff (needs 4 linked segments, has 2)');
  });
});

interface PayoffEngine {
  readonly engine: ReturnType<typeof createEngine>;
  readonly hot: StorylineId;
  readonly cold: StorylineId;
}

/**
 * A Sandbox game: the player's promotion with a fan base and four wrestlers (the fourth released,
 * the second a big star), `Test Hot Feud` (four counted segments, a played finale; people 0, 1
 * and the released 3) and `Test Cold Feud` (four counted; people 0 and 2).
 */
function payoffEngine(): PayoffEngine {
  const counted = { segments: 4, matches: 4, angles: 0, heatGained: 20, heatLost: 0 };
  const { world, ids } = worldBuilder({ settings: { sandbox: true } })
    .withGeography('mini')
    .withPromotion({ controller: PLAYER }, (promotion) =>
      promotion
        .withRoster(4, {
          employment: (index) =>
            index === 3 ? { status: 'released', endedOn: TEST_START_DATE } : {},
        })
        .withStoryline(
          { name: 'Test Hot Feud', heat: 50, progressTotals: counted },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
              [3, 'heel'],
            ],
          },
        )
        .withStoryline(
          { name: 'Test Cold Feud', heat: 50, progressTotals: counted },
          {
            members: [
              [0, 'face'],
              [2, 'heel'],
            ],
          },
        ),
    )
    .withEventInstance({ name: 'Test Show' })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 })
    .with('fan base, popularity and the finale', ({ tx, ids: built }) => {
      const everywhere = (pop: number) => Object.fromEntries(built.regions.map((id) => [id, pop]));
      tx.update('promotions', built.promotions.A!, { regionalPop: everywhere(60) });
      [40, 99, 40, 40].forEach((pop, index) => {
        tx.update('people', built.people[index]!, { regionalPop: everywhere(pop) });
      });
      const hot = built.storylines[0]!;
      tx.update('segments', built.segments[0]!, { storylineIds: [hot] });
      tx.update('storylines', hot, { finaleSegmentId: built.segments[0]! });
    })
    .build();
  const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
  return { engine, hot: ids.storylines[0]!, cold: ids.storylines[1]! };
}

function storedTrace(engine: PayoffEngine['engine'], ref: TraceRef): TraceNode {
  const result = engine.query('trace.get', { ref }, VIEWER);
  if (!result.ok || result.data === null || !('trace' in result.data)) {
    throw new Error(`No full trace at ${ref.kind}:${ref.id}`);
  }
  return result.data.trace;
}

function expectOk(result: { readonly ok: boolean; readonly reasons?: unknown }): void {
  if (!result.ok) throw new Error(JSON.stringify(result.reasons));
}

function setHeat(world: PayoffEngine, storylineId: StorylineId, heat: number): void {
  expectOk(world.engine.command('storylines.setHeat', { storylineId, heat }, PLAYER));
}

function end(world: PayoffEngine, storylineId: StorylineId): void {
  expectOk(world.engine.command('storylines.end', { storylineId }, PLAYER));
}

describe('the hand-set heat and the payoff Why?, from the real engine', () => {
  const world = payoffEngine();
  setHeat(world, world.hot, 85);
  const handSet = storedTrace(world.engine, storylineHeatTraceRef(world.hot));
  end(world, world.hot);
  const hotPayoff = storedTrace(world.engine, storylinePayoffTraceRef(world.hot));
  setHeat(world, world.cold, 20);
  end(world, world.cold);
  const coldPayoff = storedTrace(world.engine, storylinePayoffTraceRef(world.cold));

  it('a Sandbox game says the heat was set by hand', () => {
    expectWorded(handSet);
    expect(traceToText(handSet)).toContain('Set by hand in a Sandbox game');
  });

  it('a hot payoff shows its strength, the finale bonus, a big star and a member who left', () => {
    expectWorded(hotPayoff);
    const text = traceToText(hotPayoff);
    expect(text).toContain("Storyline payoff: 'Test Hot Feud'");
    expect(text).toContain('Payoff strength');
    expect(text).toContain('Paid off with a finale');
    expect(text).toContain('storylines.payoff.finaleFactor');
    expect(text).toContain('Already bigger than this story');
    expect(text).toContain('Left the promotion: no payoff');
    expect(text).toContain('storylines.payoff.popularityMax');
  });

  it('a cold payoff reads as a drop, with no finale or headroom lines', () => {
    expectWorded(coldPayoff);
    const text = traceToText(coldPayoff);
    expect(text).toContain("Storyline payoff: 'Test Cold Feud'");
    expect(text).toContain('Payoff strength');
    expect(text).not.toContain('Already bigger than this story');
    expect(text).toMatch(/Popularity: −\d/);
  });
});
