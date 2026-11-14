// The title commands (CRTV1-03). Design: docs/design/titles.md#commands
import { describe, expect, it } from 'vitest';
import type { Engine } from '../../../src/core/api';
import type { Controller } from '../../../src/core/api/controller';
import type { CommandArgs, CommandName } from '../../../src/core/api/maps';
import { isFullTrace } from '../../../src/core/trace/store';
import {
  TITLE_COMMAND_REASON_CODES,
  titlePrestigeTraceRef,
  titleVacancyTraceRef,
} from '../../../src/systems/titles';
import {
  COMPUTER,
  engineIntegrityCodes,
  OMNISCIENT,
  openReignOf,
  PLAYER,
  reignsOf,
  storedTrace,
  TODAY,
  titleEngine,
  titleEvents,
  titleIn,
  titleWorld,
  type TitleWorld,
} from './title-commands-world';
import { testId } from '../../support';

const NEW_TITLE = {
  brandId: null,
  name: '  Test Crown  ',
  holderCount: 1,
  division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
  tier: 'secondary',
  color: '#336699',
} as const;

function setup(): { world: TitleWorld; engine: Engine } {
  const world = titleWorld();
  return { world, engine: titleEngine(world) };
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

/** Issues the command, expects it refused with these codes, nothing written and no event. */
function refused<N extends CommandName>(
  engine: Engine,
  name: N,
  args: CommandArgs<N>,
  issuedBy: Controller = PLAYER,
) {
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

function codes(reasons: readonly { code: string }[]): string[] {
  return reasons.map((reason) => reason.code);
}

describe('titles.create', () => {
  it('creates an active vacant title with its starting prestige, trace and event', () => {
    const { world, engine } = setup();
    const result = ok(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.altura });
    const { titleId } = result.data;
    expect(titleIn(engine, titleId)).toMatchObject({
      promotionId: world.altura,
      brandId: null,
      name: 'Test Crown',
      holderCount: 1,
      // Secondary 35 + (80 - 50) x 0.3 = 44.
      prestige: 44,
      status: 'active',
      introducedOn: TODAY,
      retiredOn: null,
      imageRef: null,
      color: '#336699',
    });
    expect(openReignOf(engine, titleId)).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual(['title.created']);
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      { titleId, promotionId: world.altura, brandId: null, source: 'player' },
    ]);
    const trace = storedTrace(engine, titlePrestigeTraceRef(titleId));
    expect(trace !== null && isFullTrace(trace) && trace.value).toBe(44);
  });

  it('puts the title on an active brand of the promotion', () => {
    const { world, engine } = setup();
    const { titleId } = ok(engine, 'titles.create', {
      ...NEW_TITLE,
      promotionId: world.altura,
      brandId: world.prime,
    }).data;
    expect(titleIn(engine, titleId).brandId).toBe(world.prime);
  });

  it('lets the computer create a title for a computer-run promotion, as the AI', () => {
    const { world, engine } = setup();
    ok(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.bravo }, COMPUTER);
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      expect.objectContaining({ promotionId: world.bravo, source: 'ai' }),
    ]);
  });

  it('allows the same name in another promotion', () => {
    const { world, engine } = setup();
    ok(
      engine,
      'titles.create',
      { ...NEW_TITLE, name: 'Altura Championship', promotionId: world.bravo },
      COMPUTER,
    );
  });

  it('refuses a rival promotion, and the computer on the player’s promotion', () => {
    const { world, engine } = setup();
    expect(
      codes(refused(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.bravo })),
    ).toEqual(['notAllowed']);
    expect(
      codes(
        refused(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.altura }, COMPUTER),
      ),
    ).toEqual(['notAllowed']);
  });

  it('refuses a brand of another promotion and a closed brand', () => {
    const { world, engine } = setup();
    expect(
      refused(engine, 'titles.create', {
        ...NEW_TITLE,
        promotionId: world.altura,
        brandId: world.bravoBrand,
      }),
    ).toEqual([expect.objectContaining({ code: 'brandNotInPromotion', field: 'brandId' })]);
    expect(
      refused(engine, 'titles.create', {
        ...NEW_TITLE,
        promotionId: world.altura,
        brandId: world.closedBrand,
      }),
    ).toEqual([expect.objectContaining({ code: 'brandInactive', field: 'brandId' })]);
  });

  it('refuses an empty name, a long name and a name the promotion already uses', () => {
    const { world, engine } = setup();
    const create = (name: string) =>
      refused(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.altura, name });
    expect(create('   ')).toEqual([expect.objectContaining({ code: 'nameLength', field: 'name' })]);
    expect(create('x'.repeat(61))).toEqual([
      expect.objectContaining({ code: 'nameLength', field: 'name' }),
    ]);
    expect(create(' altura championship ')).toEqual([
      {
        code: 'duplicateName',
        message: 'Altura Pro already has a title called altura championship.',
        field: 'name',
        subject: { kind: 'title', id: world.vacant },
      },
    ]);
  });

  it('refuses a minimum weight above the limit', () => {
    const { world, engine } = setup();
    expect(
      refused(engine, 'titles.create', {
        ...NEW_TITLE,
        promotionId: world.altura,
        division: { gender: 'open', minWeightKg: 100, maxWeightKg: 90 },
      }),
    ).toEqual([expect.objectContaining({ code: 'weightRange', field: 'division.maxWeightKg' })]);
  });
});

