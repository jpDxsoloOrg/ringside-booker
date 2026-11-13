// Rivals book their shows on show day (AIP4-05). Design: docs/design/rival-booking.md#show-day
import { afterEach, describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../../src/core/api';
import { addDays, type GameDate } from '../../../../src/core/date';
import type { BrandId, EventInstanceId, PersonId, PromotionId } from '../../../../src/core/ids';
import { runStep } from '../../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../../src/core/pipeline/runtime';
import { isFullTrace } from '../../../../src/core/trace/store';
import type { EventInstance } from '../../../../src/model/entities/event-instance';
import type { GameWorldView } from '../../../../src/model/tables';
import type { DeepReadonly } from '../../../../src/model/world';
import {
  AIP_PRUNE_CARD_DETAIL_PHASE_ID,
  AIP_RUN_TURNS_PHASE_ID,
  BOOK_SHOW_JOB_ID,
  bookedCardSteps,
  CARD_BOOKED_SUMMARY_KEY,
  CARD_DECISION_KIND,
  CARD_PLAN_TRACE_KIND,
  CARD_SLOT_TRACE_KIND,
  cardBookedText,
  NO_PLANNED_RESULT_CODE,
  pruneCardDetailPhase,
  registerBookedCardStep,
  runTurnsPhase,
  SHOW_CANCELLED_SUMMARY_KEY,
  showCancelledText,
} from '../../../../src/systems/aip';
import { cardSegments } from '../../../../src/systems/booking/card';
import { validateCard } from '../../../../src/systems/booking/validate/validateCard';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { RegistryError } from '../../../../src/core/errors';
import {
  anAngle,
  anEventInstance,
  aMatch,
  aParticipant,
  DEFAULT_BEAT_KEY,
} from '../../../support/builders/creative';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../../support/builders/build-row';
import { SYSTEMS_WITHOUT_SHOW_NIGHT } from '../../../support/systems';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;
/** Show day: two days after the (Monday) start. */
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 2);
const SLOTS = 6;
const tunables = createEngineTunables();

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

interface ShowWorld extends BuiltWorld {
  readonly proA: PromotionId;
  readonly proB: PromotionId;
  readonly proC: PromotionId;
  readonly proD: PromotionId;
  /** Promotion A's computer GM brand. */
  readonly gmBrand: BrandId;
  /** Shows on SHOW_DAY: A's (human), the GM brand's, B's, C's and thin D's. */
  readonly shows: {
    readonly human: EventInstanceId;
    readonly gm: EventInstanceId;
    readonly b: EventInstanceId;
    readonly c: EventInstanceId;
    readonly thin: EventInstanceId;
  };
  /** Promotion A's people on the GM brand. */
  readonly gmPeople: readonly PersonId[];
}

