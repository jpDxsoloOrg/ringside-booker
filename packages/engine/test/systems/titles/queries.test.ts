// The titles queries: titles.list, titles.detail and titles.eligibleHolders (CRTV1-02).
// Design: docs/design/titles.md#queries
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  initialEngineState,
  type Engine,
  type EngineState,
  type Viewer,
} from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, type GameDate } from '../../../src/core/date';
import type { PersonId, TitleId } from '../../../src/core/ids';
import type { TraceRef } from '../../../src/core/trace/store';
import type { Push } from '../../../src/model/entities/employment';
import type { Person } from '../../../src/model/entities/person';
import type { TitleReign } from '../../../src/model/entities/title-reign';
import {
  isEligibleHolder,
  PRESTIGE_NOT_KEPT_NOTE,
  PRESTIGE_TODAY_LABEL,
  PRESTIGE_WORLD_FILE_LABEL,
  TITLE_NOT_FOUND,
  titlePrestigeTraceRef,
  titlesSystem,
  type EligibleHolders,
  type TitleCardRow,
  type TitleDetail,
  type TitleListArgs,
  type TitleListResult,
} from '../../../src/systems/titles';
import { workersSystem } from '../../../src/systems/workers';
import type { DeepPartial } from '../../support/builders/build-row';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { aTeam } from '../../support/builders/promotions';
import { aTitleReign } from '../../support/builders/creative';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../support/world-builder';
import { START } from './titles-world';

const TODAY = addDays(START, 100);

const OMNISCIENT: Viewer = { kind: 'omniscient' };
const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
/** A human who runs no promotion in this world. */
const BYSTANDER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-nobody' },
};

/** Promotion A's roster: gender, weight, push and brand (0 = Alpha, 1 = Beta). */
const ROSTER: readonly {
  gender: Person['gender'];
  weightKg: number;
  push: Push;
  brand: 0 | 1;
}[] = [
  { gender: 'male', weightKg: 100, push: 'mainEvent', brand: 0 },
  { gender: 'male', weightKg: 120, push: 'midCard', brand: 0 },
  { gender: 'female', weightKg: 60, push: 'upperCard', brand: 0 },
  { gender: 'female', weightKg: 65, push: 'lowerCard', brand: 1 },
  { gender: 'male', weightKg: 90, push: 'midCard', brand: 1 },
  { gender: 'male', weightKg: 85, push: 'enhancement', brand: 1 },
];

/** Promotion A's titles, in insertion order. */
const T = {
  alphaWorld: 0,
  alphaMid: 1,
  beta: 2,
  women: 3,
  cruiser: 4,
  tag: 5,
  old: 6,
  rivalLow: 7,
  rivalHigh: 8,
  gamma: 9,
} as const;

