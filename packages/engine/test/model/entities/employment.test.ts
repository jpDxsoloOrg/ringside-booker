import { describe, expect, it } from 'vitest';
import { cents } from '../../../src/core/money';
import {
  canTransition,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TRANSITIONS,
  EmploymentSchema,
  employmentsTable,
  isTerminalStatus,
  promotionStatusKey,
  type Employment,
  type EmploymentStatus,
} from '../../../src/model/entities/employment';
import { checkWorld } from '../../../src/model/integrity';
import {
  COMPANY_REGISTRY,
  date,
  makeBrand,
  makeEmployment,
  testId,
  validCompanyWorld,
} from '../../support/company-fixtures';
import { referenceFieldPaths } from '../../support/ref-fields';
import { issuePaths, parseIssues } from '../../support/schema-issues';

function withTerms(overrides: Partial<Employment['terms']>): Employment {
  const base = makeEmployment(1, 1, 1);
  return { ...base, terms: { ...base.terms, ...overrides } };
}

describe('EmploymentSchema', () => {
  it('accepts a complete valid active employment', () => {
    expect(parseIssues(EmploymentSchema, makeEmployment(1, 1, 1))).toEqual([]);
  });

  it('accepts an offer with an open-ended term', () => {
    const offer = makeEmployment(1, 1, 1, { status: 'offered', endsOn: null });
    expect(parseIssues(EmploymentSchema, offer)).toEqual([]);
  });

  it('rejects a per-appearance contract with a monthly wage', () => {
    const employment = withTerms({ kind: 'perAppearance', monthlyWage: cents(100) });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['terms.monthlyWage']);
  });

  it('accepts a per-appearance contract with no monthly wage', () => {
    const employment = withTerms({
      kind: 'perAppearance',
      monthlyWage: cents(0),
      perAppearanceFee: cents(50_000),
    });
    expect(parseIssues(EmploymentSchema, employment)).toEqual([]);
  });

  it('rejects endedOn set while active', () => {
    const employment = makeEmployment(1, 1, 1, { endedOn: date('2026-01-01') });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['endedOn']);
  });

  it.each(['declined', 'withdrawn', 'expired', 'released', 'quit'] as const)(
    'requires endedOn when %s',
    (status) => {
      const employment = makeEmployment(1, 1, 1, { status, endedOn: null });
      expect(issuePaths(EmploymentSchema, employment)).toContain('endedOn');
    },
  );

  it('rejects endsOn equal to startsOn', () => {
    const employment = makeEmployment(1, 1, 1, {
      startsOn: date('2026-01-01'),
      endsOn: date('2026-01-01'),
    });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['endsOn']);
  });

  it('rejects startsOn before offeredOn', () => {
    const employment = makeEmployment(1, 1, 1, { offeredOn: date('2025-12-02') });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['startsOn']);
  });

  it('rejects shares.gateBp 10001 and accepts 10000', () => {
    const shares = { gateBp: 10_001, merchBp: 0, broadcastBp: 0 };
    expect(issuePaths(EmploymentSchema, withTerms({ shares }))).toEqual(['terms.shares.gateBp']);
    expect(
      parseIssues(EmploymentSchema, withTerms({ shares: { ...shares, gateBp: 10_000 } })),
    ).toEqual([]);
  });

  it('rejects a manager equal to the person', () => {
    const employment = makeEmployment(1, 1, 1, { managerPersonId: testId('person', 1) });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['managerPersonId']);
  });

  it('rejects negative money and an appearance cap of 0', () => {
    expect(issuePaths(EmploymentSchema, withTerms({ signingBonus: cents(-1) }))).toEqual([
      'terms.signingBonus',
    ]);
    expect(issuePaths(EmploymentSchema, withTerms({ appearanceCap: 0 }))).toEqual([
      'terms.appearanceCap',
    ]);
  });

  it('rejects morale and momentum outside -100..100', () => {
    expect(issuePaths(EmploymentSchema, makeEmployment(1, 1, 1, { morale: 100.5 }))).toEqual([
      'morale',
    ]);
    expect(issuePaths(EmploymentSchema, makeEmployment(1, 1, 1, { momentum: -101 }))).toEqual([
      'momentum',
    ]);
  });

  it('rejects an open-ended contract that expired, and one that expired early', () => {
    const openEnded = makeEmployment(1, 1, 1, {
      status: 'expired',
      endsOn: null,
      endedOn: date('2026-01-01'),
    });
    expect(issuePaths(EmploymentSchema, openEnded)).toEqual(['endsOn']);
    const early = makeEmployment(1, 1, 1, { status: 'expired', endedOn: date('2026-06-01') });
    expect(issuePaths(EmploymentSchema, early)).toEqual(['endedOn']);
  });

  it('rejects a released contract that ended before it started', () => {
    const employment = makeEmployment(1, 1, 1, {
      status: 'released',
      endedOn: date('2025-11-15'),
    });
    expect(issuePaths(EmploymentSchema, employment)).toEqual(['endedOn']);
  });

  it('accepts a declined offer that ended before its start date', () => {
    const employment = makeEmployment(1, 1, 1, {
      status: 'declined',
      endedOn: date('2025-11-10'),
    });
    expect(parseIssues(EmploymentSchema, employment)).toEqual([]);
  });

  it('accepts paid time off and rejects an unknown leave kind', () => {
    const leave = { kind: 'timeOff', until: date('2026-02-01'), paid: true } as const;
    expect(parseIssues(EmploymentSchema, makeEmployment(1, 1, 1, { leave }))).toEqual([]);
    expect(
      issuePaths(EmploymentSchema, {
        ...makeEmployment(1, 1, 1),
        leave: { ...leave, kind: 'vacation' },
      }),
    ).toEqual(['leave.kind']);
  });
});

