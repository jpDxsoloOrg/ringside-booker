// The weekly milestone stories and their sources (DAY1-02). Design: docs/design/news.md#milestones
import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { PersonId, TitleId } from '../../../src/core/ids';
import { runStep } from '../../../src/core/pipeline/runStep';
import { createRuntime, type SimRuntime } from '../../../src/core/pipeline/runtime';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { News } from '../../../src/model/entities/news';
import {
  careersSource,
  milestoneSources,
  promotionsSource,
  reignRecordsSource,
  reignsSource,
  seasonsSource,
  type MilestoneCandidate,
  type MilestoneSource,
} from '../../../src/systems/news/milestones';
import { milestonesPhase } from '../../../src/systems/news';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aTitleReign, worldBuilder } from '../../support';

const day = (text: string): GameDate => parseGameDate(text);

/** 2026-01-05, a Monday: the test worlds' start date. */
const START = day('2026-01-05');
const BIRTH = day('1980-01-01');

interface MilestoneWorldOptions {
  /** When the champion (roster 0) won the title. */
  readonly wonOn?: GameDate;
  /** Finished reigns of the title, held by roster 1, oldest first. */
  readonly finished?: readonly (readonly [GameDate, GameDate])[];
  readonly prestige?: number;
  /** Roster 2's debut. Everyone else has none. */
  readonly debut?: GameDate | null;
  readonly founded?: GameDate;
  readonly seasons?: number;
  readonly tunables?: TunableOverrides;
}

interface MilestoneWorld {
  readonly runtime: SimRuntime;
  readonly titleId: TitleId;
  readonly people: readonly PersonId[];
}

function milestoneWorld(options: MilestoneWorldOptions = {}): MilestoneWorld {
  const builder = worldBuilder({ startDate: START })
    .withGeography('mini')
    .withPromotion(
      { name: 'Test Promotion A', foundedOn: options.founded ?? day('2010-06-15') },
      (promotion) =>
        promotion
          .withRoster(4, {
            person: (index) => ({
              birthDate: BIRTH,
              debutDate: index === 2 ? (options.debut ?? null) : null,
            }),
          })
          .withTitle(
            {
              name: 'Test Heavyweight Title',
              introducedOn: day('2000-01-01'),
              prestige: options.prestige ?? 50,
            },
            { holder: 0, wonOn: options.wonOn ?? day('2025-12-01') },
          ),
    )
    .with('finished reigns', (context) => {
      const titleId = context.ids.titles[0];
      const holder = context.ids.people[1];
      if (titleId === undefined || holder === undefined) throw new Error('no title');
      for (const [wonOn, lostOn] of options.finished ?? []) {
        context.insert(
          'titleReigns',
          aTitleReign({ titleId, holderIds: [holder], wonOn, lostOn }, context.sequence),
        );
      }
    });
  const { world, ids } = (
    options.seasons === undefined ? builder : builder.withSeasons(options.seasons)
  ).build();
  const titleId = ids.titles[0];
  if (titleId === undefined) throw new Error('no title');
  return {
    runtime: createRuntime({ world, tunables: createEngineTunables(options.tunables ?? {}) }),
    titleId,
    people: ids.people,
  };
}

/** What a source lists for one single day. */
function collectOn(
  world: MilestoneWorld,
  source: MilestoneSource,
  date: GameDate,
): MilestoneCandidate[] {
  return source.collect(
    world.runtime.world,
    { from: date, to: date },
    { tunables: world.runtime.tunables },
  );
}

function runMilestones(world: MilestoneWorld, date: GameDate) {
  const report = runStep(
    world.runtime,
    milestonesPhase.id,
    { kind: 'phase', id: milestonesPhase.id },
    milestonesPhase.run,
    { date },
  );
  expect(report.status).toBe('ok');
  return report;
}

function stories(world: MilestoneWorld): readonly News[] {
  return world.runtime.world.tables.news.values();
}

