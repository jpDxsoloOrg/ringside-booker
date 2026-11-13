// The workers list and the on-demand "Why?" behind its numbers.
// Design: docs/design/workers.md#workers-list
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, addYears } from '../../../src/core/date';
import type { ContinentId, CountryId, PersonId, PromotionId } from '../../../src/core/ids';
import { ATTRIBUTE_KEYS, type Person } from '../../../src/model/entities/person';
import {
  WORKER_EXPLAIN_METRICS,
  WORKER_NOT_FOUND,
  WORKER_SORT_DIRECTIONS,
  WORKER_SORT_KEYS,
  workersSystem,
  type WorkerList,
  type WorkerListArgs,
  type WorkerListFilters,
  type WorkerRow,
  type WorkerSortKey,
} from '../../../src/systems/workers';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import type { DeepPartial } from '../../support/builders/build-row';
import { aPerson } from '../../support/builders/people';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';
import { loadDefaultWorld } from './default-world';

const OMNISCIENT: Viewer = { kind: 'omniscient' };
const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
const BYSTANDER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-nobody' },
};
const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };
const EVERY_VIEWER: readonly Viewer[] = [OMNISCIENT, PLAYER, BYSTANDER, COMPUTER];

const TODAY = addDays(TEST_START_DATE, 100);
const SOUTH_ONE = testId('region', 3);

/** Roster index → person overrides for promotion A. */
const OWN_ROSTER: readonly DeepPartial<Person>[] = [
  {
    gender: 'female',
    style: 'technician',
    attributes: {
      ringwork: 90,
      psychology: 88,
      stamina: 86,
      safety: 86,
      athleticism: 86,
      mic: 82,
      charisma: 86,
      presence: 86,
    },
    regionalPop: { [testId('region', 1)]: 80, [SOUTH_ONE]: 20 },
    development: { potential: 640, ceilings: { ringwork: 95 } },
    vices: { alcohol: 'known', substances: 'hidden' },
  },
  {
    style: 'brawler',
    birthDate: addYears(TEST_START_DATE, -40),
    basedInRegionId: SOUTH_ONE,
    regionalPop: { [SOUTH_ONE]: 55 },
  },
  { restrictions: [{ kind: 'rehab', until: addDays(TODAY, 30) }] },
];

interface ListWorld {
  engine: Engine;
  people: PersonId[];
  peopleById: Map<PersonId, Person>;
  star: PersonId;
  veteran: PersonId;
  inRehab: PersonId;
  referee: PersonId;
  retired: PersonId;
  ownPromotionId: PromotionId;
  rivalPromotionId: PromotionId;
  southCountryId: CountryId;
  continentId: ContinentId;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`The list world is missing ${what}`);
  }
  return value;
}

/**
 * Seven people on the mini map, 100 days in. Promotion A (the human's) has a star technician, a
 * 40-year-old brawler based in the south and a wrestler in rehab. Promotion B has two wrestlers
 * who are identical apart from their names. A referee and a retired wrestler are free agents.
 */
