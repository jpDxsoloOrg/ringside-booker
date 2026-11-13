// roster.rows on the shipped default world, playing as Altura, against WRK1's own formulas.
// Design: docs/design/roster.md#roster-rows
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { PromotionId } from '../../../src/core/ids';
import type { GameWorldView } from '../../../src/model/tables';
import { rosterSystem, type RosterRoleGroup, type RosterView } from '../../../src/systems/roster';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  availabilityOf,
  expectedPushAt,
  footprintPopularityAt,
  gradeOf,
  overallOf,
  workersSystem,
} from '../../../src/systems/workers';
import { TEST_PLAYER_ID } from '../../support/builders/build-row';
import { loadDefaultWorld } from '../workers/default-world';
import { PLAYER, rosterOf } from './roster-world';

const ALTURA = 'Altura Wrestling Entertainment';
const EMPLOYMENTS_FILE = fileURLToPath(
  new URL('../../../../../content/worlds/default/employments.json', import.meta.url),
);

const zEmploymentRecords = z.array(
  z.object({
    promotionKey: z.string(),
    brandKey: z.string().nullable(),
    role: z.string(),
    ringName: z.string(),
  }),
);

const GROUP_OF_ROLE: Readonly<Record<string, RosterRoleGroup>> = {
  wrestler: 'wrestlers',
  manager: 'managers',
  announcer: 'announcers',
  referee: 'referees',
  producer: 'producers',
};

/** The default world with Altura run by the test player. */
function alturaWorld(): { engine: Engine; altura: PromotionId; read: GameWorldView } {
  const world = loadDefaultWorld();
  const altura = world.tables.promotions.values().find((promotion) => promotion.name === ALTURA);
  if (altura === undefined) throw new Error(`The default world has no ${ALTURA}`);
  const seated = world.transact('seat the player', (tx) => {
    tx.update('promotions', altura.id, {
      controller: { kind: 'human', playerId: TEST_PLAYER_ID },
    });
  });
  if (!seated.ok) throw seated.error;
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem, rosterSystem],
  });
  return { engine, altura: altura.id, read: world };
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('roster.rows on the default world as Altura', () => {
  const { engine, altura, read } = alturaWorld();
  const view: RosterView = rosterOf(engine, {}, PLAYER);
  const records = zEmploymentRecords
    .parse(JSON.parse(readFileSync(EMPLOYMENTS_FILE, 'utf8')))
    .filter((record) => record.promotionKey === 'pro-flagship');

  it('lists all 55 contracts in the groups and brands the content gives them', () => {
    expect(view.promotion?.promotionId).toBe(altura);
    expect(view.promotion?.brands.map((brand) => brand.name)).toEqual([
      'Altura Mainstage',
      'Altura Overclock',
    ]);
    expect(view.rows).toHaveLength(55);
    expect(countBy(view.rows, (row) => row.group)).toEqual({
      wrestlers: 44,
      managers: 2,
      announcers: 3,
      referees: 4,
      producers: 2,
    });
    const brandKeyName: Readonly<Record<string, string>> = {
      'flagship-main-brand': 'Altura Mainstage',
      'flagship-young-brand': 'Altura Overclock',
    };
    const fromContent = records
      .map((record) => [
        record.ringName,
        GROUP_OF_ROLE[record.role] ?? 'others',
        record.brandKey === null ? null : (brandKeyName[record.brandKey] ?? record.brandKey),
      ])
      .sort();
    const fromRows = view.rows.map((row) => [row.ringName, row.group, row.brandName]).sort();
    expect(fromRows).toEqual(fromContent);
  });

  it("gives every wrestler WRK1's numbers and crew none of the push fields", () => {
    const tunables = createEngineTunables();
    for (const row of view.rows) {
      const person = read.tables.people.require(row.personId);
      const employment = read.tables.employments.require(row.employmentId);
      const rating = overallOf(person, row.role, { tunables }).value;
      expect(row.overall).toEqual({
        value: Math.round(rating * 10) / 10,
        grade: gradeOf(rating).grade,
      });
      const popularity = footprintPopularityAt(read, row.personId, altura, tunables).value;
      expect(row.popularity).toBe(Math.round(popularity * 10) / 10);
      const availability = availabilityOf(person, employment, read.meta.currentDate);
      expect(row.availability.status).toBe(availability.status);
      expect(row.availability.until).toBe(availability.until);
      if (row.group === 'wrestlers') {
        expect(row.expectedPush).toBe(expectedPushAt(read, row.personId, altura, tunables).value);
        expect(row.pushGap?.verdict).toMatch(/^(expectsMore|asExpected|aboveExpected)$/);
      } else {
        expect(row.expectedPush).toBeNull();
        expect(row.pushGap).toBeNull();
      }
    }
  });

  it('starts every wrestler at the push they expect, as the content is calibrated', () => {
    const wrestlers = view.rows.filter((row) => row.group === 'wrestlers');
    expect(wrestlers.every((row) => row.pushGap?.verdict === 'asExpected')).toBe(true);
    expect(wrestlers.every((row) => row.pushGap?.steps === 0)).toBe(true);
  });
});
