// Title outcomes on show night. Design: docs/design/show-night.md#title-outcomes
import { describe, expect, it } from 'vitest';
import type { SegmentId, TitleId } from '../../../src/core/ids';
import { startDecision, type DecisionNode, type TraceNode } from '../../../src/core/trace';
import type { SimRuntime } from '../../../src/core/pipeline/runtime';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import {
  CHAMPION_WON_REASON,
  DRAW_DEFENCE_REASON,
  DRAW_NO_DEFENCE_REASON,
  NO_CONTEST_REASON,
  TITLE_OUTCOME_APPLIER_ID,
  listSegmentResultAppliers,
  titleOutcomeDecision,
  titleOutcomeTraceRef,
  type TitleOutcomeInputs,
} from '../../../src/systems/shows';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectValidWorld } from '../../support';
import { expectSerialisable } from '../../support/trace';
import { promo, seed } from '../booking/command-world';
import {
  COUNT_OUT,
  PINFALL,
  TODAY,
  changedEvents,
  competitor,
  defendedEvents,
  member,
  runNight,
  titleEvents,
  titleMatch,
  titleNightWorld,
  winFor,
  type TitleNightWorld,
} from './title-night-world';

function reignsOf(built: TitleNightWorld, titleId: TitleId) {
  return built.world.tables.titleReigns.lookup('byTitle', titleId);
}

function openReign(built: TitleNightWorld, titleId: TitleId) {
  return built.world.tables.titleReigns.lookupOne('openByTitle', titleId);
}

function decisionOf(runtime: SimRuntime, segmentId: SegmentId, titleId: TitleId): DecisionNode {
  const entry = runtime.traces.get(titleOutcomeTraceRef(segmentId, titleId));
  if (entry === undefined || !('trace' in entry) || entry.trace.kind !== 'decision') {
    throw new Error(`No title outcome trace for ${segmentId} and ${titleId}`);
  }
  expectSerialisable(entry.trace);
  return entry.trace;
}

function ruleLabels(node: DecisionNode): { label: string; passed: unknown }[] {
  return (node.children ?? [])
    .filter((child: TraceNode) => child.kind === 'branch')
    .map((child) => ({ label: child.label, passed: child.value }));
}

/** A singles match for the world title between roster 0 (the champion, side 0) and roster 1. */
function worldTitleMatch(built: TitleNightWorld, outcome: Parameters<typeof titleMatch>[1]) {
  return seed(
    built.world,
    built.show,
    0,
    titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], outcome, [
      built.titles.world,
    ]),
  );
}

describe('the title outcome applier', () => {
  it('is built in at order 10', () => {
    const applier = listSegmentResultAppliers().find(
      (entry) => entry.id === TITLE_OUTCOME_APPLIER_ID,
    );
    expect(applier?.order).toBe(10);
  });
});

