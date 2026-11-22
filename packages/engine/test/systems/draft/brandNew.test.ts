// DRF-13 draft start: every promotion starts as a brand-new company with no frills. Staff
// policies at tier 0, only the booker on staff (unless staff are drafted), one brand, no held
// venues or partner links, the setup preview says so, and a game without a draft is unchanged.
// Design: docs/design/draft.md#brand-new-companies
import { describe, expect, it } from 'vitest';
import { createEngine, type EngineState } from '../../../src/core/api';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { DRAFT_STAFF_ROLES } from '../../../src/systems/draft/candidates';
import { EQUALISED } from '../../../src/systems/draft/level';
import { previewSetup } from '../../../src/systems/draft/setupPreview';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../support/systems';
import { DEFAULT_PACKS, FLAGSHIP, PLAYER, run, startDraftGame, worldOf } from './draft-game';

const STAFF = new Set<string>(DRAFT_STAFF_ROLES);

function activeIds(state: EngineState): Set<string> {
  return new Set(
    state.world.tables.promotions.filter((row) => row.status === 'active').map((row) => row.id),
  );
}

function liveStaff(state: EngineState, promotions: ReadonlySet<string>) {
  return state.world.tables.employments.filter(
    (row) =>
      promotions.has(row.promotionId) &&
      (row.status === 'active' || row.status === 'signed' || row.status === 'offered') &&
      STAFF.has(row.role),
  );
}

describe('a draft start makes every promotion brand new', () => {
  const plain = startDraftGame({ settings: { draftStart: false } });
  const state = startDraftGame();
  const active = activeIds(state);

  it('puts catering, travel and medical at tier 0', () => {
    for (const promotion of state.world.tables.promotions.filter((row) => active.has(row.id))) {
      expect(promotion.policies, promotion.name).toEqual({ catering: 0, travel: 0, medical: 0 });
    }
  });

  it('keeps only the booker on staff: the rest are free agents to hire after the draft', () => {
    const before = liveStaff(plain, activeIds(plain));
    expect(before.length).toBeGreaterThan(0);
    expect(liveStaff(state, active)).toEqual([]);
    for (const row of before) {
      expect(state.world.tables.people.some((person) => person.id === row.personId)).toBe(true);
    }
    for (const promotion of state.world.tables.promotions.filter((row) => active.has(row.id))) {
      const bookers = plain.world.tables.employments.filter(
        (row) => row.promotionId === promotion.id && row.role === 'booker',
      );
      for (const booker of bookers) {
        expect(state.world.tables.employments.some((row) => row.id === booker.id)).toBe(true);
      }
    }
    // Nothing points at the removed contracts.
    const integrity = checkWorld(worldOf(state), TABLES);
    expect(integrity.issues.filter((issue) => issue.severity !== 'warning')).toEqual([]);
  });

  it('leaves staff to the draft when staff are drafted too', () => {
    const drafted = startDraftGame({ settings: { draftStaff: true } });
    expect(liveStaff(drafted, activeIds(drafted))).toEqual([]);
    expect(drafted.world.tables.drafts[0]!.poolLeft.staff).toBeGreaterThan(0);
  });

  it('keeps one brand each: the weekly show runs on it, the rest are retired', () => {
    const withBrands = plain.world.tables.brands.filter(
      (brand) => brand.active && active.has(brand.promotionId),
    );
    expect(withBrands.length).toBeGreaterThan(1);
    for (const promotionId of active) {
      const brands = state.world.tables.brands.filter((row) => row.promotionId === promotionId);
      const kept = brands.filter((row) => row.active);
      expect(kept.length, promotionId).toBe(brands.length === 0 ? 0 : 1);
      const retired = new Set<string>(brands.filter((row) => !row.active).map((row) => row.id));
      const onRetired = (brandId: string | null): boolean =>
        brandId !== null && retired.has(brandId);
      expect(
        state.world.tables.employments.some(
          (row) => row.promotionId === promotionId && onRetired(row.brandId),
        ),
      ).toBe(false);
      expect(
        state.world.tables.eventDefinitions.some(
          (row) =>
            row.promotionId === promotionId && row.activeUntil === null && onRetired(row.brandId),
        ),
      ).toBe(false);
      expect(
        state.world.tables.eventInstances.some(
          (row) =>
            row.promotionId === promotionId && row.status === 'scheduled' && onRetired(row.brandId),
        ),
      ).toBe(false);
      expect(
        state.world.tables.titles.some(
          (row) =>
            row.promotionId === promotionId && row.status === 'active' && onRetired(row.brandId),
        ),
      ).toBe(false);
    }
  });

  it('releases venues they held and cuts partner links', () => {
    expect(
      plain.world.tables.venues.some(
        (venue) => venue.exclusivePromotionId !== null && active.has(venue.exclusivePromotionId),
      ),
    ).toBe(true);
    for (const venue of state.world.tables.venues) {
      expect(venue.exclusivePromotionId === null || !active.has(venue.exclusivePromotionId)).toBe(
        true,
      );
    }
    for (const promotion of state.world.tables.promotions.filter((row) => active.has(row.id))) {
      expect(promotion.parentPromotionId).toBeNull();
      expect(promotion.ledgerMonths).toEqual([]);
    }
    expect(
      state.world.tables.storylines.some(
        (row) => row.status === 'active' && active.has(row.promotionId),
      ),
    ).toBe(false);
  });

  it('says so first in the setup preview', () => {
    expect(EQUALISED[0]).toBe('Every promotion starts as a brand-new company: no frills');
    const preview = previewSetup(DEFAULT_PACKS, 'default-world', {
      playerPromotionKey: FLAGSHIP,
      settings: { draftStart: true },
    });
    expect(preview.ok && preview.value.draft?.equalised[0]).toBe(EQUALISED[0]);
  });

  it('leaves a game without a draft as it was', () => {
    expect(liveStaff(plain, activeIds(plain)).length).toBeGreaterThan(0);
    expect(
      plain.world.tables.promotions.some(
        (row) => row.policies.medical > 0 || row.policies.travel > 0 || row.policies.catering > 0,
      ),
    ).toBe(true);
    expect(plain.world.tables.brands.every((brand) => brand.active)).toBe(true);
  });
});

describe('a booker-only promotion', () => {
  it('runs its shows after the draft with no referee, announcer or producer', async () => {
    const engine = createEngine({
      state: startDraftGame(),
      systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE,
    });
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    run(engine.command('draft.finish', {}, PLAYER));
    let days = 0;
    for (let tries = 0; tries < 20 && days < 14; tries += 1) {
      const result = await engine.advanceDays({ maxDays: 14 - days });
      expect(result.failures).toEqual([]);
      days += result.daysAdvanced;
      if (result.stoppedBy.kind === 'gate') {
        engine.command('news.ackAlerts', {}, PLAYER);
      }
    }
    const after = engine.exportState();
    const rivals = after.world.tables.promotions.filter(
      (row) => row.status === 'active' && row.controller.kind === 'computer',
    );
    const ran = new Set(
      after.world.tables.eventInstances
        .filter((row) => row.status === 'completed')
        .map((row) => row.promotionId),
    );
    expect(rivals.length).toBeGreaterThan(0);
    for (const rival of rivals) {
      expect(ran.has(rival.id), rival.name).toBe(true);
    }
  }, 60_000);
});