/** The source lists a story on `date` and nothing the day before or after. */
function expectOnlyOn(
  world: MilestoneWorld,
  source: MilestoneSource,
  date: GameDate,
): MilestoneCandidate {
  expect(collectOn(world, source, addDays(date, -1))).toEqual([]);
  expect(collectOn(world, source, addDays(date, 1))).toEqual([]);
  const found = collectOn(world, source, date);
  expect(found).toHaveLength(1);
  const [candidate] = found;
  if (candidate === undefined) throw new Error('nothing listed');
  expect(candidate.onDate).toBe(date);
  return candidate;
}

describe('the milestone sources', () => {
  it('are registered in order: reigns, reign records, careers, promotions, seasons', () => {
    expect(milestoneSources().map((source) => source.id)).toEqual([
      'reigns',
      'reignRecords',
      'careers',
      'promotions',
      'seasons',
    ]);
  });

  it('reigns: 100, 200 and 300 days, then each whole year', () => {
    const wonOn = day('2025-06-01');
    const world = milestoneWorld({ wonOn });
    const [champion] = world.people;
    for (const days of [100, 200, 300]) {
      const candidate = expectOnlyOn(world, reignsSource, addDays(wonOn, days));
      expect(candidate).toMatchObject({
        topic: 'reign-milestone',
        kind: 'milestone',
        importance: 1,
        params: { titleId: world.titleId, holderIds: champion, days },
        refs: { personIds: [champion] },
      });
      expect(candidate.dedupeKey).toMatch(new RegExp(`^reign-milestone:.+:${String(days)}$`));
    }
    const year = expectOnlyOn(world, reignsSource, day('2026-06-01'));
    expect(year).toMatchObject({ importance: 2, params: { years: 1 } });
    expect(year.params).not.toHaveProperty('days');
    expect(expectOnlyOn(world, reignsSource, day('2027-06-01')).params).toMatchObject({ years: 2 });
  });

  it('reigns: a major title is one level more important, capped at the front page', () => {
    const wonOn = day('2025-06-01');
    const world = milestoneWorld({ wonOn, prestige: 80 });
    expect(expectOnlyOn(world, reignsSource, addDays(wonOn, 100)).importance).toBe(2);
    expect(expectOnlyOn(world, reignsSource, day('2026-06-01')).importance).toBe(3);
    const lower = milestoneWorld({
      wonOn,
      prestige: 80,
      tunables: { 'news.milestones.majorTitlePrestige': 81 },
    });
    expect(expectOnlyOn(lower, reignsSource, addDays(wonOn, 100)).importance).toBe(1);
  });

  it('reigns: a reign won on 29 February has its anniversary on 28 February', () => {
    const world = milestoneWorld({ wonOn: day('2024-02-29') });
    const candidate = expectOnlyOn(world, reignsSource, day('2026-02-28'));
    expect(candidate.params).toMatchObject({ years: 2 });
    expect(collectOn(world, reignsSource, day('2026-03-01'))).toEqual([]);
  });

  it('reignRecords: passing the longest finished reign, once', () => {
    // Finished reigns of 100, 250 and 30 days; the open one passes 250 on day 251.
    const world = milestoneWorld({
      wonOn: day('2025-12-01'),
      finished: [
        [day('2023-01-01'), day('2023-04-11')],
        [day('2023-05-01'), day('2024-01-06')],
        [day('2024-02-01'), day('2024-03-02')],
      ],
    });
    const crossing = addDays(day('2025-12-01'), 251);
    const candidate = expectOnlyOn(world, reignRecordsSource, crossing);
    const [champion, previous] = world.people;
    expect(candidate).toMatchObject({
      topic: 'reign-record',
      importance: 3,
      params: {
        titleId: world.titleId,
        holderIds: champion,
        previousHolderIds: previous,
        days: 251,
      },
    });
    expect(candidate.dedupeKey).toMatch(/^reign-record:/);
    // Every later day is past the record too, but only the crossing day is a story.
    expect(collectOn(world, reignRecordsSource, addDays(crossing, 30))).toEqual([]);
  });

  it('reignRecords: needs news.milestones.recordMinReigns finished reigns', () => {
    const finished = [[day('2023-01-01'), day('2023-04-11')]] as const;
    const crossing = addDays(day('2025-12-01'), 101);
    expect(collectOn(milestoneWorld({ finished }), reignRecordsSource, crossing)).toEqual([]);
    const relaxed = milestoneWorld({
      finished,
      tunables: { 'news.milestones.recordMinReigns': 1 },
    });
    expect(collectOn(relaxed, reignRecordsSource, crossing)).toHaveLength(1);
    const none = milestoneWorld({ tunables: { 'news.milestones.recordMinReigns': 0 } });
    expect(collectOn(none, reignRecordsSource, crossing)).toEqual([]);
  });

  it('careers: every 5 years from 10 years, more important from 25', () => {
    const world = milestoneWorld({ debut: day('2006-03-10') });
    const person = world.people[2];
    const twenty = expectOnlyOn(world, careersSource, day('2026-03-10'));
    expect(twenty).toMatchObject({
      topic: 'career-anniversary',
      kind: 'milestone',
      importance: 1,
      params: { personId: person, years: 20 },
      dedupeKey: `career:${String(person)}:20`,
    });
    expect(twenty.refs.personIds).toEqual([person]);
    expect(twenty.refs.promotionIds).toHaveLength(1);
    expect(collectOn(world, careersSource, day('2027-03-10'))).toEqual([]);
    expect(expectOnlyOn(world, careersSource, day('2031-03-10')).importance).toBe(2);
    const young = milestoneWorld({ debut: day('2021-03-10') });
    expect(collectOn(young, careersSource, day('2026-03-10'))).toEqual([]);
    const yearly = milestoneWorld({
      debut: day('2021-03-10'),
      tunables: { 'news.milestones.careerYearStep': 1, 'news.milestones.careerMinYears': 0 },
    });
    expect(expectOnlyOn(yearly, careersSource, day('2026-03-10')).params).toMatchObject({
      years: 5,
    });
  });

  it('careers: a debut on 29 February counts on 28 February', () => {
    const world = milestoneWorld({ debut: day('2016-02-29') });
    expect(expectOnlyOn(world, careersSource, day('2026-02-28')).params).toMatchObject({
      years: 10,
    });
  });

  it('promotions: the first anniversary, then every 5 years, front page from 25', () => {
    const world = milestoneWorld({ founded: day('2025-02-10') });
    const first = expectOnlyOn(world, promotionsSource, day('2026-02-10'));
    expect(first).toMatchObject({
      topic: 'promotion-anniversary',
      kind: 'business',
      importance: 2,
      params: { years: 1 },
    });
    expect(first.dedupeKey).toMatch(/^promotion-anniversary:.+:1$/);
    expect(collectOn(world, promotionsSource, day('2027-02-10'))).toEqual([]);
    expect(expectOnlyOn(world, promotionsSource, day('2030-02-10')).params).toMatchObject({
      years: 5,
    });
    expect(expectOnlyOn(world, promotionsSource, day('2050-02-10')).importance).toBe(3);
  });

  it('seasons: a later season start, never season one', () => {
    const world = milestoneWorld({ seasons: 2 });
    const second = world.runtime.world.tables.seasons
      .values()
      .find((season) => season.number === 2);
    if (second === undefined) throw new Error('no season 2');
    expect(collectOn(world, seasonsSource, START)).toEqual([]);
    const candidate = expectOnlyOn(world, seasonsSource, second.startDate);
    expect(candidate).toMatchObject({
      topic: 'season-start',
      kind: 'season',
      importance: 3,
      params: { seasonNumber: 2 },
      bodyParams: { seasonNumber: 2, startDate: second.startDate, endDate: second.endDate },
      dedupeKey: 'season-start:2',
    });
  });
});

