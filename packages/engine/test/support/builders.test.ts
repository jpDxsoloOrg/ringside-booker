import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { weekday } from '../../src/core/date';
import { BrandSchema } from '../../src/model/entities/brand';
import { DealSchema } from '../../src/model/entities/deal';
import { EmploymentSchema } from '../../src/model/entities/employment';
import { EventDefinitionSchema } from '../../src/model/entities/event-definition';
import { EventInstanceSchema } from '../../src/model/entities/event-instance';
import { ContinentSchema, CountrySchema, RegionSchema } from '../../src/model/entities/geography';
import { LedgerEntrySchema } from '../../src/model/entities/ledger-entry';
import { MailSchema } from '../../src/model/entities/mail';
import { NetworkSchema } from '../../src/model/entities/network';
import { NewsSchema } from '../../src/model/entities/news';
import { ParticipantSchema } from '../../src/model/entities/participant';
import { PersonSchema } from '../../src/model/entities/person';
import { PromotionSchema } from '../../src/model/entities/promotion';
import { RelationshipSchema } from '../../src/model/entities/relationship';
import { SeasonSchema } from '../../src/model/entities/season';
import { AngleSegmentSchema, MatchSegmentSchema } from '../../src/model/entities/segment';
import { StableSchema } from '../../src/model/entities/stable';
import { StorylineSchema } from '../../src/model/entities/storyline';
import { TeamSchema } from '../../src/model/entities/team';
import { TitleSchema } from '../../src/model/entities/title';
import { TitleReignSchema } from '../../src/model/entities/title-reign';
import { VenueSchema } from '../../src/model/entities/venue';
import type { GameWorld } from '../../src/model/tables';
import { aWorldMeta, worldBuilder } from './world-builder';
import { expectChange, expectValidWorld } from './assertions';
import {
  aBrand,
  aContinent,
  aCountry,
  aDeal,
  aLedgerEntry,
  aMail,
  aMatch,
  anAngle,
  aNetwork,
  aNews,
  anEmployment,
  anEventDefinition,
  anEventInstance,
  aParticipant,
  aPerson,
  aPromotion,
  aRegion,
  aRelationship,
  aSeason,
  aStable,
  aStoryline,
  aTeam,
  aTitle,
  aTitleReign,
  aVenue,
  emptyWorld,
  rosterWorld,
  testId,
  tinyWorld,
  TEST_WORLD_SETTINGS,
} from './index';
import { serialiseWorld } from './serialise';
import { measureBestAgainstReference } from './cpu-budget';

const builderCases: readonly (readonly [string, () => unknown, z.ZodType])[] = [
  ['aPerson', () => aPerson(), PersonSchema],
  ['aPromotion', () => aPromotion(), PromotionSchema],
  ['aBrand', () => aBrand(), BrandSchema],
  ['anEmployment', () => anEmployment(), EmploymentSchema],
  ['aTeam', () => aTeam(), TeamSchema],
  ['aStable', () => aStable(), StableSchema],
  ['aRelationship', () => aRelationship(), RelationshipSchema],
  ['aTitle', () => aTitle(), TitleSchema],
  ['aTitleReign', () => aTitleReign(), TitleReignSchema],
  ['anEventDefinition', () => anEventDefinition(), EventDefinitionSchema],
  ['anEventInstance', () => anEventInstance(), EventInstanceSchema],
  ['aMatch', () => aMatch(), MatchSegmentSchema],
  ['anAngle', () => anAngle(), AngleSegmentSchema],
  ['aParticipant', () => aParticipant(), ParticipantSchema],
  ['aStoryline', () => aStoryline(), StorylineSchema],
  ['aSeason', () => aSeason(), SeasonSchema],
  ['aContinent', () => aContinent(), ContinentSchema],
  ['aCountry', () => aCountry(), CountrySchema],
  ['aRegion', () => aRegion(), RegionSchema],
  ['aVenue', () => aVenue(), VenueSchema],
  ['aNetwork', () => aNetwork(), NetworkSchema],
  ['aDeal', () => aDeal(), DealSchema],
  ['aMail', () => aMail(), MailSchema],
  ['aNews', () => aNews(), NewsSchema],
  ['aLedgerEntry', () => aLedgerEntry(), LedgerEntrySchema],
];

