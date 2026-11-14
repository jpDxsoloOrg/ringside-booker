// The news wire on the shipped default world: a month of milestone stories from the start
// (DAY1-02). Design: docs/design/news.md#milestones
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { addDays, compareDates, diffDays } from '../../../src/core/date';
import type { News } from '../../../src/model/entities/news';
import { newsSystem } from '../../../src/systems/news';
import { startDefaultGame } from '../calendar/default-game';

/** 4 January to 3 February 2027: the first 31 days of the default world. */
const DAYS = 31;

// Only the news system runs: the milestones read the foundation data, which nothing else changes
// in a month that matters here, and the day never stops for a show.
const start = startDefaultGame({ seed: 'default-world-news' });
const engine = createEngine({ state: start, systems: [newsSystem] });
const advanced = await engine.advanceDays({ maxDays: DAYS });
const state = engine.exportState();
const startDate = start.world.meta.startDate;
const stories: readonly News[] = state.world.tables.news;

function titleNamed(name: string) {
  const title = start.world.tables.titles.find((row) => row.name === name);
  if (title === undefined) throw new Error(`The default world has no title named ${name}`);
  const reign = start.world.tables.titleReigns.find(
    (row) => row.titleId === title.id && row.lostOn === null,
  );
  if (reign === undefined) throw new Error(`${name} has no current champion`);
  return { title, reign };
}

/** The reign-milestone story for the title at that many days held, if any. */
function reignStory(name: string, days: number) {
  const { title, reign } = titleNamed(name);
  const onDate = addDays(reign.wonOn, days);
  // The data still puts the mark inside the month, so a world-pack edit fails here clearly.
  expect(compareDates(onDate, startDate), `${name} day ${String(days)}`).toBeGreaterThanOrEqual(0);
  expect(diffDays(startDate, onDate), `${name} day ${String(days)}`).toBeLessThan(DAYS);
  return stories.find(
    (story) =>
      story.headline.key === 'news.reign-milestone.headline' &&
      story.headline.params['titleId'] === title.id &&
      story.headline.params['days'] === days &&
      story.body.params['onDate'] === onDate,
  );
}

describe('the default world news, first month', () => {
  it('runs every day without a failure', () => {
    expect(advanced.failures).toEqual([]);
    expect(advanced.daysAdvanced).toBe(DAYS);
  });

  it('has the Altura reign marks: the World title at 300 days, the Women’s at 100', () => {
    expect(reignStory('Altura World Championship', 300)).toBeDefined();
    expect(reignStory("Altura Women's Championship", 100)).toBeDefined();
  });

  it('has at least one career anniversary, the season story and about a dozen milestones', () => {
    const careers = stories.filter(
      (story) => story.headline.key === 'news.career-anniversary.headline',
    );
    expect(careers.length).toBeGreaterThan(0);
    expect(stories.filter((story) => story.kind === 'season')).toHaveLength(1);
    const milestones = stories.filter((story) => story.kind !== 'season');
    // Four or five Mondays, at most news.milestones.maxPerWeek (8) each.
    expect(milestones.length).toBeGreaterThanOrEqual(6);
    expect(milestones.length).toBeLessThanOrEqual(5 * 8);
  });

  it('posts each story once and nothing about a day before the start', () => {
    const keys = stories.map((story) => story.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const story of stories) {
      expect(compareDates(story.date, startDate)).toBeGreaterThanOrEqual(0);
      const onDate = story.body.params['onDate'];
      if (typeof onDate === 'string') {
        expect(onDate >= startDate, `${String(story.dedupeKey)} on ${onDate}`).toBe(true);
      }
    }
  });
});
