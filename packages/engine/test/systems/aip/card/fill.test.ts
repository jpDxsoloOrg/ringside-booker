// Filling the card. Design: docs/design/rival-booking.md#filling-the-card
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { addDays } from '../../../../src/core/date';
import type { PersonId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { traceNodeSchema, type TraceNode } from '../../../../src/core/trace';
import { matchTypesOf } from '../../../../src/model/catalogs';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import type { Employment } from '../../../../src/model/entities/employment';
import type { Person } from '../../../../src/model/entities/person';
import type { StorylineSide } from '../../../../src/model/entities/storyline';
import { structuralProblems } from '../../../../src/systems/booking/writer';
import {
  BookerNotes,
  bookMatchOfType,
  buildCardPool,
  CARD_PLAN_STREAM,
  CardBook,
  decideTitlePicture,
  fillCard,
  INJURED_CAN_TALK,
  NOT_ENOUGH_WORKERS,
  stepDownText,
  titleMatchCapFor,
  type CardFill,
  type CardPool,
  type FillCardDeps,
  type PlannedSegment,
} from '../../../../src/systems/aip';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { anEventInstance, aStoryline } from '../../../support/builders/creative';
import { aTeam } from '../../../support/builders/promotions';
import { flatAttributes } from '../../../support/builders/people';
import { TEST_START_DATE, type DeepPartial } from '../../../support/builders/build-row';
import { expectSerialisable } from '../../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const TODAY = TEST_START_DATE;
const LONG_AGO = addDays(TODAY, -400);
const defaults = createEngineTunables();
const SEEDS = ['fill-a', 'fill-b', 'fill-c', 'fill-d', 'fill-e', 'fill-f', 'fill-g', 'fill-h'];

interface StorylineSpec {
  readonly members: readonly (readonly [number, StorylineSide])[];
  readonly heat?: number;
  readonly name?: string;
}

interface WorldSpec {
  readonly roster: number;
  readonly person?: (index: number) => DeepPartial<Person>;
  readonly employment?: (index: number) => DeepPartial<Employment>;
  readonly teams?: readonly (readonly number[])[];
  readonly storylines?: readonly StorylineSpec[];
  /** Roster index of the holder of a singles title, if any. */
  readonly champion?: number;
  readonly importance?: EventImportance;
}

/** Ability 90 for index 0, then 4 less per index. */
function ranked(index: number): DeepPartial<Person> {
  return { attributes: flatAttributes(Math.max(10, 90 - index * 4)) };
}

function injured(canWorkAngles: boolean): DeepPartial<Person> {
  return {
    injury: {
      kindKey: parseContentKey('injury.test'),
      bodyPart: 'arms',
      since: addDays(TODAY, -3),
      expectedReturn: addDays(TODAY, 20),
      canWorkAngles,
    },
  };
}

/** Faces on even indexes, heels on odd ones, unless the spec says otherwise. */
function fillWorld(spec: WorldSpec): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => {
      promotion.withRoster(spec.roster, {
        person: (index) => ({ ...ranked(index), ...spec.person?.(index) }),
        employment: (index) => ({
          alignment: index % 2 === 0 ? 'face' : 'heel',
          ...spec.employment?.(index),
        }),
      });
      if (spec.champion !== undefined) {
        promotion.withTitle(
          { name: 'Test Title', introducedOn: LONG_AGO },
          { holder: spec.champion, wonOn: addDays(TODAY, -90) },
        );
      }
    })
    .with('teams, storylines and tonight', (context) => {
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
        throw new Error('the fill world needs a promotion and a region');
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
      for (const storyline of spec.storylines ?? []) {
        context.insert(
          'storylines',
          aStoryline(
            {
              promotionId,
              heat: storyline.heat ?? 50,
              ...(storyline.name === undefined ? {} : { name: storyline.name }),
              members: storyline.members.map(([index, side]) => ({
                personId: person(index),
                side,
              })),
            },
            context.sequence,
          ),
        );
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

interface PlanOptions {
  readonly seed?: string;
  readonly tunables?: EngineTunables;
  readonly matchSlots?: number;
  readonly talkSlots?: number;
  readonly talkRoom?: number;
  /** Plan tonight's title matches first. */
  readonly titles?: boolean;
}

interface Planned {
  readonly built: BuiltWorld;
  readonly pool: CardPool;
  readonly fill: CardFill;
}

function tonightOf(built: BuiltWorld) {
  const instance = built.world.tables.eventInstances.values().find((row) => row.name === 'Tonight');
  if (instance === undefined) {
    throw new Error('no show tonight');
  }
  return instance;
}

function depsFor(built: BuiltWorld, tunables: EngineTunables, seed: string): FillCardDeps {
  return {
    read: built.world,
    tunables,
    rng: new RngRegistry(seed).stream(CARD_PLAN_STREAM),
  };
}

function plan(built: BuiltWorld, options: PlanOptions = {}): Planned {
  const tunables = options.tunables ?? defaults;
  const instance = tonightOf(built);
  const pool = buildCardPool(built.world, { instance, date: TODAY, tunables });
  const deps = depsFor(built, tunables, options.seed ?? 'fill-seed');
  const matchSlots = options.matchSlots ?? 4;
  const titles =
    options.titles === true
      ? decideTitlePicture(
          pool,
          {
            today: TODAY,
            taste: pool.taste,
            cap: titleMatchCapFor({ importance: pool.importance, matchSlots }, { tunables }),
          },
          deps,
        ).planned
      : [];
  const fill = fillCard(
    pool,
    {
      titles,
      matchSlots,
      talkSlots: options.talkSlots ?? 2,
      ...(options.talkRoom === undefined ? {} : { talkRoom: options.talkRoom }),
    },
    deps,
  );
  expectSound(built, pool, fill, tunables);
  return { built, pool, fill };
}

/** The rules every plan keeps, whatever the roster. */
function expectSound(
  built: BuiltWorld,
  pool: CardPool,
  fill: CardFill,
  tunables: EngineTunables,
): void {
  expectSerialisable(fill);
  expect(traceNodeSchema.safeParse(fill.trace).success).toBe(true);
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  const inMatch = new Set<PersonId>();
  const appearances = new Map<PersonId, number>();
  const instance = tonightOf(built);
  for (const segment of fill.segments) {
    expect(traceNodeSchema.safeParse(segment.trace.trace).success).toBe(true);
    expect(
      structuralProblems(built.world, {
        instance,
        draft: segment.draft,
        target: { preShow: false, slot: 0 },
      }),
    ).toEqual([]);
    for (const participant of segment.draft.participants) {
      const candidate = byPerson.get(participant.personId);
      expect(candidate, 'everyone booked is in the pool').toBeDefined();
      expect(candidate?.contractBlock).toBeNull();
      appearances.set(participant.personId, (appearances.get(participant.personId) ?? 0) + 1);
      if (segment.kind === 'match') {
        expect(candidate?.canWrestle).toBe(true);
        expect(inMatch.has(participant.personId), 'nobody wrestles twice').toBe(false);
        inMatch.add(participant.personId);
      } else {
        expect(candidate?.canTalk).toBe(true);
      }
    }
  }
  const most = tunables.get('booking.maxAppearancesPerShow');
  for (const count of appearances.values()) {
    expect(count).toBeLessThanOrEqual(most);
  }
}

function personAt(built: BuiltWorld, index: number): PersonId {
  const id = built.ids.people[index];
  if (id === undefined) {
    throw new Error(`no person ${String(index)}`);
  }
  return id;
}

function matchesOf(fill: CardFill): PlannedSegment[] {
  return fill.segments.filter((segment) => segment.kind === 'match');
}

function typeOf(segment: PlannedSegment): string | null {
  return segment.draft.kind === 'match' ? segment.draft.match.matchTypeKey : null;
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

/** Only `family`'s weight is above 0. */
function only(family: 'oneOnOne' | 'tag' | 'trios' | 'multiWay' | 'other'): EngineTunables {
  return createEngineTunables({
    'aip.card.typeWeight.oneOnOne': family === 'oneOnOne' ? 100 : 0,
    'aip.card.typeWeight.tag': family === 'tag' ? 100 : 0,
    'aip.card.typeWeight.trios': family === 'trios' ? 100 : 0,
    'aip.card.typeWeight.multiWay': family === 'multiWay' ? 100 : 0,
    'aip.card.typeWeight.other': family === 'other' ? 100 : 0,
  });
}

describe('fillCard', () => {
  /**
   * 16 wrestlers: 1 injured but can talk, 2 injured and silent, 3 used up their appearances,
   * 4 tired, 5 + 7 a team; a title held by 0.
   */
  const busy = fillWorld({
    roster: 16,
    champion: 0,
    teams: [[5, 7]],
    person: (index) => {
      switch (index) {
        case 1:
          return { ...injured(true), attributes: { mic: 99, charisma: 99 } };
        case 2:
          return injured(false);
        case 4:
          return { fatigue: 90 };
        default:
          return {};
      }
    },
    employment: (index) =>
      index === 3 ? { terms: { appearanceCap: 10 }, appearancesThisYear: 10 } : {},
  });

  const busyPool = (): CardPool =>
    buildCardPool(busy.world, { instance: tonightOf(busy), date: TODAY, tunables: defaults });

  it('never double-books, never uses the unavailable and gives writer-ready drafts', () => {
    for (const seed of SEEDS) {
      const { fill } = plan(busy, { seed, titles: true, matchSlots: 5, talkSlots: 2 });
      expect(fill.open).toEqual([]);
      expect(fill.segments).toHaveLength(7);
      const people = fill.segments.flatMap((segment) =>
        segment.draft.participants.map((participant) => participant.personId),
      );
      expect(people).not.toContain(personAt(busy, 2));
      expect(people).not.toContain(personAt(busy, 3));
      const title = fill.segments.find((segment) => segment.source === 'title');
      expect(title?.draft.kind === 'match' && title.draft.match.titleIds).toHaveLength(1);
    }
  });

  it('lets an injured worker who can talk speak, but never wrestle', () => {
    const injuredId = personAt(busy, 1);
    let spoke = 0;
    for (const seed of SEEDS) {
      const { fill } = plan(busy, { seed, talkSlots: 2 });
      for (const segment of fill.segments) {
        const there = segment.draft.participants.some(
          (participant) => participant.personId === injuredId,
        );
        if (!there) {
          continue;
        }
        expect(segment.kind).toBe('angle');
        const name = busyPool().candidates.find((entry) => entry.personId === injuredId)?.ringName;
        expect(labelsOf(segment.trace.trace)).toContain(`${String(name)}: ${INJURED_CAN_TALK}`);
        spoke += 1;
      }
    }
    expect(spoke).toBeGreaterThan(0);
  });

  it('puts two free teams against each other in a tag match', () => {
    const built = fillWorld({
      roster: 8,
      teams: [
        [0, 2],
        [1, 3],
      ],
    });
    for (const seed of SEEDS) {
      const { fill } = plan(built, { seed, tunables: only('tag'), matchSlots: 1, talkSlots: 0 });
      const [match] = matchesOf(fill);
      expect(match && typeOf(match)).toBe('match.tag-team');
      const teams = new Set(match?.draft.participants.map((participant) => participant.teamId));
      expect(teams.size).toBe(2);
      expect([...teams].every((teamId) => teamId !== null)).toBe(true);
      expect(match?.trace.trace.label).toMatch(/^Test Team \d+ vs Test Team \d+$/);
    }
  });

  it('pairs workers for tonight when no team is free', () => {
    const built = fillWorld({ roster: 8 });
    const { fill } = plan(built, { tunables: only('tag'), matchSlots: 1, talkSlots: 0 });
    const [match] = matchesOf(fill);
    expect(match && typeOf(match)).toBe('match.tag-team');
    expect(match?.draft.participants.every((participant) => participant.teamId === null)).toBe(
      true,
    );
    expect(labelsOf(match?.trace.trace ?? fill.trace)).toContain(
      'Side 1: no free team, pairing workers for tonight',
    );
  });

  it('never books a battle royal on a 7-person roster', () => {
    const built = fillWorld({ roster: 7 });
    const tunables = createEngineTunables({ 'aip.card.typeWeight.other': 1000 });
    for (const seed of SEEDS) {
      const { fill } = plan(built, { seed, tunables, matchSlots: 3, talkSlots: 0 });
      expect(matchesOf(fill).map(typeOf)).not.toContain('match.battle-royal');
    }
  });

  it('books a storyline as face against heel, linked to the story', () => {
    const built = fillWorld({
      roster: 8,
      storylines: [
        {
          name: 'Test Feud',
          members: [
            [2, 'heel'],
            [3, 'face'],
          ],
        },
      ],
    });
    const [storylineId] = built.ids.storylines;
    if (storylineId === undefined) {
      throw new Error('no storyline');
    }
    const match = plan(built, {
      tunables: createEngineTunables({ 'aip.card.storylineMatchChance': 1 }),
    }).fill.segments.find((segment) => segment.source === 'storyline');
    expect(match?.kind).toBe('match');
    expect(match?.draft.storylineIds).toEqual([storylineId]);
    const sides = match?.draft.participants.map((participant) => [
      participant.side,
      participant.personId,
    ]);
    expect(sides).toEqual([
      [0, personAt(built, 3)],
      [1, personAt(built, 2)],
    ]);

    const talk = plan(built, {
      tunables: createEngineTunables({ 'aip.card.storylineMatchChance': 0 }),
    }).fill.segments.find((segment) => segment.source === 'storyline');
    expect(talk?.kind).toBe('angle');
    expect(talk?.draft.storylineIds).toEqual([storylineId]);
  });

  it('gives the hottest storylines a segment, up to the most allowed', () => {
    const built = fillWorld({
      roster: 10,
      storylines: [
        { name: 'Cold', heat: 10, members: [[0, 'face']] },
        { name: 'Hot', heat: 80, members: [[2, 'face']] },
        { name: 'Warm', heat: 50, members: [[4, 'face']] },
      ],
    });
    const { fill } = plan(built, { talkSlots: 3 });
    const story = fill.segments.filter((segment) => segment.source === 'storyline');
    const names = story.map((segment) => segment.trace.trace.children?.[0]?.label);
    expect(names).toEqual(['Storyline: Hot (heat 80)', 'Storyline: Warm (heat 50)']);
  });

  it('skips a storyline when the card has no room', () => {
    const built = fillWorld({
      roster: 6,
      storylines: [{ members: [[0, 'face']] }],
    });
    const { fill } = plan(built, { matchSlots: 2, talkSlots: 0 });
    expect(fill.skippedStorylines.map((entry) => entry.reason)).toEqual([
      'No room on the card tonight',
    ]);
  });

  it('never relaxes a contract block, leaving a slot open instead', () => {
    const built = fillWorld({
      roster: 4,
      employment: (index) =>
        index >= 2 ? { terms: { appearanceCap: 10 }, appearancesThisYear: 10 } : {},
    });
    const { fill } = plan(built, { matchSlots: 3, talkSlots: 0, talkRoom: 0 });
    expect(matchesOf(fill)).toHaveLength(1);
    expect(fill.open.map((slot) => slot.reason)).toEqual([NOT_ENOUGH_WORKERS, NOT_ENOUGH_WORKERS]);
    expect(labelsOf(fill.trace)).toContain(`filler:2: ${NOT_ENOUGH_WORKERS}`);
  });

  it('turns a match slot it cannot fill into a talking segment when there is room', () => {
    const built = fillWorld({ roster: 3 });
    const { fill } = plan(built, { matchSlots: 2, talkSlots: 0, talkRoom: 1 });
    expect(fill.segments.map((segment) => [segment.key, segment.kind])).toEqual([
      ['filler:1', 'match'],
      ['filler:2', 'angle'],
    ]);
  });

  it('gives the same plan for the same seed', () => {
    const first = plan(busy, { seed: 'same', titles: true, matchSlots: 5 }).fill;
    const second = plan(busy, { seed: 'same', titles: true, matchSlots: 5 }).fill;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('bookMatchOfType', () => {
  it('steps a trios match down to one-on-one on a thin roster, saying so', () => {
    // 4 on the roster, one injured: 3 can wrestle.
    const built = fillWorld({ roster: 4, person: (index) => (index === 3 ? injured(false) : {}) });
    const pool = buildCardPool(built.world, {
      instance: tonightOf(built),
      date: TODAY,
      tunables: defaults,
    });
    const trios = matchTypesOf(built.world).find((type) => type.key === 'match.trios');
    if (trios === undefined) {
      throw new Error('no trios type');
    }
    const notes = new BookerNotes();
    const segment = bookMatchOfType(
      pool,
      { key: 'filler:1', type: trios, book: new CardBook() },
      depsFor(built, defaults, 'step-down'),
      notes,
      'Test',
    );
    expect(segment && typeOf(segment)).toBe('match.singles');
    const labels = labelsOf(segment?.trace.trace ?? pool.taste.traces.riskAppetite);
    expect(labels).toContain(stepDownText('Six-Person Tag', 'Tag Team'));
    expect(labels).toContain(stepDownText('Tag Team', 'Singles'));
    expect(
      labels.some((label) => label.endsWith('Level 4: tired workers allowed as a last resort')),
    ).toBe(true);
    expect(segment?.trace.trace.reason).toBe(stepDownText('Six-Person Tag', 'Singles'));
  });

  it('prefers the opposite alignment for the second side', () => {
    const built = fillWorld({ roster: 6 });
    const pool = buildCardPool(built.world, {
      instance: tonightOf(built),
      date: TODAY,
      tunables: defaults,
    });
    const singles = matchTypesOf(built.world).find((type) => type.key === 'match.singles');
    if (singles === undefined) {
      throw new Error('no singles type');
    }
    for (const seed of SEEDS) {
      const segment = bookMatchOfType(
        pool,
        { key: 'filler:1', type: singles, book: new CardBook() },
        depsFor(built, defaults, seed),
        new BookerNotes(),
        'Test',
      );
      const alignments = segment?.draft.participants.map(
        (participant) =>
          pool.candidates.find((candidate) => candidate.personId === participant.personId)
            ?.alignment,
      );
      expect(new Set(alignments)).toEqual(new Set(['face', 'heel']));
    }
  });
});