function rowCounts(world: GameWorld): Record<string, number> {
  const tables: Readonly<Record<string, { readonly size: number }>> = world.tables;
  return Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.size]));
}

describe('entity builders', () => {
  it.each(builderCases)("%s's default output passes its schema", (_name, build, schema) => {
    expect(schema.safeParse(build()).success).toBe(true);
  });

  it('mints readable sequential IDs per kind', () => {
    expect([aPerson().id, aPerson().id, aPromotion().id]).toEqual([
      'per_0000000001',
      'per_0000000002',
      'pro_0000000001',
    ]);
  });

  it('starts again from 1 in every test (the setup file resets TestIds)', () => {
    const person = aPerson();
    expect(person.id).toBe('per_0000000001');
    expect(person.defaultRingName).toBe('Test Person 001');
  });

  it('accepts an explicit id', () => {
    expect(aPerson({ id: testId('person', 42) }).id).toBe('per_000000001a');
  });

  it('has boring documented person defaults', () => {
    const person = aPerson();
    expect(person.roles).toEqual(['wrestler']);
    expect(person.status).toBe('active');
    expect(person.birthDate).toBe('1998-01-05');
    expect(new Set(Object.values(person.attributes))).toEqual(new Set([50]));
    expect(new Set(Object.values(person.condition))).toEqual(new Set([100]));
    expect(person.traits).toEqual([]);
  });

  it('deep-merges nested overrides and keeps the other defaults', () => {
    const person = aPerson({ attributes: { mic: 90 }, condition: { legs: 40 } });
    expect(person.attributes.mic).toBe(90);
    expect(person.attributes.ringwork).toBe(50);
    expect(person.condition.legs).toBe(40);
    expect(person.condition.head).toBe(100);
    const employment = anEmployment({ terms: { exclusive: false } });
    expect(employment.terms.exclusive).toBe(false);
    expect(employment.terms.kind).toBe('written');
  });

  it('replaces a nested union value of a different kind instead of merging it', () => {
    const definition = anEventDefinition({
      recurrence: { kind: 'monthly', week: 'last', weekday: 6 },
    });
    expect(definition.recurrence).toEqual({ kind: 'monthly', week: 'last', weekday: 6 });
  });

  it('throws a readable error when overrides make an invalid row', () => {
    expect(() => aPerson({ heightCm: 20 })).toThrow(/aPerson: .*\n {2}heightCm:/);
  });

  it('gives matches the next free main-card slot of their instance', () => {
    const otherInstance = testId('eventInstance', 2);
    expect(aMatch().slot).toBe(0);
    expect(anAngle().slot).toBe(1);
    expect(aMatch({ slot: 3 }).slot).toBe(3);
    expect(aMatch().slot).toBe(2);
    expect(aMatch({ eventInstanceId: otherInstance }).slot).toBe(0);
    expect(aMatch({ preShow: true }).slot).toBe(0);
  });

  it('keeps dependent defaults consistent', () => {
    expect(aTitleReign({ lostOn: aTitleReign().wonOn }).endReason).toBe('lost');
    expect(anEventInstance({ status: 'completed' }).result).not.toBeNull();
    expect(aLedgerEntry({ category: 'wages' }).amount).toBeLessThan(0);
    const relationship = aRelationship({
      personAId: testId('person', 9),
      personBId: testId('person', 3),
    });
    expect([relationship.personAId, relationship.personBId]).toEqual([
      testId('person', 3),
      testId('person', 9),
    ]);
  });

  it('uses the documented world settings', () => {
    expect(aWorldMeta().settings).toEqual({
      agingEnabled: true,
      sandbox: false,
      generationLevel: 'off',
      levelPlayingField: false,
      season: { lengthDays: 91 },
      extra: {},
    });
    expect(TEST_WORLD_SETTINGS.season.lengthDays).toBe(91);
  });
});

