// Show night on the news wire (DAY1-06): a result story per show and a title-change story per new
// reign, posted through postNews with dedupe keys. Design: docs/design/news.md#integration
import { describe, expect, it } from 'vitest';
import { createEngine, defineSystem, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import { definePhase } from '../../../src/core/pipeline/phase';
import type { News } from '../../../src/model/entities/news';
import { newsSystem } from '../../../src/systems/news';
import {
  SHOW_RESULT_IMPORTANCE,
  SHOW_RESULT_TOPIC,
  TITLE_CHANGE_TOPIC,
  showResultDedupeKey,
  showsSystem,
  titleChangeDedupeKey,
} from '../../../src/systems/shows';
import { withMyShowsRun } from '../../support';
import { seed } from '../booking/command-world';
import {
  competitor,
  member,
  titleMatch,
  titleNightWorld,
  winFor,
  type TitleNightWorld,
} from './title-night-world';

/** The last main-card slot of the player's show (5 slots). */
const MAIN_EVENT_SLOT = 4;

/** The world title on the line in the main event: the champion (roster 0) loses to roster 1. */
function seedTitleChange(built: TitleNightWorld): void {
  seed(
    built.world,
    built.show,
    MAIN_EVENT_SLOT,
    titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], winFor(1), [
      built.titles.world,
    ]),
  );
}

/** An engine that runs the night (the player's show as Run the show would) with the news wire. */
function nightEngine(
  built: TitleNightWorld,
  tunableOverrides: Record<string, number> = {},
): { engine: Engine; replays: AnyDomainEvent[] } {
  const replays: AnyDomainEvent[] = [];
  // Publishes again, on the next day, whatever the test queued: a rerun of the same events.
  const replay = defineSystem({
    id: 'replay',
    phases: [
      definePhase({
        id: 'replay.run',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          for (const event of replays.splice(0)) {
            if (event.type === 'show.completed' || event.type === 'title.changed') {
              ctx.publish(event.type, event.payload);
            }
          }
        },
      }),
    ],
  });
  const engine = createEngine({
    state: { ...initialEngineState(built.world), tunableOverrides },
    systems: withMyShowsRun([simSystem, newsSystem, showsSystem, replay]),
  });
  return { engine, replays };
}

function storiesOf(engine: Engine, topic: string): News[] {
  return engine
    .exportState()
    .world.tables.news.filter((news) => news.headline.key === `news.${topic}.headline`);
}

describe('show night on the news wire', () => {
  it('posts one result story per show and one title-change story, deduped on a rerun', async () => {
    const built = titleNightWorld();
    seedTitleChange(built);
    const { engine, replays } = nightEngine(built);
    await engine.advanceDays({ maxDays: 1 });

    const state = engine.exportState();
    const show = state.world.tables.eventInstances.find((row) => row.id === built.show);
    const results = storiesOf(engine, SHOW_RESULT_TOPIC);
    expect(results.map((story) => story.dedupeKey).sort()).toEqual(
      [showResultDedupeKey(built.show), showResultDedupeKey(built.rivalShow)].sort(),
    );
    const mine = results.find((story) => story.refs.eventInstanceId === built.show);
    expect(mine).toMatchObject({
      kind: 'result',
      importance: SHOW_RESULT_IMPORTANCE.regular,
      headline: {
        params: {
          eventInstanceId: built.show,
          score: Math.round(show?.result?.score ?? -1),
          mainEventIds: [member(built, 0), member(built, 1)].sort().join(','),
        },
      },
      refs: {
        personIds: [member(built, 0), member(built, 1)].sort(),
        promotionIds: [show?.promotionId],
        eventInstanceId: built.show,
      },
    });
    // The rival's show is scored off-screen: no card, so nobody in the story.
    const rival = results.find((story) => story.refs.eventInstanceId === built.rivalShow);
    expect(rival?.refs.personIds).toEqual([]);
    expect(rival?.headline.params['mainEventIds']).toBe('');

    const reign = state.world.tables.titleReigns.find(
      (row) => row.titleId === built.titles.world && row.lostOn === null,
    );
    const changes = storiesOf(engine, TITLE_CHANGE_TOPIC);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: 'titleChange',
      importance: 2,
      dedupeKey: titleChangeDedupeKey(reign?.id ?? ''),
      headline: {
        params: {
          titleId: built.titles.world,
          newHolderIds: member(built, 1),
          previousHolderIds: member(built, 0),
          eventInstanceId: built.show,
        },
      },
      refs: {
        personIds: [member(built, 1), member(built, 0)],
        eventInstanceId: built.show,
      },
    });

    // The same events again: nothing new is posted.
    replays.push(
      ...engine
        .exportState()
        .events.recent.filter(
          (event) => event.type === 'show.completed' || event.type === 'title.changed',
        ),
    );
    expect(replays).toHaveLength(3);
    const before = engine.exportState().world.tables.news.length;
    await engine.advanceDays({ maxDays: 1 });
    expect(engine.exportState().world.tables.news.length).toBe(before);
  });

  it('makes a change of a major title front page', async () => {
    const built = titleNightWorld();
    seedTitleChange(built);
    // 0: every title counts as major.
    const { engine } = nightEngine(built, { 'news.milestones.majorTitlePrestige': 0 });
    await engine.advanceDays({ maxDays: 1 });
    expect(storiesOf(engine, TITLE_CHANGE_TOPIC).map((story) => story.importance)).toEqual([3]);
  });

  it('rates a story by the size of the show', () => {
    expect(SHOW_RESULT_IMPORTANCE).toEqual({
      flagship: 3,
      major: 2,
      regular: 1,
      minor: 0,
      house: 0,
    });
  });
});
