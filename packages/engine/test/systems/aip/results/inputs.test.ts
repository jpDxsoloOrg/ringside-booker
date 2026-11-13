// The rival results' input gatherer (AIP5-01). Design: docs/design/rival-booking.md#inputs
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../../src/core/date';
import type {
  EventInstanceId,
  PersonId,
  SegmentId,
  StorylineId,
  TitleId,
} from '../../../../src/core/ids';
import { parseContentKey } from '../../../../src/core/content-key';
import { runStep } from '../../../../src/core/pipeline/runStep';
import { createRuntime } from '../../../../src/core/pipeline/runtime';
import type { Push } from '../../../../src/model/entities/employment';
import type { GameWorldView } from '../../../../src/model/tables';
import {
  AIP_RUN_TURNS_PHASE_ID,
  cardValue,
  cardValueInputsFor,
  rivalSegmentInputsOf,
  runTurnsPhase,
  STYLE_TITLE_TASTE_LABEL,
  type RivalSegmentInputs,
} from '../../../../src/systems/aip';
import { cardSegments } from '../../../../src/systems/booking/card';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import {
  anAngle,
  anEventInstance,
  aMatch,
  aParticipant,
  aStoryline,
  DEFAULT_BEAT_KEY,
} from '../../../support/builders/creative';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const COMPUTER = { kind: 'computer' } as const;
const SHOW_DAY: GameDate = addDays(TEST_START_DATE, 2);
const REIGN_START: GameDate = addDays(TEST_START_DATE, -40);
const STORY_START: GameDate = addDays(TEST_START_DATE, -30);
const tunables = createEngineTunables();

const PUSHES: readonly Push[] = [
  'mainEvent',
  'lowerCard',
  'midCard',
  'upperCard',
  'enhancement',
  'midCard',
  'lowerCard',
  'lowerCard',
  'midCard',
  'midCard',
];

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`the inputs world has no ${what}`);
  }
  return value;
}

interface InputsWorld extends BuiltWorld {
  readonly people: readonly PersonId[];
  readonly titleId: TitleId;
  readonly storylineId: StorylineId;
  readonly segments: {
    readonly singles: SegmentId;
    readonly tag: SegmentId;
    readonly angle: SegmentId;
    readonly triple: SegmentId;
    readonly title: SegmentId;
    readonly lonely: SegmentId;
  };
}

interface InputsWorldOptions {
  /** When the champion's contract ends; open-ended when left out. */
  readonly championEndsOn?: GameDate;
}

/**
 * One computer promotion with 10 wrestlers. Person 0 holds a title with a 100 kg limit. Person 8
 * is injured, person 9 weighs 105 kg. Two shows on SHOW_DAY: a singles match in a storyline, a tag
 * match and a promo on the first; a triple threat, a title triple threat (0 v 8 v 9) and a match
 * with one side on the second.
 */
