// The storylines read queries (CRTV3-01): list, detail, forPerson and memberOptions, and what a
// rival's viewer may see of them. Design: docs/design/storylines.md#viewer-rules
import { describe, expect, it } from 'vitest';
import { controllerViewer, OMNISCIENT_VIEWER } from '../../../src/core/api';
import { parseId } from '../../../src/core/ids';
import { STORYLINE_REASONS } from '../../../src/systems/storylines';
import { TEST_START_DATE } from '../../support';
import { expectSerialisable } from '../../support/trace';
import {
  ok,
  PLAYER_VIEWER,
  reasonCodes,
  SECOND_SHOW_DATE,
  storylineEngine,
  storylineWorld,
} from './storyline-world';

/** Every object key anywhere in `value`. */
function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

describe('storylines.list', () => {
  it("returns the player's own active storylines in full, hottest first", () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const list = ok(engine.query('storylines.list', {}, PLAYER_VIEWER));
    expectSerialisable(list);
    expect(list).toMatchObject({
      promotionId: ids.promotions.A,
      activeCount: 2,
      softLimit: 6,
      hotFrom: 70,
      editable: true,
    });
    expect(list.rows.map((row) => [row.name, row.heat, row.isHot])).toEqual([
      ['Test Hot Feud', 85, true],
      ['Test Cold Feud', 40, false],
    ]);
    const [hot, cold] = list.rows;
    expect(hot).toMatchObject({
      linkedSegmentCount: 2,
      lastProgressOn: null,
      daysSinceProgress: 0,
      heatTraceRef: null,
      editable: true,
      promotionName: 'Test Promotion A',
    });
    // Members keep their stored order within a side; a released member stays, flagged.
    expect(hot?.heels.map((member) => [member.personId, member.stillEmployed])).toEqual([
      [ids.people[1], true],
      [ids.people[3], false],
    ]);
    expect(hot?.heels[1]?.alignment).toBeNull();
    expect(cold?.faces.map((member) => member.personId)).toEqual([ids.people[0]]);
    expect(cold?.neutrals.map((member) => member.personId)).toEqual([ids.people[2]]);
    expect(cold?.linkedSegmentCount).toBe(0);
  });

  it('lists ended storylines on their own and after the active ones with all', () => {
    const engine = storylineEngine();
    const ended = ok(engine.query('storylines.list', { status: 'ended' }, PLAYER_VIEWER));
    expect(ended.rows.map((row) => [row.name, row.editable, row.daysSinceProgress])).toEqual([
      ['Test Old Feud', false, null],
    ]);
    const all = ok(engine.query('storylines.list', { status: 'all' }, PLAYER_VIEWER));
    expect(all.rows.map((row) => row.name)).toEqual([
      'Test Hot Feud',
      'Test Cold Feud',
      'Test Old Feud',
    ]);
  });

  it("returns a rival promotion's storylines as public rows only", () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const list = ok(
      engine.query('storylines.list', { promotionId: ids.promotions.B! }, PLAYER_VIEWER),
    );
    expectSerialisable(list);
    expect(list.editable).toBe(false);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      name: 'Test Rival Feud',
      status: 'active',
      heat: null,
      isHot: null,
      heatTraceRef: null,
      linkedSegmentCount: null,
      lastProgressOn: null,
      daysSinceProgress: null,
      editable: false,
    });
    expect(list.rows[0]?.heels).toHaveLength(1);
    expect(list.rows[0]?.faces).toHaveLength(1);
  });

  it('shows the omniscient viewer everything, editable nothing', () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const rival = ok(
      engine.query('storylines.list', { promotionId: ids.promotions.B! }, OMNISCIENT_VIEWER),
    );
    expect(rival.rows[0]).toMatchObject({ heat: 90, isHot: true, linkedSegmentCount: 0 });
    expect(rival.editable).toBe(false);
    expect(rival.rows[0]?.editable).toBe(false);
  });

  it('refuses a viewer with no promotion and none named', () => {
    const engine = storylineEngine();
    expect(reasonCodes(engine.query('storylines.list', {}, OMNISCIENT_VIEWER))).toEqual([
      STORYLINE_REASONS.noPromotion,
    ]);
  });
});

