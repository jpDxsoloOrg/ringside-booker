import { describe, expect, it } from 'vitest';
import { UniqueIndexError } from '../../../src/core/errors';
import {
  relationshipKey,
  RelationshipSchema,
  relationshipsTable,
} from '../../../src/model/entities/relationship';
import { StableSchema, stablesTable } from '../../../src/model/entities/stable';
import { TeamSchema, teamsTable } from '../../../src/model/entities/team';
import { checkWorld } from '../../../src/model/integrity';
import { promotionsTable } from '../../../src/model/entities/promotion';
import {
  COMPANY_REGISTRY,
  date,
  makeRelationship,
  makeStable,
  makeTeam,
  testId,
  validCompanyWorld,
} from '../../support/company-fixtures';
import { referenceFieldPaths } from '../../support/ref-fields';
import { issuePaths, parseIssues } from '../../support/schema-issues';

describe('TeamSchema', () => {
  it('accepts a tag team of two and a trio of three', () => {
    expect(parseIssues(TeamSchema, makeTeam(1, [1, 2]))).toEqual([]);
    expect(parseIssues(TeamSchema, makeTeam(2, [1, 2, 3]))).toEqual([]);
  });

  it('rejects a tag team with 3 members', () => {
    expect(issuePaths(TeamSchema, makeTeam(1, [1, 2, 3], { kind: 'tag' }))).toEqual(['memberIds']);
  });

  it('rejects a trio with 2 members', () => {
    expect(issuePaths(TeamSchema, makeTeam(1, [1, 2], { kind: 'trio' }))).toEqual(['memberIds']);
  });

  it('rejects a repeated member', () => {
    expect(issuePaths(TeamSchema, makeTeam(1, [1, 1]))).toEqual(['memberIds']);
  });

  it('requires splitOn exactly when split', () => {
    expect(issuePaths(TeamSchema, makeTeam(1, [1, 2], { status: 'split' }))).toEqual(['splitOn']);
    expect(
      issuePaths(
        TeamSchema,
        makeTeam(1, [1, 2], { status: 'inactive', splitOn: date('2026-01-01') }),
      ),
    ).toEqual(['splitOn']);
    expect(
      parseIssues(
        TeamSchema,
        makeTeam(1, [1, 2], { status: 'split', splitOn: date('2026-01-01') }),
      ),
    ).toEqual([]);
  });

  it('rejects a split before the team formed', () => {
    const team = makeTeam(1, [1, 2], { status: 'split', splitOn: date('2025-05-31') });
    expect(issuePaths(TeamSchema, team)).toEqual(['splitOn']);
  });
});

describe('StableSchema', () => {
  it('accepts a stable led by one of its members', () => {
    const stable = makeStable(1, 1, [1, 2, 3], { leaderId: testId('person', 2) });
    expect(parseIssues(StableSchema, stable)).toEqual([]);
  });

  it('rejects a leader who is not a member', () => {
    const stable = makeStable(1, 1, [1, 2], { leaderId: testId('person', 3) });
    expect(issuePaths(StableSchema, stable)).toEqual(['leaderId']);
  });

  it('rejects fewer than 2 or more than 12 members', () => {
    expect(issuePaths(StableSchema, makeStable(1, 1, [1]))).toEqual(['memberIds']);
    const thirteen = Array.from({ length: 13 }, (_unused, index) => index + 1);
    expect(issuePaths(StableSchema, makeStable(1, 1, thirteen))).toEqual(['memberIds']);
    const twelve = thirteen.slice(0, 12);
    expect(parseIssues(StableSchema, makeStable(1, 1, twelve))).toEqual([]);
  });

  it('rejects a repeated member', () => {
    expect(issuePaths(StableSchema, makeStable(1, 1, [1, 2, 1]))).toEqual(['memberIds']);
  });

  it('requires disbandedOn exactly when disbanded', () => {
    expect(issuePaths(StableSchema, makeStable(1, 1, [1, 2], { status: 'disbanded' }))).toEqual([
      'disbandedOn',
    ]);
    expect(
      issuePaths(StableSchema, makeStable(1, 1, [1, 2], { disbandedOn: date('2026-01-01') })),
    ).toEqual(['disbandedOn']);
  });
});

describe('RelationshipSchema', () => {
  it('accepts a relationship in canonical order', () => {
    expect(parseIssues(RelationshipSchema, makeRelationship(1, 1, 2))).toEqual([]);
  });

  it('rejects a relationship with A > B', () => {
    expect(issuePaths(RelationshipSchema, makeRelationship(1, 2, 1))).toEqual(['personBId']);
  });

  it('rejects a relationship of a person with themselves', () => {
    expect(issuePaths(RelationshipSchema, makeRelationship(1, 2, 2))).toEqual(['personBId']);
  });

  it('rejects married + dating', () => {
    const relationship = makeRelationship(1, 1, 2, { bonds: ['married', 'dating'] });
    expect(issuePaths(RelationshipSchema, relationship)).toEqual(['bonds']);
  });

  it('accepts one romantic bond alongside other bonds', () => {
    const relationship = makeRelationship(1, 1, 2, { bonds: ['married', 'friends', 'rivals'] });
    expect(parseIssues(RelationshipSchema, relationship)).toEqual([]);
  });

  it('rejects a repeated bond', () => {
    const relationship = makeRelationship(1, 1, 2, { bonds: ['friends', 'friends'] });
    expect(issuePaths(RelationshipSchema, relationship)).toEqual(['bonds']);
  });

  it('rejects mentorship without mentorId', () => {
    const relationship = makeRelationship(1, 1, 2, { bonds: ['mentorship'] });
    expect(issuePaths(RelationshipSchema, relationship)).toEqual(['mentorId']);
  });

  it('rejects a mentorId without mentorship, and a mentor outside the pair', () => {
    const withoutBond = makeRelationship(1, 1, 2, { mentorId: testId('person', 1) });
    expect(issuePaths(RelationshipSchema, withoutBond)).toEqual(['mentorId']);
    const outsider = makeRelationship(1, 1, 2, {
      bonds: ['mentorship'],
      mentorId: testId('person', 3),
    });
    expect(issuePaths(RelationshipSchema, outsider)).toEqual(['mentorId']);
  });

  it('rejects lastChangedOn before since', () => {
    const relationship = makeRelationship(1, 1, 2, { lastChangedOn: date('2024-01-31') });
    expect(issuePaths(RelationshipSchema, relationship)).toEqual(['lastChangedOn']);
  });
});