describe('titles.edit', () => {
  it('renames, moves brand, changes colour and division without an event', () => {
    const { world, engine } = setup();
    const result = ok(engine, 'titles.edit', {
      titleId: world.television,
      name: ' Altura TV Title ',
      brandId: world.prime,
      color: '#112233',
      division: { gender: 'open', minWeightKg: null, maxWeightKg: 150 },
    });
    expect(result.data).toEqual({ titleId: world.television });
    expect(result.events).toEqual([]);
    expect(titleIn(engine, world.television)).toMatchObject({
      name: 'Altura TV Title',
      brandId: world.prime,
      color: '#112233',
      division: { gender: 'open', minWeightKg: null, maxWeightKg: 150 },
      prestige: 50,
    });
    expect(titleEvents(engine)).toEqual([]);
  });

  it('keeps its own name when only the case changes, and changes holder count while vacant', () => {
    const { world, engine } = setup();
    ok(engine, 'titles.edit', { titleId: world.vacant, name: 'ALTURA CHAMPIONSHIP' });
    ok(engine, 'titles.edit', { titleId: world.vacant, holderCount: 2 });
    expect(titleIn(engine, world.vacant)).toMatchObject({
      name: 'ALTURA CHAMPIONSHIP',
      holderCount: 2,
    });
  });

  it('refuses a holder count change while someone holds it', () => {
    const { world, engine } = setup();
    expect(refused(engine, 'titles.edit', { titleId: world.television, holderCount: 2 })).toEqual([
      {
        code: 'holderCountLocked',
        message: 'Vacate the title before changing how many people hold it.',
        field: 'holderCount',
        subject: { kind: 'title', id: world.television },
      },
    ]);
  });

  it('refuses a division the champion could not hold, with WRK1’s reason re-worded', () => {
    const { world, engine } = setup();
    const reasons = refused(engine, 'titles.edit', {
      titleId: world.television,
      division: { gender: 'female', minWeightKg: null, maxWeightKg: 90 },
    });
    expect(codes(reasons)).toEqual(['divisionGender', 'aboveMaxWeight']);
    expect(reasons.every((reason) => reason.field === 'division')).toBe(true);
    expect(reasons[1]?.message).toMatch(
      /^.+ couldn't hold it any more: too heavy for the Altura Television Title \(limit 90 kg, weighs 100 kg\)\. Vacate it first\.$/,
    );
  });

  it('refuses a duplicate name, a foreign brand and a bad weight range', () => {
    const { world, engine } = setup();
    expect(
      codes(
        refused(engine, 'titles.edit', { titleId: world.vacant, name: 'Altura Television Title' }),
      ),
    ).toEqual(['duplicateName']);
    expect(
      codes(refused(engine, 'titles.edit', { titleId: world.vacant, brandId: world.bravoBrand })),
    ).toEqual(['brandNotInPromotion']);
    expect(
      codes(
        refused(engine, 'titles.edit', {
          titleId: world.vacant,
          division: { gender: 'open', minWeightKg: 120, maxWeightKg: 80 },
        }),
      ),
    ).toEqual(['weightRange']);
  });
});

