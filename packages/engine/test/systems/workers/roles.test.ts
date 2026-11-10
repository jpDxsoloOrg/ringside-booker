// Rating roles and the main role.
import { describe, expect, it } from 'vitest';
import { EMPLOYMENT_ROLES } from '../../../src/model/entities/employment';
import { PERSON_ROLES, type PersonRole } from '../../../src/model/entities/person';
import {
  mainRoleOf,
  RATING_ROLES,
  ratingRoleOfPersonRole,
  type RatingRole,
} from '../../../src/systems/workers';
import { aPerson } from '../../support/builders/people';
import { anEmployment } from '../../support/builders/promotions';

describe('RATING_ROLES', () => {
  it('lists the seven roles a person can be rated in', () => {
    expect(RATING_ROLES).toEqual([
      'wrestler',
      'manager',
      'presenter',
      'announcer',
      'referee',
      'producer',
      'booker',
    ]);
  });

  it('covers every role an employment can hire for', () => {
    expect([...RATING_ROLES].sort()).toEqual([...EMPLOYMENT_ROLES].sort());
  });
});

describe('ratingRoleOfPersonRole', () => {
  const cases: readonly (readonly [PersonRole, RatingRole])[] = [
    ['wrestler', 'wrestler'],
    ['occasionalWrestler', 'wrestler'],
    ['manager', 'manager'],
    ['presenter', 'presenter'],
    ['announcer', 'announcer'],
    ['referee', 'referee'],
    ['producer', 'producer'],
  ];
  it.each(cases)('rates %s as %s', (role, ratingRole) => {
    expect(ratingRoleOfPersonRole(role)).toBe(ratingRole);
  });

  it('covers every person role', () => {
    expect(cases.map(([role]) => role)).toEqual([...PERSON_ROLES]);
  });
});

describe('mainRoleOf', () => {
  it("is the main employer's role when employed, whatever the person's own roles", () => {
    const person = aPerson({ roles: ['wrestler', 'manager'] });
    expect(mainRoleOf(person, anEmployment({ role: 'manager' }))).toBe('manager');
    expect(mainRoleOf(person, anEmployment({ role: 'booker' }))).toBe('booker');
  });

  it("is a free agent's first role in the standard role order, not the stored order", () => {
    const person = aPerson({ roles: ['referee', 'manager'], style: 'nonWrestler' });
    expect(mainRoleOf(person, null)).toBe('manager');
    expect(mainRoleOf(aPerson({ roles: ['producer', 'wrestler'] }), null)).toBe('wrestler');
  });

  it('rates a free-agent occasional wrestler as a wrestler', () => {
    const person = aPerson({ roles: ['announcer', 'occasionalWrestler'] });
    expect(mainRoleOf(person, null)).toBe('wrestler');
  });
});