describe('employment lifecycle', () => {
  it('cannot go straight from offered to active', () => {
    expect(canTransition('offered', 'active')).toBe(false);
  });

  it('can go from signed to active', () => {
    expect(canTransition('signed', 'active')).toBe(true);
  });

  it('follows the transitions table exactly', () => {
    const allowed: [EmploymentStatus, EmploymentStatus][] = [
      ['offered', 'signed'],
      ['offered', 'declined'],
      ['offered', 'withdrawn'],
      ['signed', 'active'],
      ['signed', 'withdrawn'],
      ['active', 'expired'],
      ['active', 'released'],
      ['active', 'quit'],
    ];
    for (const from of EMPLOYMENT_STATUSES) {
      for (const to of EMPLOYMENT_STATUSES) {
        const expected = allowed.some(
          ([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to,
        );
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it.each(['declined', 'withdrawn', 'expired', 'released', 'quit'] as const)(
    'terminal state %s has no exits',
    (status) => {
      expect(EMPLOYMENT_TRANSITIONS[status]).toEqual([]);
      expect(isTerminalStatus(status)).toBe(true);
      for (const to of EMPLOYMENT_STATUSES) {
        expect(canTransition(status, to)).toBe(false);
      }
    },
  );

  it('offered, signed and active are not terminal', () => {
    expect(isTerminalStatus('offered')).toBe(false);
    expect(isTerminalStatus('signed')).toBe(false);
    expect(isTerminalStatus('active')).toBe(false);
  });
});

describe('employment invariants', () => {
  function invariantIssues(world: ReturnType<typeof validCompanyWorld>): readonly {
    code: string;
    id?: string;
    path?: string;
  }[] {
    return checkWorld(world, COMPANY_REGISTRY, { only: ['invariants'] }).issues;
  }

  it('reports two exclusive active contracts for one person', () => {
    const world = validCompanyWorld();
    world.tables.employments._put(makeEmployment(6, 2, 2));
    expect(invariantIssues(world)).toEqual([
      expect.objectContaining({
        code: 'employments.exclusiveConflict',
        id: testId('employment', 2),
        path: 'terms.exclusive',
      }),
    ]);
  });

  it('reports an exclusive active contract alongside a non-exclusive one', () => {
    const world = validCompanyWorld();
    const nonExclusive = makeEmployment(6, 2, 2);
    world.tables.employments._put({
      ...nonExclusive,
      terms: { ...nonExclusive.terms, exclusive: false },
    });
    expect(invariantIssues(world).map((issue) => issue.code)).toEqual([
      'employments.exclusiveConflict',
    ]);
  });

  it('allows an exclusive offer alongside an exclusive active contract', () => {
    const world = validCompanyWorld();
    world.tables.employments._put(makeEmployment(6, 2, 2, { status: 'offered' }));
    expect(invariantIssues(world)).toEqual([]);
  });

  it('reports a second signed contract with the same promotion', () => {
    const world = validCompanyWorld();
    const signed = makeEmployment(6, 3, 1, {
      status: 'signed',
      offeredOn: date('2025-12-20'),
      startsOn: date('2026-03-01'),
      endsOn: null,
    });
    world.tables.employments._put({ ...signed, terms: { ...signed.terms, exclusive: false } });
    expect(invariantIssues(world)).toEqual([
      expect.objectContaining({
        code: 'employments.duplicateContract',
        id: testId('employment', 4),
      }),
    ]);
  });

  it('reports a brand from another promotion', () => {
    const world = validCompanyWorld();
    world.tables.employments._put(makeEmployment(2, 2, 1, { brandId: testId('brand', 2) }));
    expect(invariantIssues(world)).toEqual([
      expect.objectContaining({
        code: 'employments.brandOtherPromotion',
        id: testId('employment', 2),
        path: 'brandId',
      }),
    ]);
  });

  it('leaves a missing brand to the reference check', () => {
    const world = validCompanyWorld();
    world.tables.employments._put(makeEmployment(2, 2, 1, { brandId: testId('brand', 9) }));
    expect(invariantIssues(world)).toEqual([]);
    expect(checkWorld(world, COMPANY_REGISTRY, { only: ['refs'] }).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'brandId' }),
    ]);
  });

  it('reports an active contract that has not started yet and an end date in the future', () => {
    const world = validCompanyWorld();
    world.tables.brands._put(makeBrand(3, 2));
    world.tables.employments._put(
      makeEmployment(2, 2, 1, {
        offeredOn: date('2026-01-01'),
        startsOn: date('2026-02-01'),
        endsOn: null,
      }),
    );
    world.tables.employments._put(
      makeEmployment(5, 1, 2, { status: 'quit', endedOn: date('2026-01-05') }),
    );
    expect(invariantIssues(world).map((issue) => [issue.code, issue.id, issue.path])).toEqual([
      ['employments.unreachableState', testId('employment', 2), 'startsOn'],
      ['employments.unreachableState', testId('employment', 5), 'endedOn'],
    ]);
  });

  it('reports an offer dated after today and accepts one dated today', () => {
    const world = validCompanyWorld();
    const today = world.meta.currentDate;
    world.tables.employments._put(
      makeEmployment(6, 5, 1, {
        status: 'offered',
        offeredOn: date('2026-01-10'),
        startsOn: date('2026-02-01'),
        endsOn: null,
      }),
    );
    expect(invariantIssues(world).map((issue) => [issue.code, issue.id, issue.path])).toEqual([
      ['employments.unreachableState', testId('employment', 6), 'offeredOn'],
    ]);
    world.tables.employments._put(
      makeEmployment(6, 5, 1, {
        status: 'offered',
        offeredOn: today,
        startsOn: date('2026-02-01'),
        endsOn: null,
      }),
    );
    expect(invariantIssues(world)).toEqual([]);
  });

  it('indexes employments by person, promotion, status and promotion+status', () => {
    const employments = validCompanyWorld().tables.employments;
    const ids = (rows: readonly Employment[]): string[] => rows.map((row) => row.id);
    expect(ids(employments.lookup('byPerson', testId('person', 3)))).toEqual([
      testId('employment', 3),
      testId('employment', 4),
    ]);
    expect(ids(employments.lookup('byPromotion', testId('promotion', 2)))).toEqual([
      testId('employment', 3),
      testId('employment', 5),
    ]);
    expect(ids(employments.lookup('byStatus', 'released'))).toEqual([testId('employment', 5)]);
    expect(
      ids(
        employments.lookup(
          'byPromotionStatus',
          promotionStatusKey(testId('promotion', 1), 'active'),
        ),
      ),
    ).toEqual([testId('employment', 1), testId('employment', 2), testId('employment', 4)]);
    expect(promotionStatusKey(testId('promotion', 1), 'active')).toBe(
      `${testId('promotion', 1)}|active`,
    );
  });

  it('declares every ID field as a ref', () => {
    const declared = new Set(employmentsTable.refs.map((spec) => spec.path));
    const found = referenceFieldPaths(employmentsTable.schema);
    expect(found).toEqual(['brandId', 'managerPersonId', 'personId', 'promotionId']);
    expect(found.filter((path) => !declared.has(path))).toEqual([]);
  });
});
