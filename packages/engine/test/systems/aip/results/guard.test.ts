// The computer-only guard of AIP5's booked-card step (AIP5-01).
// Design: docs/design/rival-booking.md#hook
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../../src/core/date';
import type { BrandId, EventInstanceId, PromotionId } from '../../../../src/core/ids';
import { runStep } from '../../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../../src/core/pipeline/runtime';
import { inputOf } from '../../../../src/core/trace';
import { isFullTrace } from '../../../../src/core/trace/store';
import {
  AIP_PRUNE_CARD_DETAIL_PHASE_ID,
  AIP_RUN_TURNS_PHASE_ID,
  isComputerBooked,
  pruneCardDetailPhase,
  registerBookedCardStep,
  runTurnsPhase,
  titleTraceRef,
  winnerTraceRef,
} from '../../../../src/systems/aip';
import { cardSegments } from '../../../../src/systems/booking/card';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../../support/builders/build-row';
import { anEventInstance } from '../../../support/builders/creative';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const COMPUTER = { kind: 'computer' } as const;
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 2);
const tunables = createEngineTunables();

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the guard world has no ${what}`);
  }
  return value;
}

interface GuardWorld extends BuiltWorld {
  /** A: human with a computer GM brand. B: computer with a human-run brand. */
  readonly gmBrand: BrandId;
  readonly humanBrand: BrandId;
  readonly shows: {
    /** A's own show (A's first brand, no controller of its own). */
    readonly human: EventInstanceId;
    /** A's computer GM brand's show. */
    readonly gm: EventInstanceId;
    /** B's show with no brand. */
    readonly rival: EventInstanceId;
    /** B's show on its human-run brand. */
    readonly handedBack: EventInstanceId;
  };
}

function guardWorld(): GuardWorld {
  const kept: { shows?: GuardWorld['shows'] } = {};
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
      promotion
        .withBrand({ controller: null })
        .withBrand({ controller: HUMAN })
        .withRoster(12, {
          employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
        })
        .withTitle({ name: 'Test Heavyweight Championship' }, { holder: 0 }),
    )
    .with('shows', (context) => {
      const { promotions, brands, employments, regions } = context.ids;
      const regionId = required(regions[0], 'region');
      // A's people 10-19 work for its GM brand.
      for (let index = 10; index < 20; index++) {
        context.tx.update('employments', required(employments[index], 'employment'), {
          brandId: required(brands[1], 'GM brand'),
        });
      }
      const show = (
        promotionId: PromotionId | undefined,
        brandId: BrandId | null,
        name: string,
      ): EventInstanceId =>
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
              format: { slots: 6, preShowSlots: 0 },
            },
            context.sequence,
          ),
        ).id;
      kept.shows = {
        human: show(promotions.A, required(brands[0], 'A brand'), 'Human Weekly'),
        gm: show(promotions.A, required(brands[1], 'GM brand'), 'GM Weekly'),
        rival: show(promotions.B, null, 'Rival Weekly'),
        handedBack: show(promotions.B, required(brands[3], 'B human brand'), 'Handed Back'),
      };
    })
    .build();
  return {
    ...built,
    gmBrand: required(built.ids.brands[1], 'GM brand'),
    humanBrand: required(built.ids.brands[3], 'B human brand'),
    shows: required(kept.shows, 'shows'),
  };
}

function bookTheDay(runtime: SimRuntime): void {
  const report = runStep(
    runtime,
    AIP_RUN_TURNS_PHASE_ID,
    { kind: 'phase', id: AIP_RUN_TURNS_PHASE_ID },
    runTurnsPhase.run,
    { date: SHOW_DAY },
  );
  expect(report.status, report.error?.message).toBe('ok');
}

/** Registers a step behind the guard that records each show it acts on. */
function guardedStep(order: number): EventInstanceId[] {
  const seen: EventInstanceId[] = [];
  cleanups.push(
    registerBookedCardStep({
      id: 'test.guardedStep',
      order,
      run: (ctx, input) => {
        if (!isComputerBooked(ctx.read, input.instance)) {
          return;
        }
        seen.push(input.instance.id);
        for (const segmentId of input.segmentIds) {
          const segment = ctx.read.tables.segments.require(segmentId);
          if (segment.kind !== 'match') {
            continue;
          }
          ctx.recordTrace(winnerTraceRef(segmentId), ctx.date, inputOf('Winner', 'Side 1'));
          for (const titleId of segment.match.titleIds) {
            ctx.recordTrace(titleTraceRef(segmentId, titleId), ctx.date, inputOf('Kept', 'Kept'));
          }
        }
      },
    }),
  );
  return seen;
}

describe('isComputerBooked', () => {
  const built = guardWorld();
  const read = built.world;
  const show = (id: EventInstanceId) => read.tables.eventInstances.require(id);

  it("follows the brand's controller before the promotion's", () => {
    // Human promotion, computer GM brand.
    expect(isComputerBooked(read, show(built.shows.gm))).toBe(true);
    // Computer promotion, human-run brand.
    expect(isComputerBooked(read, show(built.shows.handedBack))).toBe(false);
  });

  it("falls back to the promotion's controller", () => {
    expect(isComputerBooked(read, show(built.shows.human))).toBe(false);
    expect(isComputerBooked(read, show(built.shows.rival))).toBe(true);
  });
});

describe('a booked-card step behind the guard', () => {
  it('runs once for each computer show and never for a human one', () => {
    const seen = guardedStep(1);
    const built = guardWorld();
    const runtime = createRuntime({ world: built.world, tunables });
    bookTheDay(runtime);
    expect([...seen].sort()).toEqual([built.shows.gm, built.shows.rival].sort());
  });

  it('leaves a show alone when its brand is handed back to the player before the step runs', () => {
    const built = guardWorld();
    cleanups.push(
      registerBookedCardStep({
        id: 'test.handBack',
        order: 0,
        run: (ctx, input) => {
          if (input.instance.brandId === built.gmBrand) {
            ctx.tx.update('brands', built.gmBrand, { controller: HUMAN });
          }
        },
      }),
    );
    const seen = guardedStep(1);
    const runtime = createRuntime({ world: built.world, tunables });
    bookTheDay(runtime);
    expect(seen).toEqual([built.shows.rival]);
  });

  it('keeps winner and title traces in full for keepDetailDays, then only a summary', () => {
    guardedStep(1);
    const built = guardWorld();
    const runtime = createRuntime({ world: built.world, tunables });
    bookTheDay(runtime);
    const refs = cardSegments(runtime.world, built.shows.rival).flatMap((segment) =>
      segment.kind === 'match'
        ? [
            winnerTraceRef(segment.id),
            ...segment.match.titleIds.map((titleId) => titleTraceRef(segment.id, titleId)),
          ]
        : [],
    );
    expect(refs.length).toBeGreaterThan(0);
    const keep = tunables.get('history.keepDetailDays');
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
    prune(addDays(SHOW_DAY, keep - 1));
    for (const ref of refs) {
      const entry = runtime.traces.get(ref);
      expect(entry !== undefined && isFullTrace(entry), ref.id).toBe(true);
    }
    prune(addDays(SHOW_DAY, keep));
    for (const ref of refs) {
      const entry = runtime.traces.get(ref);
      expect(entry, ref.id).toBeDefined();
      expect(entry !== undefined && isFullTrace(entry), ref.id).toBe(false);
    }
  });
});
