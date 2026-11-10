// Employer and free-agent helpers.
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { cents } from '../../../src/core/money';
import type { PersonId } from '../../../src/core/ids';
import type { Employment } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import {
  activeEmploymentsOf,
  isFreeAgent,
  primaryEmploymentOf,
} from '../../../src/systems/workers';
import { TEST_START_DATE, type DeepPartial } from '../../support/builders/build-row';
import { aPerson } from '../../support/builders/people';
import { anEmployment } from '../../support/builders/promotions';
import { worldBuilder } from '../../support/world-builder';

const TODAY = addDays(TEST_START_DATE, 30);
const NON_EXCLUSIVE: DeepPartial<Employment> = {
  terms: { kind: 'perAppearance', exclusive: false, monthlyWage: cents(0) },
};

interface Built {
  world: GameWorld;
  personId: PersonId;
}

/** A world with three promotions and one person holding the given contracts, one per promotion. */
function worldWithContracts(contracts: readonly DeepPartial<Employment>[]): Built {
  let personId: PersonId | undefined;
  const { world } = worldBuilder({ currentDate: TODAY })
    .withGeography('mini')
    .withPromotion()
    .withPromotion()
    .withPromotion()
    .with('one person and their contracts', (context) => {
      const person = context.insert('people', aPerson({}, context.sequence));
      personId = person.id;
      contracts.forEach((contract, index) => {
        const promotionId = [
          context.ids.promotions.A,
          context.ids.promotions.B,
          context.ids.promotions.C,
        ][index];
        if (promotionId === undefined) {
          throw new Error('worldWithContracts supports at most three contracts');
        }
        context.insert(
          'employments',
          anEmployment({ ...contract, personId: person.id, promotionId }, context.sequence),
        );
      });
    })
    .build();
  if (personId === undefined) {
    throw new Error('the person was not inserted');
  }
  return { world, personId };
}

describe('activeEmploymentsOf', () => {
  it('is empty for someone with no contract, who is a free agent', () => {
    const { world, personId } = worldWithContracts([]);
    expect(activeEmploymentsOf(world, personId, TODAY)).toEqual([]);
    expect(primaryEmploymentOf(world, personId, TODAY)).toBeNull();
    expect(isFreeAgent(world, personId, TODAY)).toBe(true);
  });

  it('lists active contracts that have started, in id order', () => {
    const { world, personId } = worldWithContracts([NON_EXCLUSIVE, NON_EXCLUSIVE]);
    const active = activeEmploymentsOf(world, personId, TODAY);
    expect(active).toHaveLength(2);
    expect(active.map((employment) => employment.id)).toEqual(
      active.map((employment) => employment.id).sort(),
    );
    expect(isFreeAgent(world, personId, TODAY)).toBe(false);
  });

  it('leaves out offers, signed contracts and ended contracts', () => {
    const { world, personId } = worldWithContracts([
      { status: 'offered' },
      { status: 'signed', startsOn: addDays(TODAY, 10) },
      { status: 'released', endedOn: addDays(TEST_START_DATE, 5) },
    ]);
    expect(activeEmploymentsOf(world, personId, TODAY)).toEqual([]);
    expect(isFreeAgent(world, personId, TODAY)).toBe(true);
  });

  it('leaves out a contract that starts after the date asked about', () => {
    const startsOn = addDays(TEST_START_DATE, 20);
    const { world, personId } = worldWithContracts([{ startsOn }]);
    expect(isFreeAgent(world, personId, addDays(startsOn, -1))).toBe(true);
    expect(isFreeAgent(world, personId, startsOn)).toBe(false);
    expect(activeEmploymentsOf(world, personId, startsOn)).toHaveLength(1);
  });
});

describe('primaryEmploymentOf', () => {
  it('is the only active contract when there is one', () => {
    const { world, personId } = worldWithContracts([{ status: 'offered' }, {}]);
    const [onlyActive] = activeEmploymentsOf(world, personId, TODAY);
    expect(primaryEmploymentOf(world, personId, TODAY)).toEqual(onlyActive);
  });

  it('prefers the contract that started earliest', () => {
    const { world, personId } = worldWithContracts([
      { ...NON_EXCLUSIVE, startsOn: addDays(TEST_START_DATE, 20) },
      { ...NON_EXCLUSIVE, startsOn: addDays(TEST_START_DATE, 5) },
      { ...NON_EXCLUSIVE, startsOn: addDays(TEST_START_DATE, 10) },
    ]);
    expect(primaryEmploymentOf(world, personId, TODAY)?.startsOn).toBe(addDays(TEST_START_DATE, 5));
  });

  it('falls back to the lowest id when the start dates match', () => {
    const { world, personId } = worldWithContracts([NON_EXCLUSIVE, NON_EXCLUSIVE, NON_EXCLUSIVE]);
    const [first] = activeEmploymentsOf(world, personId, TODAY);
    expect(primaryEmploymentOf(world, personId, TODAY)?.id).toBe(first?.id);
  });

  it('puts an exclusive written contract ahead of an earlier one', () => {
    // Stored like this the world breaks the exclusive-contract invariant, but the helper still
    // has to give one stable answer for it.
    const { world, personId } = worldWithContracts([
      { ...NON_EXCLUSIVE, startsOn: TEST_START_DATE },
      { terms: { kind: 'written', exclusive: true }, startsOn: addDays(TEST_START_DATE, 20) },
    ]);
    const primary = primaryEmploymentOf(world, personId, TODAY);
    expect(primary?.terms.exclusive).toBe(true);
    expect(primary?.terms.kind).toBe('written');
  });

  it('does not count a non-written exclusive contract as exclusive written', () => {
    const { world, personId } = worldWithContracts([
      { terms: { kind: 'tour', exclusive: true }, startsOn: addDays(TEST_START_DATE, 20) },
      { ...NON_EXCLUSIVE, startsOn: TEST_START_DATE },
    ]);
    expect(primaryEmploymentOf(world, personId, TODAY)?.terms.kind).toBe('perAppearance');
  });
});
