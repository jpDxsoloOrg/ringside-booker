// The contract queries: list, detail, counts and changesSince (ECO4-02).
// Design: docs/design/contracts.md#scoping
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import {
  ask,
  contractsEngine,
  OMNISCIENT,
  PLAYER,
  PLAYER_VIEW,
  releaseWorld,
  TITLE_NAME,
} from './release-world';

const MONEY_AND_MORALE = [
  'monthlyWage',
  'perAppearanceFee',
  'signingBonus',
  'shares',
  'morale',
  'appearanceCap',
  'leave',
  'notice',
  'severance',
] as const;

describe('contracts.list', () => {
  it('lists only the viewer’s contracts: active and signed on Active, soonest first on Expiring', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const active = ask(engine.query('contracts.list', { tab: 'active' }, PLAYER_VIEW));
    expect(active.map((row) => row.employmentId).sort()).toEqual(
      [built.plain, built.champion, built.expiring, built.low, built.owner, built.signed].sort(),
    );
    expect(active.some((row) => row.employmentId === built.rivalWorker)).toBe(false);
    const champion = active.find((row) => row.employmentId === built.champion);
    expect(champion).toMatchObject({
      perks: ['ironClad'],
      titles: [{ name: TITLE_NAME }],
      daysLeft: 500,
      notice: null,
      endReason: null,
    });
    expect(active.find((row) => row.employmentId === built.signed)).toMatchObject({
      status: 'signed',
      startsOn: addDays(built.today, 10),
    });

    const expiring = ask(engine.query('contracts.list', { tab: 'expiring' }, PLAYER_VIEW));
    expect(expiring.map((row) => [row.employmentId, row.daysLeft])).toEqual([
      [built.low, 35],
      [built.expiring, 40],
    ]);
    const wider = contractsEngine(releaseWorld().world, { 'contracts.expiring.windowDays': 365 });
    expect(
      ask(wider.query('contracts.list', { tab: 'expiring' }, PLAYER_VIEW)).map(
        (row) => row.employmentId,
      ),
    ).toEqual([built.low, built.expiring, built.plain]);
  });

  it('gives a viewer with no promotion nothing', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    for (const tab of ['active', 'expiring', 'ended'] as const) {
      expect(ask(engine.query('contracts.list', { tab }, OMNISCIENT))).toEqual([]);
      expect(
        ask(
          engine.query(
            'contracts.list',
            { tab },
            { kind: 'controller', controller: { kind: 'computer' } },
          ),
        ),
      ).toEqual([]);
    }
  });

  it('lists ended contracts newest first, with how they ended', async () => {
    const built = releaseWorld();
    // The glad-to-go worker asks to leave on the way; only the expiry stop is cleared here.
    const engine = contractsEngine(built.world, {
      'contracts.autoRenewPlayer': false,
      'contracts.releaseRequest.stopSkip': false,
    });
    await engine.advanceDays({ maxDays: 36, stopAtDate: addDays(built.today, 36) });
    // Acknowledge whatever stopped the skip and go on past the second end date.
    engine.command('contracts.acknowledgeExpiries', { employmentIds: 'all' }, PLAYER);
    while (engine.exportState().world.meta.currentDate <= addDays(built.today, 40)) {
      engine.command('contracts.acknowledgeExpiries', { employmentIds: 'all' }, PLAYER);
      await engine.advanceDays({ maxDays: 1 });
    }
    const ended = ask(engine.query('contracts.list', { tab: 'ended' }, PLAYER_VIEW));
    expect(ended.map((row) => [row.employmentId, row.endedOn, row.endReason])).toEqual([
      [built.expiring, addDays(built.today, 40), 'expired'],
      [built.low, addDays(built.today, 35), 'expired'],
    ]);
    expect(ended[0]).toMatchObject({ severancePaid: 0, severanceTraceRef: null, daysLeft: null });
  });
});