describe('relationshipKey', () => {
  it('returns the same canonical key in either order', () => {
    const first = testId('person', 1);
    const second = testId('person', 2);
    expect(relationshipKey(first, second)).toBe(`${first}|${second}`);
    expect(relationshipKey(second, first)).toBe(`${first}|${second}`);
  });
});

describe('group tables in a world', () => {
  it('rejects a second relationship for the same pair on insert', () => {
    const world = validCompanyWorld();
    expect(() => {
      world.tables.relationships._put(makeRelationship(2, 1, 4, { bonds: ['rivals'] }));
    }).toThrow(UniqueIndexError);
    expect(world.tables.relationships.size).toBe(1);
  });

  it('finds relationships from either side and by pair', () => {
    const relationships = validCompanyWorld().tables.relationships;
    for (const personSerial of [1, 4]) {
      expect(
        relationships.lookup('byPerson', testId('person', personSerial)).map((row) => row.id),
      ).toEqual([testId('relationship', 1)]);
    }
    const key = relationshipKey(testId('person', 4), testId('person', 1));
    expect(relationships.lookupOne('byPair', key)?.id).toBe(testId('relationship', 1));
  });

  it('indexes teams and stables by member and stables by promotion', () => {
    const world = validCompanyWorld();
    expect(world.tables.teams.lookup('byMember', testId('person', 2)).map((row) => row.id)).toEqual(
      [testId('team', 1)],
    );
    expect(
      world.tables.stables.lookup('byMember', testId('person', 4)).map((row) => row.id),
    ).toEqual([testId('stable', 1)]);
    expect(
      world.tables.stables.lookup('byPromotion', testId('promotion', 1)).map((row) => row.id),
    ).toEqual([testId('stable', 1)]);
  });

  it('reports a deceased member of an active team and an active stable', () => {
    const world = validCompanyWorld();
    world.tables.people._put({ id: testId('person', 2), status: 'deceased' });
    const report = checkWorld(world, COMPANY_REGISTRY, { only: ['invariants'] });
    expect(report.issues.map((issue) => [issue.code, issue.id, issue.path])).toEqual([
      ['stables.deceasedMember', testId('stable', 1), 'memberIds[1]'],
      ['teams.deceasedMember', testId('team', 1), 'memberIds[1]'],
    ]);
  });

  it('ignores deceased members of split teams and disbanded stables', () => {
    const world = validCompanyWorld();
    world.tables.people._put({ id: testId('person', 2), status: 'deceased' });
    world.tables.teams._put(makeTeam(1, [1, 2], { status: 'split', splitOn: date('2025-12-01') }));
    world.tables.stables._put(
      makeStable(1, 1, [1, 2, 4], { status: 'disbanded', disbandedOn: date('2025-12-01') }),
    );
    expect(checkWorld(world, COMPANY_REGISTRY, { only: ['invariants'] }).issues).toEqual([]);
  });

  it('does not require stable members to hold a contract with the promotion', () => {
    const world = validCompanyWorld();
    world.tables.stables._put(makeStable(2, 2, [4, 5]));
    expect(checkWorld(world, COMPANY_REGISTRY, { validateRows: true }).issues).toEqual([]);
  });

  it('reports a dangling team member with its index', () => {
    const world = validCompanyWorld();
    world.tables.teams._put(makeTeam(2, [1, 77]));
    expect(checkWorld(world, COMPANY_REGISTRY, { only: ['refs'] }).issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'teams',
        path: 'memberIds[1]',
        missingId: testId('person', 77),
      }),
    ]);
  });
});

describe('reference fields', () => {
  it('the walker finds nested, array and controller ID fields', () => {
    expect(referenceFieldPaths(StableSchema)).toEqual(['leaderId', 'memberIds[]', 'promotionId']);
    expect(referenceFieldPaths(promotionsTable.schema)).toEqual([
      'bookerPersonId',
      'controller.playerId',
      'homeRegionId',
      'ownerPersonId',
      'parentPromotionId',
    ]);
  });

  it.each([teamsTable, stablesTable, relationshipsTable])(
    '$name declares every ID field as a ref',
    (table) => {
      const declared = new Set(table.refs.map((spec) => spec.path));
      const undeclared = referenceFieldPaths(table.schema).filter((path) => !declared.has(path));
      expect(undeclared).toEqual([]);
    },
  );
});