describe('titles.award', () => {
  it('crowns a champion on a vacant title today', () => {
    const { world, engine } = setup();
    const [, , , , champion] = world.people;
    if (champion === undefined) {
      expect.fail('no wrestler 4');
    }
    const result = ok(engine, 'titles.award', {
      titleId: world.vacant,
      holderIds: [champion],
      teamId: null,
    });
    const reign = openReignOf(engine, world.vacant);
    expect(reign).toMatchObject({
      holderIds: [champion],
      wonOn: TODAY,
      wonInSegmentId: null,
      defences: 0,
    });
    expect(result.data).toEqual({ reignId: reign?.id, previousReignId: null });
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      {
        titleId: world.vacant,
        promotionId: world.altura,
        reignId: reign?.id,
        holderIds: [champion],
        teamId: null,
        previousReignId: null,
        source: 'player',
      },
    ]);
  });

  it('strips the current champion today and starts the new reign today', () => {
    const { world, engine } = setup();
    const before = openReignOf(engine, world.television);
    const newChampion = world.people[4];
    if (before === undefined || newChampion === undefined) {
      expect.fail('setup');
    }
    const { data } = ok(engine, 'titles.award', {
      titleId: world.television,
      holderIds: [newChampion],
      teamId: null,
    });
    expect(data.previousReignId).toBe(before.id);
    const reigns = reignsOf(engine, world.television);
    expect(reigns).toHaveLength(2);
    expect(reigns[0]).toMatchObject({
      id: before.id,
      lostOn: TODAY,
      endReason: 'stripped',
      endedInSegmentId: null,
    });
    expect(reigns[1]).toMatchObject({ id: data.reignId, wonOn: TODAY, lostOn: null });
    expect(titleEvents(engine)).toHaveLength(1);
  });

  it('awards twice in one day and keeps the table invariants', () => {
    const { world, engine } = setup();
    const [, , , , fourth, fifth] = world.people;
    if (fourth === undefined || fifth === undefined) {
      expect.fail('setup');
    }
    ok(engine, 'titles.award', { titleId: world.vacant, holderIds: [fourth], teamId: null });
    ok(engine, 'titles.award', { titleId: world.vacant, holderIds: [fifth], teamId: null });
    const reigns = reignsOf(engine, world.vacant);
    expect(reigns.map((reign) => [reign.wonOn, reign.lostOn, reign.endReason])).toEqual([
      [TODAY, TODAY, 'stripped'],
      [TODAY, null, null],
    ]);
    expect(engineIntegrityCodes(engine)).toEqual([]);
  });

  it('awards a tag title to a team', () => {
    const { world, engine } = setup();
    const [, , third, fourth] = world.people;
    if (third === undefined || fourth === undefined) {
      expect.fail('setup');
    }
    const team = engine.exportState().world.tables.teams[0];
    ok(engine, 'titles.award', {
      titleId: world.tag,
      holderIds: [third, fourth],
      teamId: team?.id ?? null,
    });
    expect(openReignOf(engine, world.tag)?.teamId).toBe(team?.id);
  });

  it('refuses every eligibility reason with the field at fault', () => {
    const { world, engine } = setup();
    const [first, , third] = world.people;
    const [bravoWrestler] = world.bravoPeople;
    if (first === undefined || third === undefined || bravoWrestler === undefined) {
      expect.fail('setup');
    }
    const team = engine.exportState().world.tables.teams[0];
    const reasons = refused(engine, 'titles.award', {
      titleId: world.tag,
      holderIds: [bravoWrestler, first, first],
      teamId: team?.id ?? null,
    });
    expect(reasons.map((reason) => [reason.code, reason.field])).toEqual([
      ['wrongHolderCount', 'holderIds'],
      ['notOnRoster', 'holderIds[0]'],
      ['duplicateHolder', 'holderIds[2]'],
      ['teamMismatch', 'teamId'],
    ]);
  });

  it('refuses the current champions', () => {
    const { world, engine } = setup();
    const [first] = world.people;
    if (first === undefined) {
      expect.fail('setup');
    }
    expect(
      refused(engine, 'titles.award', {
        titleId: world.television,
        holderIds: [first],
        teamId: null,
      }),
    ).toEqual([expect.objectContaining({ code: 'alreadyChampion', field: 'holderIds' })]);
  });

  it('refuses a rival’s title and the computer on the player’s title', () => {
    const { world, engine } = setup();
    const [first] = world.people;
    const [, bravoSecond] = world.bravoPeople;
    if (first === undefined || bravoSecond === undefined) {
      expect.fail('setup');
    }
    expect(
      refused(engine, 'titles.award', {
        titleId: world.bravoTitle,
        holderIds: [bravoSecond],
        teamId: null,
      }),
    ).toEqual([
      {
        code: 'notAllowed',
        message:
          'The Bravo Championship belongs to Bravo Wrestling. You can only change your own titles.',
        subject: { kind: 'title', id: world.bravoTitle },
      },
    ]);
    expect(
      codes(
        refused(
          engine,
          'titles.award',
          { titleId: world.vacant, holderIds: [first], teamId: null },
          COMPUTER,
        ),
      ),
    ).toEqual(['notAllowed']);
  });
});

