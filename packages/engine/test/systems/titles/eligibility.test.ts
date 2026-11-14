// The one holder check (CRTV1-01). Design: docs/design/titles.md#holders
import { describe, expect, it } from 'vitest';
import type { PersonId, TeamId, TitleId } from '../../../src/core/ids';
import type { GameWorld } from '../../../src/model/tables';
import { isEligibleHolder } from '../../../src/systems/titles';
import { aTeam, testId, worldBuilder, type BuiltWorld } from '../../support';
import { START } from './titles-world';

/**
 * Altura Pro: wrestlers 0-3 (wrestler 1 is a manager, wrestler 2 weighs 130 kg), a singles title
 * held by wrestler 0, a retired title, a light heavyweight title and a tag title. Wrestler 4 works
 * for Bayside, the other promotion. Teams: 0+3 (active), 0+1 (split).
 */
function eligibilityWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Altura Pro' }, (promotion) =>
      promotion
        .withRoster(4, {
          person: (index) =>
            index === 1
              ? { roles: ['manager'], style: 'nonWrestler' }
              : index === 2
                ? { weightKg: 130 }
                : {},
        })
        .withTitle({ name: 'Altura Championship' }, { holder: 0 })
        .withTitle({ name: 'Altura Legends Title', status: 'retired', retiredOn: START })
        .withTitle({
          name: 'Altura Cruiserweight Title',
          division: { gender: 'open', minWeightKg: null, maxWeightKg: 100 },
        })
        .withTitle({ name: 'Altura Tag Team Championship', holderCount: 2 }),
    )
    .withPromotion({ name: 'Bayside Wrestling' }, (promotion) => promotion.withRoster(1))
    .with('teams', (context) => {
      const [first, second, , fourth] = context.ids.people;
      if (first === undefined || second === undefined || fourth === undefined) {
        throw new Error('short roster');
      }
      context.insert('teams', aTeam({ memberIds: [first, fourth] }, context.sequence));
      context.insert(
        'teams',
        aTeam({ memberIds: [first, second], status: 'split', splitOn: START }, context.sequence),
      );
    })
    .build();
}

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`nothing at ${String(index)}`);
  }
  return value;
}

function codesFor(
  world: GameWorld,
  titleId: TitleId,
  holderIds: PersonId[],
  teamId: TeamId | null = null,
): string[] {
  const title = world.tables.titles.get(titleId);
  if (title === undefined) {
    throw new Error('no title');
  }
  return isEligibleHolder(world, title, { holderIds, teamId }, START).map((reason) => reason.code);
}

describe('isEligibleHolder', () => {
  const built = eligibilityWorld();
  const { world, ids } = built;
  const person = (index: number): PersonId => at(ids.people, index);
  const singles = at(ids.titles, 0);
  const retired = at(ids.titles, 1);
  const cruiser = at(ids.titles, 2);
  const tag = at(ids.titles, 3);

  it('accepts a wrestler on the roster for a singles title, even its current champion', () => {
    expect(codesFor(world, singles, [person(3)])).toEqual([]);
    expect(codesFor(world, singles, [person(0)])).toEqual([]);
  });

  it('accepts a tag team made of exactly the holders', () => {
    expect(codesFor(world, tag, [person(3), person(0)], at(ids.teams, 0))).toEqual([]);
    expect(codesFor(world, tag, [person(0), person(3)])).toEqual([]);
  });

  it('refuses a retired title once, with the player text', () => {
    const title = world.tables.titles.get(retired);
    if (title === undefined) {
      throw new Error('no title');
    }
    const reasons = isEligibleHolder(world, title, { holderIds: [person(0)], teamId: null }, START);
    expect(reasons).toEqual([
      {
        code: 'titleRetired',
        message: 'The Altura Legends Title is retired. Reactivate it first.',
        subject: { kind: 'title', id: retired },
      },
    ]);
  });

  it('refuses the wrong number of holders', () => {
    const title = world.tables.titles.get(tag);
    if (title === undefined) {
      throw new Error('no title');
    }
    const [reason] = isEligibleHolder(
      world,
      title,
      { holderIds: [person(0)], teamId: null },
      START,
    );
    expect(reason).toMatchObject({
      code: 'wrongHolderCount',
      message: 'The Altura Tag Team Championship needs 2 champions.',
    });
  });

  it('refuses the same person named twice', () => {
    expect(codesFor(world, tag, [person(0), person(0)])).toEqual(['duplicateHolder']);
  });

  it('refuses someone who works for another promotion', () => {
    const title = world.tables.titles.get(singles);
    if (title === undefined) {
      throw new Error('no title');
    }
    const outsider = person(4);
    const ringName = world.tables.people.get(outsider)?.defaultRingName ?? '';
    expect(isEligibleHolder(world, title, { holderIds: [outsider], teamId: null }, START)).toEqual([
      {
        code: 'notOnRoster',
        message: `${ringName} doesn't work for Altura Pro.`,
        subject: { kind: 'person', id: outsider },
      },
    ]);
  });

  it("passes on WRK1's reasons for each holder", () => {
    expect(codesFor(world, singles, [person(1)])).toEqual(['notAWrestler']);
    expect(codesFor(world, cruiser, [person(2)])).toEqual(['aboveMaxWeight']);
  });

  it('refuses a team that is not these holders, has split or does not exist', () => {
    expect(codesFor(world, tag, [person(0), person(2)], at(ids.teams, 0))).toEqual([
      'teamMismatch',
    ]);
    expect(codesFor(world, tag, [person(0), person(1)], at(ids.teams, 1))).toEqual([
      'notAWrestler',
      'teamMismatch',
    ]);
    expect(codesFor(world, tag, [person(0), person(3)], testId('team', 999))).toEqual([
      'teamMismatch',
    ]);
  });
});