function listWorld(): ListWorld {
  const { world, ids } = worldBuilder({ startDate: TEST_START_DATE, currentDate: TODAY })
    .withGeography('mini')
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) =>
        promotion.withRoster(3, {
          person: (rosterIndex) => OWN_ROSTER[rosterIndex] ?? {},
          employment: (rosterIndex) =>
            rosterIndex === 0
              ? { ringName: 'Test Star Name', push: 'mainEvent', alignment: 'heel', morale: 35 }
              : {},
        }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(2))
    .with('free agents', (context) => {
      context.insert(
        'people',
        aPerson(
          {
            defaultRingName: 'Test Referee',
            roles: ['referee'],
            style: 'nonWrestler',
            debutDate: null,
            attributes: { officiating: 70 },
          },
          context.sequence,
        ),
      );
      context.insert(
        'people',
        aPerson({ defaultRingName: 'Test Retired', status: 'retired' }, context.sequence),
      );
    })
    .build();

  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem],
    debugChecks: true,
  });
  const people = world.tables.people.ids().slice();
  const [southRegion] = world.tables.regions.values().filter((region) => region.id === SOUTH_ONE);
  const southCountryId = required(southRegion, 'the south region').countryId;
  return {
    engine,
    people,
    peopleById: new Map(world.tables.people.values().map((person) => [person.id, person])),
    star: required(ids.people[0], 'the star'),
    veteran: required(ids.people[1], 'the veteran'),
    inRehab: required(ids.people[2], 'the wrestler in rehab'),
    referee: required(people.at(-2), 'the referee'),
    retired: required(people.at(-1), 'the retired wrestler'),
    ownPromotionId: required(ids.promotions.A, 'promotion A'),
    rivalPromotionId: required(ids.promotions.B, 'promotion B'),
    southCountryId,
    continentId: world.tables.countries.require(southCountryId).continentId,
  };
}

