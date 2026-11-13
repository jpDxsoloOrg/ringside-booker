// Rival desk profiles, the new-game step and the decision log (AIP1-01).
// Design: docs/design/rival-desk.md#profiles and #decision-log
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import { AppendOnlyError, UniqueIndexError } from '../../../src/core/errors';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import {
  AIP_CREATE_PROFILES_STEP,
  computerUnits,
  ensureProfile,
  profileOf,
  pruneDecisionLog,
} from '../../../src/systems/aip';
import { setupSteps } from '../../../src/systems/newgame';
import { anAiProfile } from '../../support/builders/promotions';
import { TINY_WORLD_SHOW_DATE, TINY_WORLD_TODAY, tinyWorld } from '../../support/worlds';
import { startDefaultGame } from '../calendar/default-game';

const BEFORE_RIVAL_DESK = new URL(
  '../../fixtures/saves/v1-tiny-before-rival-desk.json',
  import.meta.url,
);

function promotionB(ids: ReturnType<typeof tinyWorld>['ids']) {
  const id = ids.promotions.B;
  if (id === undefined) {
    throw new Error('no promotion B');
  }
  return id;
}

describe('ensureProfile', () => {
  it('creates a blank profile once and returns the same row after that', () => {
    const { world, ids } = tinyWorld();
    const proB = promotionB(ids);
    world.transact('clear', (tx) => {
      for (const profile of [...tx.view.tables.aiProfiles.values()]) {
        tx.delete('aiProfiles', profile.id);
      }
    });
    expect(profileOf(world, proB, null)).toBeNull();

    const result = world.transact('ensure', (tx) => {
      const first = ensureProfile(
        tx,
        tx.view,
        { promotionId: proB, brandId: null },
        TINY_WORLD_TODAY,
      );
      const second = ensureProfile(
        tx,
        tx.view,
        { promotionId: proB, brandId: null },
        addDays(TINY_WORLD_TODAY, 1),
      );
      return [first, second];
    });
    if (!result.ok) {
      throw result.error;
    }
    const [first, second] = result.value;
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      promotionId: proB,
      brandId: null,
      taste: null,
      featured: null,
      createdOn: TINY_WORLD_TODAY,
      lastTurnOn: null,
    });
    expect(world.tables.aiProfiles.size).toBe(1);
    expect(profileOf(world, proB, null)).toEqual(first);
  });

  it('the byUnit index refuses a second profile for the same unit', () => {
    const { world, ids } = tinyWorld();
    const result = world.transact('duplicate', (tx) => {
      tx.insert(
        'aiProfiles',
        anAiProfile({ id: tx.mintId('aiProfiles'), promotionId: promotionB(ids) }),
      );
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(UniqueIndexError);
    }
  });
});

describe('aiProfiles invariants', () => {
  it('reports a brand of another promotion and a featured worker outside the unit', () => {
    const { world, ids } = tinyWorld();
    const proB = promotionB(ids);
    const brandOfA = ids.brands[0];
    const employmentOfA = ids.employments[0];
    const profileId = ids.aiProfiles[0];
    if (brandOfA === undefined || employmentOfA === undefined || profileId === undefined) {
      throw new Error('tiny world is missing rows');
    }
    world.tables.aiProfiles._put(
      anAiProfile({
        id: profileId,
        promotionId: proB,
        brandId: brandOfA,
        featured: {
          ace: { employmentId: employmentOfA, since: TINY_WORLD_TODAY },
          prospects: [],
          nextReviewOn: TINY_WORLD_TODAY,
          lastReviewedOn: TINY_WORLD_TODAY,
        },
      }),
    );
    const report = checkWorld(world, TABLES, { only: ['invariants'] });
    expect(
      report.issues
        .filter((issue) => issue.table === 'aiProfiles')
        .map((issue) => [issue.code, issue.path]),
    ).toEqual([
      ['aiProfiles.brandOfOtherPromotion', 'brandId'],
      ['aiProfiles.featuredOutsideUnit', 'featured.ace.employmentId'],
    ]);
  });
});

