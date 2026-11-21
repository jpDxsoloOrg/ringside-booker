// Draft start (DRF-01, DRF-03, DRF-07, DRF-09) on the shipped default world: the setup, the picks, the
// contracts, the gate and saving mid-draft. Design: docs/design/draft.md
import { describe, expect, it } from 'vitest';
import type { EngineState } from '../../../src/core/api';
import { parseGameDate } from '../../../src/core/date';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { negotiationEligibility } from '../../../src/systems/negotiation/eligibility';
import { newGameSettings } from '../../../src/systems/newgame/settings';
import { createEngineTunables } from '../../../src/systems/tunables';
import { engineOf, PLAYER, PLAYER_VIEW, run, startDraftGame, worldOf } from './draft-game';

function liveContracts(state: EngineState) {
  return state.world.tables.employments.filter(
    (row) => row.status === 'active' || row.status === 'signed' || row.status === 'offered',
  );
}

function picksOf(state: EngineState) {
  return [...state.world.tables.draftPicks].sort((left, right) => left.number - right.number);
}

describe('draft settings', () => {
  it('registers the draft options in the draft group, under "Start with a draft"', () => {
    const settings = newGameSettings().filter((setting) => setting.group === 'draft');
    expect(settings.map((setting) => setting.key)).toEqual([
      'draftStart',
      'draftRosterSize',
      'draftPoolSize',
      'draftOrder',
      'draftStaff',
      'draftNegotiateAfter',
      'draftSchedule',
    ]);
    expect(settings.slice(1).every((setting) => setting.requires === 'draftStart')).toBe(true);
  });

  it('stores nothing and makes no draft in a game without one', () => {
    const state = startDraftGame({ settings: { draftStart: false } });
    expect(
      Object.keys(state.world.meta.settings.extra).some((key) => key.startsWith('draft')),
    ).toBe(false);
    expect(state.world.tables.drafts).toHaveLength(0);
  });
});

describe('draft start setup', () => {
  const state = startDraftGame();
  const world = state.world;
  const active = world.tables.promotions.filter((row) => row.status === 'active');

  it('puts every wrestler in the pool and leaves staff where they are', () => {
    const live = liveContracts(state);
    expect(live.filter((row) => row.role === 'wrestler')).toHaveLength(0);
    expect(live.length).toBeGreaterThan(0);
  });

  it('vacates every title', () => {
    expect(world.tables.titleReigns.filter((reign) => reign.lostOn === null)).toHaveLength(0);
  });

  it('gives every promotion the same money, prestige and home popularity, and no TV deal', () => {
    const [draft] = world.tables.drafts;
    expect(draft).toBeDefined();
    for (const promotion of active) {
      expect(promotion.cash).toBe(draft?.level.cash);
      expect(promotion.prestige).toBe(draft?.level.prestige);
      for (const popularity of Object.values(promotion.regionalPop)) {
        expect(popularity).toBe(draft?.level.homePopularity);
      }
    }
    // The median of the world's promotions (the default world: cash 825,000.00).
    expect(draft?.level).toEqual({ cash: 82_500_000, prestige: 51, homePopularity: 13 });
    expect(world.tables.deals).toHaveLength(0);
  });

  it('starts every production area at level 0 (DRF-09)', () => {
    for (const promotion of active) {
      expect(
        Object.values(promotion.production).every((level) => level === 0),
        promotion.name,
      ).toBe(true);
    }
  });

  it('leaves each promotion one weekly show', () => {
    for (const promotion of active) {
      const running = world.tables.eventDefinitions.filter(
        (row) =>
          row.promotionId === promotion.id &&
          (row.activeUntil === null || row.activeUntil >= world.meta.startDate),
      );
      expect(running, promotion.name).toHaveLength(1);
      expect(running[0]?.recurrence).toMatchObject({ kind: 'weekly' });
      if (running[0]?.recurrence.kind === 'weekly') {
        expect(running[0].recurrence.weekdays).toHaveLength(1);
      }
    }
  });

  it('starts a draft with a pool of 1.25 × the rosters, mixed by card level', () => {
    const [draft] = world.tables.drafts;
    expect(draft?.status).toBe('running');
    expect(draft?.order).toHaveLength(active.length);
    expect(draft?.settings.rosterTarget).toBe(20);
    expect(draft?.poolLeft.wrestlers).toBe(Math.ceil(active.length * 20 * 1.25));
    for (const level of draft?.poolMix ?? []) {
      expect(level.inPool).toBeLessThanOrEqual(level.available);
      expect(level.female + level.male + level.other).toBe(level.inPool);
    }
    const inPool = draft?.poolMix.reduce((sum, level) => sum + level.inPool, 0);
    expect(inPool).toBe(draft?.poolLeft.wrestlers);
    expect(draft?.sitOut.length).toBeGreaterThan(0);
  });
});