describe('WorldBuilder', () => {
  it('builds the documented example with named handles', () => {
    const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
      .withGeography('mini')
      .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
        promotion
          .withRoster(8)
          .withTitle({ name: 'Test Heavyweight Title' }, { holder: 0 })
          .withWeeklyShow({ name: 'Test Weekly', weekdays: [4] }),
      )
      .build();
    expectValidWorld(world);
    expect(ids.promotions.A).toBe('pro_0000000001');
    expect(ids.people[0]).toBe('per_0000000001');
    expect(ids.people).toHaveLength(8);
    const reign = world.tables.titleReigns.lookupOne('openByTitle', ids.titles[0]!);
    expect(reign?.holderIds).toEqual([ids.people[0]]);
    const show = world.tables.eventDefinitions.require(ids.eventDefinitions[0]!);
    expect(show.recurrence).toEqual({ kind: 'weekly', weekdays: [4] });
    expect(weekday(world.meta.startDate)).toBe(0);
  });

  it('creates an active season 1 from the start date unless told not to', () => {
    const { world } = worldBuilder({ startDate: '2026-03-02' }).build();
    expect(world.tables.seasons.values()).toEqual([
      {
        id: 'sea_0000000001',
        number: 1,
        startDate: '2026-03-02',
        endDate: '2026-05-31',
        status: 'active',
      },
    ]);
    expect(worldBuilder().withoutSeason().build().world.tables.seasons.size).toBe(0);
  });

  it('builds the mini geography with placeholder names and mutual neighbours', () => {
    const { world } = worldBuilder().withGeography('mini').build();
    expectValidWorld(world);
    expect(world.tables.continents.values().map((row) => row.name)).toEqual(['Test Continent']);
    expect(world.tables.countries.values().map((row) => row.name)).toEqual([
      'Test Country North',
      'Test Country South',
    ]);
    expect(world.tables.regions.size).toBe(4);
  });

  it('mints later tx.create IDs from the same sequence', () => {
    const { world } = worldBuilder().withGeography('mini').build();
    const result = world.transact('add a region', (tx) =>
      tx.create('regions', {
        countryId: testId('country'),
        name: 'Test Region Extra',
        population: 1000,
        wrestlingInterest: 10,
        preferredStyle: null,
        neighbourRegionIds: [],
      }),
    );
    expectChange(result, { table: 'regions', inserted: ['reg_0000000005'] });
  });

  it('refuses promotions before geography', () => {
    expect(() => worldBuilder().withPromotion().build()).toThrow(/withGeography/);
  });
});