function at<V>(list: readonly V[], index: number): V {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

/**
 * Promotion A (human, prestige 80) with brands Alpha and Beta, six wrestlers and seven titles
 * (two on Alpha, one on Beta, four promotion-wide, one of them retired). Promotion B (computer,
 * prestige 60) and C (computer, prestige 90) have titles of their own. 100 days in.
 */
function queriesWorld(): BuiltWorld {
  const person = (index: number): DeepPartial<Person> => {
    const entry = at(ROSTER, index);
    return { gender: entry.gender, weightKg: entry.weightKg };
  };
  return worldBuilder({ startDate: START, currentDate: TODAY })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        prestige: 80,
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Alpha Brand' })
          .withBrand({ name: 'Beta Brand' })
          .withRoster(6, {
            person,
            employment: (index) => ({
              push: at(ROSTER, index).push,
              ringName: `Test Ring ${String(index)}`,
            }),
          })
          .withTitle({ name: 'Alpha World Title', prestige: 90 }, { holder: 0, wonOn: day(40) })
          .withTitle({ name: 'Alpha Midcard Title', prestige: 60, introducedOn: day(10) })
          .withTitle({ name: 'Beta Title', prestige: 70 }, { holder: 5, wonOn: day(60) })
          .withTitle({
            name: "Women's Title",
            prestige: 80,
            division: { gender: 'female', minWeightKg: null, maxWeightKg: null },
          })
          .withTitle({
            name: 'Cruiser Title',
            prestige: 50,
            division: { gender: 'open', minWeightKg: null, maxWeightKg: 93 },
          })
          .withTitle({ name: 'Tag Title', prestige: 75, holderCount: 2 })
          .withTitle({
            name: 'Old Title',
            prestige: 40,
            status: 'retired',
            retiredOn: day(50),
          }),
    )
    .withPromotion({ name: 'Test Promotion B', prestige: 60 }, (promotion) =>
      promotion
        .withRoster(2)
        .withTitle({ name: 'Rival Low Title', prestige: 55 }, { holder: 0 })
        .withTitle({ name: 'Rival High Title', prestige: 65 }),
    )
    .withPromotion({ name: 'Test Promotion C', prestige: 90 }, (promotion) =>
      promotion.withRoster(1).withTitle({ name: 'Gamma Title', prestige: 30 }),
    )
    .with('brands, teams and lineage', (context) => {
      const { ids, tx } = context;
      const alpha = at(ids.brands, 0);
      const beta = at(ids.brands, 1);
      const people = ids.people;
      ROSTER.forEach((entry, index) => {
        const employment = at(ids.employments, index);
        tx.update('employments', employment, { brandId: entry.brand === 0 ? alpha : beta });
      });
      tx.update('titles', at(ids.titles, T.alphaWorld), { brandId: alpha });
      tx.update('titles', at(ids.titles, T.alphaMid), { brandId: alpha });
      tx.update('titles', at(ids.titles, T.beta), { brandId: beta });

      const team = (name: string, members: [number, number], status: 'active' | 'split') =>
        context.insert(
          'teams',
          aTeam(
            {
              name,
              memberIds: [at(people, members[0]), at(people, members[1])],
              status,
              splitOn: status === 'split' ? day(5) : null,
            },
            context.sequence,
          ),
        );
      team('Team Two Three', [2, 3], 'active');
      team('Team Four Five', [4, 5], 'active');
      team('Team Split', [0, 1], 'split');

      const reign = (titleIndex: number, overrides: DeepPartial<TitleReign>): void => {
        const holderIds = overrides.holderIds ?? [];
        context.insert(
          'titleReigns',
          aTitleReign(
            {
              titleId: at(ids.titles, titleIndex),
              holderNamesAtTime: holderIds.map((_id, index) => `Old Name ${String(index)}`),
              ...overrides,
            },
            context.sequence,
          ),
        );
      };
      // Alpha World: person 1 day 0-20 (lost, 2 defences), person 4 day 20-30 (vacated), then
      // the builder's current reign for person 0 from day 40.
      reign(T.alphaWorld, {
        holderIds: [at(people, 1)],
        wonOn: day(0),
        lostOn: day(20),
        endReason: 'lost',
        defences: 2,
      });
      reign(T.alphaWorld, {
        holderIds: [at(people, 4)],
        wonOn: day(20),
        lostOn: day(30),
        endReason: 'vacated',
      });
      // Alpha Midcard (introduced day 10): champion retired, stripped, unified; vacant since 45.
      reign(T.alphaMid, {
        holderIds: [at(people, 4)],
        wonOn: day(10),
        lostOn: day(25),
        endReason: 'retired',
      });
      reign(T.alphaMid, {
        holderIds: [at(people, 1)],
        wonOn: day(25),
        lostOn: day(35),
        endReason: 'stripped',
      });
      reign(T.alphaMid, {
        holderIds: [at(people, 0)],
        wonOn: day(35),
        lostOn: day(45),
        endReason: 'unified',
      });
      // Old Title: retired with its champion on day 50.
      reign(T.old, {
        holderIds: [at(people, 1)],
        wonOn: day(10),
        lostOn: day(50),
        endReason: 'retired',
      });
    })
    .build();
}

function day(offset: number): GameDate {
  return addDays(START, offset);
}

/** The engine on the world, with stored traces under `refs`. */
function engineOn(built: BuiltWorld, refs: readonly TraceRef[] = []): Engine {
  const state: EngineState = initialEngineState(built.world);
  const full = refs.map((ref, index) => ({
    ref,
    date: TODAY,
    seq: index + 1,
    trace: { kind: 'input' as const, label: 'Stored', value: 1 },
    value: 1,
  }));
  return createEngine({
    state: { ...state, traces: { version: 1, seq: full.length, full, summaries: [] } },
    systems: [simSystem, workersSystem, titlesSystem],
    debugChecks: true,
  });
}

