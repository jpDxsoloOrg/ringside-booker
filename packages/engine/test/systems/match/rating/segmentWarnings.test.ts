// Segment warnings (MTCH1-05): every warning code fires on a crafted input, none on a clean
// singles, sorted by severity then side. Design: docs/design/match-rating.md#warnings
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { parseGameDate, type GameDate } from '../../../../src/core/date';
import type { PersonId } from '../../../../src/core/ids';
import type { Catalogs } from '../../../../src/model/catalogs';
import type { GameWorld } from '../../../../src/model/tables';
import {
  SEGMENT_WARNING_CODES,
  segmentWarnings,
  type SegmentRatingInput,
  type SegmentWarning,
} from '../../../../src/systems/match';
import { TEST_CATALOGS } from '../../../support/catalogs';
import { inputOf, personAt, tinyRating, updatePerson } from './fixtures';

const SINGLES = parseContentKey('match.singles');
const TAG = parseContentKey('match.tag-team');
const PROMO = parseContentKey('angle.promo');

interface Setup {
  readonly world: GameWorld;
  readonly base: SegmentRatingInput;
  readonly date: GameDate;
  readonly person: (index: number) => PersonId;
  readonly nameOf: (index: number) => string;
}

function setup(): Setup {
  const { world, mainEvent, people } = tinyRating();
  const base = inputOf(world, mainEvent.id);
  const person = (index: number): PersonId => personAt(people, index);
  const nameOf = (index: number): string => {
    const id = person(index);
    const contract = world.tables.employments
      .lookup('byPerson', id)
      .find((employment) => employment.status === 'active');
    return contract?.ringName ?? world.tables.people.require(id).defaultRingName;
  };
  return { world, base, date: base.event.date, person, nameOf };
}

function warningsFor(
  { world, date }: Setup,
  input: SegmentRatingInput,
  catalogs: Catalogs = TEST_CATALOGS,
): SegmentWarning[] {
  return segmentWarnings(input, world, catalogs, date);
}

function sides(...groups: (readonly PersonId[])[]): SegmentRatingInput['sides'] {
  return groups.map((personIds, side) => ({ side, personIds }));
}