describe('contracts.detail', () => {
  it('shows every term of your own contract, with a severance preview', () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const own = ask(engine.query('contracts.detail', { employmentId: built.plain }, PLAYER_VIEW));
    expect(own).toMatchObject({
      termsPrivate: false,
      monthlyWage: 800_000,
      morale: 0,
      promotionName: 'My Wrestling',
      severance: { value: 4_319_753 },
    });
  });

  it("leaves a rival's money terms and morale out, not zeroed; the omniscient viewer sees them", () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    const rival = ask(
      engine.query('contracts.detail', { employmentId: built.rivalWorker }, PLAYER_VIEW),
    );
    expect(rival).toMatchObject({
      termsPrivate: true,
      promotionName: 'Rival Wrestling',
      endsOn: addDays(built.today, 200),
    });
    for (const key of MONEY_AND_MORALE) {
      expect(rival === null ? [] : Object.keys(rival)).not.toContain(key);
    }
    expect(JSON.stringify(rival)).not.toContain('-70');
    const all = ask(
      engine.query('contracts.detail', { employmentId: built.rivalWorker }, OMNISCIENT),
    );
    expect(all).toMatchObject({ termsPrivate: false, morale: -70 });
  });
});

describe('contracts.counts and contracts.changesSince', () => {
  it('count unseen notices for the viewer only', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world);
    expect(ask(engine.query('contracts.counts', {}, PLAYER_VIEW))).toEqual({
      unseenExpiring: 0,
      wantsToLeave: 0,
    });
    await engine.advanceDays({ maxDays: 30 });
    expect(ask(engine.query('contracts.counts', {}, PLAYER_VIEW)).unseenExpiring).toBe(1);
    expect(ask(engine.query('contracts.counts', {}, OMNISCIENT)).unseenExpiring).toBe(0);
  });

  it('list starts, releases and automatic renewals in the range, own promotion only', async () => {
    const built = releaseWorld();
    const engine = contractsEngine(built.world, {
      'contracts.expiringSoon.stopSkip': false,
      'contracts.releaseRequest.stopSkip': false,
    });
    const shown = ask(
      engine.query('contracts.releasePreview', { employmentId: built.plain }, PLAYER_VIEW),
    );
    expect(shown.kind).toBe('ok');
    if (shown.kind === 'ok') {
      engine.command(
        'contracts.release',
        { employmentId: built.plain, expectedSeverance: shown.severance.value },
        PLAYER,
      );
    }
    const done = await engine.advanceDays({ maxDays: 45 });
    expect(done.daysAdvanced).toBe(45);
    const changes = ask(
      engine.query(
        'contracts.changesSince',
        { from: built.today, to: addDays(built.today, 45) },
        PLAYER_VIEW,
      ),
    );
    expect(changes.released).toEqual([
      expect.objectContaining({ employmentId: built.plain, date: built.today, how: 'released' }),
    ]);
    // The world's own contracts started today; the signed deal started ten days in.
    expect(changes.started.filter((change) => change.date !== built.today)).toEqual([
      expect.objectContaining({ employmentId: built.signed, date: addDays(built.today, 10) }),
    ]);
    expect(changes.expired).toEqual([]);
    expect(changes.renewed.map((change) => [change.employmentId, change.date])).toEqual([
      [built.low, addDays(built.today, 35)],
      [built.expiring, addDays(built.today, 40)],
    ]);
    expect(changes.renewed[0]?.line).toMatch(/contract was renewed until/);
    const rivalView = ask(
      engine.query(
        'contracts.changesSince',
        { from: built.today, to: addDays(built.today, 45) },
        OMNISCIENT,
      ),
    );
    expect(Object.values(rivalView).flat()).toEqual([]);
    const backwards = ask(
      engine.query(
        'contracts.changesSince',
        { from: addDays(built.today, 45), to: built.today },
        PLAYER_VIEW,
      ),
    );
    expect(Object.values(backwards).flat()).toEqual([]);
  });
});
