// The storyline payoff when a storyline ends (CRTV4-03). Design: docs/design/storylines.md#payoff
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../../src/core/api';
import { simSystem } from '../../../../src/core/api/builtins';
import type { Controller } from '../../../../src/core/api/controller';
import type { AnyDomainEvent } from '../../../../src/core/events/types';
import type { PersonId, RegionId, StorylineId } from '../../../../src/core/ids';
import type { Employment } from '../../../../src/model/entities/employment';
import type { Person } from '../../../../src/model/entities/person';
import type { Storyline } from '../../../../src/model/entities/storyline';
import {
  LEFT_PROMOTION_PAYOFF_TEXT,
  NO_FAN_BASE_PAYOFF_TEXT,
  planPayoff,
  STORYLINE_PAYOFF_REASON_KEY,
  storylinesSystem,
  type PayoffPlan,
  type StorylinePayoffView,
} from '../../../../src/systems/storylines';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder, type BuiltWorld } from '../../../support';
import { expectSerialisable } from '../../../support/trace';
import { ok, PLAYER_VIEWER } from '../storyline-world';

const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const COMPUTER: Controller = { kind: 'computer' };
const OMNISCIENT = { kind: 'omniscient' } as const;
const COUNTED = { segments: 4, matches: 4, angles: 0, heatGained: 0, heatLost: 0 };

/**
 * Promotion A (the player's) is known in regions 0 (60), 1 (10, below the payoff's 20) and 2 (30);
 * region 3 not at all. Its roster: person 0 at popularity 40 everywhere, person 1 at 85, person 2
 * at 40, person 3 released. Storylines, each with 4 counted segments unless noted:
 *
 * - `Test Hot Feud` (heat 80; 0 face, 1 heel, 3 heel) with a played finale match;
 * - `Test Cold Feud` (heat 30; 0, 1);
 * - `Test Short Feud` (heat 80; 2) with only 3 counted segments.
 *
 * Promotion B (the computer's) has the same fan base and `Test Rival Feud` (heat 80; its people
 * 4 at 40 and 5 at 85, no finale). Every employment starts at momentum 0.
 */
function payoffWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: PLAYER }, (promotion) =>
      promotion
        .withRoster(4, {
          employment: (index) =>
            index === 3 ? { status: 'released', endedOn: TEST_START_DATE } : {},
        })
        .withStoryline(
          { name: 'Test Hot Feud', heat: 80, progressTotals: COUNTED },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
              [3, 'heel'],
            ],
          },
        )
        .withStoryline(
          { name: 'Test Cold Feud', heat: 30, progressTotals: COUNTED },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
            ],
          },
        )
        .withStoryline(
          {
            name: 'Test Short Feud',
            heat: 80,
            progressTotals: { ...COUNTED, segments: 3, matches: 3 },
          },
          { members: [[2, 'face']] },
        ),
    )
    .withPromotion({ controller: COMPUTER }, (promotion) =>
      promotion.withRoster(2).withStoryline(
        { name: 'Test Rival Feud', heat: 80, progressTotals: COUNTED },
        {
          members: [
            [0, 'face'],
            [1, 'heel'],
          ],
        },
      ),
    )
    .withEventInstance({ name: 'Test Show' })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 })
    .with('fan bases, popularity, momentum and the finale', ({ tx, ids }) => {
      const [r0, r1, r2] = ids.regions;
      const fanBase = { [r0!]: 60, [r1!]: 10, [r2!]: 30 };
      for (const promotionId of [ids.promotions.A!, ids.promotions.B!]) {
        tx.update('promotions', promotionId, { regionalPop: fanBase });
      }
      const everywhere = (pop: number) => Object.fromEntries(ids.regions.map((id) => [id, pop]));
      [40, 85, 40, 40, 40, 85].forEach((pop, index) => {
        tx.update('people', ids.people[index]!, { regionalPop: everywhere(pop) });
      });
      for (const employmentId of ids.employments) {
        tx.update('employments', employmentId, { momentum: 0 });
      }
      const hot = ids.storylines[0]!;
      tx.update('segments', ids.segments[0]!, { storylineIds: [hot] });
      tx.update('storylines', hot, { finaleSegmentId: ids.segments[0]! });
    })
    .build();
}