describe('the draft', () => {
  it('is deterministic: the same game drafts the same picks', () => {
    const first = engineOf(startDraftGame());
    const second = engineOf(startDraftGame());
    run(first.command('draft.autoPickRest', {}, PLAYER));
    run(second.command('draft.autoPickRest', {}, PLAYER));
    const picks = (state: EngineState) =>
      picksOf(state).map((pick) => `${pick.promotionId}:${pick.personId}`);
    expect(picks(first.exportState())).toEqual(picks(second.exportState()));
  });

  it('runs snake order and stops at your pick', () => {
    const engine = engineOf(startDraftGame());
    const before = run(engine.query('draft.state', {}, PLAYER_VIEW)).draft;
    const sim = run(engine.command('draft.simToMyPick', {}, PLAYER));
    expect(sim.onTheClock?.isYou).toBe(true);
    const order = engine.exportState().world.tables.drafts[0]?.order ?? [];
    const yourSlot = order.findIndex((id) => id === sim.onTheClock?.promotionId);
    expect(sim.picksMade).toBe(yourSlot);
    expect(before?.yourNextTurn).toEqual({ round: 1, picksAway: yourSlot });
    // Round one in order, then round two backwards.
    const pool = run(engine.query('draft.pool', { limit: 1 }, PLAYER_VIEW));
    const best = pool.rows[0];
    expect(best?.fit).not.toBeNull();
    run(engine.command('draft.pick', { personId: best!.personId }, PLAYER));
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const picks = picksOf(engine.exportState());
    const count = order.length;
    expect(picks.slice(0, count).map((pick) => pick.promotionId)).toEqual(order);
    expect(picks.slice(count).map((pick) => pick.promotionId)).toEqual(
      [...order].reverse().slice(0, picks.length - count),
    );
  });

  it('refuses a pick out of turn, someone drafted, or someone sitting out', () => {
    const engine = engineOf(startDraftGame());
    const state = engine.exportState();
    const draft = state.world.tables.drafts[0];
    const order = draft?.order ?? [];
    const yours = state.world.tables.promotions.find((row) => row.controller.kind === 'human');
    const pool = run(engine.query('draft.pool', { limit: 1 }, PLAYER_VIEW));
    const best = pool.rows[0]!.personId;
    if (order[0] !== yours?.id) {
      const refused = engine.command('draft.pick', { personId: best }, PLAYER);
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.reasons[0]?.code).toBe('draft.notYourTurn');
    }
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const taken = picksOf(engine.exportState())[0]!.personId;
    const again = engine.command('draft.pick', { personId: taken }, PLAYER);
    expect(!again.ok && again.reasons[0]?.code).toBe('draft.alreadyDrafted');
    const out = engine.command('draft.pick', { personId: draft!.sitOut[0]! }, PLAYER);
    expect(!out.ok && out.reasons[0]?.code).toBe('draft.sittingOut');
  });

  it('rivals pick by need: every roster gets its share of the pool by gender', () => {
    const engine = engineOf(startDraftGame());
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const state = engine.exportState();
    const people = new Map(state.world.tables.people.map((row) => [row.id, row]));
    const picks = picksOf(state);
    const femaleShare =
      picks.filter((pick) => people.get(pick.personId)?.gender === 'female').length / picks.length;
    const byPromotion = new Map<string, number>();
    for (const pick of picks) {
      if (people.get(pick.personId)?.gender === 'female') {
        byPromotion.set(pick.promotionId, (byPromotion.get(pick.promotionId) ?? 0) + 1);
      }
    }
    for (const promotionId of state.world.tables.drafts[0]?.order ?? []) {
      expect(Math.abs((byPromotion.get(promotionId) ?? 0) - femaleShare * 20)).toBeLessThanOrEqual(
        3,
      );
    }
  });
});

