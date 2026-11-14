// News topics and story subjects. Design: docs/design/news.md#content-keys
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RegistryError } from '../../../src/core/errors';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import {
  buzzSubjectsOf,
  displayNameOf,
  newsTopic,
  newsTopics,
  registerNewsTopic,
} from '../../../src/systems/news';
import { geographyOf } from '../../../src/systems/world/geography';
import { aPerson, testId, worldBuilder } from '../../support';

describe('registerNewsTopic', () => {
  it('owns the headline and body keys and lists its params', () => {
    const remove = registerNewsTopic('reign-milestone', { params: ['title', 'days'] });
    try {
      expect(newsTopic('reign-milestone')).toEqual({
        topic: 'reign-milestone',
        headlineKey: 'news.reign-milestone.headline',
        bodyKey: 'news.reign-milestone.body',
        params: ['days', 'title'],
      });
      expect(newsTopics().map((topic) => topic.topic)).toContain('reign-milestone');
      // The same params again is harmless; other params are a clash.
      expect(() =>
        registerNewsTopic('reign-milestone', { params: ['days', 'title'] }),
      ).not.toThrow();
      expect(() => registerNewsTopic('reign-milestone', { params: ['days'] })).toThrow(
        RegistryError,
      );
    } finally {
      remove();
    }
    expect(newsTopic('reign-milestone')).toBeUndefined();
  });

  it('refuses a camelCase topic, a bad param name and a param listed twice', () => {
    expect(() => registerNewsTopic('reignMilestone', { params: [] })).toThrow(RegistryError);
    expect(() => registerNewsTopic('', { params: [] })).toThrow(RegistryError);
    expect(() => registerNewsTopic('title-change', { params: ['Title'] })).toThrow(RegistryError);
    expect(() => registerNewsTopic('title-change', { params: ['title', 'title'] })).toThrow(
      RegistryError,
    );
    expect(newsTopic('title-change')).toBeUndefined();
  });
});

describe('buzzSubjectsOf and displayNameOf', () => {
  it('names a worker by their ring name and a free agent by their default ring name', () => {
    const { world, ids } = worldBuilder()
      .withGeography('mini')
      .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
        promotion.withRoster(1, { employment: () => ({ ringName: 'The Test Star' }) }),
      )
      .with('a free agent', (context) => {
        context.insert('people', aPerson({ defaultRingName: 'Free Agent Fred' }, context.sequence));
      })
      .build();
    const date = world.meta.currentDate;
    const [worker, freeAgent] = ids.people;
    const promotion = ids.promotions.A;
    if (worker === undefined || freeAgent === undefined || promotion === undefined) {
      throw new Error('no people');
    }
    expect(displayNameOf(world, worker, date)).toBe('The Test Star');
    expect(displayNameOf(world, freeAgent, date)).toBe('Free Agent Fred');

    const { subjects, skipped } = buzzSubjectsOf(
      world,
      { personIds: [worker, testId('person', 99)], promotionIds: [promotion] },
      geographyOf(world),
    );
    expect(subjects.map((subject) => subject.label)).toEqual(['The Test Star', 'Test Promotion A']);
    expect(subjects.map((subject) => subject.popularity.value)).toEqual([0, 0]);
    expect(skipped).toEqual([{ kind: 'person', id: testId('person', 99) }]);
  });
});

describe('a save from before buzz and dedupe keys', () => {
  it('loads its stories with buzz 0 and no dedupe key', async () => {
    const file = new URL(
      '../../fixtures/saves/v1-tiny-before-storyline-progress.json',
      import.meta.url,
    );
    const report = await loadSave(new Uint8Array(readFileSync(file)), TABLES);
    if (!report.ok) expect.fail(JSON.stringify(report.issues, null, 2));
    const stories = documentToWorld(report.doc, TABLES).tables.news.values();
    expect(stories.length).toBeGreaterThan(0);
    for (const story of stories) {
      expect(story.buzz).toBe(0);
      expect(story.dedupeKey).toBeNull();
    }
  });
});