describe('segmentWarnings', () => {
  it('finds nothing wrong with a clean singles match or the stored promo', () => {
    const fixture = setup();
    expect(warningsFor(fixture, fixture.base)).toEqual([]);
    const { world, promo } = tinyRating();
    const promoInput = inputOf(world, promo.id);
    expect(segmentWarnings(promoInput, world, TEST_CATALOGS, promoInput.event.date)).toEqual([]);
  });

  it('sideCount: a third side in a Singles match', () => {
    const fixture = setup();
    const { person } = fixture;
    const warnings = warningsFor(fixture, {
      ...fixture.base,
      typeKey: SINGLES,
      sides: sides([person(0)], [person(1)], [person(4)]),
    });
    expect(warnings).toEqual([
      {
        code: 'sideCount',
        severity: 'error',
        message: 'Three sides in a Singles match: it takes 2',
      },
    ]);
  });

  it('sideSize: two people on a Singles side', () => {
    const fixture = setup();
    const { person } = fixture;
    const warnings = warningsFor(fixture, {
      ...fixture.base,
      sides: sides([person(0)], [person(1), person(4)]),
    });
    expect(warnings).toEqual([
      {
        code: 'sideSize',
        severity: 'error',
        side: 1,
        message: 'Side 2 has 2 people: Singles takes 1 a side',
      },
    ]);
  });

  it('unequalSides: uneven sides in a type that takes equal sides', () => {
    const fixture = setup();
    const { person } = fixture;
    const tag = TEST_CATALOGS.matchTypes?.[TAG];
    if (tag === undefined) {
      throw new Error('no tag team match type');
    }
    const catalogs: Catalogs = {
      ...TEST_CATALOGS,
      matchTypes: {
        ...TEST_CATALOGS.matchTypes,
        [TAG]: { ...tag, sideSize: { min: 1, max: 3 }, equalSides: true },
      },
    };
    const warnings = warningsFor(
      fixture,
      { ...fixture.base, typeKey: TAG, sides: sides([person(0), person(4)], [person(1)]) },
      catalogs,
    );
    expect(warnings).toEqual([
      {
        code: 'unequalSides',
        severity: 'warning',
        message: 'The sides are uneven (2 against 1): Tag Team takes equal sides',
      },
    ]);
  });

  it('duplicatePerson: someone on both sides, or twice on one', () => {
    const fixture = setup();
    const { person, nameOf } = fixture;
    expect(
      warningsFor(fixture, { ...fixture.base, sides: sides([person(0)], [person(0)]) }).find(
        (warning) => warning.code === 'duplicatePerson',
      ),
    ).toEqual({
      code: 'duplicatePerson',
      severity: 'error',
      personId: person(0),
      side: 0,
      message: `${nameOf(0)} is on both sides`,
    });
    expect(
      warningsFor(fixture, {
        ...fixture.base,
        typeKey: TAG,
        sides: sides([person(0), person(0)], [person(1), person(4)]),
      }).map((warning) => warning.message),
    ).toContain(`${nameOf(0)} is on side 1 twice`);
  });

  it('injured: a match always, a talking segment only when the injury rules it out', () => {
    const fixture = setup();
    const { person, nameOf, world } = fixture;
    const injuryFor = (canWorkAngles: boolean) => ({
      kindKey: parseContentKey('injury.torn-shoulder'),
      bodyPart: 'arms' as const,
      since: parseGameDate('2026-03-01'),
      expectedReturn: parseGameDate('2026-05-01'),
      canWorkAngles,
    });
    updatePerson(world, person(1), (row) => ({ ...row, injury: injuryFor(true) }));
    expect(warningsFor(fixture, fixture.base)).toEqual([
      {
        code: 'injured',
        severity: 'error',
        personId: person(1),
        side: 1,
        message: `${nameOf(1)} is injured until 2026-05-01`,
      },
    ]);
    const promoInput: SegmentRatingInput = { ...fixture.base, kind: 'angle', typeKey: PROMO };
    expect(warningsFor(fixture, promoInput)).toEqual([]);
    updatePerson(world, person(1), (row) => ({ ...row, injury: injuryFor(false) }));
    expect(warningsFor(fixture, promoInput).map((warning) => warning.code)).toEqual(['injured']);
    // Healed by the show date: no warning.
    expect(
      segmentWarnings(fixture.base, world, TEST_CATALOGS, parseGameDate('2026-05-01')),
    ).toEqual([]);
  });

  it('inactive: someone on hiatus', () => {
    const fixture = setup();
    const { person, nameOf, world } = fixture;
    updatePerson(world, person(0), (row) => ({ ...row, status: 'hiatus' }));
    expect(warningsFor(fixture, fixture.base)).toEqual([
      {
        code: 'inactive',
        severity: 'error',
        personId: person(0),
        side: 0,
        message: `${nameOf(0)} is on hiatus`,
      },
    ]);
  });

  it('nonWrestler: a non-wrestler booked in a match, not in a talking segment', () => {
    const fixture = setup();
    const { person, nameOf, world } = fixture;
    updatePerson(world, person(1), (row) => ({ ...row, style: 'nonWrestler', roles: ['manager'] }));
    expect(warningsFor(fixture, fixture.base)).toEqual([
      {
        code: 'nonWrestler',
        severity: 'warning',
        personId: person(1),
        side: 1,
        message: `${nameOf(1)} is not a wrestler`,
      },
    ]);
    expect(warningsFor(fixture, { ...fixture.base, kind: 'angle', typeKey: PROMO })).toEqual([]);
  });

  it('speakerCount: too many speakers for a Promo', () => {
    const fixture = setup();
    const { person } = fixture;
    const warnings = warningsFor(fixture, {
      ...fixture.base,
      kind: 'angle',
      typeKey: PROMO,
      sides: sides([person(0), person(2), person(3)], [person(1), person(4)]),
    });
    expect(warnings).toEqual([
      {
        code: 'speakerCount',
        severity: 'warning',
        message: 'Five speakers in a Promo: it takes 1 to 4',
      },
    ]);
  });

  it('covers every code', () => {
    expect([...SEGMENT_WARNING_CODES].sort()).toEqual(
      [
        'duplicatePerson',
        'inactive',
        'injured',
        'nonWrestler',
        'sideCount',
        'sideSize',
        'speakerCount',
        'unequalSides',
      ].sort(),
    );
  });

  it('sorts errors before warnings, then by side', () => {
    const fixture = setup();
    const { person, world } = fixture;
    updatePerson(world, person(4), (row) => ({ ...row, style: 'nonWrestler', roles: ['manager'] }));
    updatePerson(world, person(1), (row) => ({ ...row, status: 'hiatus' }));
    const warnings = warningsFor(fixture, {
      ...fixture.base,
      sides: sides([person(4)], [person(1)], [person(0)]),
    });
    expect(warnings.map((warning) => [warning.code, warning.side ?? null])).toEqual([
      ['sideCount', null],
      ['inactive', 1],
      ['nonWrestler', 0],
    ]);
  });
});
