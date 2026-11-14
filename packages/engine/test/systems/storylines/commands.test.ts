// The storyline commands and end preview (CRTV3-03). Design: docs/design/storylines.md#commands
import { describe, expect, it, vi } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import type { Controller } from '../../../src/core/api/controller';
import type { CommandArgs, CommandName } from '../../../src/core/api/maps';
import type { Reason } from '../../../src/core/api/result';
import type { AnyDomainEvent } from '../../../src/core/events/types';
import type { PersonId, StorylineId } from '../../../src/core/ids';
import { isFullTrace } from '../../../src/core/trace/store';
import type { Storyline } from '../../../src/model/entities/storyline';
import {
  STORYLINE_COMMAND_REASONS,
  storylineHeatTraceRef,
  storylinesSystem,
} from '../../../src/systems/storylines';
import {
  TEST_PLAYER_ID,
  TEST_START_DATE,
  testId,
  worldBuilder,
  type BuiltWorld,
} from '../../support';
import type * as TraceKinds from '../../../src/systems/storylines/traceKinds';
import { ok as okQuery, reasonCodes } from './storyline-world';

// Lets one test make `startStoryline` throw after it has created the row, to prove rollback.
const failing = vi.hoisted(() => ({ heatTraceRef: false }));
vi.mock('../../../src/systems/storylines/traceKinds', async (importActual) => {
  const actual = await importActual<typeof TraceKinds>();
  return {
    ...actual,
    storylineHeatTraceRef: (id: StorylineId) => {
      if (failing.heatTraceRef) {
        throw new Error('test: heat trace ref failed');
      }
      return actual.storylineHeatTraceRef(id);
    },
  };
});

const PLAYER: Controller = { kind: 'human', playerId: TEST_PLAYER_ID };
const COMPUTER: Controller = { kind: 'computer' };
const OMNISCIENT = { kind: 'omniscient' } as const;
const PLAYER_VIEWER = { kind: 'controller', controller: PLAYER } as const;

/**
 * Promotion A is the player's: brands Test Main (active) and Test Old (closed), six wrestlers
 * (`people[0..5]`, person 5 released), the active `Test Feud` (0 face, 1 heel) linked by four
 * matches, and the ended `Test Done` (2 face). Promotion B is the computer's: brand Test Rival
 * Brand, two wrestlers (`people[6..7]`) and the active `Test Rival Feud` (6 face).
 */
function commandWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Test Altura', controller: PLAYER }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Main' })
        .withBrand({ name: 'Test Old', active: false })
        .withRoster(6, {
          employment: (index) =>
            index === 5 ? { status: 'released', endedOn: TEST_START_DATE } : {},
        })
        .withStoryline(
          { name: 'Test Feud', heat: 50 },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
            ],
          },
        )
        .withStoryline(
          { name: 'Test Done', heat: 30, status: 'ended', endedOn: TEST_START_DATE },
          { members: [[2, 'face']] },
        ),
    )
    .withPromotion({ name: 'Test Bravo', controller: COMPUTER }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Rival Brand' })
        .withRoster(2)
        .withStoryline({ name: 'Test Rival Feud', heat: 60 }, { members: [[0, 'face']] }),
    )
    .withEventInstance({ name: 'Test Show' })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 })
    .withCompletedMatch({ show: 0, sides: [[1], [0]], result: 0 })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 1 })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 'draw' })
    .with('link the feud', ({ tx, ids }) => {
      for (const segmentId of ids.segments) {
        tx.update('segments', segmentId, { storylineIds: [ids.storylines[0]!] });
      }
    })
    .build();
}

interface Setup {
  built: BuiltWorld;
  engine: Engine;
  person: (index: number) => PersonId;
  feud: StorylineId;
  done: StorylineId;
  rival: StorylineId;
}

function setup(): Setup {
  const built = commandWorld();
  const engine = createEngine({
    state: initialEngineState(built.world),
    systems: [simSystem, storylinesSystem],
    debugChecks: true,
  });
  return {
    built,
    engine,
    person: (index) => built.ids.people[index]!,
    feud: built.ids.storylines[0]!,
    done: built.ids.storylines[1]!,
    rival: built.ids.storylines[2]!,
  };
}

/** Issues the command and fails the test when it is refused. */
function ok<N extends CommandName>(
  engine: Engine,
  name: N,
  args: CommandArgs<N>,
  issuedBy: Controller = PLAYER,
) {
  const result = engine.command(name, args, issuedBy);
  if (!result.ok) {
    expect.fail(JSON.stringify(result.reasons));
  }
  return result;
}

