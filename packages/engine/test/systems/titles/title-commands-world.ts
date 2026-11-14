// The world the title command and orphan-phase tests share (CRTV1-03). Design: docs/design/titles.md
import { expect } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import { addDays, compareDates, type GameDate } from '../../../src/core/date';
import type { BrandId, PersonId, PromotionId, TitleId } from '../../../src/core/ids';
import type { TraceRef, StoredTraceEntry } from '../../../src/core/trace/store';
import type { Employment } from '../../../src/model/entities/employment';
import type { Title } from '../../../src/model/entities/title';
import type { TitleReign } from '../../../src/model/entities/title-reign';
import { checkWorld } from '../../../src/model/integrity';
import { compareIds } from '../../../src/model/table';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { titlesSystem } from '../../../src/systems/titles';
import { workersSystem } from '../../../src/systems/workers';
import {
  aBrand,
  aPromotion,
  aTeam,
  aTitle,
  aTitleReign,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  worldBuilder,
  type BuiltWorld,
  type DeepPartial,
} from '../../support';

export const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
export const COMPUTER: Controller = { kind: 'computer' };
export const OMNISCIENT = { kind: 'omniscient' } as const;

/** Today in the test world: a month after the start, so contracts can have ended. */
export const TODAY: GameDate = addDays(TEST_START_DATE, 30);

export interface TitleWorld {
  readonly built: BuiltWorld;
  /** Altura Pro, run by the player (prestige 80). */
  readonly altura: PromotionId;
  /** Bravo Wrestling, run by the computer. */
  readonly bravo: PromotionId;
  /** Altura Next, Altura's developmental territory (parent Altura), run by the player. */
  readonly next: PromotionId;
  readonly prime: BrandId;
  readonly closedBrand: BrandId;
  readonly bravoBrand: BrandId;
  /** Altura's wrestlers 0..5: 0 holds the Television title, 2 and 3 are The Night Shift. */
  readonly people: readonly PersonId[];
  /** Bravo's wrestlers: 0 holds the Bravo title. */
  readonly bravoPeople: readonly PersonId[];
  readonly vacant: TitleId;
  readonly television: TitleId;
  readonly tag: TitleId;
  readonly legends: TitleId;
  readonly bravoTitle: TitleId;
  readonly nextTitle: TitleId;
}

export interface TitleWorldOptions {
  /** Changes to Altura's roster contracts, by roster index. */
  readonly employment?: (rosterIndex: number) => DeepPartial<Employment>;
  /** Changes to Bravo's roster contracts, by roster index. */
  readonly bravoEmployment?: (rosterIndex: number) => DeepPartial<Employment>;
  /** Holders of the tag title (Altura roster indexes), if it should be held. */
  readonly tagHolders?: readonly [number, number];
  /** An Altura roster index to leave holding the retired Legends Title (an old save's leftover). */
  readonly legendsHolder?: number;
}

function at<T>(list: readonly T[], index: number, what: string): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`The title world has no ${what} at ${String(index)}`);
  }
  return value;
}

/**
 * Altura Pro (player, prestige 80): 6 wrestlers, brands Altura Prime and the closed Altura Classic,
 * titles: the vacant Altura Championship, the Television title (held by wrestler 0), the tag title
 * (vacant unless `tagHolders`) and the retired Legends Title. Bravo Wrestling (computer): 2
 * wrestlers, its title held by its wrestler 0. Altura Next (player, parent Altura): the Next
 * Championship, held by Altura's wrestler 1, who has no contract with Altura Next.
 */
