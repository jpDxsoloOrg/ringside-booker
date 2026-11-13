// The medical care a worker gets. Design: docs/design/health.md#medical-care
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { PersonId, PromotionId } from '../../../src/core/ids';
import type { Employment } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import { medicalLevelOf } from '../../../src/systems/health';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aPerson, anEmployment, worldBuilder, type DeepPartial } from '../../support';
import { TEST_START_DATE } from '../../support/builders/build-row';

const NON_EXCLUSIVE = { terms: { exclusive: false } } as const;

interface MedicalWorld {
  world: GameWorld;
  person: PersonId;
  low: PromotionId;
  high: PromotionId;
}

/** Promotion A has medical level 1 and B level 3; one person with the given contracts. */
function medicalWorld(
  contracts: (low: PromotionId, high: PromotionId) => readonly DeepPartial<Employment>[],
): MedicalWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ policies: { medical: 1 } })
    .withPromotion({ policies: { medical: 3 } })
    .with('a person and their contracts', (context) => {
      const { A, B } = context.ids.promotions;
      if (A === undefined || B === undefined) {
        throw new Error('expected two promotions');
      }
      const person = context.insert('people', aPerson({}, context.sequence));
      for (const contract of contracts(A, B)) {
        context.insert(
          'employments',
          anEmployment({ personId: person.id, ...contract }, context.sequence),
        );
      }
    })
    .build();
  const [person] = ids.people;
  const { A, B } = ids.promotions;
  if (person === undefined || A === undefined || B === undefined) {
    throw new Error('the medical world is incomplete');
  }
  return { world, person, low: A, high: B };
}

const tunables = createEngineTunables();

describe('medicalLevelOf', () => {
  it('takes the best policy of two active employers', () => {
    const { world, person, low, high } = medicalWorld((a, b) => [
      { promotionId: a, ...NON_EXCLUSIVE },
      { promotionId: b, ...NON_EXCLUSIVE },
    ]);
    expect(medicalLevelOf(world, person, TEST_START_DATE, tunables)).toEqual({
      level: 3,
      promotionId: high,
    });
    expect(low).not.toBe(high);
  });

  it('uses the one employer it has', () => {
    const { world, person, low } = medicalWorld((a) => [{ promotionId: a }]);
    expect(medicalLevelOf(world, person, TEST_START_DATE, tunables)).toEqual({
      level: 1,
      promotionId: low,
    });
  });

  it('gives a free agent the free-agent level, which a tunable sets', () => {
    const { world, person } = medicalWorld(() => []);
    expect(medicalLevelOf(world, person, TEST_START_DATE, tunables)).toEqual({
      level: 1,
      promotionId: null,
    });
    expect(
      medicalLevelOf(
        world,
        person,
        TEST_START_DATE,
        createEngineTunables({ 'health.medical.freeAgentLevel': 0 }),
      ),
    ).toEqual({ level: 0, promotionId: null });
    expect(
      medicalLevelOf(
        world,
        person,
        TEST_START_DATE,
        createEngineTunables({ 'health.medical.freeAgentLevel': 3 }),
      ),
    ).toEqual({ level: 3, promotionId: null });
  });

  it('ignores an offered contract and an expired one', () => {
    const { world, person, low } = medicalWorld((a, b) => [
      { promotionId: a, ...NON_EXCLUSIVE },
      {
        promotionId: b,
        status: 'offered',
        offeredOn: TEST_START_DATE,
        startsOn: addDays(TEST_START_DATE, 30),
        ...NON_EXCLUSIVE,
      },
    ]);
    expect(medicalLevelOf(world, person, TEST_START_DATE, tunables)).toEqual({
      level: 1,
      promotionId: low,
    });

    const expired = medicalWorld((_a, b) => [
      {
        promotionId: b,
        status: 'expired',
        offeredOn: addDays(TEST_START_DATE, -400),
        startsOn: addDays(TEST_START_DATE, -365),
        endsOn: addDays(TEST_START_DATE, -1),
        endedOn: addDays(TEST_START_DATE, -1),
      },
    ]);
    expect(medicalLevelOf(expired.world, expired.person, TEST_START_DATE, tunables)).toEqual({
      level: 1,
      promotionId: null,
    });
  });

  it('ignores an active contract that has not started by the date', () => {
    const { world, person } = medicalWorld((_a, b) => [{ promotionId: b }]);
    expect(medicalLevelOf(world, person, addDays(TEST_START_DATE, -1), tunables)).toEqual({
      level: 1,
      promotionId: null,
    });
  });
});