/** Issues the command, expects it refused, nothing written and no event; returns the reasons. */
function refused<N extends CommandName>(
  engine: Engine,
  name: N,
  args: CommandArgs<N>,
  issuedBy: Controller = PLAYER,
): Reason[] {
  const before = engine.exportState();
  const result = engine.command(name, args, issuedBy);
  if (result.ok) {
    expect.fail(`${name} was accepted`);
  }
  const after = engine.exportState();
  expect(after.world).toEqual(before.world);
  expect(after.events).toEqual(before.events);
  expect(after.traces).toEqual(before.traces);
  return result.reasons;
}

/** `[code, field]` of each reason. */
function codesAndFields(reasons: readonly Reason[]): [string, string | undefined][] {
  return reasons.map((reason) => [reason.code, reason.field]);
}

function storyline(engine: Engine, id: StorylineId): Storyline {
  const row = engine.exportState().world.tables.storylines.find((entry) => entry.id === id);
  if (row === undefined) {
    throw new Error(`No storyline ${id}`);
  }
  return row;
}

function storylineEvents(engine: Engine): AnyDomainEvent[] {
  const result = engine.query('sim.recentEvents', { limit: 500 }, OMNISCIENT);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.reasons));
  }
  return result.data.filter((event) => event.type.startsWith('storyline.'));
}

/** The payload of each storyline event, without the envelope fields. */
function payloads(engine: Engine): Record<string, unknown>[] {
  return storylineEvents(engine).map((event) => {
    return { type: event.type, ...event.payload };
  });
}

function create(
  world: Setup,
  overrides: Partial<CommandArgs<'storylines.create'>> = {},
): CommandArgs<'storylines.create'> {
  return {
    promotionId: world.built.ids.promotions.A!,
    name: '  Test Grudge  ',
    summary: ' Old friends fall out. ',
    brandId: world.built.ids.brands[0]!,
    members: [
      { personId: world.person(2), side: 'face' },
      { personId: world.person(3), side: 'heel' },
    ],
    ...overrides,
  };
}