function listOf(engine: Engine, args: WorkerListArgs = {}, viewer: Viewer = PLAYER): WorkerList {
  const result = engine.query('workers.list', args, viewer);
  if (!result.ok) {
    throw new Error(`workers.list was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function idsOf(list: WorkerList): PersonId[] {
  return list.rows.map((row) => row.personId);
}

function filtered(engine: Engine, filters: WorkerListFilters): PersonId[] {
  return idsOf(listOf(engine, { filters })).sort();
}

/** Every object key anywhere in `value`. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysIn(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysIn(nested, found);
    }
  }
  return found;
}

describe('workers.list: the rows', () => {
  it('lists everyone, best main-role overall first, with the counts before filters', () => {
    const world = listWorld();
    const list = listOf(world.engine);

    expect(list.total).toBe(7);
    expect(list.freeAgents).toBe(2);
    expect(list.rows).toHaveLength(7);
    expect(list.rows[0]?.personId).toBe(world.star);
    const overalls = list.rows.map((row) => row.overall);
    expect(overalls).toEqual([...overalls].sort((left, right) => right - left));
  });

  it('describes an employed person and a free agent', () => {
    const world = listWorld();
    const rows = new Map(listOf(world.engine).rows.map((row) => [row.personId, row]));

    expect(rows.get(world.star)).toMatchObject({
      ringName: 'Test Star Name',
      gender: 'female',
      roles: ['wrestler'],
      mainRole: 'wrestler',
      age: 28,
      style: 'technician',
      employer: { promotionId: world.ownPromotionId, name: 'Test Promotion A' },
      push: 'mainEvent',
      alignment: 'heel',
      availability: { status: 'available', label: 'Available', until: null },
      topPopularity: { countryName: 'Test Country North' },
    });
    const star = required(rows.get(world.star), 'the star row');
    expect(star.legalName).toMatch(/^Test /);
    expect(star.topPopularity?.value).toBeCloseTo(48, 9);
    expect(star.worldPopularity).toBeGreaterThan(0);
    expect(star.worldPopularity).toBeLessThan(48);

    expect(rows.get(world.referee)).toMatchObject({
      ringName: 'Test Referee',
      mainRole: 'referee',
      employer: null,
      push: null,
      alignment: null,
      topPopularity: null,
      worldPopularity: 0,
    });
    expect(rows.get(world.inRehab)?.availability).toEqual({
      status: 'rehab',
      label: 'In rehab',
      until: addDays(TODAY, 30),
    });
  });

  it('offers the employers and home places that appear, sorted by name', () => {
    const world = listWorld();
    const { facets } = listOf(world.engine, { filters: { employer: { kind: 'freeAgent' } } });

    expect(facets.promotions.map((promotion) => promotion.name)).toEqual([
      'Test Promotion A',
      'Test Promotion B',
    ]);
    expect(facets.continents).toEqual([{ continentId: world.continentId, name: 'Test Continent' }]);
    expect(facets.countries.map((country) => country.name)).toEqual([
      'Test Country North',
      'Test Country South',
    ]);
    expect(facets.countries.every((country) => country.continentId === world.continentId)).toBe(
      true,
    );
  });

  it('never returns development, vices, morale or contract terms, to any viewer', () => {
    const { engine } = listWorld();
    for (const viewer of EVERY_VIEWER) {
      const list = listOf(engine, {}, viewer);
      const keys = keysIn(JSON.parse(JSON.stringify(list)));
      for (const hidden of [
        'development',
        'potential',
        'ceilings',
        'vices',
        'alcohol',
        'substances',
        'morale',
        'terms',
        'monthlyWage',
        'contract',
      ]) {
        expect(keys.has(hidden), `${hidden} for a ${viewer.kind} viewer`).toBe(false);
      }
      // Push and alignment are public.
      expect(keys.has('push')).toBe(true);
      expect(keys.has('alignment')).toBe(true);
    }
  });

  it('gives every viewer the same rows', () => {
    const { engine } = listWorld();
    const [first, ...others] = EVERY_VIEWER.map((viewer) => listOf(engine, {}, viewer));
    for (const other of others) {
      expect(other).toEqual(first);
    }
  });
});

describe('workers.list: filters', () => {
  it('filters by role, status, availability, gender and style', () => {
    const world = listWorld();
    const { engine } = world;

    expect(filtered(engine, { roles: ['referee'] })).toEqual([world.referee]);
    expect(filtered(engine, { roles: ['referee', 'wrestler'] })).toHaveLength(7);
    expect(filtered(engine, { statuses: ['retired'] })).toEqual([world.retired]);
    expect(filtered(engine, { availability: ['rehab'] })).toEqual([world.inRehab]);
    expect(filtered(engine, { availability: ['retired', 'rehab'] })).toEqual(
      [world.inRehab, world.retired].sort(),
    );
    expect(filtered(engine, { genders: ['female'] })).toEqual([world.star]);
    expect(filtered(engine, { styles: ['brawler', 'nonWrestler'] })).toEqual(
      [world.veteran, world.referee].sort(),
    );
  });

  it('treats an empty list filter as no filter', () => {
    const { engine } = listWorld();
    expect(filtered(engine, { roles: [], genders: [], styles: [] })).toHaveLength(7);
  });

  it('filters by employer: anyone, free agents or one promotion', () => {
    const world = listWorld();
    const { engine } = world;

    expect(filtered(engine, { employer: { kind: 'any' } })).toHaveLength(7);
    expect(filtered(engine, { employer: { kind: 'freeAgent' } })).toEqual(
      [world.referee, world.retired].sort(),
    );
    expect(
      filtered(engine, { employer: { kind: 'promotion', promotionId: world.rivalPromotionId } }),
    ).toHaveLength(2);
    expect(
      filtered(engine, { employer: { kind: 'promotion', promotionId: world.ownPromotionId } }),
    ).toEqual([world.star, world.veteran, world.inRehab].sort());
  });

  it('filters by where someone is based', () => {
    const world = listWorld();
    const { engine } = world;

    expect(filtered(engine, { countryId: world.southCountryId })).toEqual([world.veteran]);
    expect(filtered(engine, { continentId: world.continentId })).toHaveLength(7);
    expect(filtered(engine, { continentId: testId('continent', 99) })).toEqual([]);
  });

  it('filters by age, both ends included', () => {
    const world = listWorld();
    const { engine } = world;

    expect(filtered(engine, { ageMin: 40 })).toEqual([world.veteran]);
    expect(filtered(engine, { ageMin: 41 })).toEqual([]);
    expect(filtered(engine, { ageMax: 28 })).toHaveLength(6);
    expect(filtered(engine, { ageMax: 27 })).toEqual([]);
    expect(filtered(engine, { ageMin: 28, ageMax: 40 })).toHaveLength(7);
  });

  it('filters by attribute minimums and by overall', () => {
    const world = listWorld();
    const { engine } = world;

    expect(filtered(engine, { attributeMin: [{ attribute: 'ringwork', min: 90 }] })).toEqual([
      world.star,
    ]);
    expect(filtered(engine, { attributeMin: [{ attribute: 'officiating', min: 70 }] })).toEqual([
      world.referee,
    ]);
    expect(
      filtered(engine, {
        attributeMin: [
          { attribute: 'ringwork', min: 90 },
          { attribute: 'officiating', min: 70 },
        ],
      }),
    ).toEqual([]);

    const starOverall = required(
      listOf(engine).rows.find((row) => row.personId === world.star),
      'the star row',
    ).overall;
    expect(filtered(engine, { overallMin: starOverall })).toEqual([world.star]);
    expect(filtered(engine, { overallMin: 0 })).toHaveLength(7);
  });

  it('combines filters: every one must pass', () => {
    const world = listWorld();
    const { engine } = world;

    expect(
      filtered(engine, {
        roles: ['wrestler'],
        employer: { kind: 'promotion', promotionId: world.ownPromotionId },
        availability: ['available'],
        ageMax: 30,
      }),
    ).toEqual([world.star]);
    expect(filtered(engine, { employer: { kind: 'freeAgent' }, statuses: ['active'] })).toEqual([
      world.referee,
    ]);
  });

  it('shows a retired person unless a status filter leaves them out', () => {
    const world = listWorld();
    const { engine } = world;

    expect(idsOf(listOf(engine))).toContain(world.retired);
    expect(filtered(engine, { statuses: ['active', 'retired'] })).toContain(world.retired);
    expect(filtered(engine, { statuses: ['active'] })).not.toContain(world.retired);
  });

  it('answers a filter nobody passes with no rows, not a refusal', () => {
    const { engine } = listWorld();
    const result = engine.query('workers.list', { filters: { ageMin: 99 } }, PLAYER);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.rows).toEqual([]);
      expect(result.data.total).toBe(7);
      expect(result.data.freeAgents).toBe(2);
    }
  });

  it('refuses arguments it does not know', () => {
    const { engine } = listWorld();
    // A caller that sends a filter this build does not have.
    const filters: WorkerListFilters = {};
    Reflect.set(filters, 'hairColour', 'red');
    const args: WorkerListArgs = { filters };
    const result = engine.query('workers.list', args, PLAYER);
    expect(result.ok).toBe(false);
  });
});

describe('workers.list: sorting', () => {
  function expectedValue(row: WorkerRow, key: WorkerSortKey, people: Map<PersonId, Person>) {
    if (key === 'overall') return row.overall;
    if (key === 'ringName') return row.ringName.toLowerCase();
    if (key === 'age') return row.age;
    if (key === 'popularity') return row.topPopularity?.value ?? null;
    if (key === 'employer') return row.employer?.name.toLowerCase() ?? null;
    return required(people.get(row.personId), 'a person').attributes[key];
  }

  it('sorts by every key in both directions, nobody lost, ties by ring name then ID', () => {
    const world = listWorld();
    const people = world.peopleById;

    for (const key of WORKER_SORT_KEYS) {
      for (const direction of WORKER_SORT_DIRECTIONS) {
        const { rows } = listOf(world.engine, { sort: { key, direction } });
        const label = `${key} ${direction}`;
        expect(rows.map((row) => row.personId).sort(), label).toEqual([...world.people].sort());

        const sign = direction === 'asc' ? 1 : -1;
        for (let index = 1; index < rows.length; index += 1) {
          const before = required(rows[index - 1], 'a row');
          const after = required(rows[index], 'a row');
          const left = expectedValue(before, key, people);
          const right = expectedValue(after, key, people);
          if (left === null || right === null) {
            // No value goes last, whatever the direction.
            expect(left === null && right !== null, label).toBe(false);
            if (left !== right) continue;
          } else if (left !== right) {
            expect((left < right ? -1 : 1) * sign, label).toBe(-1);
            continue;
          }
          const leftName = before.ringName.toLowerCase();
          const rightName = after.ringName.toLowerCase();
          expect(leftName <= rightName, `${label}: ring name tie-break`).toBe(true);
          if (leftName === rightName) {
            expect(before.personId < after.personId, `${label}: ID tie-break`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps tied rows in the same order in both directions', () => {
    const world = listWorld();
    const tied = (direction: 'asc' | 'desc'): PersonId[] =>
      idsOf(
        listOf(world.engine, {
          filters: { employer: { kind: 'promotion', promotionId: world.rivalPromotionId } },
          sort: { key: 'age', direction },
        }),
      );
    expect(tied('asc')).toEqual(tied('desc'));
  });

  it('puts free agents last when sorting by employer, in both directions', () => {
    const world = listWorld();
    for (const direction of WORKER_SORT_DIRECTIONS) {
      const { rows } = listOf(world.engine, { sort: { key: 'employer', direction } });
      expect(rows.slice(-2).every((row) => row.employer === null)).toBe(true);
    }
  });
});

describe('workers.explain', () => {
  it('matches the list for every person and every number', () => {
    const world = listWorld();
    for (const row of listOf(world.engine).rows) {
      for (const metric of WORKER_EXPLAIN_METRICS) {
        const result = world.engine.query(
          'workers.explain',
          { personId: row.personId, metric },
          PLAYER,
        );
        if (!result.ok) {
          throw new Error(`workers.explain was refused: ${JSON.stringify(result.reasons)}`);
        }
        const listed =
          metric === 'overall'
            ? row.overall
            : metric === 'worldPopularity'
              ? row.worldPopularity
              : (row.topPopularity?.value ?? 0);
        expect(Math.abs(result.data.value - listed)).toBeLessThan(1e-9);
        expect(result.data.trace.value).toBe(result.data.value);
        expectSerialisable(result.data);
      }
    }
  });

  it('explains the overall as the main-role rating and the top popularity as its country', () => {
    const world = listWorld();
    const explain = (personId: PersonId, metric: (typeof WORKER_EXPLAIN_METRICS)[number]) => {
      const result = world.engine.query('workers.explain', { personId, metric }, PLAYER);
      if (!result.ok) {
        throw new Error(`workers.explain was refused: ${JSON.stringify(result.reasons)}`);
      }
      return result.data;
    };

    expect(explain(world.referee, 'overall').trace.label).toBe('Referee rating');
    expect(explain(world.star, 'overall').trace.label).toBe('Wrestler rating');
    expect(explain(world.star, 'topPopularity').trace.label).toContain('Test Country North');
    expect(explain(world.veteran, 'topPopularity').trace.label).toContain('Test Country South');
    // Unknown everywhere: the world roll-up, which shows the zeroes.
    expect(explain(world.referee, 'topPopularity').value).toBe(0);
  });

  it('refuses a person that does not exist', () => {
    const { engine } = listWorld();
    const result = engine.query(
      'workers.explain',
      { personId: testId('person', 999), metric: 'overall' },
      PLAYER,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons[0]?.code).toBe(WORKER_NOT_FOUND);
    }
  });
});

describe('workers.list on the default world', () => {
  const DEFAULT_WORLD_PEOPLE = 286;
  const FREE_AGENT_WRESTLERS = 35;
  const FREE_AGENT_CREW = 9;
  /** The budget for one list in node. The real figure is logged and is far below it. */
  const LIST_BUDGET_MS = 150;

  const engine = createEngine({
    state: initialEngineState(loadDefaultWorld()),
    systems: [simSystem, workersSystem],
    debugChecks: false,
  });

  it('lists all 286 people as plain JSON, inside the time budget', () => {
    // Once to warm up, then the measured run.
    listOf(engine, {}, OMNISCIENT);
    const startedAt = process.hrtime.bigint();
    const list = listOf(engine, {}, OMNISCIENT);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(`workers.list, default world, 286 rows: ${elapsedMs.toFixed(1)} ms`);

    expect(list.rows).toHaveLength(DEFAULT_WORLD_PEOPLE);
    expect(list.total).toBe(DEFAULT_WORLD_PEOPLE);
    expectSerialisable(list);
    expect(elapsedMs).toBeLessThan(LIST_BUDGET_MS);
  });

  it('finds the free-agent pool: 35 wrestlers and 9 crew', () => {
    const list = listOf(engine, { filters: { employer: { kind: 'freeAgent' } } }, OMNISCIENT);
    const wrestlers = list.rows.filter((row) => row.mainRole === 'wrestler');

    expect(list.freeAgents).toBe(FREE_AGENT_WRESTLERS + FREE_AGENT_CREW);
    expect(list.rows).toHaveLength(FREE_AGENT_WRESTLERS + FREE_AGENT_CREW);
    expect(wrestlers).toHaveLength(FREE_AGENT_WRESTLERS);
    expect(list.rows.every((row) => row.employer === null && row.push === null)).toBe(true);
  });

  it('explains every row to the same number the list shows', () => {
    for (const row of listOf(engine, {}, OMNISCIENT).rows) {
      for (const metric of WORKER_EXPLAIN_METRICS) {
        const result = engine.query('workers.explain', { personId: row.personId, metric }, PLAYER);
        if (!result.ok) {
          throw new Error(`workers.explain was refused: ${JSON.stringify(result.reasons)}`);
        }
        const listed =
          metric === 'overall'
            ? row.overall
            : metric === 'worldPopularity'
              ? row.worldPopularity
              : (row.topPopularity?.value ?? 0);
        expect(Math.abs(result.data.value - listed)).toBeLessThan(1e-9);
      }
    }
  });

  it('sorts by an attribute', () => {
    const { rows } = listOf(engine, { sort: { key: 'mic', direction: 'desc' } }, OMNISCIENT);
    expect(rows).toHaveLength(DEFAULT_WORLD_PEOPLE);
    expect(ATTRIBUTE_KEYS).toContain('mic');
  });
});

describe('workers.list: injured people (WRK6-06)', () => {
  /** Promotion A has two wrestlers; the second is out with the test arm injury. */
  function injuredWorld(): { engine: Engine; fit: PersonId; hurt: PersonId } {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withInjuryCatalog()
      .withPromotion({ name: 'Test Promotion A' }, (promotion) => promotion.withRoster(2))
      .withInjury(1)
      .build();
    const engine = createEngine({
      state: initialEngineState(world),
      systems: [simSystem, workersSystem],
      debugChecks: true,
    });
    return {
      engine,
      fit: required(ids.people[0], 'the fit wrestler'),
      hurt: required(ids.people[1], 'the injured wrestler'),
    };
  }

  it('keeps only the injured with availability ["injured"], with the injury on the row', () => {
    const { engine, hurt } = injuredWorld();
    const list = listOf(engine, { filters: { availability: ['injured'] } });

    expect(idsOf(list)).toEqual([hurt]);
    expect(list.rows[0]?.availability.status).toBe('injured');
    expect(list.rows[0]?.injury).toEqual({
      label: 'Test arm injury',
      bodyPart: 'arms',
      expectedReturn: list.rows[0]?.availability.until,
      daysRemaining: 14,
    });
  });

  it('leaves the injury null for everyone who is not injured', () => {
    const { engine, fit } = injuredWorld();
    const rows = new Map(listOf(engine).rows.map((row) => [row.personId, row]));
    expect(rows.get(fit)?.injury).toBeNull();
  });
});
