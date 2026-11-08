/**
 * `WorldBuilder`: a fluent way to build a valid game world in a test.
 *
 * ```ts
 * const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
 *   .withGeography('mini')
 *   .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
 *     promotion
 *       .withRoster(8)
 *       .withTitle({ name: 'Test Heavyweight Title' }, { holder: 0 })
 *       .withWeeklyShow({ name: 'Test Weekly', weekdays: [4] }),
 *   )
 *   .build();
 * ids.promotions.A; // the first promotion
 * ids.people[0]; // its first wrestler
 * ```
 *
 * The world is created with `createWorld(TABLES, meta, { idFactory, validateWrites })`, where the
 * ID factory is a fresh `TestIdSequence` (so every build mints the same IDs) and write validation
 * is on (see `write-validation.ts`). Every row goes in through one real transaction, so a world
 * the builder returns is one the write path accepted. Season 1 (active, starting on `startDate`,
 * `settings.season.lengthDays` long) is created unless `.withoutSeason()` is called.
 */

import { addDays, addYears, diffDays, parseGameDate, type Weekday } from '../../src/core/date';
import type { PromotionId } from '../../src/core/ids';
import type { Brand } from '../../src/model/entities/brand';
import type { Employment } from '../../src/model/entities/employment';
import type { EventDefinition } from '../../src/model/entities/event-definition';
import type { Person } from '../../src/model/entities/person';
import type { Promotion } from '../../src/model/entities/promotion';
import type { Title } from '../../src/model/entities/title';
import type { RowOf } from '../../src/model/table-def';
import { TABLES, type GameTables, type GameWorld } from '../../src/model/tables';
import type { AnyId, TableKey, Tx } from '../../src/model/tx';
import { createWorld, type DeepReadonly } from '../../src/model/world';
import { WorldMetaSchema, type WorldMeta } from '../../src/model/world-meta';
import {
  buildRow,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  TEST_WORLD_SETTINGS,
  type DeepPartial,
} from './builders/build-row';
import { aBrand, anEmployment, aPromotion } from './builders/promotions';
import { anEventDefinition, aSeason, aTitle, aTitleReign } from './builders/creative';
import { aContinent, aCountry, aRegion } from './builders/geography';
import { aPerson, DEFAULT_PERSON_AGE } from './builders/people';
import { TestIdSequence } from './ids';
import { testWriteValidation } from './write-validation';

// ---------------------------------------------------------------------------------------------
// World metadata

/** Metadata overrides, with the two dates as plain `YYYY-MM-DD` strings. */
export type TestMetaOverrides = Omit<DeepPartial<WorldMeta>, 'startDate' | 'currentDate'> & {
  readonly startDate?: string;
  readonly currentDate?: string;
};

/**
 * World metadata for a test world: `Test World`, starting on `TEST_START_DATE` (and still on it
 * unless `currentDate` says otherwise), seed `test-seed`, `TEST_WORLD_SETTINGS`, and one player,
 * `player-1`. `daysSimulated` follows the two dates.
 */
export function aWorldMeta(overrides: TestMetaOverrides = {}): WorldMeta {
  const startDate =
    overrides.startDate === undefined ? TEST_START_DATE : parseGameDate(overrides.startDate);
  const currentDate =
    overrides.currentDate === undefined ? startDate : parseGameDate(overrides.currentDate);
  const defaults: WorldMeta = {
    worldName: 'Test World',
    startDate,
    currentDate,
    seed: 'test-seed',
    settings: TEST_WORLD_SETTINGS,
    players: [{ playerId: TEST_PLAYER_ID, displayName: 'Test Player 1' }],
    contentPacks: [],
    contentKeys: {},
    daysSimulated: Math.max(0, diffDays(startDate, currentDate)),
  };
  return buildRow(WorldMetaSchema, 'aWorldMeta', defaults, {
    ...overrides,
    startDate,
    currentDate,
  });
}

// ---------------------------------------------------------------------------------------------
// IDs of the built world

export const PROMOTION_LABELS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
] as const;

/** Promotions are labelled `A`, `B`, ... in the order they were added. */
export type PromotionLabel = (typeof PROMOTION_LABELS)[number];

/** The IDs of every row the builder inserted, per table, in insertion order. */
export type IdLists = { -readonly [Name in keyof GameTables]: RowOf<GameTables[Name]>['id'][] };

/** `ids.people[0]`, `ids.promotions.A`, ...: named handles on a built world's rows. */
export type WorldIds = Omit<IdLists, 'promotions'> & {
  readonly promotions: Partial<Record<PromotionLabel, PromotionId>>;
};

