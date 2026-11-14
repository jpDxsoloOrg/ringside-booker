/**
 * The world and engine the ECO4-03 tests share (unhappy workers, release requests, walk-outs).
 *
 * "My Wrestling" (the player) has four workers, all at morale 0, with long contracts:
 * - 0 `worker`: mid card, $8,000 a month, 500 days left;
 * - 1 `ironClad`: mid card with the iron-clad perk;
 * - 2 `storied`: mid card, the only member of "Hot Angle" (active, heat 70 unless given);
 * - 3 `owner`: owns the promotion, open-ended.
 *
 * "Rival Wrestling" (the computer) has three: 0 `rivalChampion` (lower card, holds "Rival Title"),
 * 1 `rivalMainEvent` (main event) and 2 `rivalLower` (lower card), each with 300 days left.
 *
 * Morale only moves through WRK1's door: `setMorale` queues a target, and the test system's phase
 * (`unhappyTest.setMorale`, before the contracts phases) applies the difference the next day.
 */

import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { AnyDomainEvent } from '../../../src/core/events';
import { addDays, type GameDate } from '../../../src/core/date';
import type { EmploymentId, PromotionId, StorylineId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { Employment } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import { contractsSystem } from '../../../src/systems/contracts';
import { financeSystem } from '../../../src/systems/finance';
import { applyMoraleChange } from '../../../src/systems/workers';
import {
  aStoryline,
  resetTestIds,
  TEST_START_DATE,
  worldBuilder,
  type DeepPartial,
} from '../../support';
import { edit, PLAYER } from './release-world';

export const STORY_NAME = 'Hot Angle';
export const RIVAL_TITLE = 'Rival Title';
export const TEST_MORALE_REASON = { key: 'test.morale', label: 'Test morale' };

const TODAY = TEST_START_DATE;

const HUMAN_ROSTER: readonly DeepPartial<Employment>[] = [
  { push: 'midCard', endsOn: addDays(TODAY, 500), terms: { monthlyWage: cents(800_000) } },
  { push: 'midCard', endsOn: addDays(TODAY, 500), terms: { perks: { ironClad: true } } },
  { push: 'midCard', endsOn: addDays(TODAY, 500) },
  { push: 'none', endsOn: null },
];
const RIVAL_ROSTER: readonly DeepPartial<Employment>[] = [
  { push: 'lowerCard', endsOn: addDays(TODAY, 300), terms: { monthlyWage: cents(500_000) } },
  { push: 'mainEvent', endsOn: addDays(TODAY, 300), terms: { monthlyWage: cents(500_000) } },
  { push: 'lowerCard', endsOn: addDays(TODAY, 300), terms: { monthlyWage: cents(500_000) } },
];

export interface UnhappyWorld {
  readonly world: GameWorld;
  readonly human: PromotionId;
  readonly rival: PromotionId;
  readonly worker: EmploymentId;
  readonly ironClad: EmploymentId;
  readonly storied: EmploymentId;
  readonly owner: EmploymentId;
  readonly rivalChampion: EmploymentId;
  readonly rivalMainEvent: EmploymentId;
  readonly rivalLower: EmploymentId;
  readonly storyline: StorylineId;
  readonly today: GameDate;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`unhappy world: missing ${what}`);
  }
  return value;
}

export function unhappyWorld(options: { readonly heat?: number } = {}): UnhappyWorld {
  resetTestIds();
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'My Wrestling', controller: PLAYER }, (promotion) =>
      promotion.withRoster(HUMAN_ROSTER.length, {
        employment: (index) => HUMAN_ROSTER[index] ?? {},
      }),
    )
    .withPromotion({ name: 'Rival Wrestling' }, (promotion) =>
      promotion
        .withRoster(RIVAL_ROSTER.length, { employment: (index) => RIVAL_ROSTER[index] ?? {} })
        .withTitle({ name: RIVAL_TITLE }, { holder: 0 }),
    )
    .build();
  const human = required(ids.promotions.A, 'A');
  const rival = required(ids.promotions.B, 'B');
  const ownerPerson = required(ids.people[3], 'owner person');
  const storiedPerson = required(ids.people[2], 'storied person');
  let storyline: StorylineId | undefined;
  edit(world, (tx) => {
    tx.update('promotions', human, { ownerPersonId: ownerPerson });
    storyline = tx.insert(
      'storylines',
      aStoryline({
        id: tx.mintId('storylines'),
        promotionId: human,
        name: STORY_NAME,
        heat: options.heat ?? 70,
        members: [{ personId: storiedPerson, side: 'face' }],
      }),
    ).id;
  });
  const [worker, ironClad, storied, owner, rivalChampion, rivalMainEvent, rivalLower] =
    ids.employments;
  return {
    world,
    human,
    rival,
    worker: required(worker, 'worker'),
    ironClad: required(ironClad, 'iron-clad'),
    storied: required(storied, 'storied'),
    owner: required(owner, 'owner'),
    rivalChampion: required(rivalChampion, 'rival champion'),
    rivalMainEvent: required(rivalMainEvent, 'rival main eventer'),
    rivalLower: required(rivalLower, 'rival lower carder'),
    storyline: required(storyline, 'storyline'),
    today: world.meta.currentDate,
  };
}

export interface UnhappyEngine {
  readonly engine: Engine;
  /** Every committed event, in order. */
  readonly events: AnyDomainEvent[];
  /** Sets a worker's morale through WRK1's door at the start of the next simulated day. */
  setMorale(employmentId: EmploymentId, morale: number): void;
  /** Simulates `days` days (stopping early at a gate). Returns the days simulated. */
  advance(days: number): Promise<number>;
  today(): GameDate;
}

/** An engine over `world` with sim, finance, contracts and the morale-setting test system. */
export function unhappyEngine(
  world: GameWorld,
  overrides: Record<string, number | boolean | string> = {},
): UnhappyEngine {
  const targets = new Map<EmploymentId, number>();
  const moraleSystem = defineSystem({
    id: 'unhappyTest',
    phases: [
      definePhase({
        id: 'unhappyTest.setMorale',
        group: 'contracts',
        order: 1,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const [employmentId, morale] of targets) {
            const employment = ctx.read.tables.employments.require(employmentId);
            applyMoraleChange(ctx, {
              employmentId,
              delta: morale - employment.morale,
              source: 'system',
              reason: TEST_MORALE_REASON,
            });
          }
          targets.clear();
        },
      }),
    ],
  });
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, financeSystem, contractsSystem, moraleSystem],
  });
  for (const [key, value] of Object.entries(overrides)) {
    const set = engine.command('tunables.setOverride', { key, value }, PLAYER);
    if (!set.ok) {
      throw new Error(`could not set ${key}: ${JSON.stringify(set.reasons)}`);
    }
  }
  const events: AnyDomainEvent[] = [];
  engine.onEvent((event) => {
    events.push(event);
  });
  return {
    engine,
    events,
    setMorale: (employmentId, morale) => {
      targets.set(employmentId, morale);
    },
    advance: async (days) => (await engine.advanceDays({ maxDays: days })).daysAdvanced,
    today: () => engine.exportState().world.meta.currentDate,
  };
}

/** The worker's contract-concern row, if any. */
export function concernOf(engine: Engine, employmentId: EmploymentId) {
  return engine
    .exportState()
    .world.tables.contractConcerns.find((row) => row.employmentId === employmentId);
}