function inputsWorld(options: InputsWorldOptions = {}): InputsWorld {
  const kept: { segments?: InputsWorld['segments']; storylineId?: StorylineId } = {};
  const built = worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion
        .withRoster(10, {
          person: (index) => {
            if (index === 8) {
              return {
                injury: {
                  kindKey: parseContentKey('injury.test'),
                  bodyPart: 'legs',
                  since: TEST_START_DATE,
                  expectedReturn: addDays(TEST_START_DATE, 30),
                  canWorkAngles: false,
                },
              };
            }
            return index === 9 ? { weightKg: 105 } : { weightKg: 90 };
          },
          employment: (index) => ({
            push: required(PUSHES[index], 'push'),
            alignment: index === 6 ? 'face' : index % 2 === 0 ? 'face' : 'heel',
            endsOn:
              index === 0
                ? (options.championEndsOn ?? null)
                : index === 8
                  ? addDays(SHOW_DAY, 1)
                  : index === 9
                    ? SHOW_DAY
                    : index === 3
                      ? addDays(SHOW_DAY, 365)
                      : null,
          }),
        })
        .withTitle(
          {
            name: 'Test Heavyweight Championship',
            prestige: 70,
            introducedOn: addDays(TEST_START_DATE, -100),
            division: { gender: 'open', minWeightKg: null, maxWeightKg: 100 },
          },
          { holder: 0, wonOn: REIGN_START },
        ),
    )
    .with('shows', (context) => {
      const { promotions, people, regions, titles, employments } = context.ids;
      const promotionId = required(promotions.A, 'promotion');
      const regionId = required(regions[0], 'region');
      const person = (index: number): PersonId =>
        required(people[index], `person ${String(index)}`);
      const show = (name: string): EventInstanceId =>
        context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId,
              regionId,
              name,
              date: SHOW_DAY,
              airDate: SHOW_DAY,
              format: { slots: 6, preShowSlots: 0 },
            },
            context.sequence,
          ),
        ).id;
      const first = show('Rival Weekly');
      const second = show('Rival Saturday');
      const storyline = context.insert(
        'storylines',
        aStoryline(
          {
            promotionId,
            name: 'Test Feud',
            startedOn: STORY_START,
            members: [
              { personId: person(1), side: 'heel' },
              { personId: person(2), side: 'face' },
            ],
          },
          context.sequence,
        ),
      );
      const match = (
        eventInstanceId: EventInstanceId,
        sides: readonly (readonly number[])[],
        extra: { titleIds?: TitleId[]; storylineIds?: StorylineId[] } = {},
      ): SegmentId => {
        const segment = context.insert(
          'segments',
          aMatch(
            {
              eventInstanceId,
              storylineIds: extra.storylineIds ?? [],
              match: { titleIds: extra.titleIds ?? [] },
            },
            context.sequence,
          ),
        );
        for (const [side, members] of sides.entries()) {
          for (const index of members) {
            context.insert(
              'participants',
              aParticipant(
                { segmentId: segment.id, personId: person(index), side },
                context.sequence,
              ),
            );
          }
        }
        return segment.id;
      };
      const singles = match(first, [[1], [2]], { storylineIds: [storyline.id] });
      const tag = match(first, [
        [4, 5],
        [6, 7],
      ]);
      const angle = context.insert(
        'segments',
        anAngle(
          {
            eventInstanceId: first,
            angle: { beats: [{ beatKey: DEFAULT_BEAT_KEY, personIds: [person(3)] }] },
          },
          context.sequence,
        ),
      );
      context.insert(
        'participants',
        aParticipant(
          { segmentId: angle.id, personId: person(3), side: 0, role: 'speaker' },
          context.sequence,
        ),
      );
      const titleId = required(titles[0], 'title');
      const triple = match(second, [[1], [2], [3]]);
      const title = match(second, [[0], [8], [9]], { titleIds: [titleId] });
      const lonely = match(second, [[4]]);
      // Person 0 is the ace, person 4 a prospect; both of 4's partners are not featured.
      context.insert('aiProfiles', {
        id: context.sequence.id('aiProfile'),
        promotionId,
        brandId: null,
        taste: null,
        featured: {
          ace: { employmentId: required(employments[0], 'employment 0'), since: TEST_START_DATE },
          prospects: [
            { employmentId: required(employments[4], 'employment 4'), since: TEST_START_DATE },
          ],
          nextReviewOn: addDays(TEST_START_DATE, 28),
          lastReviewedOn: TEST_START_DATE,
        },
        createdOn: TEST_START_DATE,
        lastTurnOn: null,
      });
      kept.segments = { singles, tag, angle: angle.id, triple, title, lonely };
      kept.storylineId = storyline.id;
    })
    .build();
  return {
    ...built,
    people: built.ids.people,
    titleId: required(built.ids.titles[0], 'title'),
    storylineId: required(kept.storylineId, 'storyline'),
    segments: required(kept.segments, 'segments'),
  };
}

function inputsOf(read: GameWorldView, segmentId: SegmentId): RivalSegmentInputs {
  const inputs = rivalSegmentInputsOf(read, tunables, segmentId, SHOW_DAY);
  if (inputs === null) {
    throw new Error(`no inputs for ${segmentId}`);
  }
  return inputs;
}