interface ShowWorldOptions {
  /** Puts a match (B's first two wrestlers) in slot 2 and a promo in slot 4 of B's show. */
  readonly bookedB?: boolean;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the show world has no ${what}`);
  }
  return value;
}

/**
 * A: human, 20 wrestlers, the last 10 on its computer GM brand. B and C: computer, 12 each. D:
 * computer with 3. Everyone has a show on SHOW_DAY; A has one for each brand.
 */
function showWorld(options: ShowWorldOptions = {}): ShowWorld {
  const kept: { shows?: ShowWorld['shows']; gmPeople?: PersonId[] } = {};
  const built = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: HUMAN }, (promotion) =>
      promotion
        .withBrand({ controller: null })
        .withBrand({ controller: COMPUTER })
        .withRoster(20, {
          employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
        }),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withRoster(12, {
        employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
      }),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withRoster(12, {
        employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
      }),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) => promotion.withRoster(3))
    .with('shows', (context) => {
      const { promotions, brands, people, employments, regions } = context.ids;
      const regionId = required(regions[0], 'region');
      const gmBrand = required(brands[1], 'GM brand');
      // A's people 10-19 work for the GM brand.
      const gmPeople: PersonId[] = [];
      for (let index = 10; index < 20; index++) {
        context.tx.update('employments', required(employments[index], 'employment'), {
          brandId: gmBrand,
        });
        gmPeople.push(required(people[index], 'person'));
      }
      const show = (promotionId: PromotionId | undefined, brandId: BrandId | null, name: string) =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: required(promotionId, 'promotion'),
              brandId,
              regionId,
              name,
              date: SHOW_DAY,
              airDate: SHOW_DAY,
              format: { slots: SLOTS, preShowSlots: 0 },
            },
            context.sequence,
          ),
        ).id;
      const shows = {
        human: show(promotions.A, required(brands[0], 'brand 0'), 'Human Weekly'),
        gm: show(promotions.A, gmBrand, 'GM Weekly'),
        b: show(promotions.B, null, 'Rival B Weekly'),
        c: show(promotions.C, null, 'Rival C Weekly'),
        thin: show(promotions.D, null, 'Thin Weekly'),
      };
      if (options.bookedB === true) {
        const first = required(people[20], 'B wrestler 1');
        const second = required(people[21], 'B wrestler 2');
        const third = required(people[22], 'B wrestler 3');
        const match = context.insert(
          'segments',
          aMatch({ eventInstanceId: shows.b, slot: 1, preShow: false }, context.sequence),
        );
        for (const [side, personId] of [first, second].entries()) {
          context.insert(
            'participants',
            aParticipant({ segmentId: match.id, personId, side }, context.sequence),
          );
        }
        const promo = context.insert(
          'segments',
          anAngle(
            {
              eventInstanceId: shows.b,
              slot: 3,
              preShow: false,
              angle: { beats: [{ beatKey: DEFAULT_BEAT_KEY, personIds: [third] }] },
            },
            context.sequence,
          ),
        );
        context.insert(
          'participants',
          aParticipant(
            { segmentId: promo.id, personId: third, side: 0, role: 'speaker' },
            context.sequence,
          ),
        );
      }
      kept.shows = shows;
      kept.gmPeople = gmPeople;
    })
    .build();
  return {
    ...built,
    proA: required(built.ids.promotions.A, 'A'),
    proB: required(built.ids.promotions.B, 'B'),
    proC: required(built.ids.promotions.C, 'C'),
    proD: required(built.ids.promotions.D, 'D'),
    gmBrand: required(built.ids.brands[1], 'GM brand'),
    shows: required(kept.shows, 'shows'),
    gmPeople: required(kept.gmPeople, 'GM people'),
  };
}

function runtimeOf(built: BuiltWorld): SimRuntime {
  return createRuntime({ world: built.world, tunables });
}

/** Runs `aip.runTurns` on SHOW_DAY; returns its log lines. */
function bookTheDay(runtime: SimRuntime): string[] {
  const report = runStep(
    runtime,
    AIP_RUN_TURNS_PHASE_ID,
    { kind: 'phase', id: AIP_RUN_TURNS_PHASE_ID },
    runTurnsPhase.run,
    { date: SHOW_DAY },
  );
  expect(report.status, report.error?.message).toBe('ok');
  return report.logs;
}

function showOf(read: GameWorldView, id: EventInstanceId): DeepReadonly<EventInstance> {
  return read.tables.eventInstances.require(id);
}

/** The person ids in each match on the card, competitors only. */
function matchPeople(read: GameWorldView, id: EventInstanceId): PersonId[][] {
  return cardSegments(read, id)
    .filter((segment) => segment.kind === 'match')
    .map((segment) =>
      read.tables.participants
        .lookup('bySegment', segment.id)
        .filter((participant) => participant.role === 'competitor')
        .map((participant) => participant.personId),
    );
}

function blockingErrors(read: GameWorldView, id: EventInstanceId): string[] {
  return validateCard(read, id, { tunables, today: SHOW_DAY })
    .errors.filter((issue) => issue.code !== NO_PLANNED_RESULT_CODE)
    .map((issue) => `${issue.code}: ${issue.message}`);
}

describe('aip.bookShow', () => {
  it('books each rival show with a full, valid card that ends on a match', () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    for (const id of [built.shows.b, built.shows.c]) {
      expect(showOf(read, id).status).toBe('booked');
      const segments = cardSegments(read, id);
      const main = segments.filter((segment) => !segment.preShow);
      expect(main).toHaveLength(SLOTS);
      expect(main.at(-1)).toMatchObject({ kind: 'match', slot: SLOTS - 1 });
      expect(blockingErrors(read, id)).toEqual([]);
      // Nobody twice: every person is in at most one match.
      const people = matchPeople(read, id).flat();
      expect(new Set(people).size).toBe(people.length);
      // AIP5-04's booked-card step plans every match's result.
      for (const segment of segments) {
        if (segment.kind === 'match') {
          expect(segment.outcome).not.toBeNull();
        }
      }
    }
    const booked = runtime.bus.recent({ types: ['aip.cardBooked'] }).map((event) => event.payload);
    expect(booked.map((payload) => payload.eventInstanceId).sort()).toEqual(
      [built.shows.gm, built.shows.b, built.shows.c].sort(),
    );
    for (const payload of booked) {
      expect(payload.segmentCount).toBe(SLOTS);
    }
  });

  it("never touches the player's show", () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    expect(showOf(read, built.shows.human)).toMatchObject({ status: 'scheduled' });
    expect(cardSegments(read, built.shows.human)).toEqual([]);
    const decisions = read.tables.aiDecisions
      .values()
      .filter((decision) => decision.refs.eventInstanceId === built.shows.human);
    expect(decisions).toEqual([]);
  });

  it('cancels a thin rival show with a reason, one show.cancelled and a card decision', () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    expect(showOf(read, built.shows.thin)).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: SHOW_DAY },
    });
    expect(cardSegments(read, built.shows.thin)).toEqual([]);
    const cancelled = runtime.bus
      .recent({ types: ['show.cancelled'] })
      .map((event) => event.payload)
      .filter((payload) => payload.eventInstanceId === built.shows.thin);
    expect(cancelled).toEqual([
      {
        eventInstanceId: built.shows.thin,
        promotionId: built.proD,
        date: SHOW_DAY,
        reason: 'byPromotion',
      },
    ]);
    const [decision] = read.tables.aiDecisions
      .values()
      .filter((row) => row.refs.eventInstanceId === built.shows.thin);
    expect(decision).toMatchObject({
      kind: CARD_DECISION_KIND,
      promotionId: built.proD,
      summary: {
        key: SHOW_CANCELLED_SUMMARY_KEY,
        params: { show: 'Thin Weekly', reason: 'Only 3 wrestlers available, needs 5' },
      },
    });
    expect(showCancelledText(required(decision, 'decision').summary)).toBe(
      'Cancelled Thin Weekly: Only 3 wrestlers available, needs 5',
    );
  });

  it("books a computer GM brand's show from that brand's roster only", () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    expect(showOf(read, built.shows.gm).status).toBe('booked');
    const people = new Set(
      cardSegments(read, built.shows.gm).flatMap((segment) =>
        read.tables.participants
          .lookup('bySegment', segment.id)
          .map((participant) => participant.personId),
      ),
    );
    expect(people.size).toBeGreaterThan(0);
    for (const personId of people) {
      expect(built.gmPeople).toContain(personId);
    }
    expect(blockingErrors(read, built.shows.gm)).toEqual([]);
  });

  it('keeps the segments already on the card and fills the rest', () => {
    const built = showWorld({ bookedB: true });
    const before = cardSegments(built.world, built.shows.b).map((segment) => ({
      id: segment.id,
      slot: segment.slot,
      kind: segment.kind,
    }));
    expect(before).toHaveLength(2);
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    expect(showOf(read, built.shows.b).status).toBe('booked');
    const after = cardSegments(read, built.shows.b);
    for (const kept of before) {
      expect(after.find((segment) => segment.id === kept.id)).toMatchObject({
        slot: kept.slot,
        kind: kept.kind,
      });
    }
    expect(after.filter((segment) => !segment.preShow)).toHaveLength(SLOTS);
    const people = matchPeople(read, built.shows.b).flat();
    expect(new Set(people).size).toBe(people.length);
    expect(blockingErrors(read, built.shows.b)).toEqual([]);
  });

  it('logs and skips a booked-card step that throws, and still books the card', () => {
    const seen: string[] = [];
    cleanups.push(
      registerBookedCardStep({
        id: 'test.brokenStep',
        order: 1,
        run: (ctx, input) => {
          ctx.tx.update('eventInstances', input.instance.id, { name: 'Should be rolled back' });
          ctx.publish('aip.jobFailed', {
            jobId: 'test',
            promotionId: input.instance.promotionId,
            brandId: null,
            message: 'should not be delivered',
          });
          throw new Error('step broke');
        },
      }),
      registerBookedCardStep({
        id: 'test.seeingStep',
        order: 2,
        run: (_ctx, input) => {
          seen.push(`${input.instance.id}:${String(input.segmentIds.length)}`);
        },
      }),
    );
    const built = showWorld();
    const runtime = runtimeOf(built);
    const logs = bookTheDay(runtime);
    const read = runtime.world;
    expect(showOf(read, built.shows.b)).toMatchObject({
      status: 'booked',
      name: 'Rival B Weekly',
    });
    expect(logs.some((line) => line.includes('test.brokenStep failed and was skipped'))).toBe(true);
    expect(runtime.bus.recent({ types: ['aip.jobFailed'] })).toEqual([]);
    expect(seen).toContain(`${built.shows.b}:${String(SLOTS)}`);
  });

  it('refuses a duplicate or malformed booked-card step', () => {
    cleanups.push(registerBookedCardStep({ id: 'test.once', order: 0, run: () => undefined }));
    expect(() =>
      registerBookedCardStep({ id: 'test.once', order: 1, run: () => undefined }),
    ).toThrow(RegistryError);
    expect(() => registerBookedCardStep({ id: 'Bad', order: 0, run: () => undefined })).toThrow(
      RegistryError,
    );
    // AIP5-04's `aip.decideResults` (order 10) is always registered.
    expect(bookedCardSteps().map((step) => step.id)).toEqual(['test.once', 'aip.decideResults']);
  });

  it('keeps a plan trace and a short trace per written slot, and a hidden card decision', () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const read = runtime.world;
    for (const id of [built.shows.b, built.shows.c, built.shows.thin]) {
      const plan = runtime.traces.get({ kind: CARD_PLAN_TRACE_KIND, id });
      expect(plan, id).toBeDefined();
      expect(plan !== undefined && isFullTrace(plan)).toBe(false);
    }
    for (const segment of cardSegments(read, built.shows.b)) {
      const slot = runtime.traces.get({ kind: CARD_SLOT_TRACE_KIND, id: segment.id });
      expect(slot !== undefined && isFullTrace(slot), segment.id).toBe(true);
      if (slot !== undefined && isFullTrace(slot)) {
        expect(slot.trace.label).toMatch(/^Slot \d+ · /);
        // The headline lines and the card score, not the whole plan.
        expect(JSON.stringify(slot.trace).length).toBeLessThan(4_000);
      }
    }
    const [decision] = read.tables.aiDecisions
      .values()
      .filter((row) => row.refs.eventInstanceId === built.shows.b);
    const show = showOf(read, built.shows.b);
    expect(decision).toMatchObject({
      kind: CARD_DECISION_KIND,
      revealOn: show.airDate,
      traceRef: { kind: CARD_PLAN_TRACE_KIND, id: built.shows.b },
      summary: { key: CARD_BOOKED_SUMMARY_KEY },
    });
    const params = required(decision, 'decision').summary.params;
    expect(Number(params['matches']) + Number(params['talking'])).toBe(SLOTS);
    expect(cardBookedText(required(decision, 'decision').summary)).toMatch(
      /^Booked Rival B Weekly: \d+ match(es)?, \d+ talking segments?, \d+ title match(es)?$/,
    );
  });

  it('keeps each slot in full for aip.card.keepDetailDays, then only its summary', () => {
    const built = showWorld();
    const runtime = runtimeOf(built);
    bookTheDay(runtime);
    const keep = tunables.get('aip.card.keepDetailDays');
    const prune = (date: GameDate): void => {
      const report = runStep(
        runtime,
        AIP_PRUNE_CARD_DETAIL_PHASE_ID,
        { kind: 'phase', id: AIP_PRUNE_CARD_DETAIL_PHASE_ID },
        pruneCardDetailPhase.run,
        { date },
      );
      expect(report.status, report.error?.message).toBe('ok');
    };
    const slots = cardSegments(runtime.world, built.shows.b).map((segment) => ({
      kind: CARD_SLOT_TRACE_KIND,
      id: segment.id,
    }));
    expect(slots).toHaveLength(SLOTS);
    prune(addDays(SHOW_DAY, keep - 1));
    for (const slot of slots) {
      const entry = runtime.traces.get(slot);
      expect(entry !== undefined && isFullTrace(entry)).toBe(true);
    }
    prune(addDays(SHOW_DAY, keep));
    for (const slot of slots) {
      const entry = runtime.traces.get(slot);
      expect(entry, slot.id).toBeDefined();
      expect(entry !== undefined && isFullTrace(entry)).toBe(false);
    }
    // The card itself stays: who was on the show is a public fact.
    expect(cardSegments(runtime.world, built.shows.b)).toHaveLength(SLOTS);
  });

  it('is registered as a beforeShow job', async () => {
    const { aiJobs } = await import('../../../../src/systems/aip');
    expect(aiJobs().find((job) => job.id === BOOK_SHOW_JOB_ID)).toMatchObject({
      cadence: 'beforeShow',
      units: 'all',
    });
  });
});

describe('aip.bookShow without show night', () => {
  it('leaves booked rival cards to the close rule, which marks them not run, cards intact', async () => {
    const built = showWorld();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: SYSTEMS_WITHOUT_SHOW_NIGHT,
    });
    const result = await engine.advanceDays({ maxDays: 3 });
    expect(result.failures).toEqual([]);
    const state = engine.exportState();
    const show = state.world.tables.eventInstances.find((row) => row.id === built.shows.b);
    expect(show).toMatchObject({
      status: 'cancelled',
      cancellation: { reason: 'notRun', on: SHOW_DAY },
    });
    const segments = state.world.tables.segments.filter(
      (segment) => segment.eventInstanceId === built.shows.b,
    );
    expect(segments).toHaveLength(SLOTS);
  });
});