describe('storylines.create', () => {
  it('starts a storyline with starting heat, its trace and a storyline.started event', () => {
    const world = setup();
    const result = ok(world.engine, 'storylines.create', create(world));
    const { storylineId, warnings } = result.data;
    expect(warnings).toEqual([]);

    const row = storyline(world.engine, storylineId);
    expect(row).toMatchObject({
      promotionId: world.built.ids.promotions.A,
      brandId: world.built.ids.brands[0],
      name: 'Test Grudge',
      summary: 'Old friends fall out.',
      status: 'active',
      startedOn: TEST_START_DATE,
      endedOn: null,
      lastProgressOn: null,
      finaleSegmentId: null,
      members: [
        { personId: world.person(2), side: 'face' },
        { personId: world.person(3), side: 'heel' },
      ],
    });
    expect(row.heat).toBeGreaterThan(0);

    const trace = okQuery(
      world.engine.query('trace.get', { ref: storylineHeatTraceRef(storylineId) }, OMNISCIENT),
    );
    expect(trace).not.toBeNull();
    expect(trace !== null && isFullTrace(trace)).toBe(true);
    expect(payloads(world.engine)).toEqual([
      {
        type: 'storyline.started',
        storylineId,
        promotionId: world.built.ids.promotions.A,
        source: 'player',
      },
    ]);
  });

  it('defaults to no summary and the whole promotion', () => {
    const world = setup();
    const args = create(world);
    delete args.summary;
    delete args.brandId;
    const { storylineId } = ok(world.engine, 'storylines.create', args).data;
    expect(storyline(world.engine, storylineId)).toMatchObject({ summary: '', brandId: null });
  });

  it('refuses each broken field with its code and field', () => {
    const world = setup();
    const cases: [Partial<CommandArgs<'storylines.create'>>, [string, string | undefined][]][] = [
      [{ name: '   ' }, [['storylines.nameLength', 'name']]],
      [{ name: 'x'.repeat(81) }, [['storylines.nameLength', 'name']]],
      [{ name: ' test feud ' }, [['storylines.nameTaken', 'name']]],
      [{ summary: 'x'.repeat(501) }, [['storylines.summaryLength', 'summary']]],
      [{ brandId: world.built.ids.brands[2]! }, [['storylines.brandNotInPromotion', 'brandId']]],
      [{ brandId: world.built.ids.brands[1]! }, [['storylines.brandNotInPromotion', 'brandId']]],
      [{ members: [] }, [['storylines.noMembers', 'members']]],
      [
        {
          members: [
            { personId: world.person(0), side: 'face' },
            { personId: world.person(5), side: 'heel' },
            { personId: world.person(6), side: 'heel' },
          ],
        },
        [
          ['storylines.memberNotEmployed', 'members[1].personId'],
          ['storylines.memberNotEmployed', 'members[2].personId'],
        ],
      ],
      [
        {
          members: [
            { personId: world.person(0), side: 'face' },
            { personId: world.person(0), side: 'heel' },
          ],
        },
        [['storylines.duplicateMember', 'members[1].personId']],
      ],
    ];
    for (const [overrides, expected] of cases) {
      expect(
        codesAndFields(refused(world.engine, 'storylines.create', create(world, overrides))),
      ).toEqual(expected);
    }
  });

  it('refuses more than 12 members', () => {
    const world = setup();
    const members = Array.from({ length: 13 }, (_, index) => ({
      personId: world.person(index % 5),
      side: 'neutral' as const,
    }));
    const codes = refused(world.engine, 'storylines.create', create(world, { members })).map(
      (reason) => reason.code,
    );
    expect(codes).toContain(STORYLINE_COMMAND_REASONS.tooManyMembers);
  });

  it('allows the name of an ended storyline again', () => {
    const world = setup();
    ok(world.engine, 'storylines.create', create(world, { name: 'Test Done' }));
  });

  it('refuses a rival promotion, a computer controller and an unknown promotion', () => {
    const world = setup();
    const rival = refused(
      world.engine,
      'storylines.create',
      create(world, {
        promotionId: world.built.ids.promotions.B!,
        brandId: null,
        members: [{ personId: world.person(6), side: 'face' }],
      }),
    );
    expect(codesAndFields(rival)).toEqual([['storylines.notYours', 'promotionId']]);
    expect(rival[0]?.message).toBe(
      "Test Bravo isn't yours. You can only start storylines for your own promotion.",
    );

    const computer = refused(world.engine, 'storylines.create', create(world), COMPUTER);
    expect(codesAndFields(computer)).toEqual([['storylines.notYours', 'promotionId']]);

    const unknown = refused(
      world.engine,
      'storylines.create',
      create(world, { promotionId: testId('promotion', 999) }),
    );
    expect(codesAndFields(unknown)).toEqual([['storylines.promotionNotFound', 'promotionId']]);
  });

  it('warns about the 7th active storyline and still creates it', () => {
    const world = setup();
    for (let index = 1; index <= 5; index += 1) {
      const { warnings } = ok(
        world.engine,
        'storylines.create',
        create(world, { name: `Test Story ${String(index)}` }),
      ).data;
      expect(warnings).toEqual([]);
    }
    const result = ok(world.engine, 'storylines.create', create(world, { name: 'Test Story 7' }));
    expect(result.data.warnings).toEqual([
      {
        code: 'storylines.manyActive',
        message: 'You already run 6 storylines; it gets hard to keep them all hot.',
        subject: { kind: 'promotion', id: world.built.ids.promotions.A },
      },
    ]);
    expect(storyline(world.engine, result.data.storylineId).status).toBe('active');
  });

  it('never warns about many storylines when the soft limit is 0', () => {
    const world = setup();
    const engine = createEngine({
      state: {
        ...initialEngineState(world.built.world),
        tunableOverrides: { 'storylines.activeSoftLimit': 0 },
      },
      systems: [simSystem, storylinesSystem],
    });
    for (let index = 1; index <= 7; index += 1) {
      const { warnings } = ok(
        engine,
        'storylines.create',
        create(world, { name: `Test Story ${String(index)}` }),
      ).data;
      expect(warnings).toEqual([]);
    }
  });

  it('warns when no one is on the other side', () => {
    const world = setup();
    const { warnings } = ok(
      world.engine,
      'storylines.create',
      create(world, {
        members: [
          { personId: world.person(2), side: 'face' },
          { personId: world.person(3), side: 'neutral' },
        ],
      }),
    ).data;
    expect(warnings).toEqual([
      { code: 'storylines.oneSided', message: 'No one on the other side yet.', field: 'members' },
    ]);
  });

  it('leaves no partial storyline when apply throws', () => {
    const world = setup();
    const before = world.engine.exportState();
    failing.heatTraceRef = true;
    try {
      const result = world.engine.command('storylines.create', create(world), PLAYER);
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual(['internal']);
    } finally {
      failing.heatTraceRef = false;
    }
    const after = world.engine.exportState();
    expect(after.world).toEqual(before.world);
    expect(after.events).toEqual(before.events);
    expect(after.traces).toEqual(before.traces);
  });
});

