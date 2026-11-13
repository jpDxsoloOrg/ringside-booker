// Rival results are deterministic and kept apart per show (AIP5-04). Design:
// docs/design/rival-booking.md#how-a-rival-shows-results-are-decided
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../../src/core/api';
import { addDays, type GameDate } from '../../../../src/core/date';
import type { EventInstanceId, PersonId, PromotionId, SegmentId } from '../../../../src/core/ids';
import { runStep } from '../../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../../src/core/pipeline/runtime';
import { startDecision } from '../../../../src/core/trace';
import { isFullTrace, type StoredTraceEntry } from '../../../../src/core/trace/store';
import type { MatchOutcome } from '../../../../src/model/entities/segment';
import {
  computerUnits,
  decideResults,
  TITLE_TRACE_KIND,
  WINNER_TRACE_KIND,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { aMatch, anEventInstance, aParticipant } from '../../../support/builders/creative';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import { SLOW_TESTS } from '../../../support/slow';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../../support/systems';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const COMPUTER = { kind: 'computer' } as const;
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 2);
const ROSTER = 10;
const tunables = createEngineTunables();

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the world has no ${what}`);
  }
  return value;
}

interface TwoRivals {
  readonly world: BuiltWorld['world'];
  /** B's show, then C's. */
  readonly shows: readonly EventInstanceId[];
  /** The matches on C's show. */
  readonly cMatches: readonly SegmentId[];
}

/**
 * Two computer promotions, B and C, 10 wrestlers each, a title held by each one's first wrestler
 * and a weekly Monday show; plus one show each on SHOW_DAY with matches already booked: B's has
 * `bMatches` of them, C's three.
 */
function twoRivals(bMatches: number): TwoRivals {
  const kept: { shows?: EventInstanceId[]; cMatches?: SegmentId[] } = {};
  const built = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withRoster(ROSTER).withTitle({ name: 'B Title' }, { holder: 0 }).withWeeklyShow(),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withRoster(ROSTER).withTitle({ name: 'C Title' }, { holder: 0 }).withWeeklyShow(),
    )
    .with('shows', (context) => {
      const { promotions, people, regions } = context.ids;
      const regionId = required(regions[0], 'region');
      const show = (promotionId: PromotionId | undefined, name: string) =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: required(promotionId, 'promotion'),
              regionId,
              name,
              date: SHOW_DAY,
              airDate: SHOW_DAY,
              format: { slots: 6, preShowSlots: 0 },
            },
            context.sequence,
          ),
        ).id;
      const book = (eventInstanceId: EventInstanceId, slot: number, pair: PersonId[]) => {
        const match = context.insert(
          'segments',
          aMatch({ eventInstanceId, slot, preShow: false }, context.sequence),
        );
        for (const [side, personId] of pair.entries()) {
          context.insert(
            'participants',
            aParticipant({ segmentId: match.id, personId, side }, context.sequence),
          );
        }
        return match.id;
      };
      const person = (index: number) => required(people[index], `person ${String(index)}`);
      const showB = show(promotions.A, 'B Special');
      const showC = show(promotions.B, 'C Special');
      for (let index = 0; index < bMatches; index++) {
        book(showB, index, [person(index * 2), person(index * 2 + 1)]);
      }
      kept.cMatches = [0, 1, 2].map((index) =>
        book(showC, index, [person(ROSTER + index * 2), person(ROSTER + index * 2 + 1)]),
      );
      kept.shows = [showB, showC];
    })
    .build();
  return {
    world: built.world,
    shows: required(kept.shows, 'shows'),
    cMatches: required(kept.cMatches, 'C matches'),
  };
}

function fullTraceOf(entry: StoredTraceEntry | undefined): unknown {
  return entry !== undefined && isFullTrace(entry) ? entry.trace : null;
}

/** Runs the step on both shows (B first), as aip.bookShow would; returns C's plans. */
function decideBoth(rivals: TwoRivals): { outcome: MatchOutcome | null; trace: string }[] {
  const runtime = createRuntime({ world: rivals.world, tunables });
  const report = runStep(
    runtime,
    'test.decideResults',
    { kind: 'phase', id: 'test.decideResults' },
    (ctx) => {
      const units = computerUnits(ctx.read);
      for (const showId of rivals.shows) {
        const instance = ctx.read.tables.eventInstances.require(showId);
        const unit = required(
          units.find((entry) => entry.promotionId === instance.promotionId),
          'unit',
        );
        decideResults(
          { ...ctx, unit },
          {
            instance,
            segmentIds: [],
            plan: {
              kind: 'card',
              placements: [],
              open: [],
              planTrace: startDecision<string>('Test plan').choose('card', 'Test'),
              notes: [],
              counts: { matches: 0, talking: 0, titles: 0, storyline: 0 },
            },
          },
        );
      }
    },
    { date: SHOW_DAY },
  );
  expect(report.status, report.error?.message).toBe('ok');
  return rivals.cMatches.map((segmentId) => {
    const segment = runtime.world.tables.segments.require(segmentId);
    return {
      outcome: segment.kind === 'match' ? segment.outcome : null,
      // The trace itself (its ref holds the segment id, which differs between the two worlds).
      trace: JSON.stringify(
        fullTraceOf(runtime.traces.get({ kind: WINNER_TRACE_KIND, id: segmentId })),
      ),
    };
  });
}

describe('rival results determinism', () => {
  it("adding a match to one rival's card never changes another promotion's results", () => {
    const one = decideBoth(twoRivals(1));
    const three = decideBoth(twoRivals(3));
    for (const plan of one) {
      expect(plan.outcome).not.toBeNull();
      expect(plan.trace).not.toBe('null');
    }
    // Same plans, same Why?s (the traces carry no ids from the other show).
    expect(three.map((plan) => plan.outcome)).toEqual(one.map((plan) => plan.outcome));
    expect(three.map((plan) => plan.trace)).toEqual(one.map((plan) => plan.trace));
  });

  // About a second on the small world; the 60-day sim's determinism check covers it in CI too.
  it.runIf(SLOW_TESTS)(
    'two engines from the same save plan the same results for 60 days',
    async () => {
      const rivals = twoRivals(1);
      const run = async () => {
        const engine = createEngine({
          state: initialEngineState(rivals.world),
          systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
        });
        const result = await engine.advanceDays({ maxDays: 60 });
        expect(result.failures).toEqual([]);
        const state = engine.exportState();
        return {
          outcomes: state.world.tables.segments.map((segment) =>
            segment.kind === 'match' ? [segment.id, segment.outcome] : [segment.id, null],
          ),
          traces: state.traces.full.filter(
            (entry) => entry.ref.kind === WINNER_TRACE_KIND || entry.ref.kind === TITLE_TRACE_KIND,
          ),
          decisions: state.world.tables.aiDecisions,
          reigns: state.world.tables.titleReigns,
        };
      };
      const first = await run();
      const second = await run();
      expect(first.traces.length).toBeGreaterThan(10);
      expect(second).toEqual(first);
    },
  );
});
