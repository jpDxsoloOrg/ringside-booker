// Title eligibility. Design: docs/design/workers.md#title-eligibility
import { describe, expect, it } from 'vitest';
import type { Gender } from '../../../src/model/entities/person';
import type { DivisionGender } from '../../../src/model/entities/title';
import { isEligibleForTitle } from '../../../src/systems/workers';
import { aTitle } from '../../support/builders/creative';
import { aPerson } from '../../support/builders/people';
import { TEST_START_DATE } from '../../support/builders/build-row';
import { expectSerialisable } from '../../support/trace';

function codes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((reason) => reason.code);
}

describe('isEligibleForTitle', () => {
  it('returns no reasons for a wrestler and an open title with no limits', () => {
    expect(isEligibleForTitle(aPerson(), aTitle())).toEqual([]);
  });

  it('counts an occasional wrestler as a wrestler', () => {
    const person = aPerson({ roles: ['occasionalWrestler', 'manager'] });
    expect(isEligibleForTitle(person, aTitle())).toEqual([]);
  });

  it('refuses someone with no wrestling role', () => {
    const person = aPerson({ roles: ['referee'], style: 'nonWrestler' });
    const title = aTitle({ name: 'Test World Championship' });
    expect(isEligibleForTitle(person, title)).toEqual([
      {
        code: 'notAWrestler',
        message: 'Only wrestlers can hold the Test World Championship',
        subject: { kind: 'person', id: person.id },
      },
    ]);
  });

  it('refuses a retired title', () => {
    const title = aTitle({
      name: 'Test Legacy',
      status: 'retired',
      retiredOn: TEST_START_DATE,
    });
    const reasons = isEligibleForTitle(aPerson(), title);
    expect(codes(reasons)).toEqual(['titleRetired']);
    expect(reasons[0]?.message).toBe('The Test Legacy title has been retired');
  });

  describe('division gender', () => {
    const cases: readonly (readonly [Gender, DivisionGender, boolean])[] = [
      ['male', 'open', true],
      ['female', 'open', true],
      ['nonBinary', 'open', true],
      ['male', 'male', true],
      ['female', 'male', false],
      ['nonBinary', 'male', false],
      ['male', 'female', false],
      ['female', 'female', true],
      ['nonBinary', 'female', false],
    ];
    it.each(cases)('%s wrestler, %s division: eligible %s', (gender, divisionGender, eligible) => {
      const title = aTitle({
        division: { gender: divisionGender, minWeightKg: null, maxWeightKg: null },
      });
      const reasons = isEligibleForTitle(aPerson({ gender }), title);
      expect(codes(reasons)).toEqual(eligible ? [] : ['divisionGender']);
    });

    it('says which division the title is for', () => {
      const title = aTitle({
        name: "Test Women's Championship",
        division: { gender: 'female', minWeightKg: null, maxWeightKg: null },
      });
      expect(isEligibleForTitle(aPerson({ gender: 'male' }), title)[0]?.message).toBe(
        "The Test Women's Championship is a women's title",
      );
    });
  });

  describe('weight limits', () => {
    const cruiserweight = aTitle({
      name: 'Test Cruiserweight Title',
      division: { gender: 'open', minWeightKg: 80, maxWeightKg: 93 },
    });

    it('includes both limits', () => {
      expect(isEligibleForTitle(aPerson({ weightKg: 80 }), cruiserweight)).toEqual([]);
      expect(isEligibleForTitle(aPerson({ weightKg: 93 }), cruiserweight)).toEqual([]);
    });

    it('refuses one kilogram under the minimum', () => {
      const reasons = isEligibleForTitle(aPerson({ weightKg: 79 }), cruiserweight);
      expect(codes(reasons)).toEqual(['belowMinWeight']);
      expect(reasons[0]?.message).toBe(
        'Too light for the Test Cruiserweight Title (needs at least 80 kg, weighs 79 kg)',
      );
    });

    it('refuses one kilogram over the maximum', () => {
      const reasons = isEligibleForTitle(aPerson({ weightKg: 94 }), cruiserweight);
      expect(codes(reasons)).toEqual(['aboveMaxWeight']);
      expect(reasons[0]?.message).toBe(
        'Too heavy for the Test Cruiserweight Title (limit 93 kg, weighs 94 kg)',
      );
    });

    it('treats a null limit as no limit on that side', () => {
      const noMinimum = aTitle({
        division: { gender: 'open', minWeightKg: null, maxWeightKg: 93 },
      });
      const noMaximum = aTitle({
        division: { gender: 'open', minWeightKg: 105, maxWeightKg: null },
      });
      expect(isEligibleForTitle(aPerson({ weightKg: 40 }), noMinimum)).toEqual([]);
      expect(codes(isEligibleForTitle(aPerson({ weightKg: 94 }), noMinimum))).toEqual([
        'aboveMaxWeight',
      ]);
      expect(isEligibleForTitle(aPerson({ weightKg: 250 }), noMaximum)).toEqual([]);
      expect(codes(isEligibleForTitle(aPerson({ weightKg: 104 }), noMaximum))).toEqual([
        'belowMinWeight',
      ]);
    });
  });

  it('lists every failing rule, in a fixed order, as plain data', () => {
    const person = aPerson({
      roles: ['manager'],
      style: 'nonWrestler',
      gender: 'female',
      weightKg: 60,
    });
    const title = aTitle({
      status: 'retired',
      retiredOn: TEST_START_DATE,
      division: { gender: 'male', minWeightKg: 105, maxWeightKg: null },
    });
    const reasons = isEligibleForTitle(person, title);
    expect(codes(reasons)).toEqual([
      'titleRetired',
      'notAWrestler',
      'divisionGender',
      'belowMinWeight',
    ]);
    for (const reason of reasons) {
      expect(reason.subject).toEqual({ kind: 'person', id: person.id });
      expect(reason.message).not.toBe('');
    }
    expectSerialisable(reasons);
  });
});