describe('storylines.edit', () => {
  it('renames, rewrites the summary and moves the brand with no event', () => {
    const world = setup();
    ok(world.engine, 'storylines.edit', {
      storylineId: world.feud,
      name: '  Test Feud Reborn ',
      summary: ' New chapter. ',
      brandId: world.built.ids.brands[0]!,
    });
    expect(storyline(world.engine, world.feud)).toMatchObject({
      name: 'Test Feud Reborn',
      summary: 'New chapter.',
      brandId: world.built.ids.brands[0],
    });
    ok(world.engine, 'storylines.edit', { storylineId: world.feud, brandId: null });
    expect(storyline(world.engine, world.feud).brandId).toBeNull();
    expect(storylineEvents(world.engine)).toEqual([]);
  });

  it('keeps its own name and refuses the name of another active storyline', () => {
    const world = setup();
    ok(world.engine, 'storylines.edit', { storylineId: world.feud, name: 'TEST FEUD' });
    const { storylineId } = ok(world.engine, 'storylines.create', create(world)).data;
    expect(
      codesAndFields(refused(world.engine, 'storylines.edit', { storylineId, name: 'test feud' })),
    ).toEqual([['storylines.nameTaken', 'name']]);
  });

  it('refuses no change, bad fields and a rival storyline', () => {
    const world = setup();
    expect(
      codesAndFields(refused(world.engine, 'storylines.edit', { storylineId: world.feud })),
    ).toEqual([['invalidArgs', 'storylineId']]);
    expect(
      codesAndFields(
        refused(world.engine, 'storylines.edit', {
          storylineId: world.feud,
          name: '',
          summary: 'x'.repeat(501),
          brandId: world.built.ids.brands[1]!,
        }),
      ),
    ).toEqual([
      ['storylines.nameLength', 'name'],
      ['storylines.summaryLength', 'summary'],
      ['storylines.brandNotInPromotion', 'brandId'],
    ]);
    const rival = refused(world.engine, 'storylines.edit', {
      storylineId: world.rival,
      name: 'Mine',
    });
    expect(rival).toEqual([
      {
        code: 'storylines.notYours',
        message: 'That storyline belongs to Test Bravo.',
        subject: { kind: 'storyline', id: world.rival },
      },
    ]);
  });
});