export interface BuiltWorld {
  readonly world: GameWorld;
  readonly ids: WorldIds;
}

function emptyIdLists(): IdLists {
  return {
    people: [],
    promotions: [],
    brands: [],
    employments: [],
    teams: [],
    stables: [],
    relationships: [],
    titles: [],
    titleReigns: [],
    eventDefinitions: [],
    eventInstances: [],
    segments: [],
    participants: [],
    storylines: [],
    seasons: [],
    continents: [],
    countries: [],
    regions: [],
    venues: [],
    networks: [],
    deals: [],
    mail: [],
    news: [],
    ledgerEntries: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Build context

/** What a custom `.with(...)` step gets: the open transaction and the builder's bookkeeping. */
export interface BuildContext {
  readonly tx: Tx<GameTables>;
  /** The world's ID sequence. Pass it to the entity builders so their IDs and names follow on. */
  readonly sequence: TestIdSequence;
  /** The IDs inserted so far. */
  readonly ids: WorldIds;
  readonly meta: DeepReadonly<WorldMeta>;
  /** Inserts `row` and records its ID in `ids` (a promotion also gets the next label). */
  insert<Name extends TableKey<GameTables>>(
    table: Name,
    row: RowOf<GameTables[Name]>,
  ): RowOf<GameTables[Name]>;
}

class BuildState implements BuildContext {
  private readonly lists = emptyIdLists();
  private readonly promotionHandles: Partial<Record<PromotionLabel, PromotionId>> = {};

  constructor(
    readonly tx: Tx<GameTables>,
    readonly sequence: TestIdSequence,
  ) {}

  get meta(): DeepReadonly<WorldMeta> {
    return this.tx.view.meta;
  }

  get ids(): WorldIds {
    return { ...this.lists, promotions: this.promotionHandles };
  }

  insert<Name extends TableKey<GameTables>>(
    table: Name,
    row: RowOf<GameTables[Name]>,
  ): RowOf<GameTables[Name]> {
    const stored = this.tx.insert(table, row);
    const lists: Readonly<Record<string, AnyId[]>> = this.lists;
    lists[table]?.push(stored.id);
    const promotionId = table === 'promotions' ? this.lists.promotions.at(-1) : undefined;
    if (promotionId !== undefined) {
      const label = PROMOTION_LABELS[this.lists.promotions.length - 1];
      if (label === undefined) {
        throw new Error(
          `WorldBuilder labels at most ${String(PROMOTION_LABELS.length)} promotions`,
        );
      }
      this.promotionHandles[label] = promotionId;
    }
    return stored;
  }
}

// ---------------------------------------------------------------------------------------------
// Promotions

export interface RosterOptions {
  /** Overrides for the person at this roster index (counted across `withRoster` calls). */
  readonly person?: (rosterIndex: number) => DeepPartial<Person>;
  /** Overrides for that person's employment. */
  readonly employment?: (rosterIndex: number) => DeepPartial<Employment>;
}

export interface TitleHolding {
  /** Roster index (or indexes, for a tag or trios title) of the current champions. */
  readonly holder?: number | readonly number[];
}

export interface WeeklyShow {
  readonly name?: string;
  /** 0 = Monday .. 6 = Sunday. Mondays when left out. */
  readonly weekdays?: readonly Weekday[];
}

/** Collects what to add to one promotion. Applied in a fixed order; see `addPromotion`. */
export class PromotionBuilder {
  readonly brands: DeepPartial<Brand>[] = [];
  readonly rosters: { readonly count: number; readonly options: RosterOptions }[] = [];
  readonly titles: { readonly overrides: DeepPartial<Title>; readonly holding: TitleHolding }[] =
    [];
  readonly shows: {
    readonly show: WeeklyShow;
    readonly overrides: DeepPartial<EventDefinition>;
  }[] = [];

  /** Adds a brand. The first brand is the flagship and gets the roster and the shows. */
  withBrand(overrides: DeepPartial<Brand> = {}): this {
    this.brands.push(overrides);
    return this;
  }

  /** Adds `count` wrestlers, each with an active employment with this promotion. */
  withRoster(count: number, options: RosterOptions = {}): this {
    this.rosters.push({ count, options });
    return this;
  }

  /** Adds a title; with a `holder`, also the current reign of those roster members. */
  withTitle(overrides: DeepPartial<Title> = {}, holding: TitleHolding = {}): this {
    this.titles.push({ overrides, holding });
    return this;
  }

  /** Adds a weekly show running from the world's start date. */
  withWeeklyShow(show: WeeklyShow = {}, overrides: DeepPartial<EventDefinition> = {}): this {
    this.shows.push({ show, overrides });
    return this;
  }
}

/**
 * Adds a promotion and what its builder collected, in this order: the promotion, its brands, its
 * roster (people, then their employments with the first brand), its titles and reigns, its shows.
 * People are based in the promotion's home region, which defaults to the world's first region.
 */
function addPromotion(
  context: BuildState,
  overrides: DeepPartial<Promotion>,
  plan: PromotionBuilder,
): void {
  const [firstRegionId] = context.ids.regions;
  if (firstRegionId === undefined) {
    throw new Error('WorldBuilder: call .withGeography() before .withPromotion()');
  }
  const { sequence } = context;
  const startDate = context.meta.startDate;
  const promotion = context.insert(
    'promotions',
    aPromotion({ homeRegionId: firstRegionId, ...overrides }, sequence),
  );

  const brandIds = plan.brands.map(
    (brandOverrides, priority) =>
      context.insert(
        'brands',
        aBrand({ promotionId: promotion.id, priority, ...brandOverrides }, sequence),
      ).id,
  );
  const flagshipBrandId = brandIds[0] ?? null;

  const roster: { readonly personId: Person['id']; readonly ringName: string }[] = [];
  for (const { count, options } of plan.rosters) {
    for (let i = 0; i < count; i += 1) {
      const rosterIndex = roster.length;
      const person = context.insert(
        'people',
        aPerson(
          {
            birthRegionId: promotion.homeRegionId,
            basedInRegionId: promotion.homeRegionId,
            birthDate: addYears(startDate, -DEFAULT_PERSON_AGE),
            ...options.person?.(rosterIndex),
          },
          sequence,
        ),
      );
      const employment = context.insert(
        'employments',
        anEmployment(
          {
            personId: person.id,
            promotionId: promotion.id,
            brandId: flagshipBrandId,
            offeredOn: startDate,
            startsOn: startDate,
            ringName: person.defaultRingName,
            ...options.employment?.(rosterIndex),
          },
          sequence,
        ),
      );
      roster.push({ personId: person.id, ringName: employment.ringName });
    }
  }

  for (const { overrides: titleOverrides, holding } of plan.titles) {
    const title = context.insert(
      'titles',
      aTitle({ promotionId: promotion.id, introducedOn: startDate, ...titleOverrides }, sequence),
    );
    if (holding.holder === undefined) {
      continue;
    }
    const holderIndexes = typeof holding.holder === 'number' ? [holding.holder] : holding.holder;
    const holders = holderIndexes.map((holderIndex) => {
      const member = roster[holderIndex];
      if (member === undefined) {
        throw new Error(
          `WorldBuilder: title ${title.name} names roster index ${String(holderIndex)}, but the roster has ${String(roster.length)} people`,
        );
      }
      return member;
    });
    context.insert(
      'titleReigns',
      aTitleReign(
        {
          titleId: title.id,
          holderIds: holders.map((holder) => holder.personId),
          holderNamesAtTime: holders.map((holder) => holder.ringName),
          wonOn: title.introducedOn,
        },
        sequence,
      ),
    );
  }

  for (const { show, overrides: showOverrides } of plan.shows) {
    context.insert(
      'eventDefinitions',
      anEventDefinition(
        {
          promotionId: promotion.id,
          brandId: flagshipBrandId,
          activeFrom: startDate,
          recurrence: { kind: 'weekly', weekdays: [...(show.weekdays ?? [0])] },
          ...(show.name === undefined ? {} : { name: show.name }),
          ...showOverrides,
        },
        sequence,
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Geography

/** The geography presets `withGeography` knows. */
export type GeographyPreset = 'mini';

/**
 * The mini geography: `Test Continent` with `Test Country North` and `Test Country South`, each
 * with two regions. Neighbours run in a line: North 1 - North 2 - South 1 - South 2.
 */
function addMiniGeography(context: BuildState): void {
  const { sequence } = context;
  const continent = context.insert(
    'continents',
    aContinent({ name: 'Test Continent', code: 'TCA' }, sequence),
  );
  const north = context.insert(
    'countries',
    aCountry(
      { continentId: continent.id, name: 'Test Country North', code: 'TNN', population: 3_000_000 },
      sequence,
    ),
  );
  const south = context.insert(
    'countries',
    aCountry(
      { continentId: continent.id, name: 'Test Country South', code: 'TNS', population: 2_000_000 },
      sequence,
    ),
  );
  // Mint the four IDs first: each region lists its neighbours when it is inserted.
  const regionPlans = [
    { countryId: north.id, name: 'Test Region North 1', population: 1_800_000, interest: 60 },
    { countryId: north.id, name: 'Test Region North 2', population: 1_200_000, interest: 50 },
    { countryId: south.id, name: 'Test Region South 1', population: 1_100_000, interest: 55 },
    { countryId: south.id, name: 'Test Region South 2', population: 900_000, interest: 40 },
  ].map((plan) => ({ ...plan, id: sequence.id('region') }));
  regionPlans.forEach((plan, index) => {
    const neighbourRegionIds = regionPlans
      .filter((_other, otherIndex) => Math.abs(otherIndex - index) === 1)
      .map((other) => other.id);
    context.insert(
      'regions',
      aRegion(
        {
          id: plan.id,
          countryId: plan.countryId,
          name: plan.name,
          population: plan.population,
          wrestlingInterest: plan.interest,
          neighbourRegionIds,
        },
        sequence,
      ),
    );
  });
}

// ---------------------------------------------------------------------------------------------
// The builder

type BuildStep = (context: BuildState) => void;

const GEOGRAPHY_PRESETS: Readonly<Record<GeographyPreset, BuildStep>> = {
  mini: addMiniGeography,
};

export class WorldBuilder {
  private readonly steps: BuildStep[] = [];
  private seasonCount = 1;

  constructor(private readonly metaOverrides: TestMetaOverrides = {}) {}

  /** Adds a preset geography. Call it before adding promotions. */
  withGeography(preset: GeographyPreset): this {
    this.steps.push(GEOGRAPHY_PRESETS[preset]);
    return this;
  }

  /** Adds a promotion; `configure` adds its brands, roster, titles and shows. */
  withPromotion(
    overrides: DeepPartial<Promotion> = {},
    configure?: (promotion: PromotionBuilder) => unknown,
  ): this {
    const plan = new PromotionBuilder();
    configure?.(plan);
    this.steps.push((context) => {
      addPromotion(context, overrides, plan);
    });
    return this;
  }

  /**
   * Creates `count` back-to-back seasons from the start date, each `settings.season.lengthDays`
   * long; all but the last are completed. The default is one active season.
   */
  withSeasons(count: number): this {
    this.seasonCount = count;
    return this;
  }

  /** Leaves the seasons table empty, as a world still being set up has it. */
  withoutSeason(): this {
    return this.withSeasons(0);
  }

  /** Runs a custom step inside the build transaction, after the steps added before it. */
  with(label: string, step: (context: BuildContext) => void): this {
    this.steps.push((context) => {
      try {
        step(context);
      } catch (error: unknown) {
        throw new Error(`WorldBuilder step "${label}" failed`, { cause: error });
      }
    });
    return this;
  }

  /** Builds a new world. Every call returns an identical, independent world. */
  build(): BuiltWorld {
    const meta = aWorldMeta(this.metaOverrides);
    const sequence = new TestIdSequence();
    const world = createWorld(TABLES, meta, {
      idFactory: sequence,
      validateWrites: testWriteValidation(),
    });
    const result = world.transact('build test world', (tx) => {
      const context = new BuildState(tx, sequence);
      this.addSeasons(context);
      for (const step of this.steps) {
        step(context);
      }
      return context.ids;
    });
    if (!result.ok) {
      throw new Error(`WorldBuilder could not build the world: ${result.error.message}`, {
        cause: result.error,
      });
    }
    return { world, ids: result.value };
  }

  private addSeasons(context: BuildState): void {
    const { startDate, settings } = context.meta;
    const lengthDays = settings.season.lengthDays;
    for (let number = 1; number <= this.seasonCount; number += 1) {
      const seasonStart = addDays(startDate, (number - 1) * lengthDays);
      context.insert(
        'seasons',
        aSeason(
          {
            number,
            startDate: seasonStart,
            endDate: addDays(seasonStart, lengthDays - 1),
            status: number === this.seasonCount ? 'active' : 'completed',
          },
          context.sequence,
        ),
      );
    }
  }
}

/** Starts a world builder. Dates are `YYYY-MM-DD`; the start date defaults to `TEST_START_DATE`. */
export function worldBuilder(meta: TestMetaOverrides = {}): WorldBuilder {
  return new WorldBuilder(meta);
}
