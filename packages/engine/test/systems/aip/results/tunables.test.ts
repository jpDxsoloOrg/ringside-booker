// The rival results' tunables, streams and decision kinds (AIP5-01).
// Design: docs/design/rival-booking.md#winners and #title-changes
import { describe, expect, it } from 'vitest';
import { isStreamName } from '../../../../src/core/rng/streams';
import { describeTunables } from '../../../../src/core/tunables/describe';
import {
  aipCardTunables,
  aipResultsTunables,
  decisionKindOf,
  reignBandProblems,
  reignBandsAsSet,
  reignBandsOf,
  RIVAL_BOOKING_CATEGORY,
  TITLE_DECISION_KIND,
  TITLES_STREAM,
  WINNER_DECISION_KIND,
  WINNERS_STREAM,
} from '../../../../src/systems/aip';
import { ALL_TUNABLES, createEngineTunables } from '../../../../src/systems/tunables';

const DEFAULTS: Readonly<Record<string, number | boolean>> = {
  'aip.winner.jitter': 0.1,
  'aip.winner.drawChance': 0,
  'aip.winner.squash.pushGap': 3,
  'aip.winner.squash.chance': 0.92,
  'aip.winner.protect.ace': 0.6,
  'aip.winner.protect.prospect': 0.75,
  'aip.winner.finale.faceChance': 0.7,
  'aip.winner.finale.minAgeDays': 56,
  'aip.winner.method.nonTitleWeight': 0.15,
  'aip.titles.band1.maxDays': 14,
  'aip.titles.band1.chance': 0,
  'aip.titles.band2.maxDays': 45,
  'aip.titles.band2.chance': 4,
  'aip.titles.band3.maxDays': 90,
  'aip.titles.band3.chance': 12,
  'aip.titles.band4.maxDays': 150,
  'aip.titles.band4.chance': 22,
  'aip.titles.band5.maxDays': 240,
  'aip.titles.band5.chance': 34,
  'aip.titles.band6.maxDays': 365,
  'aip.titles.band6.chance': 48,
  'aip.titles.bandBeyond.chance': 60,
  'aip.titles.prestigePivot': 60,
  'aip.titles.changePrestigeWeight': 0.25,
  'aip.titles.tempoWeight': 0.3,
  'aip.titles.houseShowsRetain': true,
  'aip.titles.importance.house': -20,
  'aip.titles.importance.minor': -12,
  'aip.titles.importance.regular': -8,
  'aip.titles.importance.major': 6,
  'aip.titles.importance.flagship': 15,
  'aip.titles.hotShot.weeks': 3,
  'aip.titles.hotShot.bonus': 10,
  'aip.titles.overdueDays': 400,
  'aip.titles.expiringDays': 28,
  'aip.titles.challengerMinContractDays': 60,
  'aip.titles.maxChance': 90,
  'aip.titles.valid.gap': 30,
  'aip.titles.valid.floor': 40,
  'aip.titles.strong.gap': 12,
  'aip.titles.strong.floor': 62,
};

describe('the rival results tunables', () => {
  it('are all in the engine set with the agreed defaults, and nothing else', () => {
    expect(Object.keys(aipResultsTunables).sort()).toEqual(Object.keys(DEFAULTS).sort());
    const rows = new Map(describeTunables(createEngineTunables()).map((row) => [row.key, row]));
    for (const [key, value] of Object.entries(DEFAULTS)) {
      expect(ALL_TUNABLES).toHaveProperty([key]);
      expect(rows.get(key)?.default, key).toBe(value);
      expect(rows.get(key)?.value, key).toBe(value);
    }
  });

  it('are listed under Rival booking with a docRef to #winners or #title-changes', () => {
    const rows = describeTunables(createEngineTunables(), { category: RIVAL_BOOKING_CATEGORY });
    const keys = rows.map((row) => row.key);
    for (const [key, def] of Object.entries(aipResultsTunables)) {
      expect(keys).toContain(key);
      expect(def.docRef).toBe(
        key.startsWith('aip.winner.')
          ? 'rival-booking.md#winners'
          : 'rival-booking.md#title-changes',
      );
    }
    // The defence urgency weight stays AIP4's; the change weight has its own key.
    expect(aipCardTunables['aip.titles.prestigeWeight'].docRef).toBe(
      'rival-booking.md#title-picture',
    );
  });

  it('reads an override of 0 back as 0', () => {
    const tunables = createEngineTunables({
      'aip.winner.drawChance': 0,
      'aip.winner.jitter': 0,
    });
    expect(tunables.get('aip.winner.drawChance')).toBe(0);
    expect(tunables.get('aip.winner.jitter')).toBe(0);
    expect(
      createEngineTunables({ 'aip.winner.drawChance': 0.2 }).get('aip.winner.drawChance'),
    ).toBe(0.2);
  });

  it('have reign bands whose days increase, and refuse bands that do not', () => {
    const defaults = reignBandsAsSet(createEngineTunables());
    expect(defaults.map((band) => band.maxDays)).toEqual([14, 45, 90, 150, 240, 365]);
    expect(reignBandProblems(defaults)).toEqual([]);

    const tangled = createEngineTunables({ 'aip.titles.band3.maxDays': 45 });
    expect(reignBandProblems(reignBandsAsSet(tangled))).toEqual([
      'Band 3 ends at 45 days, which is not after band 2 (45 days)',
    ]);
    const used = reignBandsOf(tangled);
    expect(used.problems).toHaveLength(1);
    expect(used.bands.map((band) => band.maxDays)).toEqual([14, 45, 90, 150, 240, 365]);

    const longer = reignBandsOf(createEngineTunables({ 'aip.titles.band6.maxDays': 500 }));
    expect(longer.problems).toEqual([]);
    expect(longer.bands.at(-1)).toEqual({ band: 6, maxDays: 500, chance: 48 });
  });

  it('never mention minutes or length', () => {
    const text = JSON.stringify(aipResultsTunables).toLowerCase();
    expect(text).not.toMatch(/minute|length|duration/);
  });
});

describe('the rival results streams and decision kinds', () => {
  it('are valid, separate streams', () => {
    expect(isStreamName(WINNERS_STREAM)).toBe(true);
    expect(isStreamName(TITLES_STREAM)).toBe(true);
    expect(WINNERS_STREAM).toBe('aip.winners');
    expect(TITLES_STREAM).toBe('aip.titles');
  });

  it('register the winner and title decision kinds with their chips', () => {
    expect(decisionKindOf(WINNER_DECISION_KIND)).toEqual({
      kind: 'winner',
      chip: 'Winners',
      icon: null,
    });
    expect(decisionKindOf(TITLE_DECISION_KIND)).toEqual({
      kind: 'title',
      chip: 'Titles',
      icon: null,
    });
  });
});
