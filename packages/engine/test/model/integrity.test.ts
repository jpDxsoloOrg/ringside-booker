import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseId, type PromotionId, type RegionId } from '../../src/core/ids';
import { checkWorld, MAX_INTEGRITY_ISSUES } from '../../src/model/integrity';
import { zId } from '../../src/model/primitives';
import { defineTable } from '../../src/model/table-def';
import { createWorld } from '../../src/model/world';
import { stubTable } from '../support/stub-tables';
import {
  makeOwner,
  makeWidget,
  ownerId,
  regionId,
  TOY_REGISTRY,
  toyMeta,
  validToyWorld,
  widgetId,
  type Widget,
} from '../support/toy-registry';

/** Lets a test store a row the type system would refuse, as a corrupt save could. */
function corruptWidget(value: unknown): Widget {
  return z.custom<Widget>(() => true).parse(value);
}

describe('checkWorld on a valid world', () => {
  it('returns ok with no issues', () => {
    const report = checkWorld(validToyWorld(), TOY_REGISTRY, { validateRows: true });
    expect(report).toEqual({ ok: true, issues: [], truncated: 0 });
  });

  it('accepts an empty world', () => {
    const world = createWorld(TOY_REGISTRY, toyMeta());
    expect(checkWorld(world, TOY_REGISTRY).ok).toBe(true);
  });
});

describe('references', () => {
  const missingOwner = ownerId(99);

  it('reports a dangling scalar reference with its exact path', () => {
    const world = validToyWorld();
    world.tables.widgets._put(makeWidget(4, missingOwner));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'widgets',
        id: widgetId(4),
        path: 'ownerId',
        target: 'promotion',
        missingId: missingOwner,
      }),
    ]);
  });

  it('reports a dangling array reference with the element index', () => {
    const world = validToyWorld();
    world.tables.widgets._put(makeWidget(4, ownerId(1), { tagIds: [ownerId(2), missingOwner] }));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        id: widgetId(4),
        path: 'tagIds[1]',
        missingId: missingOwner,
      }),
    ]);
  });

  it('reports a dangling record-key reference with the key in the path', () => {
    const world = validToyWorld();
    world.tables.widgets._put(
      makeWidget(4, ownerId(1), { scores: { [ownerId(1)]: 3, [missingOwner]: 2 } }),
    );
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        id: widgetId(4),
        path: `scores{${missingOwner}}`,
        missingId: missingOwner,
      }),
    ]);
  });

  it('reports an ID of the wrong kind in a reference field as dangling', () => {
    const world = validToyWorld();
    const notAnOwner = parseId('employment', 'emp_0000000001');
    world.tables.widgets._put(makeWidget(4, ownerId(1), { scores: { [notAnOwner]: 1 } }));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: `scores{${notAnOwner}}` }),
    ]);
  });

  it('reports a value of the wrong shape even when it names an existing row', () => {
    const world = validToyWorld();
    const scalarTags: unknown = { ...makeWidget(4, ownerId(1)), tagIds: ownerId(2) };
    world.tables.widgets._put(corruptWidget(scalarTags));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'ref.invalidValue', id: widgetId(4), path: 'tagIds' }),
    ]);
  });

  it('allows null in a nullable reference and reports it in a non-nullable one', () => {
    const world = validToyWorld();
    world.tables.owners._put(makeOwner(3, { homeRegionId: null }));
    expect(checkWorld(world, TOY_REGISTRY).ok).toBe(true);

    const brokenWidget: unknown = { ...makeWidget(4, ownerId(1)), ownerId: null };
    world.tables.widgets._put(corruptWidget(brokenWidget));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'ref.null', id: widgetId(4), path: 'ownerId' }),
    ]);
  });

  it('reports a human controller whose playerId is not in meta.players', () => {
    const world = validToyWorld();
    world.tables.owners._put(
      makeOwner(3, { controller: { type: 'human', playerId: 'player-unknown' } }),
    );
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.unknownPlayer',
        table: 'owners',
        id: ownerId(3),
        path: 'controller.playerId',
        target: 'player',
        missingId: 'player-unknown',
      }),
    ]);
  });

  it('reports every human controller once the player list is emptied', () => {
    const world = validToyWorld();
    world.meta = { ...world.meta, players: [] };
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues.map((issue) => issue.code)).toEqual(['ref.unknownPlayer']);
  });
});

describe('IDs and keys', () => {
  it('reports a row stored under a key that is not its own ID', () => {
    const world = validToyWorld();
    world.tables.widgets._putAt(widgetId(7), makeWidget(8, ownerId(1)));
    const report = checkWorld(world, TOY_REGISTRY, { only: ['ids'] });
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'id.keyMismatch', table: 'widgets', id: widgetId(7) }),
    ]);
  });

  it('reports an emp_ ID in the widgets table', () => {
    const world = validToyWorld();
    const employmentId = parseId('employment', 'emp_0000000001');
    const misfiled: unknown = { ...makeWidget(4, ownerId(2)), id: employmentId };
    world.tables.widgets._put(corruptWidget(misfiled));
    const report = checkWorld(world, TOY_REGISTRY, { only: ['ids'] });
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'id.wrongKind', table: 'widgets', id: employmentId }),
    ]);
  });
});