describe('contracts at the pick', () => {
  it('signs a one-season contract priced by the ask, with no signing bonus', () => {
    const engine = engineOf(startDraftGame());
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const state = engine.exportState();
    const season = state.world.tables.seasons.find((row) => row.status === 'active');
    for (const pick of picksOf(state)) {
      expect(pick.status).toBe('signed');
      const contract = state.world.tables.employments.find((row) => row.id === pick.employmentId);
      expect(contract?.status).toBe('active');
      expect(contract?.promotionId).toBe(pick.promotionId);
      expect(contract?.terms.signingBonus).toBe(0);
      expect(contract?.startsOn).toBe(state.world.meta.startDate);
      expect((contract?.endsOn ?? '') > (season?.endDate ?? '')).toBe(true);
    }
  });

  it('with "Negotiate contracts after the draft", picks join unsigned and reserved', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    run(engine.command('draft.simToMyPick', {}, PLAYER));
    const best = run(engine.query('draft.pool', { limit: 1 }, PLAYER_VIEW)).rows[0]!.personId;
    run(engine.command('draft.pick', { personId: best }, PLAYER));
    const state = engine.exportState();
    const mine = picksOf(state).find((pick) => pick.personId === best);
    expect(mine?.status).toBe('reserved');
    expect(mine?.employmentId).toBeNull();
    expect(liveContracts(state).some((row) => row.personId === best)).toBe(false);
    // Only the promotion that drafted them may talk to them.
    const world = worldOf(state);
    const tunables = createEngineTunables();
    const rival = state.world.tables.drafts[0]?.order.find((id) => id !== mine?.promotionId);
    const theirs = negotiationEligibility(
      world,
      tunables,
      best,
      rival!,
      state.world.meta.currentDate,
    );
    expect(theirs.situation).toBe('underContract');
    expect(theirs.reasons[0]?.code).toBe('draft.rightsHeld');
    const yours = negotiationEligibility(
      world,
      tunables,
      best,
      mine!.promotionId,
      state.world.meta.currentDate,
    );
    expect(yours.situation).toBe('freeAgent');
    // A release gives them back to the pool.
    run(engine.command('draft.release', { personId: best }, PLAYER));
    const after = engine.exportState();
    expect(picksOf(after).find((pick) => pick.personId === best)?.status).toBe('released');
    expect(after.world.tables.drafts[0]?.poolLeft.wrestlers).toBe(
      (state.world.tables.drafts[0]?.poolLeft.wrestlers ?? 0) + 1,
    );
  });

  it('rivals sign or release their unsigned picks when the draft finishes', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    const finish = run(engine.command('draft.finish', {}, PLAYER));
    expect(finish.status).toBe('finished');
    const state = engine.exportState();
    const human = state.world.tables.promotions.find((row) => row.controller.kind === 'human');
    for (const pick of picksOf(state)) {
      if (pick.promotionId === human?.id) {
        expect(pick.status).toBe('reserved');
      } else {
        expect(['signed', 'released']).toContain(pick.status);
      }
    }
    expect(finish.signed + finish.released).toBe(
      picksOf(state).filter((pick) => pick.promotionId !== human?.id).length,
    );
    const integrity = checkWorld(worldOf(state), TABLES);
    expect(integrity.issues.filter((issue) => issue.severity !== 'warning')).toEqual([]);
  });

  it('a tight budget makes rivals release picks back to the pool', () => {
    const engine = engineOf(startDraftGame({ settings: { draftNegotiateAfter: true } }));
    run(engine.command('draft.autoPickRest', {}, PLAYER));
    // A 0.1% payroll share signs almost nobody.
    const state = engine.exportState();
    const tight = engineOf({
      ...state,
      tunableOverrides: { ...state.tunableOverrides, 'draft.ai.payrollShare': 0.001 },
    });
    const finish = run(tight.command('draft.finish', {}, PLAYER));
    expect(finish.released).toBeGreaterThan(0);
  });
});