function list(engine: Engine, viewer: Viewer, args: TitleListArgs): TitleListResult {
  const result = engine.query('titles.list', args, viewer);
  if (!result.ok) {
    throw new Error(`titles.list was refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function detail(engine: Engine, titleId: TitleId): TitleDetail {
  const result = engine.query('titles.detail', { titleId }, PLAYER);
  if (!result.ok) {
    throw new Error(`titles.detail was refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function eligible(engine: Engine, titleId: TitleId, includeIneligible = false): EligibleHolders {
  const result = engine.query('titles.eligibleHolders', { titleId, includeIneligible }, PLAYER);
  if (!result.ok) {
    throw new Error(`titles.eligibleHolders was refused: ${JSON.stringify(result.reasons)}`);
  }
  expectSerialisable(result.data);
  return result.data;
}

function shape(result: TitleListResult): [string | null, string, string[]][] {
  return result.groups.map((group) => [
    group.brandName,
    group.promotionName,
    group.titles.map((title) => title.name),
  ]);
}

function allRows(result: TitleListResult): TitleCardRow[] {
  return result.groups.flatMap((group) => group.titles);
}

const built = queriesWorld();
const engine = engineOn(built);
const titleId = (index: number): TitleId => at(built.ids.titles, index);
const personId = (index: number): PersonId => at(built.ids.people, index);

describe('titles.list', () => {
  it('groups our titles by brand in priority order, then promotion-wide', () => {
    const own = list(engine, PLAYER, { scope: 'own', status: 'active' });
    expect(shape(own)).toEqual([
      ['Alpha Brand', 'Test Promotion A', ['Alpha World Title', 'Alpha Midcard Title']],
      ['Beta Brand', 'Test Promotion A', ['Beta Title']],
      ['Promotion-wide', 'Test Promotion A', ["Women's Title", 'Tag Title', 'Cruiser Title']],
    ]);
    expect(own.counts).toEqual({ active: 6, retired: 1 });
    expect(own.groups.map((group) => group.brandId)).toEqual([
      at(built.ids.brands, 0),
      at(built.ids.brands, 1),
      null,
    ]);
  });

  it('groups the rest of the world by promotion, highest prestige first', () => {
    const world = list(engine, PLAYER, { scope: 'world', status: 'active' });
    expect(shape(world)).toEqual([
      [null, 'Test Promotion C', ['Gamma Title']],
      [null, 'Test Promotion B', ['Rival High Title', 'Rival Low Title']],
    ]);
    expect(world.counts).toEqual({ active: 3, retired: 0 });
  });

  it('marks only the controlling human’s titles editable', () => {
    const own = list(engine, PLAYER, { scope: 'own', status: 'all' });
    expect(allRows(own).every((row) => row.editable)).toBe(true);
    const world = list(engine, PLAYER, { scope: 'world', status: 'all' });
    expect(allRows(world).some((row) => row.editable)).toBe(false);
    const bystander = list(engine, BYSTANDER, { scope: 'world', status: 'all' });
    expect(allRows(bystander)).toHaveLength(10);
    expect(allRows(bystander).some((row) => row.editable)).toBe(false);
  });

  it('filters on status', () => {
    const retired = list(engine, PLAYER, { scope: 'own', status: 'retired' });
    expect(shape(retired)).toEqual([['Promotion-wide', 'Test Promotion A', ['Old Title']]]);
    const all = list(engine, PLAYER, { scope: 'own', status: 'all' });
    expect(at(all.groups, 2).titles.map((title) => title.name)).toEqual([
      "Women's Title",
      'Tag Title',
      'Cruiser Title',
      'Old Title',
    ]);
  });

  it('gives an omniscient viewer no own groups and every promotion, read-only', () => {
    expect(list(engine, OMNISCIENT, { scope: 'own', status: 'all' }).groups).toEqual([]);
    const world = list(engine, OMNISCIENT, { scope: 'world', status: 'active' });
    expect(shape(world)).toEqual([
      [null, 'Test Promotion C', ['Gamma Title']],
      // Inside a world group: brand priority first (Alpha, Beta, none), then prestige.
      [
        null,
        'Test Promotion A',
        [
          'Alpha World Title',
          'Alpha Midcard Title',
          'Beta Title',
          "Women's Title",
          'Tag Title',
          'Cruiser Title',
        ],
      ],
      [null, 'Test Promotion B', ['Rival High Title', 'Rival Low Title']],
    ]);
    expect(allRows(world).some((row) => row.editable)).toBe(false);
  });

  it('shows the champion, or null for a vacant title', () => {
    const rows = allRows(list(engine, PLAYER, { scope: 'own', status: 'all' }));
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get('Alpha Midcard Title')?.champion).toBeNull();
    expect(byName.get('Alpha World Title')?.champion).toMatchObject({
      holders: [{ personId: personId(0), ringName: 'Test Ring 0' }],
      teamId: null,
      wonOn: day(40),
      daysHeld: 60,
      defences: 0,
    });
    expect(byName.get('Cruiser Title')?.divisionLabel).toBe('Cruiserweight: up to 93 kg');
    expect(byName.get("Women's Title")?.divisionLabel).toBe("Women's");
    expect(byName.get('Tag Title')?.divisionLabel).toBe('Open');
  });
});

describe('the prestige Why?', () => {
  it('says a title from the world file got its prestige there', () => {
    const row = detail(engine, titleId(T.alphaWorld)).title;
    expect(row.prestigeTraceRef).toBeNull();
    expect(row.prestigeTrace).toEqual({
      kind: 'input',
      label: PRESTIGE_WORLD_FILE_LABEL,
      value: 90,
      unit: 'points',
      ref: { kind: 'title', id: titleId(T.alphaWorld) },
    });
  });

  it('says the breakdown is gone for a later title with nothing stored', () => {
    const row = detail(engine, titleId(T.alphaMid)).title;
    expect(row.prestigeTraceRef).toBeNull();
    expect(row.prestigeTrace).toMatchObject({ kind: 'formula', value: 60 });
    expect(JSON.stringify(row.prestigeTrace)).toContain(PRESTIGE_TODAY_LABEL);
    expect(JSON.stringify(row.prestigeTrace)).toContain(PRESTIGE_NOT_KEPT_NOTE);
  });

  it('points at the stored trace once one is recorded', () => {
    const ref = titlePrestigeTraceRef(titleId(T.alphaWorld));
    const row = detail(engineOn(built, [ref]), titleId(T.alphaWorld)).title;
    expect(row.prestigeTraceRef).toEqual(ref);
    expect(row.prestigeTrace).toBeNull();
  });

  it('is set on every row, never both', () => {
    for (const row of allRows(list(engine, OMNISCIENT, { scope: 'world', status: 'all' }))) {
      expect((row.prestigeTraceRef === null) !== (row.prestigeTrace === null)).toBe(true);
    }
  });
});

describe('titles.detail', () => {
  it('lists the lineage newest first, numbered in the order the reigns were won', () => {
    const lineage = detail(engine, titleId(T.alphaWorld));
    expect(
      lineage.reigns.map((reign) => [
        reign.number,
        reign.holders.map((holder) => holder.personId),
        reign.daysHeld,
        reign.defences,
        reign.endReasonLabel,
      ]),
    ).toEqual([
      [3, [personId(0)], 60, 0, 'Current champion'],
      [2, [personId(4)], 10, 0, 'Vacated'],
      [1, [personId(1)], 20, 2, 'Lost the title'],
    ]);
    const [current, , first] = lineage.reigns;
    expect(current?.lostOn).toBeNull();
    expect(current?.daysHeldTrace).toMatchObject({ kind: 'formula', value: 60 });
    expect(first?.holders).toEqual([
      {
        personId: personId(1),
        nameAtTime: 'Old Name 0',
        currentRingName: 'Test Ring 1',
        imageRef: null,
      },
    ]);
    expect(lineage.stats).toEqual({ totalReigns: 3, distinctChampions: 3, daysVacant: 10 });
    expect(lineage.records.longestReign?.value).toBe(60);
    expect(lineage.records.mostDefences?.personIds).toEqual([personId(1)]);
  });

  it('labels every way a reign ends', () => {
    expect(detail(engine, titleId(T.alphaMid)).reigns.map((reign) => reign.endReasonLabel)).toEqual(
      ['Unified', 'Stripped', 'Champion retired'],
    );
    expect(detail(engine, titleId(T.old)).reigns.map((reign) => reign.endReasonLabel)).toEqual([
      'Title retired',
    ]);
    // Introduced on day 10, held to day 45, vacant since.
    expect(detail(engine, titleId(T.alphaMid)).stats.daysVacant).toBe(55);
    // Retired on day 50 after one reign from day 10: counted only to the retirement.
    expect(detail(engine, titleId(T.old)).stats.daysVacant).toBe(10);
  });

  it('links a vacated reign to its stored Why?', () => {
    const vacated = at(detail(engine, titleId(T.alphaWorld)).reigns, 1);
    expect(vacated.endTraceRef).toBeNull();
    const ref: TraceRef = { kind: 'titles.vacancy', id: vacated.reignId };
    const withTrace = detail(engineOn(built, [ref]), titleId(T.alphaWorld));
    expect(at(withTrace.reigns, 1).endTraceRef).toEqual(ref);
  });

  it('refuses a title that is not there', () => {
    const result = engine.query('titles.detail', { titleId: testId('title', 999) }, PLAYER);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.map((reason) => reason.code)).toEqual([TITLE_NOT_FOUND]);
      expect(result.reasons[0]?.message).toBe("That title doesn't exist any more.");
    }
  });
});