describe('storylines.addMember, removeMember and setSide', () => {
  it('add, remove and switch sides, each with its storyline.membersChanged', () => {
    const world = setup();
    const promotionId = world.built.ids.promotions.A;
    ok(world.engine, 'storylines.addMember', {
      storylineId: world.feud,
      personId: world.person(4),
      side: 'neutral',
    });
    ok(world.engine, 'storylines.setSide', {
      storylineId: world.feud,
      personId: world.person(0),
      side: 'heel',
    });
    ok(world.engine, 'storylines.removeMember', {
      storylineId: world.feud,
      personId: world.person(1),
    });

    expect(storyline(world.engine, world.feud).members).toEqual([
      { personId: world.person(0), side: 'heel' },
      { personId: world.person(4), side: 'neutral' },
    ]);
    const base = { type: 'storyline.membersChanged', storylineId: world.feud, promotionId };
    expect(payloads(world.engine)).toEqual([
      { ...base, added: [world.person(4)], removed: [], sideChanged: [] },
      { ...base, added: [], removed: [], sideChanged: [world.person(0)] },
      { ...base, added: [], removed: [world.person(1)], sideChanged: [] },
    ]);
  });

  it('keeps heat, last progress and links when someone leaves', () => {
    const world = setup();
    const before = storyline(world.engine, world.feud);
    ok(world.engine, 'storylines.removeMember', {
      storylineId: world.feud,
      personId: world.person(0),
    });
    const after = storyline(world.engine, world.feud);
    expect({ ...after, members: before.members }).toEqual(before);
    const detail = okQuery(
      world.engine.query('storylines.detail', { storylineId: world.feud }, PLAYER_VIEWER),
    );
    expect(detail.linkedSegmentCount).toBe(4);
  });

  it('a switch to the same side succeeds with no event', () => {
    const world = setup();
    const result = ok(world.engine, 'storylines.setSide', {
      storylineId: world.feud,
      personId: world.person(0),
      side: 'face',
    });
    expect(result.events).toEqual([]);
    expect(storylineEvents(world.engine)).toEqual([]);
  });

  it('refuses members who cannot join', () => {
    const world = setup();
    const add = (personId: PersonId) =>
      codesAndFields(
        refused(world.engine, 'storylines.addMember', {
          storylineId: world.feud,
          personId,
          side: 'face',
        }),
      );
    expect(add(world.person(0))).toEqual([['storylines.alreadyMember', 'personId']]);
    expect(add(world.person(5))).toEqual([['storylines.memberNotEmployed', 'personId']]);
    expect(add(world.person(6))).toEqual([['storylines.memberNotEmployed', 'personId']]);
  });

  it('refuses a 13th member', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({ controller: PLAYER }, (promotion) =>
        promotion
          .withRoster(13)
          .withStoryline(
            { name: 'Test Crowd' },
            { members: Array.from({ length: 12 }, (_, index) => [index, 'neutral'] as const) },
          ),
      )
      .build();
    const engine = createEngine({
      state: initialEngineState(built.world),
      systems: [simSystem, storylinesSystem],
    });
    const reasons = refused(engine, 'storylines.addMember', {
      storylineId: built.ids.storylines[0]!,
      personId: built.ids.people[12]!,
      side: 'face',
    });
    expect(codesAndFields(reasons)).toEqual([['storylines.tooManyMembers', 'personId']]);
  });

  it('refuses a non-member and the last member', () => {
    const world = setup();
    expect(
      codesAndFields(
        refused(world.engine, 'storylines.removeMember', {
          storylineId: world.feud,
          personId: world.person(4),
        }),
      ),
    ).toEqual([['storylines.notMember', 'personId']]);
    expect(
      codesAndFields(
        refused(world.engine, 'storylines.setSide', {
          storylineId: world.feud,
          personId: world.person(4),
          side: 'heel',
        }),
      ),
    ).toEqual([['storylines.notMember', 'personId']]);

    ok(world.engine, 'storylines.removeMember', {
      storylineId: world.feud,
      personId: world.person(1),
    });
    const last = refused(world.engine, 'storylines.removeMember', {
      storylineId: world.feud,
      personId: world.person(0),
    });
    expect(last).toEqual([
      {
        code: 'storylines.lastMember',
        message: 'A storyline needs at least one person. End it instead.',
        field: 'personId',
        subject: { kind: 'storyline', id: world.feud },
      },
    ]);
  });

  it('refuses the computer on the player storyline and the player on the rival one', () => {
    const world = setup();
    expect(
      refused(
        world.engine,
        'storylines.addMember',
        { storylineId: world.feud, personId: world.person(4), side: 'face' },
        COMPUTER,
      ).map((reason) => reason.code),
    ).toEqual(['storylines.notYours']);
    expect(
      refused(world.engine, 'storylines.setSide', {
        storylineId: world.rival,
        personId: world.person(6),
        side: 'heel',
      }).map((reason) => reason.code),
    ).toEqual(['storylines.notYours']);
  });

  it('lets the computer change its own storyline through the same commands', () => {
    const world = setup();
    ok(
      world.engine,
      'storylines.addMember',
      { storylineId: world.rival, personId: world.person(7), side: 'heel' },
      COMPUTER,
    );
    expect(storyline(world.engine, world.rival).members).toHaveLength(2);
  });
});

