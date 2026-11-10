// Availability. Design: docs/design/workers.md#availability
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { parseGameDate, type GameDate } from '../../../src/core/date';
import type { Employment, Leave } from '../../../src/model/entities/employment';
import type { Injury, Person } from '../../../src/model/entities/person';
import { AVAILABILITY_STATUSES, availabilityOf } from '../../../src/systems/workers';
import { aPerson } from '../../support/builders/people';
import { anEmployment } from '../../support/builders/promotions';
import { expectSerialisable } from '../../support/trace';

const date = parseGameDate;
const TODAY: GameDate = date('2026-03-09');
const TOMORROW: GameDate = date('2026-03-10');
const NEXT_MONTH: GameDate = date('2026-04-09');
const LAST_WEEK: GameDate = date('2026-03-02');

function anInjury(overrides: Partial<Injury> = {}): Injury {
  return {
    kindKey: parseContentKey('injury.torn-acl'),
    bodyPart: 'legs',
    since: date('2026-02-01'),
    expectedReturn: NEXT_MONTH,
    canWorkAngles: false,
    ...overrides,
  };
}

function employedWith(leave: Leave | null): Employment {
  return anEmployment({ leave });
}

describe('availabilityOf', () => {
  it('reads a healthy, debuted, active person as available', () => {
    expect(availabilityOf(aPerson(), employedWith(null), TODAY)).toEqual({
      status: 'available',
      reason: 'Available',
      until: null,
      canWorkAngles: true,
    });
  });

  it('reads a free agent (no employment) the same way', () => {
    expect(availabilityOf(aPerson(), null, TODAY).status).toBe('available');
  });

  it('returns plain data', () => {
    expectSerialisable(availabilityOf(aPerson({ injury: anInjury() }), null, TODAY));
  });

  describe('retired', () => {
    const cases: readonly (readonly [Person['status'], string])[] = [
      ['retired', 'Retired'],
      ['deceased', 'Deceased'],
      ['outOfBusiness', 'Left the business'],
    ];
    it.each(cases)('reads status %s as retired', (status, reason) => {
      expect(availabilityOf(aPerson({ status }), employedWith(null), TODAY)).toEqual({
        status: 'retired',
        reason,
        until: null,
        canWorkAngles: false,
      });
    });

    it('wins over an injury', () => {
      const person = aPerson({ status: 'retired', injury: anInjury() });
      expect(availabilityOf(person, null, TODAY).status).toBe('retired');
    });
  });

  describe('notDebuted', () => {
    it('applies when there is no debut date, with no day back', () => {
      expect(availabilityOf(aPerson({ debutDate: null }), null, TODAY)).toEqual({
        status: 'notDebuted',
        reason: 'Has not debuted yet',
        until: null,
        canWorkAngles: false,
      });
    });

    it('applies to a manager with no debut date', () => {
      const manager = aPerson({ roles: ['manager'], style: 'nonWrestler', debutDate: null });
      expect(availabilityOf(manager, null, TODAY).status).toBe('notDebuted');
    });

    it.each(['referee', 'announcer', 'presenter', 'producer'] as const)(
      'does not apply to a %s, a role that never has a debut date',
      (role) => {
        const crew = aPerson({ roles: [role], style: 'nonWrestler', debutDate: null });
        expect(availabilityOf(crew, null, TODAY)).toEqual({
          status: 'available',
          reason: 'Available',
          until: null,
          canWorkAngles: true,
        });
      },
    );

    it('still applies to crew whose debut date is ahead', () => {
      const crew = aPerson({ roles: ['referee'], style: 'nonWrestler', debutDate: TOMORROW });
      expect(availabilityOf(crew, null, TODAY).status).toBe('notDebuted');
    });

    it('applies while the debut is ahead, until the debut date', () => {
      const result = availabilityOf(aPerson({ debutDate: TOMORROW }), null, TODAY);
      expect(result.status).toBe('notDebuted');
      expect(result.until).toBe(TOMORROW);
    });

    it('stops on the debut day itself', () => {
      expect(availabilityOf(aPerson({ debutDate: TODAY }), null, TODAY).status).toBe('available');
    });
  });

  describe('injured', () => {
    it('applies until the expected return, which is the first day back', () => {
      const person = aPerson({ injury: anInjury({ expectedReturn: TOMORROW }) });
      expect(availabilityOf(person, null, TODAY)).toEqual({
        status: 'injured',
        reason: 'Injured (leg injury)',
        until: TOMORROW,
        canWorkAngles: false,
      });
      expect(availabilityOf(person, null, TOMORROW).status).toBe('available');
    });

    it('lets an injured person do talking segments when the injury allows it', () => {
      const person = aPerson({ injury: anInjury({ canWorkAngles: true, bodyPart: 'arms' }) });
      expect(availabilityOf(person, null, TODAY)).toEqual({
        status: 'injured',
        reason: 'Injured (arm injury); can still do talking segments',
        until: NEXT_MONTH,
        canWorkAngles: true,
      });
    });

    it('stops counting once healed, without the injury being cleared', () => {
      const person = aPerson({ injury: anInjury({ expectedReturn: LAST_WEEK }) });
      expect(availabilityOf(person, null, TODAY).status).toBe('available');
    });

    it('wins over a suspension that overlaps it', () => {
      const person = aPerson({ injury: anInjury({ expectedReturn: TOMORROW }) });
      const employment = employedWith({ kind: 'suspension', until: NEXT_MONTH, paid: false });
      const result = availabilityOf(person, employment, TODAY);
      expect(result.status).toBe('injured');
      expect(result.until).toBe(TOMORROW);
      // Once the injury has healed the suspension is what is left.
      expect(availabilityOf(person, employment, TOMORROW).status).toBe('suspended');
    });

    it('wins over a restriction', () => {
      const person = aPerson({
        injury: anInjury(),
        restrictions: [{ kind: 'rehab', until: NEXT_MONTH }],
      });
      expect(availabilityOf(person, null, TODAY).status).toBe('injured');
    });
  });

  describe('restrictions', () => {
    it('reads rehab and personal leave, until the first day back', () => {
      const inRehab = aPerson({ restrictions: [{ kind: 'rehab', until: TOMORROW }] });
      expect(availabilityOf(inRehab, null, TODAY)).toEqual({
        status: 'rehab',
        reason: 'In rehab',
        until: TOMORROW,
        canWorkAngles: false,
      });
      expect(availabilityOf(inRehab, null, TOMORROW).status).toBe('available');

      const onLeave = aPerson({ restrictions: [{ kind: 'personalLeave', until: NEXT_MONTH }] });
      expect(availabilityOf(onLeave, null, TODAY)).toEqual({
        status: 'personalLeave',
        reason: 'On personal leave',
        until: NEXT_MONTH,
        canWorkAngles: false,
      });
    });

    it('uses the one that ends last when several are running', () => {
      const person = aPerson({
        restrictions: [
          { kind: 'rehab', until: TOMORROW },
          { kind: 'personalLeave', until: NEXT_MONTH },
          { kind: 'rehab', until: LAST_WEEK },
        ],
      });
      const result = availabilityOf(person, null, TODAY);
      expect(result.status).toBe('personalLeave');
      expect(result.until).toBe(NEXT_MONTH);
    });

    it('ignores expired ones', () => {
      const person = aPerson({ restrictions: [{ kind: 'rehab', until: LAST_WEEK }] });
      expect(availabilityOf(person, null, TODAY).status).toBe('available');
    });

    it('wins over a hiatus and over a leave from the employer', () => {
      const person = aPerson({
        status: 'hiatus',
        restrictions: [{ kind: 'rehab', until: TOMORROW }],
      });
      const employment = employedWith({ kind: 'timeOff', until: NEXT_MONTH, paid: true });
      expect(availabilityOf(person, employment, TODAY).status).toBe('rehab');
    });
  });

  describe('hiatus and semi-retirement', () => {
    it('reads a hiatus as personal leave with no known end', () => {
      expect(availabilityOf(aPerson({ status: 'hiatus' }), employedWith(null), TODAY)).toEqual({
        status: 'personalLeave',
        reason: 'On hiatus',
        until: null,
        canWorkAngles: false,
      });
    });

    it('puts a hiatus ahead of a suspension', () => {
      const employment = employedWith({ kind: 'suspension', until: NEXT_MONTH, paid: false });
      const result = availabilityOf(aPerson({ status: 'hiatus' }), employment, TODAY);
      expect(result.reason).toBe('On hiatus');
    });

    it('reads a semi-retired person as available, with the reason saying so', () => {
      expect(availabilityOf(aPerson({ status: 'semiRetired' }), null, TODAY)).toEqual({
        status: 'available',
        reason: 'Semi-retired: works occasional dates',
        until: null,
        canWorkAngles: true,
      });
    });
  });

  describe('leave from the employer', () => {
    it('reads a suspension and time off, until the first day back', () => {
      const suspended = employedWith({ kind: 'suspension', until: TOMORROW, paid: false });
      expect(availabilityOf(aPerson(), suspended, TODAY)).toEqual({
        status: 'suspended',
        reason: 'Suspended',
        until: TOMORROW,
        canWorkAngles: false,
      });
      const timeOff = employedWith({ kind: 'timeOff', until: NEXT_MONTH, paid: true });
      expect(availabilityOf(aPerson(), timeOff, TODAY)).toEqual({
        status: 'timeOff',
        reason: 'On time off',
        until: NEXT_MONTH,
        canWorkAngles: false,
      });
    });

    it('is available on the until day itself', () => {
      const suspended = employedWith({ kind: 'suspension', until: TODAY, paid: false });
      expect(availabilityOf(aPerson(), suspended, TODAY).status).toBe('available');
    });

    it('reads an expired leave as available without it being cleared', () => {
      const expired = employedWith({ kind: 'timeOff', until: LAST_WEEK, paid: true });
      expect(availabilityOf(aPerson(), expired, TODAY).status).toBe('available');
    });
  });

  it('only lets available people and cleared injuries work talking segments', () => {
    const employment = employedWith({ kind: 'suspension', until: NEXT_MONTH, paid: false });
    const results = [
      availabilityOf(aPerson(), null, TODAY),
      availabilityOf(aPerson({ injury: anInjury({ canWorkAngles: true }) }), null, TODAY),
      availabilityOf(aPerson({ injury: anInjury() }), null, TODAY),
      availabilityOf(
        aPerson({ restrictions: [{ kind: 'rehab', until: NEXT_MONTH }] }),
        null,
        TODAY,
      ),
      availabilityOf(aPerson({ status: 'hiatus' }), null, TODAY),
      availabilityOf(aPerson(), employment, TODAY),
      availabilityOf(
        aPerson(),
        employedWith({ kind: 'timeOff', until: NEXT_MONTH, paid: true }),
        TODAY,
      ),
      availabilityOf(aPerson({ debutDate: null }), null, TODAY),
      availabilityOf(aPerson({ status: 'retired' }), null, TODAY),
    ];
    expect(results.map((result) => [result.status, result.canWorkAngles])).toEqual([
      ['available', true],
      ['injured', true],
      ['injured', false],
      ['rehab', false],
      ['personalLeave', false],
      ['suspended', false],
      ['timeOff', false],
      ['notDebuted', false],
      ['retired', false],
    ]);
    expect(new Set(results.map((result) => result.status))).toEqual(new Set(AVAILABILITY_STATUSES));
  });
});