describe('a challenger win', () => {
  it('closes the old reign and opens a new one for the winner', () => {
    const built = titleNightWorld();
    const before = openReign(built, built.titles.world);
    if (before === undefined) {
      throw new Error('The world title has no champion');
    }
    const segmentId = worldTitleMatch(built, winFor(1));
    const { runtime } = runNight(built);

    const closed = built.world.tables.titleReigns.require(before.id);
    expect(closed).toMatchObject({ lostOn: TODAY, endReason: 'lost', endedInSegmentId: segmentId });
    const current = openReign(built, built.titles.world);
    const challenger = member(built, 1);
    const ringName = built.world.tables.employments.lookup('byPerson', challenger)[0]?.ringName;
    expect(current).toMatchObject({
      holderIds: [challenger],
      teamId: null,
      wonOn: TODAY,
      lostOn: null,
      wonInSegmentId: segmentId,
      endedInSegmentId: null,
      endReason: null,
      defences: 0,
      holderNamesAtTime: [ringName],
    });
    expect(changedEvents(runtime)).toEqual([
      {
        titleId: built.titles.world,
        promotionId: built.world.tables.titles.require(built.titles.world).promotionId,
        fromReignId: before.id,
        toReignId: current?.id,
        segmentId,
        eventInstanceId: built.show,
        newHolderIds: [challenger],
        previousHolderIds: [member(built, 0)],
      },
    ]);
    expect(defendedEvents(runtime)).toEqual([]);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('changed');
    expect(decision.reason).toBe('Challengers won by Pinfall');
    expectValidWorld(built.world);
  });

  it('by count-out keeps the title with the champion and says why', () => {
    const built = titleNightWorld();
    const before = openReign(built, built.titles.world);
    const segmentId = worldTitleMatch(built, winFor(1, COUNT_OUT));
    const { runtime } = runNight(built);

    expect(openReign(built, built.titles.world)).toMatchObject({ id: before?.id, defences: 1 });
    expect(changedEvents(runtime)).toEqual([]);
    expect(defendedEvents(runtime)).toHaveLength(1);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('retained');
    // MTCH2's title rule (EVT3-07): the count-out finish never moves a title.
    expect(decision.reason).toBe("Count-out: titles can't change hands on this finish");
    expect(ruleLabels(decision)).toContainEqual({
      label: "Count-out: titles can't change hands on this finish",
      passed: false,
    });
  });

  it('with three competitors keeps a singles title (the size rule)', () => {
    const built = titleNightWorld();
    const segmentId = seed(
      built.world,
      built.show,
      0,
      titleMatch(
        [
          competitor(member(built, 0), 0),
          competitor(member(built, 1), 1),
          competitor(member(built, 6), 1),
          competitor(member(built, 7), 1),
        ],
        winFor(1),
        [built.titles.world],
        'match.handicap',
      ),
    );
    const { runtime } = runNight(built);

    expect(openReign(built, built.titles.world)?.holderIds).toEqual([member(built, 0)]);
    expect(changedEvents(runtime)).toEqual([]);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('retained');
    expect(decision.reason).toBe('Winning side has 3 competitors; the title needs 1');
    expect(ruleLabels(decision)).toContainEqual({
      label: 'Winning side has 3 competitors; the title needs 1',
      passed: false,
    });
    expectValidWorld(built.world);
  });

  it('opens the first reign of a vacant title', () => {
    const built = titleNightWorld();
    const segmentId = seed(
      built.world,
      built.show,
      0,
      titleMatch([competitor(member(built, 6), 0), competitor(member(built, 7), 1)], winFor(0), [
        built.titles.vacant,
      ]),
    );
    const { runtime } = runNight(built);

    expect(reignsOf(built, built.titles.vacant)).toHaveLength(1);
    const reign = openReign(built, built.titles.vacant);
    expect(reign?.holderIds).toEqual([member(built, 6)]);
    expect(changedEvents(runtime)).toEqual([
      expect.objectContaining({
        fromReignId: null,
        toReignId: reign?.id,
        newHolderIds: [member(built, 6)],
        previousHolderIds: [],
      }),
    ]);
    expect(decisionOf(runtime, segmentId, built.titles.vacant).chosen).toBe('changed');
    expectValidWorld(built.world);
  });

  it('by a team gives the tag title to the team', () => {
    const built = titleNightWorld();
    const { holders, challengers } = built.teams;
    seed(
      built.world,
      built.show,
      0,
      titleMatch(
        [
          competitor(member(built, 2), 0, holders),
          competitor(member(built, 3), 0, holders),
          competitor(member(built, 5), 1, challengers),
          competitor(member(built, 4), 1, challengers),
        ],
        winFor(1),
        [built.titles.tag],
        'match.tag-team',
      ),
    );
    runNight(built);

    const reign = openReign(built, built.titles.tag);
    expect(reign?.teamId).toBe(challengers);
    expect(reign?.holderIds).toEqual([member(built, 4), member(built, 5)].sort());
    expect(reign?.holderNamesAtTime).toHaveLength(2);
    expectValidWorld(built.world);
  });

  it('moves the title twice on one show, leaving two closed reigns and one open', () => {
    const built = titleNightWorld();
    const first = worldTitleMatch(built, winFor(1));
    const second = seed(
      built.world,
      built.show,
      1,
      titleMatch([competitor(member(built, 1), 0), competitor(member(built, 0), 1)], winFor(1), [
        built.titles.world,
      ]),
    );
    const { runtime } = runNight(built);

    const reigns = reignsOf(built, built.titles.world);
    expect(reigns.filter((reign) => reign.lostOn === null)).toHaveLength(1);
    expect(reigns.filter((reign) => reign.lostOn !== null)).toHaveLength(2);
    expect(openReign(built, built.titles.world)?.holderIds).toEqual([member(built, 0)]);
    const middle = reigns.find((reign) => reign.wonInSegmentId === first);
    expect(middle).toMatchObject({ wonOn: TODAY, lostOn: TODAY, endedInSegmentId: second });
    expect(changedEvents(runtime).map((event) => event.segmentId)).toEqual([first, second]);
    const report = checkWorld(built.world, TABLES);
    const reignIssues = report.issues.filter((issue) => issue.code.startsWith('titleReigns.'));
    expect(reignIssues).toEqual([]);
    expectValidWorld(built.world);
  });

  it('settles two titles on the line separately, in title id order', () => {
    const built = titleNightWorld();
    const segmentId = seed(
      built.world,
      built.show,
      0,
      titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], winFor(1), [
        built.titles.second,
        built.titles.world,
      ]),
    );
    const { runtime } = runNight(built);

    const ordered = [built.titles.world, built.titles.second].sort();
    expect(changedEvents(runtime).map((event) => event.titleId)).toEqual(ordered);
    for (const titleId of ordered) {
      expect(decisionOf(runtime, segmentId, titleId).chosen).toBe('changed');
      expect(openReign(built, titleId)?.holderIds).toEqual([member(built, 1)]);
    }
    expectValidWorld(built.world);
  });
});

