/**
 * A small registry for testing the World store without real game data.
 *
 * - `owners` (promotion IDs, `pro_`): a name, a controller (a human player or the computer) and an
 *   optional home region.
 * - `widgets` (title IDs, `tit_`): a unique `serial`, an `ownerId`, `tagIds[]` naming owners who
 *   tagged it, and sparse `scores{}` keyed by owner ID. At most three widgets per owner.
 * - `regions`: a stub table, so the owners' region reference has something to point at.
 *
 * Toy tables reuse real entity kinds because IDs are branded per kind; the store does not care
 * what the rows mean.
 */

import { z } from 'zod';
import { parseGameDate } from '../../src/core/date';
import { parseId, type PromotionId, type RegionId, type TitleId } from '../../src/core/ids';
import { zId } from '../../src/model/primitives';
import { PLAYER_REF_TARGET, defineTable } from '../../src/model/table-def';
import type { IntegrityIssue } from '../../src/model/integrity';
import { createWorld, tableOf, type World } from '../../src/model/world';
import type { WorldMeta } from '../../src/model/world-meta';
import { stubTable } from './stub-tables';

export const MAX_WIDGETS_PER_OWNER = 3;

const OwnerSchema = z.strictObject({
  id: zId('promotion'),
  name: z.string().min(1),
  controller: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('human'), playerId: z.string().min(1) }),
    z.strictObject({ type: z.literal('computer') }),
  ]),
  homeRegionId: zId('region').nullable(),
});

export type Owner = z.infer<typeof OwnerSchema>;

export const ownersTable = defineTable({
  kind: 'promotion',
  name: 'owners',
  schema: OwnerSchema,
  refs: [
    { path: 'controller.playerId', target: PLAYER_REF_TARGET, nullable: false },
    { path: 'homeRegionId', target: 'region', nullable: true },
  ],
  indexes: [],
});

const WidgetSchema = z.strictObject({
  id: zId('title'),
  serial: z.string().min(1),
  ownerId: zId('promotion'),
  tagIds: z.array(zId('promotion')),
  scores: z.record(z.string(), z.number()),
});

export type Widget = z.infer<typeof WidgetSchema>;

export const widgetsTable = defineTable({
  kind: 'title',
  name: 'widgets',
  schema: WidgetSchema,
  refs: [
    { path: 'ownerId', target: 'promotion', nullable: false },
    { path: 'tagIds[]', target: 'promotion', nullable: false },
    { path: 'scores{}', target: 'promotion', nullable: false },
  ],
  indexes: [
    { name: 'bySerial', key: (widget) => widget.serial, unique: true },
    { name: 'byOwner', key: (widget) => widget.ownerId },
    {
      name: 'byTaggedOwner',
      key: (widget) => (widget.tagIds.length === 0 ? null : widget.tagIds),
    },
  ],
  invariants: [
    {
      name: 'atMostThreeWidgetsPerOwner',
      check(view): IntegrityIssue[] {
        const countByOwner = new Map<string, number>();
        for (const widget of tableOf(view, widgetsTable).values()) {
          countByOwner.set(widget.ownerId, (countByOwner.get(widget.ownerId) ?? 0) + 1);
        }
        const issues: IntegrityIssue[] = [];
        for (const [ownerId, count] of countByOwner) {
          if (count > MAX_WIDGETS_PER_OWNER) {
            issues.push({
              code: 'widgets.tooManyPerOwner',
              table: 'widgets',
              id: ownerId,
              message: `Owner ${ownerId} has ${String(count)} widgets (max ${String(MAX_WIDGETS_PER_OWNER)})`,
            });
          }
        }
        return issues;
      },
    },
  ],
});

export const regionsTable = stubTable('region', 'regions');

export const TOY_REGISTRY = {
  owners: ownersTable,
  widgets: widgetsTable,
  regions: regionsTable,
} as const;

export type ToyRegistry = typeof TOY_REGISTRY;

function body(serial: number): string {
  return String(serial).padStart(10, '0');
}

export function ownerId(serial: number): PromotionId {
  return parseId('promotion', `pro_${body(serial)}`);
}

export function widgetId(serial: number): TitleId {
  return parseId('title', `tit_${body(serial)}`);
}

export function regionId(serial: number): RegionId {
  return parseId('region', `reg_${body(serial)}`);
}

export const TOY_PLAYER_ID = 'player-1';

/** Valid metadata with one human player. */
export function toyMeta(overrides: Partial<WorldMeta> = {}): WorldMeta {
  return {
    worldName: 'Toy World',
    startDate: parseGameDate('2026-01-01'),
    currentDate: parseGameDate('2026-01-01'),
    seed: 'toy-seed',
    settings: {
      agingEnabled: true,
      sandbox: false,
      generationLevel: 'medium',
      levelPlayingField: false,
      season: { lengthDays: 91 },
      extra: {},
    },
    players: [{ playerId: TOY_PLAYER_ID, displayName: 'Player One' }],
    contentPacks: [],
    contentKeys: {},
    daysSimulated: 0,
    ...overrides,
  };
}

export function makeOwner(serial: number, overrides: Partial<Owner> = {}): Owner {
  return {
    id: ownerId(serial),
    name: `Owner ${String(serial)}`,
    controller: { type: 'computer' },
    homeRegionId: null,
    ...overrides,
  };
}

export function makeWidget(
  serial: number,
  owner: PromotionId,
  overrides: Partial<Widget> = {},
): Widget {
  return {
    id: widgetId(serial),
    serial: `W-${String(serial)}`,
    ownerId: owner,
    tagIds: [],
    scores: {},
    ...overrides,
  };
}

export function emptyToyWorld(): World<ToyRegistry> {
  return createWorld(TOY_REGISTRY, toyMeta());
}

/**
 * A valid world: one region, two owners (one human, one computer) and three widgets that use every
 * reference form.
 */
export function validToyWorld(): World<ToyRegistry> {
  const world = emptyToyWorld();
  world.tables.regions._put({ id: regionId(1) });
  world.tables.owners._put(
    makeOwner(1, {
      controller: { type: 'human', playerId: TOY_PLAYER_ID },
      homeRegionId: regionId(1),
    }),
  );
  world.tables.owners._put(makeOwner(2));
  world.tables.widgets._put(makeWidget(1, ownerId(1), { tagIds: [ownerId(2)] }));
  world.tables.widgets._put(
    makeWidget(2, ownerId(1), {
      tagIds: [ownerId(1), ownerId(2)],
      scores: { [ownerId(2)]: 4.5 },
    }),
  );
  world.tables.widgets._put(makeWidget(3, ownerId(2)));
  return world;
}