describe('the gate and saving mid-draft', () => {
  it('day 1 cannot start until the draft is finished', async () => {
    const engine = engineOf(startDraftGame({ settings: {} }));
    const stopped = await engine.advanceDays({ maxDays: 1 });
    expect(stopped.daysAdvanced).toBe(0);
    expect(
      stopped.stoppedBy.kind === 'gate' &&
        stopped.stoppedBy.hits.some((hit) => hit.gateId === 'draft.unfinished'),
    ).toBe(true);
    run(engine.command('draft.finish', {}, PLAYER));
    const after = await engine.advanceDays({ maxDays: 1 });
    expect(
      after.stoppedBy.kind === 'gate' &&
        after.stoppedBy.hits.some((hit) => hit.gateId === 'draft.unfinished'),
    ).toBe(false);
  });

  it('finishing early passes your remaining picks and makes the rivals full', () => {
    const engine = engineOf(startDraftGame());
    const finish = run(engine.command('draft.finish', {}, PLAYER));
    expect(finish.passed).toBe(1);
    const state = run(engine.query('draft.state', {}, PLAYER_VIEW)).draft;
    expect(state?.status).toBe('finished');
    for (const roster of state?.rosters ?? []) {
      expect(roster.wrestlers).toBe(roster.isYou ? roster.wrestlers : 20);
    }
  });

  it('resumes from a save made mid-draft exactly as if it never stopped', () => {
    const straight = engineOf(startDraftGame({ seed: 'resume' }));
    run(straight.command('draft.simToMyPick', {}, PLAYER));
    const best = run(straight.query('draft.pool', { limit: 1 }, PLAYER_VIEW)).rows[0]!.personId;
    run(straight.command('draft.pick', { personId: best }, PLAYER));
    run(straight.command('draft.simToMyPick', { maxPicks: 5 }, PLAYER));
    // Save here, reload, and carry on in the copy.
    const saved = structuredClone(straight.exportState());
    const resumed = engineOf(saved);
    run(straight.command('draft.autoPickRest', {}, PLAYER));
    run(resumed.command('draft.autoPickRest', {}, PLAYER));
    const picks = (state: EngineState) =>
      picksOf(state).map((pick) => `${String(pick.number)}:${pick.promotionId}:${pick.personId}`);
    expect(picks(resumed.exportState())).toEqual(picks(straight.exportState()));
  });
});

describe('the show schedule', () => {
  it('"One show a week" refuses a special; "Open" allows it', () => {
    for (const schedule of ['weekly', 'open'] as const) {
      const engine = engineOf(startDraftGame({ settings: { draftSchedule: schedule } }));
      run(engine.command('draft.finish', {}, PLAYER));
      const state = engine.exportState();
      const yours = state.world.tables.promotions.find((row) => row.controller.kind === 'human');
      const result = engine.command(
        'calendar.addOneOff',
        {
          promotionId: yours!.id,
          name: 'Draft Special',
          brandId: null,
          importance: 'major',
          format: { slots: 8, preShowSlots: 0 },
          date: parseGameDate('2027-03-06'),
          regionId: null,
          venueId: null,
        },
        PLAYER,
      );
      const refused =
        !result.ok && result.reasons.some((reason) => reason.code === 'draft.oneWeeklyShow');
      expect(refused, schedule).toBe(schedule === 'weekly');
    }
  });
});

describe('draft queries', () => {
  it('previews the settings, the level and the pool mix', () => {
    const engine = engineOf(
      startDraftGame({ settings: { draftOrder: 'bySize', draftStaff: true } }),
    );
    const preview = run(engine.query('draft.preview', {}, PLAYER_VIEW));
    expect(preview.options).toMatchObject({ enabled: true, order: 'bySize', draftStaff: true });
    expect(preview.draft?.settings.staffTarget).toBeGreaterThan(0);
    expect(preview.draft?.poolMix).toHaveLength(5);
    expect(preview.notEqualised.length).toBeGreaterThan(0);
  });

  it('pages, filters and sorts the pool', () => {
    const engine = engineOf(startDraftGame());
    const women = run(
      engine.query(
        'draft.pool',
        { gender: 'female', limit: 5, sort: 'age', descending: false },
        PLAYER_VIEW,
      ),
    );
    expect(women.rows).toHaveLength(5);
    expect(women.rows.every((row) => row.gender === 'female')).toBe(true);
    const ages = women.rows.map((row) => row.age);
    expect([...ages].sort((left, right) => left - right)).toEqual(ages);
    expect(women.rows[0]?.why.length).toBeGreaterThan(1);
    const page2 = run(engine.query('draft.pool', { offset: 5, limit: 5 }, PLAYER_VIEW));
    expect(page2.offset).toBe(5);
    expect(page2.total).toBe(page2.poolLeft.wrestlers);
  });
});