describe('a champion win, draw or no contest', () => {
  it('adds a defence when the champion wins', () => {
    const built = titleNightWorld();
    const before = openReign(built, built.titles.world);
    const segmentId = worldTitleMatch(built, winFor(0));
    const { runtime } = runNight(built);

    expect(openReign(built, built.titles.world)).toMatchObject({ id: before?.id, defences: 1 });
    expect(defendedEvents(runtime)).toEqual([
      {
        titleId: built.titles.world,
        promotionId: built.world.tables.titles.require(built.titles.world).promotionId,
        reignId: before?.id,
        segmentId,
        eventInstanceId: built.show,
        defences: 1,
      },
    ]);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('retained');
    expect(decision.reason).toBe(CHAMPION_WON_REASON);
  });

  it('counts a draw as a defence while the flag is on', () => {
    const built = titleNightWorld();
    const segmentId = worldTitleMatch(built, { kind: 'draw' });
    const { runtime } = runNight(built);

    expect(openReign(built, built.titles.world)?.defences).toBe(1);
    expect(defendedEvents(runtime)).toHaveLength(1);
    expect(decisionOf(runtime, segmentId, built.titles.world).reason).toBe(DRAW_DEFENCE_REASON);
  });

  it('does not count a draw as a defence when the flag is off', () => {
    const built = titleNightWorld();
    const segmentId = worldTitleMatch(built, { kind: 'draw' });
    const { runtime } = runNight(built, { 'shows.titles.drawCountsAsDefence': false });

    expect(openReign(built, built.titles.world)?.defences).toBe(0);
    expect(titleEvents(runtime)).toEqual([]);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('retained');
    expect(decision.reason).toBe(DRAW_NO_DEFENCE_REASON);
  });

  it('changes nothing on a no contest', () => {
    const built = titleNightWorld();
    const before = JSON.stringify(built.world.tables.titleReigns.values());
    const segmentId = worldTitleMatch(built, { kind: 'noContest' });
    const { runtime } = runNight(built);

    expect(JSON.stringify(built.world.tables.titleReigns.values())).toBe(before);
    expect(titleEvents(runtime)).toEqual([]);
    const decision = decisionOf(runtime, segmentId, built.titles.world);
    expect(decision.chosen).toBe('noChange');
    expect(decision.reason).toBe(NO_CONTEST_REASON);
  });
});

