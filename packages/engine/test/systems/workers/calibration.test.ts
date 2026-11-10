// Calibration of expected push against the shipped default world: the push the formula expects
// should be close to the push each promotion's wrestlers actually have.
// Design: docs/design/workers.md#expected-push
import { describe, expect, it } from 'vitest';
import { PUSH_LEVELS, type Push } from '../../../src/model/entities/employment';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  activeEmploymentsOf,
  expectedPush,
  expectedPushAt,
  footprintPopularityValue,
} from '../../../src/systems/workers';
import { geographyOf } from '../../../src/systems/world/geography';
import { loadDefaultWorld } from './default-world';

const world = loadDefaultWorld();
const today = world.meta.currentDate;
const tunables = createEngineTunables();
const regions = geographyOf(world).regions;

/** The card positions from the top down; `none` is not a position. */
const CARD_STEPS: readonly Push[] = PUSH_LEVELS.filter((push) => push !== 'none');

function cardStep(push: Push): number {
  return CARD_STEPS.indexOf(push);
}

interface PromotionCalibration {
  name: string;
  popularity: number;
  wrestlers: number;
  exact: number;
  withinOne: number;
}

function calibrate(): PromotionCalibration[] {
  return world.tables.promotions.values().map((promotion) => {
    const row: PromotionCalibration = {
      name: promotion.name,
      popularity: footprintPopularityValue(
        {
          subjectPop: promotion.regionalPop,
          promotionPop: promotion.regionalPop,
          promotionName: promotion.name,
          regions,
        },
        { tunables },
      ),
      wrestlers: 0,
      exact: 0,
      withinOne: 0,
    };
    for (const person of world.tables.people.values()) {
      const employment = activeEmploymentsOf(world, person.id, today).find(
        (candidate) => candidate.promotionId === promotion.id && candidate.role === 'wrestler',
      );
      if (employment === undefined || employment.push === 'none') {
        continue;
      }
      const expected = expectedPushAt(world, person.id, promotion.id, tunables).value;
      const distance = Math.abs(cardStep(expected) - cardStep(employment.push));
      row.wrestlers += 1;
      row.exact += distance === 0 ? 1 : 0;
      row.withinOne += distance <= 1 ? 1 : 0;
    }
    return row;
  });
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${String(Math.round((part / whole) * 100))}%`;
}

describe('expected push on the default world', () => {
  const rows = calibrate();
  const wrestlers = rows.reduce((sum, row) => sum + row.wrestlers, 0);
  const withinOne = rows.reduce((sum, row) => sum + row.withinOne, 0);

  it('is within one card position of the actual push for at least half the wrestlers', () => {
    const table = rows.map((row) => ({
      promotion: row.name,
      popularity: Math.round(row.popularity * 10) / 10,
      wrestlers: row.wrestlers,
      exact: percent(row.exact, row.wrestlers),
      withinOne: percent(row.withinOne, row.wrestlers),
    }));
    // The table is the point of a calibration run, so it is printed on purpose.
    console.table(table);
    console.log(`Within one card position overall: ${percent(withinOne, wrestlers)}`);
    expect(wrestlers).toBeGreaterThan(0);
    expect(withinOne / wrestlers).toBeGreaterThanOrEqual(0.5);
  });

  it('expects a lower push from a bigger promotion for the same worker', () => {
    const promotions = world.tables.promotions.values();
    const altura = promotions.find((promotion) => promotion.name.startsWith('Altura'));
    if (altura === undefined) {
      throw new Error('The default world has no Altura promotion');
    }
    // A fixed worker, equally known everywhere, so only the promotion's size differs.
    const workerPop = Object.fromEntries(regions.map((region) => [region.id, 30]));
    const expectedAt = (promotion: (typeof promotions)[number]): Push =>
      expectedPush(
        {
          employmentRole: 'wrestler',
          workerPop,
          promotionPop: promotion.regionalPop,
          promotionName: promotion.name,
          regions,
        },
        { tunables },
      ).value;
    const atAltura = expectedAt(altura);
    const smallest = rows.reduce((least, row) => (row.popularity < least.popularity ? row : least));
    const local = promotions.find((promotion) => promotion.name === smallest.name);
    if (local === undefined || local.id === altura.id) {
      throw new Error('The default world has no promotion smaller than Altura');
    }
    const atLocal = expectedAt(local);
    expect(cardStep(atAltura)).toBeGreaterThan(cardStep(atLocal));

    // And for every promotion: the more popular it is with its own fans, the lower (or equal) the
    // push this worker expects.
    const byPopularity = [...rows].sort((left, right) => left.popularity - right.popularity);
    let previousStep = -1;
    for (const row of byPopularity) {
      const promotion = promotions.find((candidate) => candidate.name === row.name);
      if (promotion === undefined) {
        throw new Error(`Promotion ${row.name} went missing`);
      }
      const step = cardStep(expectedAt(promotion));
      expect(step).toBeGreaterThanOrEqual(previousStep);
      previousStep = step;
    }
  });
});