describe('titles.vacate', () => {
  it('ends the reign vacated today with the booker’s Why? and one event', () => {
    const { world, engine } = setup();
    const reign = openReignOf(engine, world.television);
    if (reign === undefined) {
      expect.fail('setup');
    }
    const result = ok(engine, 'titles.vacate', { titleId: world.television });
    expect(result.data).toEqual({ reignId: reign.id });
    expect(reignsOf(engine, world.television)[0]).toMatchObject({
      lostOn: TODAY,
      endReason: 'vacated',
    });
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      {
        titleId: world.television,
        promotionId: world.altura,
        reignId: reign.id,
        holderIds: reign.holderIds,
        reasonKey: 'booker',
        source: 'player',
      },
    ]);
    const trace = storedTrace(engine, titleVacancyTraceRef(reign.id));
    if (trace === null || !isFullTrace(trace)) {
      expect.fail('no vacancy trace');
    }
    expect(trace.trace).toMatchObject({
      kind: 'decision',
      label: 'How the reign ended',
      chosen: 'vacated',
      reason: 'Vacated by the booker',
    });
  });

  it('lets the computer vacate its own title as the AI', () => {
    const { world, engine } = setup();
    ok(engine, 'titles.vacate', { titleId: world.bravoTitle }, COMPUTER);
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      expect.objectContaining({ reasonKey: 'booker', source: 'ai' }),
    ]);
  });

  it('refuses a vacant title, a missing title and a retired title', () => {
    const { world, engine } = setup();
    expect(refused(engine, 'titles.vacate', { titleId: world.vacant })).toEqual([
      {
        code: 'alreadyVacant',
        message: 'The Altura Championship is already vacant.',
        subject: { kind: 'title', id: world.vacant },
      },
    ]);
    expect(codes(refused(engine, 'titles.vacate', { titleId: testId('title', 9999) }))).toEqual([
      'titleNotFound',
    ]);
    expect(refused(engine, 'titles.vacate', { titleId: world.legends })).toEqual([
      {
        code: 'titleRetired',
        message: 'The Altura Legends Title is retired. Reactivate it first.',
        subject: { kind: 'title', id: world.legends },
      },
    ]);
  });
});