describe('news.milestones', () => {
  it('sits in periodic at order 12 and runs on Mondays', () => {
    expect(milestonesPhase).toMatchObject({
      id: 'news.milestones',
      group: 'periodic',
      order: 12,
      cadence: { kind: 'weekly', weekday: 'mon' },
    });
  });

  it('dates the story the Monday and names the real day in the body', () => {
    const wonOn = day('2025-10-01');
    // Day 100 is Friday 9 January 2026; the next Monday is 12 January.
    const world = milestoneWorld({ wonOn });
    runMilestones(world, day('2026-01-12'));
    const [story] = stories(world);
    expect(stories(world)).toHaveLength(1);
    expect(story).toMatchObject({
      date: day('2026-01-12'),
      kind: 'milestone',
      headline: { key: 'news.reign-milestone.headline', params: { days: 100 } },
      body: { key: 'news.reign-milestone.body', params: { days: 100, onDate: day('2026-01-09') } },
    });
  });

  it('never reports a day before the game started', () => {
    // Day 100 on Sunday 4 January, the day before the start; day 300 well after.
    const before = milestoneWorld({ wonOn: addDays(day('2026-01-04'), -100) });
    runMilestones(before, START);
    expect(stories(before)).toEqual([]);
    const onStart = milestoneWorld({ wonOn: addDays(START, -100) });
    runMilestones(onStart, START);
    expect(stories(onStart)).toHaveLength(1);
  });

  it('posts nothing new when the same Monday runs again, and a record only once', () => {
    const world = milestoneWorld({
      wonOn: day('2025-12-01'),
      finished: [
        [day('2023-01-01'), day('2023-01-21')],
        [day('2023-02-01'), day('2023-02-21')],
        [day('2023-03-01'), day('2023-03-21')],
      ],
    });
    // The record (21 days) was passed before the start; day 100 is 11 March 2026.
    for (let monday = START; monday <= day('2026-03-16'); monday = addDays(monday, 7)) {
      runMilestones(world, monday);
      runMilestones(world, monday);
    }
    expect(stories(world).map((story) => story.headline.key)).toEqual([
      'news.reign-milestone.headline',
    ]);
  });

  it('posts the record the week it is passed, once', () => {
    const world = milestoneWorld({
      wonOn: day('2025-12-01'),
      finished: [
        [day('2023-01-01'), day('2023-03-12')],
        [day('2023-04-01'), day('2023-04-21')],
        [day('2023-05-01'), day('2023-05-21')],
      ],
    });
    // 70 days is the record; day 71 is 10 February 2026.
    for (let monday = START; monday <= day('2026-03-02'); monday = addDays(monday, 7)) {
      runMilestones(world, monday);
    }
    const records = stories(world).filter(
      (story) => story.headline.key === 'news.reign-record.headline',
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.date).toBe(day('2026-02-16'));
  });

  it('caps the week at news.milestones.maxPerWeek, most important first, then by day', () => {
    // In the week to Monday 11 January 2027: the promotion's first anniversary (2, Tue 5th), the
    // reign's first year (2, Wed 6th) and a 20-year career (1, Thu 7th).
    const options: MilestoneWorldOptions = {
      wonOn: day('2026-01-06'),
      founded: day('2026-01-05'),
      debut: day('2007-01-07'),
    };
    const topicsPosted = (overrides: TunableOverrides) => {
      const world = milestoneWorld({ ...options, tunables: overrides });
      const report = runMilestones(world, day('2027-01-11'));
      const keys = stories(world)
        .map((story) => story.headline.key)
        .sort();
      return { keys, logs: report.logs };
    };
    const all = topicsPosted({});
    expect(all.keys).toEqual([
      'news.career-anniversary.headline',
      'news.promotion-anniversary.headline',
      'news.reign-milestone.headline',
    ]);
    expect(all.logs).toContain(
      'Posted 3 milestone stories (0 already on file); dropped 0 over the weekly cap of 8',
    );

    const two = topicsPosted({ 'news.milestones.maxPerWeek': 2 });
    expect(two.keys).toEqual([
      'news.promotion-anniversary.headline',
      'news.reign-milestone.headline',
    ]);
    expect(two.logs).toContain(
      'Posted 2 milestone stories (0 already on file); dropped 1 over the weekly cap of 2',
    );
    // Equal importance: the earlier day wins.
    expect(topicsPosted({ 'news.milestones.maxPerWeek': 1 }).keys).toEqual([
      'news.promotion-anniversary.headline',
    ]);
    expect(topicsPosted({ 'news.milestones.maxPerWeek': 0 }).keys).toEqual([]);
  });
});
