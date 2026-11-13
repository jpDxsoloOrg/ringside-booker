// The title picture and challengers. Design: docs/design/rival-booking.md#title-picture
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { addDays } from '../../../../src/core/date';
import type { PersonId, TitleId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import {
  assertTraceReplays,
  findTraceNodes,
  traceNodeSchema,
  type TraceNode,
} from '../../../../src/core/trace';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import type { Person } from '../../../../src/model/entities/person';
import type { Title } from '../../../../src/model/entities/title';
import {
  buildCardPool,
  CARD_PLAN_STREAM,
  decideTitlePicture,
  lastDefenceOf,
  NO_CHALLENGER_REASON,
  NO_DEFENCE_YET_NOTE,
  NO_FRESH_CHALLENGER,
  recentChallengersOf,
  titleMatchCapFor,
  type CardPool,
  type TitlePicture,
} from '../../../../src/systems/aip';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { aMatch, anEventInstance, aParticipant } from '../../../support/builders/creative';
import { aTeam } from '../../../support/builders/promotions';
import { flatAttributes } from '../../../support/builders/people';
import { TEST_START_DATE, type DeepPartial } from '../../../support/builders/build-row';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder, type BuiltWorld, type TitleHolding } from '../../../support/world-builder';

const TODAY = TEST_START_DATE; // Mon 5 Jan 2026
const LONG_AGO = addDays(TODAY, -400);
const defaults = createEngineTunables();

interface TitleSpec {
  readonly overrides?: DeepPartial<Title>;
  /** Roster indexes of the champions; left out for a vacant title. */
  readonly holder?: number | readonly number[];
  /** Days since the reign began. Defaults to 60 (overdue). */
  readonly daysHeld?: number;
}

interface PastMatch {
  /** Index into the spec's titles. */
  readonly title: number;
  readonly sides: readonly (readonly number[])[];
  readonly daysAgo: number;
}

interface WorldSpec {
  readonly roster: number;
  /** Overrides by roster index; card value falls with the index unless overridden. */
  readonly person?: (index: number) => DeepPartial<Person>;
  readonly titles: readonly TitleSpec[];
  readonly teams?: readonly (readonly number[])[];
  readonly past?: readonly PastMatch[];
  readonly importance?: EventImportance;
}

/** Ability 90 for index 0, then 5 less per index, so card value falls with the index. */
function ranked(index: number): DeepPartial<Person> {
  return { attributes: flatAttributes(Math.max(10, 90 - index * 5)) };
}

function titleWorld(spec: WorldSpec): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => {
      promotion.withRoster(spec.roster, {
        person: (index) => ({ ...ranked(index), ...spec.person?.(index) }),
      });
      for (const title of spec.titles) {
        const holding: TitleHolding =
          title.holder === undefined
            ? {}
            : { holder: title.holder, wonOn: addDays(TODAY, -(title.daysHeld ?? 60)) };
        promotion.withTitle({ introducedOn: LONG_AGO, ...title.overrides }, holding);
      }
    })
    .with('teams, past title matches and tonight', (context) => {
      const person = (index: number): PersonId => {
        const id = context.ids.people[index];
        if (id === undefined) {
          throw new Error(`no person ${String(index)}`);
        }
        return id;
      };
      const promotionId = context.ids.promotions.A;
      const [regionId] = context.ids.regions;
      if (promotionId === undefined || regionId === undefined) {
        throw new Error('the title world needs a promotion and a region');
      }
      for (const members of spec.teams ?? []) {
        context.insert(
          'teams',
          aTeam(
            {
              memberIds: members.map(person),
              kind: members.length === 3 ? 'trio' : 'tag',
              formedOn: LONG_AGO,
            },
            context.sequence,
          ),
        );
      }
      const titleIds = context.ids.titles;
      for (const past of spec.past ?? []) {
        const titleId = titleIds[past.title];
        if (titleId === undefined) {
          throw new Error(`no title ${String(past.title)}`);
        }
        const instance = context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId,
              regionId,
              date: addDays(TODAY, -past.daysAgo),
              status: 'completed',
            },
            context.sequence,
          ),
        );
        const segment = context.insert(
          'segments',
          aMatch(
            {
              eventInstanceId: instance.id,
              match: { titleIds: [titleId] },
              outcome: {
                kind: 'win',
                winningSide: 0,
                methodKey: parseContentKey('method.pinfall'),
              },
            },
            context.sequence,
          ),
        );
        past.sides.forEach((side, sideIndex) => {
          for (const index of side) {
            context.insert(
              'participants',
              aParticipant(
                { segmentId: segment.id, personId: person(index), side: sideIndex },
                context.sequence,
              ),
            );
          }
        });
      }
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId,
            regionId,
            name: 'Tonight',
            importance: spec.importance ?? 'regular',
            date: TODAY,
          },
          context.sequence,
        ),
      );
    })
    .build();
}