interface Setup {
  built: BuiltWorld;
  engine: Engine;
  person: (index: number) => PersonId;
  region: (index: number) => RegionId;
  hot: StorylineId;
  cold: StorylineId;
  short: StorylineId;
  rival: StorylineId;
}

function setup(): Setup {
  const built = payoffWorld();
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, storylinesSystem],
    debugChecks: true,
  });
  return {
    built,
    engine,
    person: (index) => built.ids.people[index]!,
    region: (index) => built.ids.regions[index]!,
    hot: built.ids.storylines[0]!,
    cold: built.ids.storylines[1]!,
    short: built.ids.storylines[2]!,
    rival: built.ids.storylines[3]!,
  };
}

function end(world: Setup, storylineId: StorylineId, issuedBy: Controller = PLAYER): void {
  const result = world.engine.command('storylines.end', { storylineId }, issuedBy);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
}

function personOf(engine: Engine, personId: PersonId): Person {
  const row = engine.exportState().world.tables.people.find((person) => person.id === personId);
  if (row === undefined) throw new Error(`no person ${personId}`);
  return row;
}

function employmentOf(engine: Engine, personId: PersonId): Employment {
  const row = engine
    .exportState()
    .world.tables.employments.find(
      (employment) => employment.personId === personId && employment.status === 'active',
    );
  if (row === undefined) throw new Error(`no employment for ${personId}`);
  return row;
}

function storylineOf(engine: Engine, storylineId: StorylineId): Storyline {
  const row = engine
    .exportState()
    .world.tables.storylines.find((storyline) => storyline.id === storylineId);
  if (row === undefined) throw new Error(`no storyline ${storylineId}`);
  return row;
}

function events(engine: Engine, type: string): AnyDomainEvent[] {
  return ok(engine.query('sim.recentEvents', { limit: 500 }, OMNISCIENT)).filter(
    (event) => event.type === type,
  );
}

function payoffView(world: Setup, storylineId: StorylineId, viewer = PLAYER_VIEWER) {
  const view: StorylinePayoffView = ok(
    world.engine.query('storylines.payoff', { storylineId }, viewer),
  );
  expectSerialisable(view);
  return view;
}

function previewOf(world: Setup, storylineId: StorylineId): PayoffPlan {
  const view = payoffView(world, storylineId);
  if (view.kind !== 'preview') throw new Error(`expected a preview, got ${view.kind}`);
  return view.plan;
}

