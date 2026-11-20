// Active promotions (DRF-06), the wizard's previews (DRF-06/07) and a drafted world playing on.
// Design: docs/design/draft.md#active-promotions and #wizard-previews
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/core/api';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { createNewGame } from '../../../src/systems/newgame';
import { previewPromotionPage, previewSetup } from '../../../src/systems/draft/setupPreview';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE } from '../../support/systems';
import { DEFAULT_PACKS, FLAGSHIP, PLAYER, run, startDraftGame, worldOf } from './draft-game';

const KEEP = ['pro-au-indie', 'pro-ca'];

describe('active promotions', () => {
  it('closes every promotion not chosen, but never yours', () => {
    const state = startDraftGame({ settings: { draftStart: false }, activePromotionKeys: KEEP });
    const { promotions, employments, titles, eventDefinitions, deals } = state.world.tables;
    const active = promotions.filter((row) => row.status === 'active');
    expect(active).toHaveLength(KEEP.length + 1);
    expect(active.some((row) => row.controller.kind === 'human')).toBe(true);
    const closed = new Set(
      promotions.filter((row) => row.status === 'closed').map((row) => row.id),
    );
    expect(closed.size).toBe(promotions.length - active.length);
    const live = employments.filter((row) => row.status === 'active' || row.status === 'signed');
    expect(live.some((row) => closed.has(row.promotionId))).toBe(false);
    expect(
      titles.filter((row) => closed.has(row.promotionId)).every((row) => row.status === 'retired'),
    ).toBe(true);
    expect(
      eventDefinitions
        .filter((row) => closed.has(row.promotionId))
        .every((row) => row.activeUntil !== null && row.activeUntil < state.world.meta.startDate),
    ).toBe(true);
    expect(deals.some((row) => closed.has(row.promotionId))).toBe(false);
    expect(state.world.tables.eventInstances.some((row) => closed.has(row.promotionId))).toBe(
      false,
    );
    const integrity = checkWorld(worldOf(state), TABLES);
    expect(integrity.issues.filter((issue) => issue.severity !== 'warning')).toEqual([]);
  });

  it('refuses a promotion key the world does not have', () => {
    const result = createNewGame(DEFAULT_PACKS, {
      rootPackId: 'default-world',
      seed: 'x',
      playerId: 'local-player',
      playerName: 'Alex',
      saveName: 'X',
      seasonLength: { preset: '6m' },
      player: { mode: 'existing', promotionKey: FLAGSHIP },
      settings: {},
      activePromotionKeys: ['pro-nowhere'],
    });
    expect(!result.ok && result.reasons[0]?.field).toBe('activePromotionKeys');
  });

  it('only active promotions draft', () => {
    const state = startDraftGame({ activePromotionKeys: KEEP });
    expect(state.world.tables.drafts[0]?.order).toHaveLength(KEEP.length + 1);
  });
});

describe('wizard previews', () => {
  it('counts active promotions and wrestlers', () => {
    const all = previewSetup(DEFAULT_PACKS, 'default-world', {});
    const some = previewSetup(DEFAULT_PACKS, 'default-world', {
      activePromotionKeys: KEEP,
      playerPromotionKey: FLAGSHIP,
    });
    if (!all.ok || !some.ok) throw new Error('preview failed');
    expect(all.value.promotions).toEqual({ total: 12, active: 12, inactive: 0 });
    expect(some.value.promotions).toEqual({ total: 12, active: 3, inactive: 9 });
    expect(some.value.wrestlers.total).toBe(all.value.wrestlers.total);
    expect(some.value.wrestlers.onActiveRosters).toBeLessThan(all.value.wrestlers.onActiveRosters);
    expect(all.value.draft).toBeNull();
  });

  it('previews the draft exactly as the new game sets it up', () => {
    const preview = previewSetup(DEFAULT_PACKS, 'default-world', {
      playerPromotionKey: FLAGSHIP,
      settings: { draftStart: true },
    });
    if (!preview.ok || preview.value.draft === null) throw new Error('no draft preview');
    const state = startDraftGame();
    const draft = state.world.tables.drafts[0];
    expect(preview.value.draft.settings).toEqual(draft?.settings);
    expect(preview.value.draft.level).toEqual(draft?.level);
    expect(preview.value.draft.poolWrestlers).toBe(draft?.poolLeft.wrestlers);
    expect(preview.value.draft.mix.map((level) => level.inPool)).toEqual(
      draft?.poolMix.map((level) => level.inPool),
    );
  });

  it('pages, searches and filters the promotion picker', () => {
    const page = previewPromotionPage(DEFAULT_PACKS, 'default-world', { limit: 5 });
    if (!page.ok) throw new Error('page failed');
    expect(page.value.rows).toHaveLength(5);
    expect(page.value.total).toBe(12);
    const wrestlers = page.value.rows.map((row) => row.wrestlers);
    expect([...wrestlers].sort((left, right) => right - left)).toEqual(wrestlers);
    expect(page.value.biggestFirst).toHaveLength(12);
    const country = page.value.countries[0];
    const byCountry = previewPromotionPage(DEFAULT_PACKS, 'default-world', {
      countryKey: country?.key ?? '',
    });
    expect(byCountry.ok && byCountry.value.total).toBe(country?.count);
    const search = previewPromotionPage(DEFAULT_PACKS, 'default-world', { search: 'wattle' });
    expect(search.ok && search.value.rows.map((row) => row.key)).toEqual(['pro-au-indie']);
  });
});

describe('a drafted world plays on', () => {
  it('runs two weeks after the draft with no failed step', async () => {
    const state = startDraftGame({ settings: { draftStaff: true } });
    const engine = createEngine({ state, systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    run(engine.command('draft.finish', {}, PLAYER));
    let days = 0;
    for (let tries = 0; tries < 10 && days < 14; tries += 1) {
      const result = await engine.advanceDays({ maxDays: 14 - days });
      expect(result.failures).toEqual([]);
      days += result.daysAdvanced;
      if (result.stoppedBy.kind === 'gate') {
        engine.command('news.ackAlerts', {}, PLAYER);
      }
    }
    expect(days).toBeGreaterThan(0);
  }, 120_000);
});