interface Planned {
  readonly built: BuiltWorld;
  readonly pool: CardPool;
  readonly picture: TitlePicture;
}

function plan(spec: WorldSpec, options: { seed?: string; tunables?: EngineTunables } = {}) {
  const built = titleWorld(spec);
  const tunables = options.tunables ?? defaults;
  const instance = built.world.tables.eventInstances.values().find((row) => row.name === 'Tonight');
  if (instance === undefined) {
    throw new Error('no show tonight');
  }
  const pool = buildCardPool(built.world, { instance, date: TODAY, tunables });
  const cap = titleMatchCapFor({ importance: pool.importance, matchSlots: 6 }, { tunables });
  const picture = decideTitlePicture(
    pool,
    { today: TODAY, taste: pool.taste, cap },
    {
      read: built.world,
      tunables,
      rng: new RngRegistry(options.seed ?? 'title-seed').stream(CARD_PLAN_STREAM),
    },
  );
  expectSerialisable(picture);
  expect(traceNodeSchema.safeParse(picture.trace).success).toBe(true);
  // Every formula in the picture (urgency, card values, the cap) replays to its value.
  for (const formula of findTraceNodes(picture.trace, 'formula')) {
    if (typeof formula.value === 'number') {
      assertTraceReplays({ value: formula.value, trace: formula });
    }
  }
  return { built, pool, picture } satisfies Planned;
}

function personAt(built: BuiltWorld, index: number): PersonId {
  const id = built.ids.people[index];
  if (id === undefined) {
    throw new Error(`no person ${String(index)}`);
  }
  return id;
}

function titleAt(built: BuiltWorld, index: number): TitleId {
  const id = built.ids.titles[index];
  if (id === undefined) {
    throw new Error(`no title ${String(index)}`);
  }
  return id;
}

function challengersOf(picture: TitlePicture, titleId: TitleId): PersonId[] {
  return (
    picture.planned
      .find((match) => match.titleId === titleId)
      ?.sides.filter((side) => !side.isChampions)
      .flatMap((side) => side.personIds) ?? []
  );
}

function labelsOf(node: TraceNode): string[] {
  const labels: string[] = [];
  const walk = (current: TraceNode): void => {
    labels.push(current.label);
    if (current.kind === 'decision') {
      labels.push(current.reason);
    }
    for (const child of current.children ?? []) {
      walk(child);
    }
  };
  walk(node);
  return labels;
}