describe('storylines.forPerson', () => {
  it('finds a person in storylines of both promotions, each scoped on its own', () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const view = ok(
      engine.query('storylines.forPerson', { personId: ids.people[0]! }, PLAYER_VIEWER),
    );
    expectSerialisable(view);
    expect(view.rows.map((row) => [row.name, row.promotionId, row.heat])).toEqual([
      ['Test Hot Feud', ids.promotions.A, 85],
      ['Test Cold Feud', ids.promotions.A, 40],
      ['Test Rival Feud', ids.promotions.B, null],
    ]);
    // Not employed by the rival: shown under their default ring name, flagged.
    const rivalRow = view.rows[2];
    expect(rivalRow?.faces[0]).toMatchObject({ personId: ids.people[0], stillEmployed: false });
  });

  it('leaves ended storylines out unless asked', () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const person = ids.people[2]!;
    const active = ok(engine.query('storylines.forPerson', { personId: person }, PLAYER_VIEWER));
    expect(active.rows.map((row) => row.name)).toEqual(['Test Cold Feud']);
    const all = ok(
      engine.query('storylines.forPerson', { personId: person, includeEnded: true }, PLAYER_VIEWER),
    );
    expect(all.rows.map((row) => row.name)).toEqual(['Test Cold Feud', 'Test Old Feud']);
  });
});

describe('storylines.memberOptions', () => {
  it("lists the promotion's active people only, wrestlers first, with their storyline counts", () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const view = ok(engine.query('storylines.memberOptions', {}, PLAYER_VIEWER));
    expectSerialisable(view);
    expect(view.promotionId).toBe(ids.promotions.A);
    const byPerson = new Map(view.options.map((option) => [option.personId, option]));
    // Person 3 is released; people 4-6 belong to the rival.
    expect([...byPerson.keys()].sort()).toEqual([ids.people[0], ids.people[1], ids.people[2]]);
    expect(byPerson.get(ids.people[0]!)?.activeStorylineCount).toBe(2);
    expect(byPerson.get(ids.people[2]!)?.activeStorylineCount).toBe(1);
    expect(view.options.every((option) => option.role === 'wrestler')).toBe(true);
  });

  it("refuses a rival's promotion", () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    expect(
      reasonCodes(
        engine.query('storylines.memberOptions', { promotionId: ids.promotions.B! }, PLAYER_VIEWER),
      ),
    ).toEqual([STORYLINE_REASONS.notYours]);
  });
});

describe('storylines.detail', () => {
  it('orders the timeline by show date and marks the finale, with no duration of any kind', () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const detail = ok(
      engine.query('storylines.detail', { storylineId: ids.storylines[1]! }, PLAYER_VIEWER),
    );
    expectSerialisable(detail);
    expect(detail.summary).toBe('Two rivals.');
    expect(detail.ending).toBeNull();
    expect(
      detail.timeline.map((entry) => [
        entry.segmentId,
        entry.date,
        entry.eventName,
        entry.isFinale,
      ]),
    ).toEqual([
      [ids.segments[1], TEST_START_DATE, 'Test Show One', false],
      [ids.segments[0], SECOND_SHOW_DATE, 'Test Show Two', true],
    ]);
    expect(detail.timeline[0]).toMatchObject({ kind: 'match', stars: 2.5, ratingTraceId: null });
    expect(detail.timeline[0]?.label).toMatch(/ vs /);
    expect(keysOf(detail).filter((key) => /minute|length|duration/i.test(key))).toEqual([]);
  });

  it('says an ended storyline with too few segments had no payoff', () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const detail = ok(
      engine.query('storylines.detail', { storylineId: ids.storylines[2]! }, PLAYER_VIEWER),
    );
    expectSerialisable(detail);
    expect(detail.timeline).toEqual([]);
    expect(detail.ending).toEqual({
      endedOn: detail.endedOn,
      linkedSegments: 0,
      minSegments: 4,
      payoff: 'tooFew',
      payoffTraceRef: null,
    });
  });

  it("gives a rival's viewer an empty timeline and no ending", () => {
    const { ids } = storylineWorld();
    const engine = storylineEngine();
    const rivalView = controllerViewer({ kind: 'human', playerId: 'player-2' });
    const detail = ok(
      engine.query('storylines.detail', { storylineId: ids.storylines[1]! }, rivalView),
    );
    expectSerialisable(detail);
    expect(detail).toMatchObject({ heat: null, timeline: [], ending: null, summary: '' });
  });

  it('refuses an unknown storyline', () => {
    const engine = storylineEngine();
    expect(
      reasonCodes(
        engine.query(
          'storylines.detail',
          { storylineId: parseId('storyline', 'sty_0000000099') },
          PLAYER_VIEWER,
        ),
      ),
    ).toEqual([STORYLINE_REASONS.notFound]);
  });
});