describe('rivalSegmentInputsOf', () => {
  const built = inputsWorld();
  const read = built.world;
  const person = (index: number): PersonId =>
    required(built.people[index], `person ${String(index)}`);

  it('gathers a singles match: show, sides, card values, push, alignment and storyline', () => {
    const inputs = inputsOf(read, built.segments.singles);
    expect(inputs).toMatchObject({
      segmentId: built.segments.singles,
      date: SHOW_DAY,
      importance: 'regular',
      promotionId: built.ids.promotions.A,
      brandId: null,
      titles: [],
    });
    expect(inputs.titleTaste.trace.label).toBe(STYLE_TITLE_TASTE_LABEL);
    expect(inputs.sides.map((side) => side.side)).toEqual([0, 1]);
    const [first, second] = inputs.sides;
    expect(first).toMatchObject({
      personIds: [person(1)],
      pushIndex: 2,
      alignment: 'heel',
      featured: null,
    });
    expect(second).toMatchObject({ personIds: [person(2)], pushIndex: 3, alignment: 'face' });
    // The same card value AIP1's roster tab shows.
    const employment = required(
      read.tables.employments.lookup('byPerson', person(1))[0],
      'employment of person 1',
    );
    const expected = cardValue(cardValueInputsFor(read, tunables, employment, SHOW_DAY), {
      tunables,
    });
    expect(first?.cardValues[0]?.value).toBe(expected.value);
    expect(first?.label).toBe(employment.ringName);
    expect(inputs.storylines).toEqual([
      {
        storylineId: built.storylineId,
        name: 'Test Feud',
        ageDays: 32,
        finaleFlag: null,
        faceSides: [1],
        heelSides: [0],
      },
    ]);
  });

  it('gathers a tag match: names joined, top push, majority alignment, prospect wins', () => {
    const inputs = inputsOf(read, built.segments.tag);
    const [first, second] = inputs.sides;
    const names = (ids: readonly PersonId[]): string =>
      ids
        .map(
          (id) =>
            required(read.tables.employments.lookup('byPerson', id)[0], 'employment').ringName,
        )
        .join(' & ');
    expect(first?.personIds).toEqual([person(4), person(5)].sort());
    expect(first?.label).toBe(names(first?.personIds ?? []));
    expect(first?.cardValues).toHaveLength(2);
    // 4 is enhancement (1), 5 midcard (3): the top push counts.
    expect(first?.pushIndex).toBe(3);
    // 4 face, 5 heel: no majority.
    expect(first?.alignment).toBe('tweener');
    expect(first?.featured).toBe('prospect');
    // 6 face, 7 heel → tweener; 6 and 7 are lower card.
    expect(second).toMatchObject({ pushIndex: 2, alignment: 'tweener', featured: null });
  });

  it('gathers a triple threat with three sides', () => {
    const inputs = inputsOf(read, built.segments.triple);
    expect(inputs.sides.map((side) => side.personIds)).toEqual([
      [person(1)],
      [person(2)],
      [person(3)],
    ]);
    expect(inputs.sides.map((side) => side.pushIndex)).toEqual([2, 3, 4]);
  });

  it('returns null for an angle and for a match with one side', () => {
    expect(rivalSegmentInputsOf(read, tunables, built.segments.angle, SHOW_DAY)).toBeNull();
    expect(rivalSegmentInputsOf(read, tunables, built.segments.lonely, SHOW_DAY)).toBeNull();
  });

  it('gathers the title: reign, champion side, contracts and eligibility from WRK1', () => {
    const inputs = inputsOf(read, built.segments.title);
    expect(inputs.sides[0]?.featured).toBe('ace');
    expect(inputs.titles).toHaveLength(1);
    const [title] = inputs.titles;
    expect(title).toMatchObject({
      titleId: built.titleId,
      name: 'Test Heavyweight Championship',
      prestige: 70,
      holderCount: 1,
      openReign: { wonOn: REIGN_START, reignDays: 42, holderIds: [person(0)] },
      championSide: 0,
      // An open-ended champion contract has no days left to count.
      championContractDaysLeft: null,
    });
    expect(title?.challengerSides.map((side) => side.side)).toEqual([1, 2]);
    const [injured, heavy] = title?.challengerSides ?? [];
    // Injured: an availability reason, still under the weight limit; contract ends tomorrow.
    expect(injured?.eligibility.map((reason) => reason.code)).toEqual(['injured']);
    expect(injured?.eligibility[0]?.subject).toEqual({ kind: 'person', id: person(8) });
    expect(injured?.contractDaysLeft).toBe(1);
    // 105 kg against a 100 kg limit; contract ends today.
    expect(heavy?.eligibility.map((reason) => reason.code)).toEqual(['aboveMaxWeight']);
    expect(heavy?.eligibility[0]?.message).toBe(
      'Too heavy for the Test Heavyweight Championship (limit 100 kg, weighs 105 kg)',
    );
    expect(heavy?.contractDaysLeft).toBe(0);
    expect(heavy?.marketPopularity.trace.label).toMatch(/^Market popularity of /);
  });

  it("counts the champion's contract days with real dates", () => {
    const inYear = inputsWorld({ championEndsOn: addDays(SHOW_DAY, 365) });
    expect(inputsOf(inYear.world, inYear.segments.title).titles[0]).toMatchObject({
      championContractDaysLeft: 365,
    });
    const tomorrow = inputsWorld({ championEndsOn: addDays(SHOW_DAY, 1) });
    expect(inputsOf(tomorrow.world, tomorrow.segments.title).titles[0]).toMatchObject({
      championContractDaysLeft: 1,
    });
  });

  it('gives the same plain JSON on every call', () => {
    for (const segmentId of [built.segments.singles, built.segments.tag, built.segments.title]) {
      const once = inputsOf(read, segmentId);
      const again = inputsOf(read, segmentId);
      expect(again).toEqual(once);
      expect(JSON.parse(JSON.stringify(once))).toEqual(once);
    }
  });
});