describe('guardrails', () => {
  it('skips a retired title and a title from another promotion without throwing', () => {
    const built = titleNightWorld();
    const retiredMatch = worldTitleMatch(built, winFor(1));
    const foreignMatch = seed(
      built.world,
      built.show,
      1,
      titleMatch([competitor(member(built, 6), 0), competitor(member(built, 7), 1)], winFor(1), []),
    );
    const patched = built.world.transact('break the titles', (tx) => {
      tx.update('titles', built.titles.world, { status: 'retired', retiredOn: TODAY });
      tx.update('segments', foreignMatch, (row) =>
        row.kind === 'match'
          ? { ...row, match: { ...row.match, titleIds: [built.titles.rival] } }
          : row,
      );
    });
    expect(patched.ok).toBe(true);
    const before = JSON.stringify(built.world.tables.titleReigns.values());
    const { runtime, report } = runNight(built);

    expect(JSON.stringify(built.world.tables.titleReigns.values())).toBe(before);
    expect(titleEvents(runtime)).toEqual([]);
    expect(runtime.traces.get(titleOutcomeTraceRef(retiredMatch, built.titles.world))).toBe(
      undefined,
    );
    expect(runtime.traces.get(titleOutcomeTraceRef(foreignMatch, built.titles.rival))).toBe(
      undefined,
    );
    expect(report.logs.some((line) => line.includes('it is retired'))).toBe(true);
    expect(report.logs.some((line) => line.includes('another promotion'))).toBe(true);
  });

  it('leaves angles and matches with no title alone', () => {
    const built = titleNightWorld();
    seed(built.world, built.show, 0, promo(member(built, 0)));
    seed(
      built.world,
      built.show,
      1,
      titleMatch([competitor(member(built, 0), 0), competitor(member(built, 1), 1)], winFor(1), []),
    );
    const before = JSON.stringify(built.world.tables.titleReigns.values());
    const { runtime } = runNight(built);
    expect(JSON.stringify(built.world.tables.titleReigns.values())).toBe(before);
    expect(titleEvents(runtime)).toEqual([]);
  });
});

describe('titleOutcomeDecision', () => {
  const tunables = createEngineTunables();
  const base: TitleOutcomeInputs = {
    titleName: 'Test World Title',
    holderCount: 1,
    vacant: false,
    outcome: { kind: 'win', winningSide: 1, methodKey: PINFALL },
    holdersWon: false,
    winnerCount: 1,
    method: { name: 'Pinfall', changesTitles: true },
    titleCanChange: null,
  };

  it('is a pure, serialisable decision', () => {
    const first = titleOutcomeDecision(base, { tunables });
    expect(titleOutcomeDecision(base, { tunables })).toEqual(first);
    expectSerialisable(first);
    expect(first.trace).toMatchObject({
      kind: 'decision',
      label: 'Title outcome: Test World Title',
    });
  });

  it("uses MTCH2's title rule instead of the method's flag when it is given", () => {
    const blocked = startDecision<'yes' | 'no'>('Can the title change hands?').choose(
      'no',
      "Disqualification: titles can't change hands on this finish",
    );
    const refused = titleOutcomeDecision(
      { ...base, titleCanChange: { value: false, trace: blocked.trace } },
      { tunables },
    );
    expect(refused.value).toBe('retained');
    expect(refused.trace).toMatchObject({
      reason: "Disqualification: titles can't change hands on this finish",
    });
    const allowed = startDecision<'yes' | 'no'>('Can the title change hands?').choose(
      'yes',
      'The method and the finish both allow a title change',
    );
    const moved = titleOutcomeDecision(
      {
        ...base,
        method: { name: 'Pinfall', changesTitles: false },
        titleCanChange: { value: true, trace: allowed.trace },
      },
      { tunables },
    );
    expect(moved.value).toBe('changed');
  });

  it('keeps a vacant title vacant when the challengers cannot take it', () => {
    const kept = titleOutcomeDecision(
      { ...base, vacant: true, method: { name: 'Count-Out', changesTitles: false } },
      { tunables },
    );
    expect(kept.value).toBe('stillVacant');
    expect(
      titleOutcomeDecision({ ...base, vacant: true, outcome: { kind: 'draw' } }, { tunables })
        .value,
    ).toBe('stillVacant');
  });
});