describe('invariants', () => {
  it('fires when an owner has more than three widgets', () => {
    const world = validToyWorld();
    world.tables.widgets._put(makeWidget(4, ownerId(1)));
    world.tables.widgets._put(makeWidget(5, ownerId(1)));
    const report = checkWorld(world, TOY_REGISTRY);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'widgets.tooManyPerOwner', id: ownerId(1) }),
    ]);
  });

  it('turns a throwing invariant into an issue instead of throwing', () => {
    const exploding = {
      ...stubTable('venue', 'venues'),
      invariants: [
        {
          name: 'explodes',
          check(): never {
            throw new Error('boom');
          },
        },
      ],
    };
    const registry = { venues: exploding };
    const world = createWorld(registry, toyMeta());
    const report = checkWorld(world, registry);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'invariant.threw', table: 'venues' }),
    ]);
    expect(report.issues[0]?.message).toContain('boom');
  });
});

describe('row validation', () => {
  it('is off by default and reports schema failures when asked for', () => {
    const world = validToyWorld();
    const badSerial: unknown = { ...makeWidget(4, ownerId(1)), serial: '' };
    world.tables.widgets._put(corruptWidget(badSerial));
    expect(checkWorld(world, TOY_REGISTRY).ok).toBe(true);
    const report = checkWorld(world, TOY_REGISTRY, { validateRows: true });
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'row.invalid', id: widgetId(4), path: 'serial' }),
    ]);
    const onlyRows = checkWorld(world, TOY_REGISTRY, { only: ['rows'] });
    expect(onlyRows.issues.map((issue) => issue.code)).toEqual(['row.invalid']);
  });
});

describe('subsets and the issue cap', () => {
  it('runs only the requested checks', () => {
    const world = validToyWorld();
    world.tables.widgets._put(makeWidget(4, ownerId(99)));
    world.tables.widgets._put(makeWidget(5, ownerId(1)));
    world.tables.widgets._put(makeWidget(6, ownerId(1)));
    expect(checkWorld(world, TOY_REGISTRY, { only: ['refs'] }).issues.map((i) => i.code)).toEqual([
      'ref.dangling',
    ]);
    expect(
      checkWorld(world, TOY_REGISTRY, { only: ['invariants'] }).issues.map((i) => i.code),
    ).toEqual(['widgets.tooManyPerOwner']);
    expect(checkWorld(world, TOY_REGISTRY, { only: ['ids'] }).ok).toBe(true);
  });

  it('caps the report at 200 issues and counts the rest as truncated', () => {
    const world = createWorld(TOY_REGISTRY, toyMeta());
    world.tables.owners._put(makeOwner(1));
    for (let serial = 1; serial <= 250; serial += 1) {
      world.tables.widgets._put(
        makeWidget(serial, ownerId(1), { tagIds: [ownerId(1000 + serial)] }),
      );
    }
    const report = checkWorld(world, TOY_REGISTRY, { only: ['refs'] });
    expect(MAX_INTEGRITY_ISSUES).toBe(200);
    expect(report.issues).toHaveLength(200);
    expect(report.truncated).toBe(50);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ id: widgetId(1), path: 'tagIds[0]' });
  });
});

describe('stub tables', () => {
  const VenueSchema = z.strictObject({ id: zId('venue'), regionId: zId('region') });
  const venuesTable = defineTable({
    kind: 'venue',
    name: 'venues',
    schema: VenueSchema,
    refs: [{ path: 'regionId', target: 'region', nullable: false }],
    indexes: [],
  });
  const venueId = parseId('venue', 'ven_0000000001');
  const missingRegion: RegionId = regionId(5);

  it('give a reference a table to resolve against, so a missing row is dangling', () => {
    const registry = { venues: venuesTable, regions: stubTable('region', 'regions') };
    const world = createWorld(registry, toyMeta());
    world.tables.regions._put({ id: regionId(1) });
    world.tables.venues._put({ id: venueId, regionId: missingRegion });
    const report = checkWorld(world, registry, { validateRows: true });
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.dangling',
        table: 'venues',
        id: venueId,
        path: 'regionId',
        missingId: missingRegion,
      }),
    ]);
  });

  it('without the stub, the reference is reported once as targetUnregistered', () => {
    const registry = { venues: venuesTable };
    const world = createWorld(registry, toyMeta());
    world.tables.venues._put({ id: venueId, regionId: missingRegion });
    world.tables.venues._put({ id: parseId('venue', 'ven_0000000002'), regionId: regionId(6) });
    const report = checkWorld(world, registry);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'ref.targetUnregistered',
        table: 'venues',
        path: 'regionId',
        target: 'region',
      }),
    ]);
  });
});

describe('determinism', () => {
  it('produces the same report whatever order rows were inserted in', () => {
    const forwards = createWorld(TOY_REGISTRY, toyMeta());
    const backwards = createWorld(TOY_REGISTRY, toyMeta());
    const serials = [1, 2, 3, 4, 5];
    const ownerOf = (serial: number): PromotionId => ownerId(serial % 2 === 0 ? 1 : 9);
    forwards.tables.owners._put(makeOwner(1));
    backwards.tables.owners._put(makeOwner(1));
    for (const serial of serials) {
      forwards.tables.widgets._put(makeWidget(serial, ownerOf(serial)));
    }
    for (const serial of [...serials].reverse()) {
      backwards.tables.widgets._put(makeWidget(serial, ownerOf(serial)));
    }
    const report = checkWorld(forwards, TOY_REGISTRY);
    expect(checkWorld(backwards, TOY_REGISTRY)).toEqual(report);
    expect(report.issues.map((issue) => issue.id)).toEqual([widgetId(1), widgetId(3), widgetId(5)]);
  });
});