describe('the decision log', () => {
  it('refuses an edit with AppendOnlyError and allows a delete', () => {
    const { world, ids } = tinyWorld();
    const [revealed] = ids.aiDecisions;
    if (revealed === undefined) {
      throw new Error('no decision');
    }
    const edited = world.transact('edit', (tx) => {
      tx.update('aiDecisions', revealed, { importance: 3 });
    });
    expect(edited.ok).toBe(false);
    if (!edited.ok) {
      expect(edited.error).toBeInstanceOf(AppendOnlyError);
    }
    const deleted = world.transact('prune', (tx) => {
      tx.delete('aiDecisions', revealed);
    });
    expect(deleted.ok).toBe(true);
    expect(world.tables.aiDecisions.get(revealed)).toBeUndefined();
  });

  it('prunes revealed rows past the retention period and keeps plans that have not aired', () => {
    const { world, ids } = tinyWorld();
    const [revealed, hidden] = ids.aiDecisions;
    const prune = (today: typeof TINY_WORLD_TODAY, days: number): number => {
      const result = world.transact('prune', (tx) => pruneDecisionLog(tx, today, days));
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    };
    expect(prune(TINY_WORLD_TODAY, 365)).toBe(0);
    // Two days of retention keep yesterday's decision; one day keeps only today's.
    expect(prune(TINY_WORLD_TODAY, 2)).toBe(0);
    expect(prune(TINY_WORLD_TODAY, 1)).toBe(1);
    expect(world.tables.aiDecisions.ids()).toEqual([hidden]);
    expect(revealed).toBeDefined();
    // 0 keeps none of the past, but the hidden plan stays until it airs.
    expect(prune(TINY_WORLD_TODAY, 0)).toBe(0);
    expect(prune(addDays(TINY_WORLD_SHOW_DATE, 7), 0)).toBe(1);
    expect(world.tables.aiDecisions.size).toBe(0);
  });
});

describe('aip.createProfiles', () => {
  it('runs at order 895, after the controllers are assigned', () => {
    const steps = setupSteps();
    expect(steps).toContainEqual({ id: 'aip.createProfiles', order: 895 });
    const order = (id: string) => steps.findIndex((step) => step.id === id);
    expect(order(AIP_CREATE_PROFILES_STEP.id)).toBeGreaterThan(order('wld.assignControllers'));
  });

  it('gives the 11 rivals of a Longleaf game a profile each and Longleaf none', () => {
    const state = startDefaultGame({
      player: { mode: 'existing', promotionKey: 'pro-us-southeast' },
    });
    const { promotions, aiProfiles } = state.world.tables;
    const longleaf = promotions.find((row) => row.name === 'Longleaf Championship Wrestling');
    expect(longleaf?.controller.kind).toBe('human');
    expect(aiProfiles).toHaveLength(11);
    expect(aiProfiles.some((profile) => profile.promotionId === longleaf?.id)).toBe(false);
    const computerIds = promotions
      .filter((row) => row.controller.kind === 'computer')
      .map((row) => row.id)
      .sort();
    expect(aiProfiles.map((profile) => profile.promotionId).sort()).toEqual(computerIds);
    for (const profile of aiProfiles) {
      expect(profile).toMatchObject({
        brandId: null,
        taste: null,
        featured: null,
        createdOn: state.world.meta.startDate,
        lastTurnOn: null,
      });
    }
  });
});

describe('saves written before the rival desk', () => {
  it('load with empty aiProfiles and aiDecisions', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_RIVAL_DESK)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.aiProfiles).toEqual([]);
    expect(report.doc.state.world.tables.aiDecisions).toEqual([]);
  });
});

describe('the tiny world', () => {
  it('has one computer unit, promotion B, and its profile', () => {
    const { world, ids } = tinyWorld();
    expect(computerUnits(world).map((unit) => unit.promotionId)).toEqual([promotionB(ids)]);
    expect(profileOf(world, promotionB(ids), null)?.id).toBe(ids.aiProfiles[0]);
  });
});