describe('rivalSegmentInputsOf on a card the rival booked', () => {
  it('gives plain inputs for every planned match', () => {
    const kept: { show?: EventInstanceId } = {};
    const built = worldBuilder()
      .withGeography('mini')
      .withCatalogs()
      .withPromotion({ controller: COMPUTER }, (promotion) =>
        promotion
          .withRoster(10, {
            employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
          })
          .withTitle({ name: 'Test Heavyweight Championship' }, { holder: 0 }),
      )
      .with('show', (context) => {
        kept.show = context.insert(
          'eventInstances',
          anEventInstance(
            {
              promotionId: required(context.ids.promotions.A, 'promotion'),
              regionId: required(context.ids.regions[0], 'region'),
              name: 'Rival Weekly',
              date: SHOW_DAY,
              airDate: SHOW_DAY,
              format: { slots: 6, preShowSlots: 0 },
            },
            context.sequence,
          ),
        ).id;
      })
      .build();
    const runtime = createRuntime({ world: built.world, tunables });
    const report = runStep(
      runtime,
      AIP_RUN_TURNS_PHASE_ID,
      { kind: 'phase', id: AIP_RUN_TURNS_PHASE_ID },
      runTurnsPhase.run,
      { date: SHOW_DAY },
    );
    expect(report.status, report.error?.message).toBe('ok');
    const read = runtime.world;
    const showId = required(kept.show, 'show');
    expect(read.tables.eventInstances.require(showId).status).toBe('booked');
    const matches = cardSegments(read, showId).filter((segment) => segment.kind === 'match');
    expect(matches.length).toBeGreaterThan(0);
    for (const segment of matches) {
      const inputs = inputsOf(read, segment.id);
      expect(inputs.sides.length).toBeGreaterThanOrEqual(2);
      for (const side of inputs.sides) {
        expect(side.cardValues).toHaveLength(side.personIds.length);
        expect([...side.personIds].sort()).toEqual(side.personIds);
      }
      expect(JSON.parse(JSON.stringify(inputs))).toEqual(inputs);
      expect(inputsOf(read, segment.id)).toEqual(inputs);
    }
  });
});