describe('storylines.end and storylines.endPreview', () => {
  it('ends with 4 linked segments: no payoff yet, members, heat and links kept', () => {
    const world = setup();
    const before = storyline(world.engine, world.feud);
    const preview = okQuery(
      world.engine.query('storylines.endPreview', { storylineId: world.feud }, PLAYER_VIEWER),
    );
    expect(preview).toEqual({
      linkedSegments: 4,
      minSegments: 4,
      payoff: 'notAvailable',
      message: 'No payoff yet: payoffs arrive with storyline booking.',
    });

    const result = ok(world.engine, 'storylines.end', { storylineId: world.feud });
    expect(result.data).toEqual({ linkedSegments: 4, minSegments: 4, payoff: 'notAvailable' });
    expect(storyline(world.engine, world.feud)).toEqual({
      ...before,
      status: 'ended',
      endedOn: TEST_START_DATE,
    });
    expect(payloads(world.engine)).toEqual([
      {
        type: 'storyline.ended',
        storylineId: world.feud,
        promotionId: world.built.ids.promotions.A,
        linkedSegments: 4,
      },
    ]);
    const detail = okQuery(
      world.engine.query('storylines.detail', { storylineId: world.feud }, PLAYER_VIEWER),
    );
    expect(detail.ending?.payoff).toBe('notAvailable');
  });

  it('ends a storyline with no linked segments: too few to pay off', () => {
    const world = setup();
    const { storylineId } = ok(world.engine, 'storylines.create', create(world)).data;
    const preview = okQuery(
      world.engine.query('storylines.endPreview', { storylineId }, PLAYER_VIEWER),
    );
    expect(preview).toEqual({
      linkedSegments: 0,
      minSegments: 4,
      payoff: 'tooFew',
      message: 'Ending now pays nothing: needs 4 linked segments, has 0.',
    });
    expect(ok(world.engine, 'storylines.end', { storylineId }).data).toEqual({
      linkedSegments: 0,
      minSegments: 4,
      payoff: 'tooFew',
    });
  });

  it('previews only the viewer own active storylines', () => {
    const world = setup();
    expect(
      reasonCodes(
        world.engine.query('storylines.endPreview', { storylineId: world.rival }, PLAYER_VIEWER),
      ),
    ).toEqual(['storylines.notYours']);
    expect(
      reasonCodes(
        world.engine.query('storylines.endPreview', { storylineId: world.feud }, OMNISCIENT),
      ),
    ).toEqual(['storylines.notYours']);
    expect(
      reasonCodes(
        world.engine.query('storylines.endPreview', { storylineId: world.done }, PLAYER_VIEWER),
      ),
    ).toEqual(['storylines.ended']);
  });

  it('refuses the rival storyline from the player seat', () => {
    const world = setup();
    expect(
      refused(world.engine, 'storylines.end', { storylineId: world.rival }).map(
        (reason) => reason.code,
      ),
    ).toEqual(['storylines.notYours']);
  });
});

describe('ended storylines', () => {
  it('every changing command refuses them with storylines.ended', () => {
    const world = setup();
    const expected = [
      {
        code: 'storylines.ended',
        message: "Test Done has ended; ended storylines can't be changed.",
        subject: { kind: 'storyline', id: world.done },
      },
    ];
    const storylineId = world.done;
    expect(refused(world.engine, 'storylines.edit', { storylineId, name: 'Again' })).toEqual(
      expected,
    );
    expect(
      refused(world.engine, 'storylines.addMember', {
        storylineId,
        personId: world.person(3),
        side: 'heel',
      }),
    ).toEqual(expected);
    expect(
      refused(world.engine, 'storylines.removeMember', { storylineId, personId: world.person(2) }),
    ).toEqual(expected);
    expect(
      refused(world.engine, 'storylines.setSide', {
        storylineId,
        personId: world.person(2),
        side: 'heel',
      }),
    ).toEqual(expected);
    expect(refused(world.engine, 'storylines.end', { storylineId })).toEqual(expected);
  });

  it('refuses an unknown storyline', () => {
    const world = setup();
    const unknown = testId('storyline', 999);
    expect(
      refused(world.engine, 'storylines.end', { storylineId: unknown }).map(
        (reason) => reason.code,
      ),
    ).toEqual(['storylines.notFound']);
  });
});

describe('D-09: storyline commands never touch a worker', () => {
  it('create, addMember, setSide, removeMember and end leave every employment as it was', () => {
    const world = setup();
    const before = world.engine.exportState().world.tables.employments;
    const { storylineId } = ok(world.engine, 'storylines.create', create(world)).data;
    ok(world.engine, 'storylines.addMember', {
      storylineId,
      personId: world.person(4),
      side: 'heel',
    });
    ok(world.engine, 'storylines.setSide', {
      storylineId,
      personId: world.person(2),
      side: 'heel',
    });
    ok(world.engine, 'storylines.setSide', {
      storylineId,
      personId: world.person(3),
      side: 'face',
    });
    ok(world.engine, 'storylines.removeMember', { storylineId, personId: world.person(4) });
    ok(world.engine, 'storylines.end', { storylineId });
    ok(world.engine, 'storylines.end', { storylineId: world.feud });
    expect(world.engine.exportState().world.tables.employments).toEqual(before);
  });
});