describe('titles.retire and titles.reactivate', () => {
  it('retires a held title: the reign ends retired, the lineage and introducedOn stay', () => {
    const { world, engine } = setup();
    const reign = openReignOf(engine, world.television);
    const introducedOn = titleIn(engine, world.television).introducedOn;
    const result = ok(engine, 'titles.retire', { titleId: world.television });
    expect(result.data).toEqual({ endedReignId: reign?.id });
    expect(titleIn(engine, world.television)).toMatchObject({
      status: 'retired',
      retiredOn: TODAY,
      introducedOn,
    });
    expect(reignsOf(engine, world.television)).toEqual([
      expect.objectContaining({ id: reign?.id, lostOn: TODAY, endReason: 'retired' }),
    ]);
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      {
        titleId: world.television,
        promotionId: world.altura,
        endedReignId: reign?.id,
        source: 'player',
      },
    ]);
  });

  it('retires a vacant title with no reign to end', () => {
    const { world, engine } = setup();
    expect(ok(engine, 'titles.retire', { titleId: world.vacant }).data).toEqual({
      endedReignId: null,
    });
  });

  it('reactivates a retired title vacant, with its lineage intact', () => {
    const { world, engine } = setup();
    ok(engine, 'titles.retire', { titleId: world.television });
    const lineage = reignsOf(engine, world.television);
    const result = ok(engine, 'titles.reactivate', { titleId: world.television });
    expect(result.data).toEqual({ titleId: world.television });
    expect(titleIn(engine, world.television)).toMatchObject({ status: 'active', retiredOn: null });
    expect(openReignOf(engine, world.television)).toBeUndefined();
    expect(reignsOf(engine, world.television)).toEqual(lineage);
    expect(titleEvents(engine).map((event) => event.type)).toEqual([
      'title.retired',
      'title.reactivated',
    ]);
    expect(titleEvents(engine)[1]?.payload).toEqual({
      titleId: world.television,
      promotionId: world.altura,
      source: 'player',
    });
  });

  it('refuses retiring a retired title and reactivating an active one', () => {
    const { world, engine } = setup();
    expect(codes(refused(engine, 'titles.retire', { titleId: world.legends }))).toEqual([
      'titleRetired',
    ]);
    expect(refused(engine, 'titles.reactivate', { titleId: world.vacant })).toEqual([
      {
        code: 'notRetired',
        message: "The Altura Championship isn't retired.",
        subject: { kind: 'title', id: world.vacant },
      },
    ]);
    expect(codes(refused(engine, 'titles.reactivate', { titleId: world.bravoTitle }))).toEqual([
      'notAllowed',
    ]);
  });
});

describe('the title commands together', () => {
  it('log every call with its controller and keep the world sound', () => {
    const { world, engine } = setup();
    const champion = world.people[5];
    if (champion === undefined) {
      expect.fail('setup');
    }
    ok(engine, 'titles.create', { ...NEW_TITLE, promotionId: world.altura });
    ok(engine, 'titles.edit', { titleId: world.vacant, color: '#000000' });
    ok(engine, 'titles.award', { titleId: world.vacant, holderIds: [champion], teamId: null });
    ok(engine, 'titles.vacate', { titleId: world.vacant });
    ok(engine, 'titles.retire', { titleId: world.vacant });
    ok(engine, 'titles.reactivate', { titleId: world.vacant });
    ok(engine, 'titles.vacate', { titleId: world.bravoTitle }, COMPUTER);
    engine.command('titles.vacate', { titleId: world.vacant }, PLAYER);

    const log = engine.query('sim.commandLog', { limit: 20 }, OMNISCIENT);
    if (!log.ok) {
      expect.fail(JSON.stringify(log.reasons));
    }
    expect(log.data.map((entry) => [entry.name, entry.issuedBy, entry.outcome])).toEqual([
      ['titles.create', PLAYER, 'applied'],
      ['titles.edit', PLAYER, 'applied'],
      ['titles.award', PLAYER, 'applied'],
      ['titles.vacate', PLAYER, 'applied'],
      ['titles.retire', PLAYER, 'applied'],
      ['titles.reactivate', PLAYER, 'applied'],
      ['titles.vacate', COMPUTER, 'applied'],
      ['titles.vacate', PLAYER, 'rejected'],
    ]);
    expect(engineIntegrityCodes(engine)).toEqual([]);
  });

  it('list every refusal code they use', () => {
    expect([...TITLE_COMMAND_REASON_CODES].sort()).toEqual(
      [
        'alreadyChampion',
        'alreadyVacant',
        'brandInactive',
        'brandNotInPromotion',
        'duplicateName',
        'holderCountLocked',
        'nameLength',
        'notRetired',
        'promotionNotFound',
        'titleNotFound',
        'titleRetired',
        'weightRange',
      ].sort(),
    );
  });
});