describe('storylines.payOffOnEnd', () => {
  it('pays a hot storyline: popularity in the qualifying regions only, momentum, events', () => {
    const world = setup();
    const before = [0, 1].map((index) => personOf(world.engine, world.person(index)));
    end(world, world.hot);

    // Heat 80 with a played finale: quality 0.75 × 1.25. Person 0 (popularity 40) has full room
    // to grow: 3.75; person 1 (85) only a quarter: 0.9375. Momentum 9.375 for both.
    const record = storylineOf(world.engine, world.hot).payoff;
    expect(record).toMatchObject({ paid: true, on: TEST_START_DATE, countedSegments: 4, heat: 80 });
    const [zero, one, released] = record!.members;
    expect(zero!.popularityDelta).toBeCloseTo(3.75, 10);
    expect(one!.popularityDelta).toBeCloseTo(0.9375, 10);
    expect(zero!.momentumDelta).toBeCloseTo(9.375, 10);
    expect(released).toEqual({
      personId: world.person(3),
      popularityDelta: 0,
      momentumDelta: 0,
      skipped: true,
    });

    for (const [index, person] of before.entries()) {
      const after = personOf(world.engine, person.id).regionalPop;
      // Regions 0 and 2 are the promotion's fan base for a payoff; 1 is below 20 and 3 unknown.
      expect(after[world.region(0)]!).toBeGreaterThan(person.regionalPop[world.region(0)]!);
      expect(after[world.region(2)]!).toBeGreaterThan(person.regionalPop[world.region(2)]!);
      expect(after[world.region(1)]).toBe(person.regionalPop[world.region(1)]);
      expect(after[world.region(3)]).toBe(person.regionalPop[world.region(3)]);
      expect(employmentOf(world.engine, world.person(index)).momentum).toBeCloseTo(9.375, 10);
    }

    const popularity = events(world.engine, 'popularity.changed');
    expect(popularity.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        subjectId: world.person(0),
        source: 'player',
        reasonKey: STORYLINE_PAYOFF_REASON_KEY,
      }),
      expect.objectContaining({ subjectId: world.person(1), source: 'player' }),
    ]);
    expect(events(world.engine, 'momentum.changed')).toHaveLength(2);
    expect(events(world.engine, 'storyline.paidOff').map((event) => event.payload)).toEqual([
      {
        storylineId: world.hot,
        promotionId: world.built.ids.promotions.A,
        paid: true,
        memberCount: 2,
        quality: 0.9375,
      },
    ]);

    const view = payoffView(world, world.hot);
    expect(view).toMatchObject({
      kind: 'paid',
      traceRef: { kind: 'storylines.payoff', id: world.hot },
    });
    const detail = ok(
      world.engine.query('storylines.detail', { storylineId: world.hot }, PLAYER_VIEWER),
    );
    expect(detail.ending).toMatchObject({ payoff: 'paid', linkedSegments: 4 });
  });

  it('a cold storyline really lowers popularity and momentum, and never morale', () => {
    const world = setup();
    const before = [0, 1].map((index) => personOf(world.engine, world.person(index)));
    const morale = employmentOf(world.engine, world.person(0)).morale;
    end(world, world.cold);

    const record = storylineOf(world.engine, world.cold).payoff!;
    for (const member of record.members) {
      expect(member.popularityDelta).toBeCloseTo(-2, 10);
      expect(member.momentumDelta).toBeCloseTo(-5, 10);
    }
    for (const [index, person] of before.entries()) {
      const after = personOf(world.engine, person.id).regionalPop;
      expect(after[world.region(0)]!).toBeLessThan(person.regionalPop[world.region(0)]!);
      expect(after[world.region(2)]!).toBeLessThan(person.regionalPop[world.region(2)]!);
      expect(after[world.region(1)]).toBe(person.regionalPop[world.region(1)]);
      expect(employmentOf(world.engine, world.person(index)).momentum).toBeCloseTo(-5, 10);
    }
    expect(employmentOf(world.engine, world.person(0)).morale).toBe(morale);
    expect(events(world.engine, 'morale.changed')).toEqual([]);
  });

  it('skips a member released before the end, with the reason', () => {
    const world = setup();
    const plan = previewOf(world, world.hot);
    expect(plan.members.map((member) => member.skippedReason)).toEqual([
      null,
      null,
      LEFT_PROMOTION_PAYOFF_TEXT,
    ]);
    expect(plan.members[2]).toMatchObject({ employmentId: null, marketPopularity: null });
  });

  it('pays nothing with too few counted segments, and says so', () => {
    const world = setup();
    const before = personOf(world.engine, world.person(2));
    expect(previewOf(world, world.short)).toMatchObject({ eligible: false, countedSegments: 3 });
    end(world, world.short);

    expect(personOf(world.engine, world.person(2))).toEqual(before);
    expect(employmentOf(world.engine, world.person(2)).momentum).toBe(0);
    expect(storylineOf(world.engine, world.short).payoff).toMatchObject({
      paid: false,
      countedSegments: 3,
      members: [{ personId: world.person(2), popularityDelta: 0, momentumDelta: 0 }],
    });
    expect(events(world.engine, 'storyline.paidOff').map((event) => event.payload)).toEqual([
      expect.objectContaining({ paid: false, memberCount: 0, quality: 0 }),
    ]);
    const view = payoffView(world, world.short);
    expect(view.kind).toBe('noPayoff');
    const detail = ok(
      world.engine.query('storylines.detail', { storylineId: world.short }, PLAYER_VIEWER),
    );
    expect(detail.ending).toMatchObject({ payoff: 'tooFew', linkedSegments: 3 });
  });

  it("the preview's numbers are what the payoff applies", () => {
    const world = setup();
    const plan = previewOf(world, world.hot);
    expect(plan).toMatchObject({ eligible: true, finalePlayed: true, heat: 80 });
    expect(plan.regionWeights).toEqual({ [world.region(0)]: 0.6, [world.region(2)]: 0.3 });
    end(world, world.hot);

    const record = storylineOf(world.engine, world.hot).payoff!;
    expect(record.members).toEqual(
      plan.members.map((member) => ({
        personId: member.personId,
        popularityDelta: member.skippedReason === null ? member.popularity.value : 0,
        momentumDelta: member.skippedReason === null ? member.momentum.value : 0,
        skipped: member.skippedReason !== null,
      })),
    );
    for (const member of plan.members.slice(0, 2)) {
      expect(employmentOf(world.engine, member.personId).momentum).toBe(member.momentum.value);
    }
  });

  it('a rival storyline ended by the computer pays by the same numbers', () => {
    const world = setup();
    const plan = planPayoff(world.built.world, createEngineTunables({}), world.rival);
    end(world, world.rival, COMPUTER);

    // Heat 80 with no finale: quality 0.75. Person 4 (40) gains 3, person 5 (85) 0.75; momentum 7.5.
    const record = storylineOf(world.engine, world.rival).payoff!;
    expect(record.members.map((member) => member.popularityDelta)).toEqual(
      plan.members.map((member) => member.popularity.value),
    );
    expect(record.members[0]!.popularityDelta).toBeCloseTo(3, 10);
    expect(record.members[1]!.popularityDelta).toBeCloseTo(0.75, 10);
    expect(employmentOf(world.engine, world.person(4)).momentum).toBeCloseTo(7.5, 10);
    expect(events(world.engine, 'popularity.changed').map((event) => event.payload)).toEqual([
      expect.objectContaining({ subjectId: world.person(4), source: 'ai' }),
      expect.objectContaining({ subjectId: world.person(5), source: 'ai' }),
    ]);
  });

  it('skips everyone when the promotion has no fan base big enough', () => {
    const world = setup();
    const plan = planPayoff(
      world.built.world,
      createEngineTunables({ 'storylines.payoff.minRegionPop': 100 }),
      world.hot,
    );
    expect(plan.regionWeights).toEqual({});
    expect(plan.members.map((member) => member.skippedReason)).toEqual([
      NO_FAN_BASE_PAYOFF_TEXT,
      NO_FAN_BASE_PAYOFF_TEXT,
      LEFT_PROMOTION_PAYOFF_TEXT,
    ]);
  });
});

describe('storylines.payoff', () => {
  it("is the storyline's own promotion's: a rival viewer gets notYourStoryline", () => {
    const world = setup();
    const view = payoffView(world, world.rival);
    expect(view).toMatchObject({
      kind: 'unavailable',
      reason: { code: 'storylines.notYourStoryline' },
    });
    expect(payoffView(world, world.rival, OMNISCIENT).kind).toBe('preview');
  });

  it('says so for an unknown storyline', () => {
    const world = setup();
    const view = payoffView(world, 'sty_0000000099' as StorylineId);
    expect(view).toMatchObject({ kind: 'unavailable', reason: { code: 'storylines.notFound' } });
  });
});