describe('decideTitlePicture', () => {
  it('defends an overdue title and leaves a fresh one alone', () => {
    const { built, picture } = plan({
      roster: 6,
      titles: [
        { overrides: { name: 'Overdue Title', prestige: 50 }, holder: 0, daysHeld: 40 },
        { overrides: { name: 'Fresh Title', prestige: 50 }, holder: 1, daysHeld: 3 },
      ],
    });
    const [overdue, fresh] = [titleAt(built, 0), titleAt(built, 1)];
    expect(picture.planned.map((match) => match.titleId)).toEqual([overdue]);
    const match = picture.planned[0];
    // A one-on-one type that allows titles, rolled with the match type weights (AIP4-03).
    expect(['match.singles', 'match.endurance', 'match.sprint']).toContain(match?.matchTypeKey);
    expect(match?.sides[0]).toEqual({
      personIds: [personAt(built, 0)],
      teamId: null,
      isChampions: true,
    });
    expect(match?.sides).toHaveLength(2);
    expect(picture.skipped).toEqual([
      { titleId: fresh, reason: 'Not due: 3 days since the last defence' },
    ]);
    const labels = labelsOf(match?.trace.trace ?? picture.trace);
    expect(labels).toContain(NO_DEFENCE_YET_NOTE);
    expect(labels).toContain('40 days since the last defence');
    // The style's title taste sets a 26.67-day gap: 40 ÷ 26.67 + 50 prestige × 0.5 ÷ 100.
    expect(labels).toContain('Due: urgency 1.75 ≥ 1');
  });

  it('counts from the latest completed title match when there is one', () => {
    const { built } = plan({
      roster: 4,
      titles: [{ holder: 0, daysHeld: 90 }],
      past: [{ title: 0, sides: [[0], [2]], daysAgo: 10 }],
    });
    const titleId = titleAt(built, 0);
    expect(lastDefenceOf(built.world, { titleId }, TODAY)).toEqual({
      date: addDays(TODAY, -10),
      source: 'match',
    });
    expect(recentChallengersOf(built.world, titleId, 2)).toEqual([personAt(built, 2)]);
  });

  it('defends up to the cap on a major show, the most urgent first', () => {
    const { built, picture } = plan({
      roster: 14,
      importance: 'major',
      titles: [
        { overrides: { prestige: 90 }, holder: 0, daysHeld: 5 },
        { overrides: { prestige: 80 }, holder: 1, daysHeld: 5 },
        { overrides: { prestige: 70 }, holder: 2, daysHeld: 5 },
        { overrides: { prestige: 60 }, holder: 3, daysHeld: 5 },
        { overrides: { prestige: 50 }, holder: 4, daysHeld: 5 },
      ],
    });
    // The major-show bonus makes every title due; the cap is 4.
    expect(picture.planned).toHaveLength(4);
    expect(picture.planned.map((match) => match.titleId)).toEqual(
      [0, 1, 2, 3].map((index) => titleAt(built, index)),
    );
    expect(picture.skipped).toEqual([
      { titleId: titleAt(built, 4), reason: 'Card already has 4 title matches (limit 4)' },
    ]);
    const everyone = picture.planned.flatMap((match) =>
      match.sides.flatMap((side) => side.personIds),
    );
    expect(new Set(everyone).size).toBe(everyone.length);
  });

  it('skips a title whose champion is injured, with the reason', () => {
    const { built, picture } = plan({
      roster: 4,
      person: (index) =>
        index === 0
          ? {
              injury: {
                kindKey: parseContentKey('injury.test'),
                bodyPart: 'legs',
                since: addDays(TODAY, -3),
                expectedReturn: addDays(TODAY, 38),
                canWorkAngles: false,
              },
            }
          : {},
      titles: [{ holder: 0 }],
    });
    expect(picture.planned).toEqual([]);
    expect(picture.skipped.map((entry) => entry.titleId)).toEqual([titleAt(built, 0)]);
    expect(picture.skipped[0]?.reason).toMatch(
      /^Champion .+ can't defend tonight: Injured \(leg injury\) until 12 Feb$/,
    );
  });

  it('gives a vacant title the two best eligible contenders', () => {
    const { built, picture } = plan({ roster: 5, titles: [{ overrides: { prestige: 10 } }] });
    const [match] = picture.planned;
    expect(match?.sides.map((side) => side.isChampions)).toEqual([false, false]);
    expect(challengersOf(picture, titleAt(built, 0))).toEqual([
      personAt(built, 0),
      personAt(built, 1),
    ]);
    expect(labelsOf(match?.trace.trace ?? picture.trace)).toContain(
      'Vacant title: the two best eligible contenders meet',
    );
  });

  it("never gives a women's title a male challenger", () => {
    const { built, picture } = plan(
      {
        roster: 6,
        person: (index) => ({ gender: index === 0 || index >= 4 ? 'female' : 'male' }),
        titles: [
          {
            overrides: { division: { gender: 'female', minWeightKg: null, maxWeightKg: null } },
            holder: 0,
          },
        ],
      },
      { tunables: createEngineTunables({ 'aip.titles.challengerPool': 10 }) },
    );
    const challengers = challengersOf(picture, titleAt(built, 0));
    expect(challengers).toHaveLength(1);
    expect([personAt(built, 4), personAt(built, 5)]).toContain(challengers[0]);
    const labels = labelsOf(picture.trace);
    expect(labels.some((label) => label.endsWith("is a women's title"))).toBe(true);
  });

  it('never gives a weight-capped title a heavier challenger; the limit itself is allowed', () => {
    const { built, picture } = plan(
      {
        roster: 5,
        person: (index) => ({ weightKg: [90, 120, 101, 100, 80][index] ?? 100 }),
        titles: [
          {
            overrides: { division: { gender: 'open', minWeightKg: null, maxWeightKg: 100 } },
            holder: 0,
          },
        ],
      },
      { tunables: createEngineTunables({ 'aip.titles.challengerPool': 10 }) },
    );
    const challengers = challengersOf(picture, titleAt(built, 0));
    expect([personAt(built, 3), personAt(built, 4)]).toContain(challengers[0]);
    expect(labelsOf(picture.trace).some((label) => label.includes('Too heavy'))).toBe(true);
  });

  it('rests recent challengers, then allows a rematch when nobody else is left', () => {
    const rested = plan(
      {
        roster: 4,
        titles: [{ holder: 0, daysHeld: 90 }],
        past: [
          { title: 0, sides: [[0], [1]], daysAgo: 60 },
          { title: 0, sides: [[0], [2]], daysAgo: 40 },
        ],
      },
      { tunables: createEngineTunables({ 'aip.titles.challengerPool': 10 }) },
    );
    expect(challengersOf(rested.picture, titleAt(rested.built, 0))).toEqual([
      personAt(rested.built, 3),
    ]);

    const rematch = plan({
      roster: 3,
      titles: [{ holder: 0, daysHeld: 90 }],
      past: [
        { title: 0, sides: [[0], [1]], daysAgo: 60 },
        { title: 0, sides: [[0], [2]], daysAgo: 40 },
      ],
    });
    expect(challengersOf(rematch.picture, titleAt(rematch.built, 0))).toHaveLength(1);
    expect(labelsOf(rematch.picture.trace)).toContain(NO_FRESH_CHALLENGER);
  });

  it('keeps other champions out unless the flag is off', () => {
    const spec: WorldSpec = {
      roster: 3,
      titles: [
        { overrides: { prestige: 90 }, holder: 0 },
        { overrides: { prestige: 10 }, holder: 1, daysHeld: 1 },
      ],
    };
    const strict = plan(spec, {
      tunables: createEngineTunables({ 'aip.titles.challengerPool': 10 }),
    });
    expect(challengersOf(strict.picture, titleAt(strict.built, 0))).toEqual([
      personAt(strict.built, 2),
    ]);

    const open = plan(spec, {
      tunables: createEngineTunables({
        'aip.titles.challengerPool': 1,
        'aip.titles.excludeOtherChampions': false,
      }),
    });
    expect(challengersOf(open.picture, titleAt(open.built, 0))).toEqual([personAt(open.built, 1)]);
  });

  it('skips a title with nobody eligible instead of forcing a match', () => {
    const { built, picture } = plan({
      roster: 2,
      person: (index) => ({ gender: index === 0 ? 'female' : 'male' }),
      titles: [
        {
          overrides: { division: { gender: 'female', minWeightKg: null, maxWeightKg: null } },
          holder: 0,
        },
      ],
    });
    expect(picture.planned).toEqual([]);
    expect(picture.skipped).toEqual([{ titleId: titleAt(built, 0), reason: NO_CHALLENGER_REASON }]);
  });

  it('gives a tag title an established team, then pairs workers when no team is free', () => {
    const tagTitle: TitleSpec = { overrides: { holderCount: 2 }, holder: [0, 1] };
    const withTeam = plan({
      roster: 6,
      titles: [tagTitle],
      teams: [
        [0, 1],
        [4, 5],
      ],
    });
    const [match] = withTeam.picture.planned;
    expect(match?.matchTypeKey).toBe('match.tag-team');
    const challengerSide = match?.sides.find((side) => !side.isChampions);
    expect(challengerSide?.personIds).toEqual([
      personAt(withTeam.built, 4),
      personAt(withTeam.built, 5),
    ]);
    expect(challengerSide?.teamId).not.toBeNull();

    const paired = plan({ roster: 6, titles: [tagTitle], teams: [[0, 1]] });
    const pairedSide = paired.picture.planned[0]?.sides.find((side) => !side.isChampions);
    expect(pairedSide).toEqual({
      personIds: [personAt(paired.built, 2), personAt(paired.built, 3)],
      teamId: null,
      isChampions: false,
    });
    expect(
      labelsOf(paired.picture.trace).some((label) =>
        label.startsWith('No established team free: '),
      ),
    ).toBe(true);
  });

  it('gives the same pick for the same seed', () => {
    const spec: WorldSpec = { roster: 8, titles: [{ holder: 0 }] };
    const picks = (seed: string): PersonId[] =>
      challengersOf(plan(spec, { seed }).picture, titleAt(titleWorld(spec), 0));
    expect(picks('seed-a')).toEqual(picks('seed-a'));
    const seen = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((seed) => String(picks(seed))),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it('records the weighted rolls and the considered contenders', () => {
    const { picture } = plan({ roster: 6, titles: [{ holder: 0 }] });
    const rolls = findTraceNodes(picture.trace, 'roll');
    // The challenger, then the match type.
    expect(rolls.map((node) => node.label)).toEqual([
      'Challenger for the Test Title 001',
      'Match type for the Test Title 001',
    ]);
    expect(rolls.every((node) => node.roll.stream === CARD_PLAN_STREAM)).toBe(true);
    const matchType = findTraceNodes(picture.trace, 'decision').find(
      (node) => node.label === 'Match type',
    );
    expect(matchType?.considered.map((option) => option.option)).toEqual([
      'Singles',
      'Endurance Match',
      'Sprint',
    ]);
    const decisions = findTraceNodes(picture.trace, 'decision');
    const challenger = decisions.find((node) => node.label.startsWith('Challenger for the'));
    expect(challenger?.considered).toHaveLength(3);
    expect(challenger?.considered[0]?.option).toMatch(/^#1 .+, card value \d+/);
  });
});
