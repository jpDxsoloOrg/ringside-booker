/**
 * The world and helpers the turn-runner tests share (AIP1-03): a few computer units and one human
 * promotion, a runtime over it, and a way to run `aip.runTurns` (and the prune) day by day.
 */

import { addDays, type GameDate } from '../../../src/core/date';
import type { PromotionId } from '../../../src/core/ids';
import type { StepReport } from '../../../src/core/pipeline/report';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  AIP_PRUNE_DECISION_LOG_PHASE_ID,
  AIP_RUN_TURNS_PHASE_ID,
  pruneDecisionLogPhase,
  runTurnsPhase,
} from '../../../src/systems/aip';
import type { BrandId } from '../../../src/core/ids';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';

export const HUMAN = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
export const COMPUTER = { kind: 'computer' } as const;

/** The first day the tests run: a Monday. */
export const RUNNER_START: GameDate = TEST_START_DATE;

export interface RunnerWorld extends BuiltWorld {
  readonly runtime: SimRuntime;
  /** Human promotion A; its brand 0 is run by A, brand 1 is a computer GM brand. */
  readonly proA: PromotionId;
  readonly computerBrand: BrandId;
  /** Computer promotions B and C. */
  readonly proB: PromotionId;
  readonly proC: PromotionId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the runner world has no ${what}`);
  }
  return value;
}

/** A: human with a computer GM brand; B and C: computer promotions. */
export function runnerWorld(
  extra: (builder: ReturnType<typeof worldBuilder>) => void = () => undefined,
  tunableOverrides: TunableOverrides = {},
): RunnerWorld {
  const builder = worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: HUMAN }, (promotion) =>
      promotion.withBrand({ controller: null }).withBrand({ controller: COMPUTER }),
    )
    .withPromotion({ controller: COMPUTER })
    .withPromotion({ controller: COMPUTER });
  extra(builder);
  const built = builder.build();
  const runtime = createRuntime({
    world: built.world,
    tunables: createEngineTunables(tunableOverrides),
  });
  return {
    ...built,
    runtime,
    proA: required(built.ids.promotions.A, 'promotion A'),
    computerBrand: required(built.ids.brands[1], 'brand 1'),
    proB: required(built.ids.promotions.B, 'promotion B'),
    proC: required(built.ids.promotions.C, 'promotion C'),
  };
}

/** Runs `aip.runTurns` on `date` as one pipeline step. */
export function runTurnsOn(runtime: SimRuntime, date: GameDate): StepReport {
  return runStep(
    runtime,
    AIP_RUN_TURNS_PHASE_ID,
    { kind: 'phase', id: AIP_RUN_TURNS_PHASE_ID },
    runTurnsPhase.run,
    { date },
  );
}

/** Runs `aip.pruneDecisionLog` on `date` as one pipeline step. */
export function pruneOn(runtime: SimRuntime, date: GameDate): StepReport {
  return runStep(
    runtime,
    AIP_PRUNE_DECISION_LOG_PHASE_ID,
    { kind: 'phase', id: AIP_PRUNE_DECISION_LOG_PHASE_ID },
    pruneDecisionLogPhase.run,
    { date },
  );
}

/** Runs the turns on `days` days from `from`, failing the test on a failed step. */
export function runTurnsFor(runtime: SimRuntime, from: GameDate, days: number): StepReport[] {
  const reports: StepReport[] = [];
  for (let offset = 0; offset < days; offset++) {
    const report = runTurnsOn(runtime, addDays(from, offset));
    if (report.status !== 'ok') {
      throw new Error(`aip.runTurns ${report.status}: ${report.error?.message ?? ''}`);
    }
    reports.push(report);
  }
  return reports;
}