export function titleWorld(options: TitleWorldOptions = {}): TitleWorld {
  const handles: { next?: PromotionId; nextTitle?: TitleId } = {};
  const built = worldBuilder({ currentDate: TODAY })
    .withGeography('mini')
    .withPromotion({ name: 'Altura Pro', prestige: 80, controller: PLAYER }, (promotion) =>
      promotion
        .withBrand({ name: 'Altura Prime' })
        .withBrand({ name: 'Altura Classic', active: false })
        .withRoster(6, options.employment === undefined ? {} : { employment: options.employment })
        .withTitle({ name: 'Altura Championship' })
        .withTitle({ name: 'Altura Television Title' }, { holder: 0 })
        .withTitle(
          { name: 'Altura Tag Team Championship', holderCount: 2 },
          options.tagHolders === undefined ? {} : { holder: [...options.tagHolders] },
        )
        .withTitle(
          {
            name: 'Altura Legends Title',
            status: 'retired',
            retiredOn: addDays(TEST_START_DATE, 10),
          },
          options.legendsHolder === undefined ? {} : { holder: options.legendsHolder },
        ),
    )
    .withPromotion({ name: 'Bravo Wrestling' }, (promotion) =>
      promotion
        .withBrand({ name: 'Bravo Live' })
        .withRoster(
          2,
          options.bravoEmployment === undefined ? {} : { employment: options.bravoEmployment },
        )
        .withTitle({ name: 'Bravo Championship' }, { holder: 0 }),
    )
    .with('The Night Shift, and Altura Next with its title', (context) => {
      const people = context.ids.people;
      const altura = context.ids.promotions.A;
      if (altura === undefined) {
        throw new Error('no Altura');
      }
      context.insert(
        'teams',
        aTeam(
          {
            name: 'The Night Shift',
            memberIds: [at(people, 2, 'person'), at(people, 3, 'person')],
          },
          context.sequence,
        ),
      );
      const next = context.insert(
        'promotions',
        aPromotion(
          {
            name: 'Altura Next',
            controller: PLAYER,
            parentPromotionId: altura,
            homeRegionId: at(context.ids.regions, 0, 'region'),
          },
          context.sequence,
        ),
      );
      context.insert('brands', aBrand({ promotionId: next.id }, context.sequence));
      const title = context.insert(
        'titles',
        aTitle({ promotionId: next.id, name: 'Next Championship' }, context.sequence),
      );
      const holder = at(people, 1, 'person');
      context.insert(
        'titleReigns',
        aTitleReign(
          {
            titleId: title.id,
            holderIds: [holder],
            holderNamesAtTime: ['Next Champion'],
            wonOn: TEST_START_DATE,
          },
          context.sequence,
        ),
      );
      handles.next = next.id;
      handles.nextTitle = title.id;
    })
    .build();
  const { promotions, brands, people, titles } = built.ids;
  const { next, nextTitle } = handles;
  if (
    promotions.A === undefined ||
    promotions.B === undefined ||
    next === undefined ||
    nextTitle === undefined
  ) {
    throw new Error('The title world is missing a promotion');
  }
  return {
    built,
    altura: promotions.A,
    bravo: promotions.B,
    next,
    prime: at(brands, 0, 'brand'),
    closedBrand: at(brands, 1, 'brand'),
    bravoBrand: at(brands, 2, 'brand'),
    people: people.slice(0, 6),
    bravoPeople: people.slice(6, 8),
    vacant: at(titles, 0, 'title'),
    television: at(titles, 1, 'title'),
    tag: at(titles, 2, 'title'),
    legends: at(titles, 3, 'title'),
    bravoTitle: at(titles, 4, 'title'),
    nextTitle,
  };
}

/** An engine over the world with only the systems these tests need. */
export function titleEngine(
  world: TitleWorld,
  tunableOverrides: EngineState['tunableOverrides'] = {},
): Engine {
  const state = initialEngineState(world.built.world);
  return createEngine({
    state: { ...state, tunableOverrides },
    systems: [simSystem, workersSystem, titlesSystem],
    debugChecks: true,
  });
}

export function titleIn(engine: Engine, titleId: TitleId): Title {
  const title = engine.exportState().world.tables.titles.find((row) => row.id === titleId);
  if (title === undefined) {
    throw new Error(`No title ${titleId}`);
  }
  return title;
}

/** The title's reigns, oldest first (engine IDs are random): by start day, the ended one first. */
export function reignsOf(engine: Engine, titleId: TitleId): TitleReign[] {
  return engine
    .exportState()
    .world.tables.titleReigns.filter((reign) => reign.titleId === titleId)
    .sort(
      (left, right) =>
        compareDates(left.wonOn, right.wonOn) ||
        Number(left.lostOn === null) - Number(right.lostOn === null) ||
        compareIds(left.id, right.id),
    );
}

/** The open reign, or undefined when vacant. */
export function openReignOf(engine: Engine, titleId: TitleId): TitleReign | undefined {
  return reignsOf(engine, titleId).find((reign) => reign.lostOn === null);
}

/** Every `title.*` event so far, oldest first. */
export function titleEvents(engine: Engine): AnyDomainEvent[] {
  const result = engine.query('sim.recentEvents', { limit: 500 }, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data.filter((event) => event.type.startsWith('title.'));
}

export function storedTrace(engine: Engine, ref: TraceRef): StoredTraceEntry | null {
  const result = engine.query('trace.get', { ref }, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data;
}

/** Runs one day and fails the test if a step failed. */
export async function runOneDay(engine: Engine): Promise<void> {
  const result = await engine.advanceDays({ maxDays: 1 });
  expect(result.failures).toEqual([]);
  expect(result.daysAdvanced).toBe(1);
}

/** The codes of every integrity problem in the engine's world (empty when it is sound). */
export function engineIntegrityCodes(engine: Engine): string[] {
  const world = documentToWorld({ state: { world: engine.exportState().world } }, TABLES);
  return checkWorld(world, TABLES, { validateRows: true }).issues.map((issue) => issue.code);
}
