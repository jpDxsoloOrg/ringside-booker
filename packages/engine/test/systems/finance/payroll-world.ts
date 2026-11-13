/**
 * A world for the payroll, medical and books tests, and a runtime that runs only the finance
 * phases (so a long run stays fast and every cash move is the finance system's own).
 *
 * - A: human-controlled. Roster of three at the default wage: index 0 is paid, index 1 is a booker,
 *   index 2 is on unpaid leave for ten days. Also a pending offer and a signed contract that starts
 *   tomorrow, neither of them active. Medical level 1.
 * - B: computer-controlled, two paid wrestlers, medical level 0.
 * - C: computer-controlled, two per-appearance deals (no monthly wage), medical level 1.
 * - D: closed, one paid wrestler.
 */

import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { PhaseRegistry } from '../../../src/core/pipeline/registry';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { GameWorld } from '../../../src/model/tables';
import { financeSystem } from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { anEmployment, aPerson, TEST_PLAYER_ID, worldBuilder } from '../../support';

export interface PayrollWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly perAppearance: PromotionId;
  readonly closed: PromotionId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`payrollWorld: missing ${what}`);
  }
  return value;
}

/** The world described above, starting on `startDate` (defaults to the test start date). */
export function payrollWorld(startDate?: string): PayrollWorld {
  const { world, ids } = worldBuilder(startDate === undefined ? {} : { startDate })
    .withGeography('mini')
    .withPromotion(
      { controller: { kind: 'human', playerId: TEST_PLAYER_ID }, policies: { medical: 1 } },
      (promotion) =>
        promotion.withRoster(3, {
          employment: (index) => {
            if (index === 1) {
              return { role: 'booker' };
            }
            if (index === 2) {
              return {
                leave: { kind: 'timeOff', until: parseGameDate('2999-01-01'), paid: false },
              };
            }
            return {};
          },
        }),
    )
    .withPromotion({ policies: { medical: 0 } }, (promotion) => promotion.withRoster(2))
    .withPromotion({ policies: { medical: 1 } }, (promotion) =>
      promotion.withRoster(2, {
        employment: () => ({ terms: { kind: 'perAppearance', monthlyWage: cents(0) } }),
      }),
    )
    .withPromotion({ status: 'closed' }, (promotion) => promotion.withRoster(1))
    .with('pending contracts', (context) => {
      const human = required(context.ids.promotions.A, 'promotion A');
      const today = context.meta.currentDate;
      for (const status of ['offered', 'signed'] as const) {
        const person = context.insert('people', aPerson({}, context.sequence));
        context.insert(
          'employments',
          anEmployment(
            {
              personId: person.id,
              promotionId: human,
              status,
              offeredOn: today,
              startsOn: addDays(today, 1),
            },
            context.sequence,
          ),
        );
      }
    })
    .build();
  return {
    world,
    human: required(ids.promotions.A, 'A'),
    rival: required(ids.promotions.B, 'B'),
    perAppearance: required(ids.promotions.C, 'C'),
    closed: required(ids.promotions.D, 'D'),
  };
}

/** A runtime over `world` with only the finance phases registered. */
export function financeRuntime(world: GameWorld, overrides: TunableOverrides = {}): SimRuntime {
  const phases = new PhaseRegistry();
  for (const phase of financeSystem.phases) {
    phases.register(phase);
  }
  return createRuntime({ world, tunables: createEngineTunables(overrides), phases });
}

/** The default wage of the test builders, spread over a day: 500,000 × 12 ÷ 365.25, rounded. */
export const DEFAULT_DAILY_WAGE = Math.round((500_000 * 12) / 365.25);

/** Every date from `from` for `days` days. */
export function datesFrom(from: GameDate, days: number): GameDate[] {
  return Array.from({ length: days }, (_, index) => addDays(from, index));
}