describe('canned worlds', () => {
  it('emptyWorld holds metadata and no rows', () => {
    const { world } = emptyWorld();
    expectValidWorld(world);
    expect(Object.values(rowCounts(world)).every((count) => count === 0)).toBe(true);
  });

  it('tinyWorld is valid', () => {
    expectValidWorld(tinyWorld().world);
  });

  it('tinyWorld has the documented contents', () => {
    const { world, ids } = tinyWorld();
    expect(rowCounts(world)).toEqual({
      people: 16,
      promotions: 2,
      brands: 1,
      employments: 16,
      teams: 1,
      stables: 1,
      relationships: 2,
      titles: 2,
      titleReigns: 4,
      eventDefinitions: 1,
      eventInstances: 1,
      segments: 4,
      participants: 8,
      storylines: 1,
      seasons: 2,
      continents: 1,
      countries: 2,
      regions: 4,
      venues: 1,
      networks: 1,
      deals: 1,
      mail: 2,
      news: 2,
      ledgerEntries: 5,
      popularityShowChanges: 1,
      aftermaths: 2,
      promotionSnapshots: 3,
    });
    expect(world.tables.promotions.require(ids.promotions.A!).controller).toEqual({
      kind: 'human',
      playerId: 'player-1',
    });
    expect(world.tables.promotions.require(ids.promotions.B!).controller).toEqual({
      kind: 'computer',
    });
    for (const titleId of ids.titles) {
      const reigns = world.tables.titleReigns.lookup('byTitle', titleId);
      expect(reigns.filter((reign) => reign.lostOn === null)).toHaveLength(1);
      expect(reigns.filter((reign) => reign.lostOn !== null)).toHaveLength(1);
      const { introducedOn } = world.tables.titles.require(titleId);
      for (const reign of reigns) {
        expect(reign.wonOn >= introducedOn, `${reign.id} won before its title existed`).toBe(true);
      }
    }
    const [show] = world.tables.eventInstances.values();
    expect(show?.status).toBe('completed');
    expect(show?.format).toEqual({ slots: 6, preShowSlots: 1 });
    const card = world.tables.segments
      .lookup('byEventInstance', show!.id)
      .map((segment) => [segment.preShow, segment.slot, segment.kind]);
    expect(card).toEqual([
      [false, 0, 'match'],
      [false, 1, 'angle'],
      [false, 2, 'match'],
      [true, 0, 'match'],
    ]);
    const seasons = world.tables.seasons.values().map((season) => season.status);
    expect(seasons).toEqual(['completed', 'active']);
    expect(world.tables.mail.values().filter((mail) => mail.decision !== null)).toHaveLength(1);
    expect(world.tables.deals.values()[0]?.status).toBe('active');
  });

  it('tinyWorld builds to identical JSON every time', () => {
    expect(serialiseWorld(tinyWorld().world)).toBe(serialiseWorld(tinyWorld().world));
  });

  it('rosterWorld builds identically, with varied attributes and no randomness', () => {
    const first = rosterWorld(12);
    expect(serialiseWorld(first.world)).toBe(serialiseWorld(rosterWorld(12).world));
    const rings = first.world.tables.people.values().map((person) => person.attributes.ringwork);
    expect(new Set(rings).size).toBeGreaterThan(6);
    expect(first.world.tables.employments.size).toBe(12);
  });

  // A wall-clock bound of 500 ms failed under load (a cold first build alone took 340 ms), so the
  // CPU time is compared with a reference workload measured in the same process (see
  // cpu-budget.ts), the cheapest of three builds. The budget is the old 500 ms over the
  // reference's 50 ms on a laptop; a warm build costs about one reference.
  it('rosterWorld(300) is valid and builds in under 10 reference workloads of CPU time', () => {
    let built: ReturnType<typeof rosterWorld> | undefined;
    const timing = measureBestAgainstReference(() => {
      built = rosterWorld(300);
    }, 3);
    expect(
      timing.ratio,
      `${timing.workMs.toFixed(0)} ms of CPU time against ${timing.referenceMs.toFixed(1)} ms for the reference`,
    ).toBeLessThan(10);
    expect(built?.world.tables.people.size).toBe(300);
    expectValidWorld(built!.world);
  });

  it('uses only placeholder names (the shipped catalogs on its metadata aside)', () => {
    const names: string[] = [];
    const withoutCatalogs = JSON.stringify(
      JSON.parse(serialiseWorld(tinyWorld().world), (key, value: unknown) =>
        key === 'catalogs' ? undefined : value,
      ),
    );
    JSON.parse(withoutCatalogs, (key, value: unknown) => {
      const isName = ['name', 'worldName', 'defaultRingName', 'ringName', 'displayName'];
      if (isName.includes(key) && typeof value === 'string') {
        names.push(value);
      }
      return value;
    });
    expect(names.length).toBeGreaterThan(40);
    expect(names.filter((name) => !name.startsWith('Test '))).toEqual([]);
  });
});

describe('@ringside/engine/testing', () => {
  it('resolves through the package export map to the same modules', async () => {
    const testing = await import('@ringside/engine/testing');
    expect(testing.tinyWorld).toBe(tinyWorld);
    expect(testing.aPerson).toBe(aPerson);
    expect(testing.expectValidWorld).toBe(expectValidWorld);
  });
});