describe('titles.eligibleHolders', () => {
  it('lists only the women on the roster for a women’s title', () => {
    const holders = eligible(engine, titleId(T.women));
    expect(holders.people.map((person) => person.personId)).toEqual([personId(2), personId(3)]);
    expect(holders.ineligible).toEqual([]);
    expect(holders.teams).toEqual([]);
    expect(at(holders.people, 0)).toMatchObject({
      ringName: 'Test Ring 2',
      gender: 'female',
      weightKg: 60,
      weightClass: 'lightweight',
      push: 'upperCard',
      sameBrand: true,
      isCurrentHolder: false,
      availability: { status: 'available' },
    });
  });

  it('gives the others back with their reasons when asked', () => {
    const holders = eligible(engine, titleId(T.women), true);
    expect(holders.ineligible.map((entry) => entry.personId)).toEqual([0, 1, 4, 5].map(personId));
    for (const entry of holders.ineligible) {
      expect(entry.reasons.map((reason) => reason.code)).toEqual(['divisionGender']);
    }
  });

  it('leaves out the too-heavy for a cruiserweight title, push order first', () => {
    const holders = eligible(engine, titleId(T.cruiser), true);
    expect(holders.people.map((person) => person.personId)).toEqual([2, 4, 3, 5].map(personId));
    expect(
      holders.ineligible.map((entry) => [
        entry.personId,
        entry.reasons.map((reason) => reason.code),
      ]),
    ).toEqual([
      [personId(0), ['aboveMaxWeight']],
      [personId(1), ['aboveMaxWeight']],
    ]);
  });

  it('puts the title’s own brand first and flags the rest as a hint only', () => {
    const holders = eligible(engine, titleId(T.beta));
    expect(holders.people.map((person) => [person.personId, person.sameBrand])).toEqual([
      [personId(4), true],
      [personId(3), true],
      [personId(5), true],
      [personId(0), false],
      [personId(2), false],
      [personId(1), false],
    ]);
    expect(holders.people.find((person) => person.isCurrentHolder)?.personId).toBe(personId(5));
  });

  it('never lists a rival’s worker, who could not be awarded it', () => {
    const rivalWorker = at(built.ids.people, 6);
    const holders = eligible(engine, titleId(T.alphaWorld), true);
    const listed = [...holders.people, ...holders.ineligible].map((entry) => entry.personId);
    expect(listed).toHaveLength(6);
    expect(listed).not.toContain(rivalWorker);
    const title = built.world.tables.titles.require(titleId(T.alphaWorld));
    const reasons = isEligibleHolder(
      built.world,
      title,
      { holderIds: [rivalWorker], teamId: null },
      TODAY,
    );
    expect(reasons.map((reason) => reason.code)).toEqual(['notOnRoster']);
  });

  it('lists active teams of the right kind first for a tag title', () => {
    const holders = eligible(engine, titleId(T.tag));
    expect(holders.holderCount).toBe(2);
    expect(holders.teams.map((team) => team.name)).toEqual(['Team Four Five', 'Team Two Three']);
    expect(at(holders.teams, 0).members.map((member) => member.personId)).toEqual([
      personId(4),
      personId(5),
    ]);
    expect(holders.people).toHaveLength(6);
  });

  it('refuses a title that is not there', () => {
    const result = engine.query(
      'titles.eligibleHolders',
      { titleId: testId('title', 999), includeIneligible: false },
      PLAYER,
    );
    expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual([TITLE_NOT_FOUND]);
  });
});
