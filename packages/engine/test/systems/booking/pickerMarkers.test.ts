// EVT2-13: `booking.availableWorkers` names the titles each person and team holds, and the
// storylines they are in, for the roster picker's champion marker and Storylines filter.
// Design: docs/design/booking.md#queries
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import { aTeam, anEventInstance, worldBuilder } from '../../support';
import { engineOver, PLAYER_ONE, AS_PLAYER_ONE } from './queries-world';

const START = parseGameDate('2026-01-05');

function only<Value>(value: Value | undefined, what: string): Value {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

function markersWorld() {
  const { world, ids } = worldBuilder({ startDate: START })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A', controller: PLAYER_ONE }, (promotion) =>
      promotion
        .withRoster(5)
        .withTitle({ name: 'Test World Title' }, { holder: 0 })
        .withTitle({ name: 'Test Tag Titles', holderCount: 2 }, { holder: [1, 2] })
        .withTitle({ name: 'Test Vacant Title' })
        .withStoryline({ name: 'Test Cold Feud', heat: 20 }, { members: [[3, 'neutral']] })
        .withStoryline(
          { name: 'Test Hot Feud', heat: 80 },
          {
            members: [
              [0, 'face'],
              [3, 'heel'],
            ],
          },
        )
        .withStoryline(
          { name: 'Test Old Feud', status: 'ended', endedOn: START },
          { members: [[4, 'face']] },
        ),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion
        .withRoster(1)
        .withStoryline({ name: 'Test Rival Feud' }, { members: [[0, 'face']] }),
    )
    .with('teams and a show', (context) => {
      const [, second, third] = context.ids.people;
      context.insert(
        'teams',
        aTeam(
          { name: 'Test Champions', memberIds: [only(second, 'p1'), only(third, 'p2')] },
          context.sequence,
        ),
      );
      context.insert(
        'teams',
        aTeam(
          { name: 'Test Pair', memberIds: [only(third, 'p2'), only(context.ids.people[3], 'p3')] },
          context.sequence,
        ),
      );
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId: only(context.ids.promotions.A, 'promotion A'),
            regionId: only(context.ids.regions[0], 'region'),
            name: 'Test Show',
            date: START,
            airDate: START,
          },
          context.sequence,
        ),
      );
    })
    .build();
  return { world, ids, show: only(ids.eventInstances[0], 'show') };
}

describe('booking.availableWorkers: titles and storylines (EVT2-13)', () => {
  it("names each champion's titles and each team's tag titles, own promotion only", () => {
    const built = markersWorld();
    const result = engineOver(built.world).query(
      'booking.availableWorkers',
      { eventInstanceId: built.show, kind: 'match' },
      AS_PLAYER_ONE,
    );
    if (!result.ok) throw new Error('refused');
    const titlesOf = (index: number) =>
      result.data.people
        .find((row) => row.personId === built.ids.people[index])
        ?.titles.map((title) => title.name);
    expect(titlesOf(0)).toEqual(['Test World Title']);
    expect(titlesOf(1)).toEqual(['Test Tag Titles']);
    expect(titlesOf(2)).toEqual(['Test Tag Titles']);
    expect(titlesOf(3)).toEqual([]);
    const teamTitles = Object.fromEntries(
      result.data.teams.map((team) => [team.name, team.titles.map((title) => title.name)]),
    );
    expect(teamTitles).toEqual({ 'Test Champions': ['Test Tag Titles'], 'Test Pair': [] });
  });

  it('lists the active storylines hottest first, with each member’s side', () => {
    const built = markersWorld();
    const result = engineOver(built.world).query(
      'booking.availableWorkers',
      { eventInstanceId: built.show, kind: 'match', search: 'zzz' },
      AS_PLAYER_ONE,
    );
    if (!result.ok) throw new Error('refused');
    // The search narrows the people, never the storylines the filter offers.
    expect(result.data.people).toEqual([]);
    expect(result.data.storylines.map((storyline) => storyline.name)).toEqual([
      'Test Hot Feud',
      'Test Cold Feud',
    ]);

    const all = engineOver(built.world).query(
      'booking.availableWorkers',
      { eventInstanceId: built.show, kind: 'match' },
      AS_PLAYER_ONE,
    );
    if (!all.ok) throw new Error('refused');
    const storylinesOf = (index: number) =>
      all.data.people
        .find((row) => row.personId === built.ids.people[index])
        ?.storylines.map((membership) => [membership.name, membership.side]);
    expect(storylinesOf(3)).toEqual([
      ['Test Hot Feud', 'heel'],
      ['Test Cold Feud', 'neutral'],
    ]);
    expect(storylinesOf(0)).toEqual([['Test Hot Feud', 'face']]);
    // An ended storyline is no longer current.
    expect(storylinesOf(4)).toEqual([]);
  });
});
