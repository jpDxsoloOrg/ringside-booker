// Shared setup for the beat rater tests (MTCH5-03): one human-run promotion (writing 5) with three
// wrestlers of known mic and charisma and a manager, and a computer-run rival with two wrestlers.
import { expect } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type Viewer,
} from '../../../../src/core/api';
import { parseContentKey, type ContentKey } from '../../../../src/core/content-key';
import type { PersonId, PromotionId, RegionId } from '../../../../src/core/ids';
import type { GameWorld } from '../../../../src/model/tables';
import { defaultSystems } from '../../../../src/systems';
import type { PreviewAngleArgs, PreviewAngleResult } from '../../../../src/systems/match';
import { TEST_PLAYER_ID } from '../../../support/builders/build-row';
import { worldBuilder } from '../../../support';

export const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};

export const PROMO_TYPE = parseContentKey('angle.promo');
export const CONFRONTATION_TYPE = parseContentKey('angle.confrontation');
export const PROMO = parseContentKey('beat.promo');
export const WAR_OF_WORDS = parseContentKey('beat.war-of-words');
export const BRAWL = parseContentKey('beat.brawl');
export const STAREDOWN = parseContentKey('beat.staredown');

/** Mic and charisma of the three wrestlers, by roster index. */
export const TALKERS = [
  { mic: 80, charisma: 60 },
  { mic: 20, charisma: 25 },
  { mic: 55, charisma: 70 },
] as const;
export const MANAGER_MIC = 90;

export interface AngleWorld {
  readonly world: GameWorld;
  readonly engine: Engine;
  readonly promotion: PromotionId;
  readonly rival: PromotionId;
  readonly region: RegionId;
  /** The three wrestlers of promotion A. */
  readonly wrestlers: readonly [PersonId, PersonId, PersonId];
  readonly manager: PersonId;
  /** The rival's two wrestlers. */
  readonly rivals: readonly [PersonId, PersonId];
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('missing');
  }
  return value;
}

/** Sets a person's contract fields with promotion A or B (manager, morale, momentum). */
export function updateContract(
  world: GameWorld,
  personId: PersonId,
  change: Partial<{ managerPersonId: PersonId | null; morale: number; momentum: number | null }>,
): void {
  const contract = world.tables.employments
    .lookup('byPerson', personId)
    .find((employment) => employment.status === 'active');
  if (contract === undefined) {
    throw new Error(`no active contract for ${personId}`);
  }
  const result = world.transact('edit contract', (tx) => {
    tx.update('employments', contract.id, change);
  });
  if (!result.ok) {
    throw result.error;
  }
}

/** The world described at the top of the file, with an engine over it. */
export function angleWorld(): AngleWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion(
      {
        name: 'Test Promotion A',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        production: { writing: 5 },
      },
      (promotion) =>
        promotion.withRoster(4, {
          person: (index) =>
            index === 3
              ? {
                  roles: ['manager'],
                  style: 'nonWrestler',
                  attributes: { mic: MANAGER_MIC, charisma: 50 },
                }
              : { attributes: { ...at(TALKERS, index), presence: 40, broadcasting: 10 } },
          employment: (index) => (index === 3 ? { role: 'manager' } : {}),
        }),
    )
    .withPromotion(
      { name: 'Test Promotion B', controller: { kind: 'computer' }, production: { writing: 5 } },
      (promotion) => promotion.withRoster(2),
    )
    .build();
  let engine: Engine | null = null;
  return {
    world,
    // Built on first use from the world as it is then, so a test edits the world first.
    get engine(): Engine {
      engine ??= createEngine({ state: initialEngineState(world), systems: defaultSystems });
      return engine;
    },
    promotion: defined(ids.promotions.A),
    rival: defined(ids.promotions.B),
    region: at(ids.regions, 0),
    wrestlers: [at(ids.people, 0), at(ids.people, 1), at(ids.people, 2)],
    manager: at(ids.people, 3),
    rivals: [at(ids.people, 4), at(ids.people, 5)],
  };
}

/** One beat for the preview args. */
export function beatArgs(
  beatKey: ContentKey,
  groupOne: readonly PersonId[],
  groupTwo: readonly PersonId[] = [],
): PreviewAngleArgs['beats'][number] {
  return { beatKey, groupOne: [...groupOne], groupTwo: [...groupTwo] };
}

/** A midcard promo by wrestler 0, on a televised regular show in the first region. */
export function promoArgs(
  setup: AngleWorld,
  overrides: Partial<PreviewAngleArgs> = {},
): PreviewAngleArgs {
  return {
    importance: 'regular',
    regionId: setup.region,
    televised: true,
    slotRole: 'midcard',
    angleTypeKey: PROMO_TYPE,
    beats: [beatArgs(PROMO, [setup.wrestlers[0]])],
    previewSeed: 7,
    ...overrides,
  };
}

/** Runs `match.previewAngle` and fails the test on a refusal. */
export function previewAngle(
  setup: AngleWorld,
  args: PreviewAngleArgs,
  viewer: Viewer = PLAYER,
): PreviewAngleResult {
  const result = setup.engine.query('match.previewAngle', args, viewer);
  if (!result.ok) {
    expect.fail(`match.previewAngle refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}
