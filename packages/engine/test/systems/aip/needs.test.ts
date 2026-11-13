// Roster needs and the weekly roster review. Design: docs/design/rival-desk.md#needs
import { describe, expect, it } from 'vitest';
import { addDays, parseGameDate } from '../../../src/core/date';
import { findTraceNodes } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Push } from '../../../src/model/entities/employment';
import {
  needSummaryText,
  NO_NEEDS_REASON,
  rosterNeeds,
  rosterReviewDecision,
  slotsDemanded,
  TOP_NEED_REASON,
  type Need,
  type NeedsChampion,
  type NeedsInputs,
  type NeedsWrestler,
} from '../../../src/systems/aip';
import { createEngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support/ids';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

const TODAY = parseGameDate('2026-04-01');

/**
 * With 8 slots the shows call for 16 wrestlers: 2 main event, 3 upper card, 5 mid card, 3 lower
 * card and 2 enhancement. This roster fills each band exactly, 8 men and 7 women, 8 faces and 7
 * heels.
 */
const BAND_COUNTS: readonly [Push, number][] = [
  ['mainEvent', 2],
  ['upperCard', 3],
  ['midCard', 5],
  ['lowerCard', 3],
  ['enhancement', 2],
];

function fullRoster(): NeedsWrestler[] {
  const wrestlers: NeedsWrestler[] = [];
  for (const [push, count] of BAND_COUNTS) {
    for (let index = 0; index < count; index += 1) {
      const serial = wrestlers.length + 1;
      wrestlers.push({
        personId: testId('person', serial),
        name: `Test Person ${String(serial).padStart(3, '0')}`,
        gender: serial % 2 === 1 ? 'male' : 'female',
        push,
        alignment: serial % 2 === 1 ? 'face' : 'heel',
        available: true,
      });
    }
  }
  return wrestlers;
}

function inputsOf(overrides: Partial<NeedsInputs> = {}): NeedsInputs {
  return {
    unitName: 'Test Promotion A',
    largestShowSlots: 8,
    wrestlers: fullRoster(),
    genderDivisions: ['male', 'female'],
    champions: [],
    crewCounts: { referee: 2, announcer: 1, producer: 0 },
    today: TODAY,
    ...overrides,
  };
}

function needsOf(inputs: NeedsInputs, overrides: TunableOverrides = {}): Need[] {
  const needs = rosterNeeds(inputs, { tunables: createEngineTunables(overrides) });
  for (const need of needs) {
    expectTraceReplays(need.severity);
    expectSerialisable(need.summary);
  }
  return needs;
}

function onlyNeed(needs: readonly Need[], key: string): Need {
  const found = needs.filter((need) => need.key === key);
  expect(found).toHaveLength(1);
  const need = found[0];
  if (need === undefined) {
    throw new Error(`no need ${key}`);
  }
  return need;
}

function tunableKeys(need: Need): string[] {
  return findTraceNodes(need.severity.trace, 'tunable').map((node) => node.key);
}

/** The roster with the first `count` wrestlers matching `match` changed by `change`. */
function changeFirst(
  count: number,
  match: (wrestler: NeedsWrestler) => boolean,
  change: Partial<NeedsWrestler>,
): NeedsWrestler[] {
  let left = count;
  return fullRoster().map((wrestler) => {
    if (left > 0 && match(wrestler)) {
      left -= 1;
      return { ...wrestler, ...change };
    }
    return wrestler;
  });
}

const champion = (overrides: Partial<NeedsChampion> = {}): NeedsChampion => ({
  titleId: testId('title', 1),
  titleName: 'Test Heavyweight Title',
  personIds: [testId('person', 1)],
  names: ['Test Person 001'],
  unfitReason: null,
  contractEndsOn: null,
  employed: true,
  ...overrides,
});

describe('slotsDemanded', () => {
  it('is the largest show times the workers per slot', () => {
    const result = slotsDemanded({ largestShowSlots: 8 }, { tunables: createEngineTunables() });
    expect(result.value).toBe(16);
    expectTraceReplays(result);
    expectTraceContains(result, { kind: 'input', label: 'Largest show has 8 slots' });
  });

  it('uses the default slots when the unit has no active shows', () => {
    const result = slotsDemanded({ largestShowSlots: null }, { tunables: createEngineTunables() });
    expect(result.value).toBe(12);
    expectTraceReplays(result);
    expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toEqual([
      'aip.needs.defaultSlots',
      'aip.needs.workersPerSlot',
    ]);
  });
});

describe('rosterNeeds', () => {
  it('finds nothing on a full, balanced roster', () => {
    expect(needsOf(inputsOf())).toEqual([]);
  });

  describe('depth', () => {
    it('is short one main eventer when one is unavailable', () => {
      const wrestlers = changeFirst(1, (wrestler) => wrestler.push === 'mainEvent', {
        available: false,
      });
      const need = onlyNeed(needsOf(inputsOf({ wrestlers })), 'depth.mainEvent');
      expect(need.kind).toBe('depth');
      expect(need.severity.value).toBe(50);
      expect(needSummaryText(need.summary)).toBe('Thin at main event: 1 of 2');
      expect(tunableKeys(need)).toEqual(
        expect.arrayContaining([
          'aip.needs.workersPerSlot',
          'aip.needs.bandShare.mainEvent',
          'aip.needs.minSeverity',
        ]),
      );
    });

    it('works from the default slots when there are no shows', () => {
      // 6 slots × 2 = 12 wrestlers: the main event wants round(1.44) = 1, so 2 are plenty.
      const needs = needsOf(inputsOf({ largestShowSlots: null }));
      expect(needs.filter((need) => need.kind === 'depth')).toEqual([]);
      const empty = needsOf(inputsOf({ largestShowSlots: null, wrestlers: [] }));
      expect(onlyNeed(empty, 'depth.mainEvent').summary.params).toMatchObject({
        have: 0,
        target: 1,
      });
    });

    it('makes no need for a band whose target rounds to 0', () => {
      const needs = needsOf(inputsOf({ wrestlers: [] }), { 'aip.needs.bandShare.mainEvent': 0 });
      expect(needs.some((need) => need.key === 'depth.mainEvent')).toBe(false);
      expect(needs.some((need) => need.key === 'depth.midCard')).toBe(true);
    });
  });

  describe('alignment', () => {
    it('allows a gap of 3 and needs heels at 4', () => {
      // 8 faces and 7 heels; making heels tweeners widens the gap.
      const atLimit = changeFirst(2, (wrestler) => wrestler.alignment === 'heel', {
        alignment: 'tweener',
      });
      expect(needsOf(inputsOf({ wrestlers: atLimit })).map((need) => need.key)).not.toContain(
        'alignment',
      );
      const past = changeFirst(3, (wrestler) => wrestler.alignment === 'heel', {
        alignment: 'tweener',
      });
      const need = onlyNeed(needsOf(inputsOf({ wrestlers: past })), 'alignment');
      expect(need.severity.value).toBe(15);
      expect(needSummaryText(need.summary)).toBe('Short on heels');
      expect(tunableKeys(need)).toEqual(
        expect.arrayContaining([
          'aip.needs.maxAlignmentGap',
          'aip.needs.alignmentSeverityPerWorker',
        ]),
      );
    });

    it('needs faces when heels lead, and leaves unpushed wrestlers out', () => {
      const heels = changeFirst(5, (wrestler) => wrestler.alignment === 'face', {
        alignment: 'heel',
      });
      const need = onlyNeed(needsOf(inputsOf({ wrestlers: heels })), 'alignment');
      expect(needSummaryText(need.summary)).toBe('Short on faces');
      const unpushed = changeFirst(4, (wrestler) => wrestler.alignment === 'heel', {
        push: 'none',
      });
      const needs = needsOf(inputsOf({ wrestlers: unpushed }));
      expect(onlyNeed(needs, 'alignment').summary.params).toMatchObject({ faces: 8, heels: 3 });
    });
  });

  describe('gender divisions', () => {
    it('needs 4 available in a division with a title', () => {
      const women = fullRoster().filter((wrestler) => wrestler.gender === 'female');
      const four = women.slice(0, 4);
      expect(
        needsOf(inputsOf({ wrestlers: four, genderDivisions: ['female'] })).some(
          (need) => need.kind === 'gender',
        ),
      ).toBe(false);
      const three = women.slice(0, 3);
      const need = onlyNeed(
        needsOf(inputsOf({ wrestlers: three, genderDivisions: ['female'] })),
        'gender.female',
      );
      expect(need.severity.value).toBe(25);
      expect(needSummaryText(need.summary)).toBe("Women's division thin: 3 of 4");
      expect(tunableKeys(need)).toContain('aip.needs.minPerGenderDivision');
    });

    it('only checks divisions that have a title', () => {
      const men = fullRoster().filter((wrestler) => wrestler.gender === 'male');
      const needs = needsOf(inputsOf({ wrestlers: men, genderDivisions: ['male'] }));
      expect(needs.some((need) => need.kind === 'gender')).toBe(false);
    });
  });

  describe('champions', () => {
    it('is most pressing when the champion has left', () => {
      const need = onlyNeed(
        needsOf(inputsOf({ champions: [champion({ employed: false })] })),
        `champion.${testId('title', 1)}.gone`,
      );
      expect(need.severity.value).toBe(100);
      expect(needSummaryText(need.summary)).toBe('Champion has left: Test Heavyweight Title');
      expect(need.refs.titleIds).toEqual([testId('title', 1)]);
    });

    it('needs a champion who cannot defend', () => {
      const need = onlyNeed(
        needsOf(inputsOf({ champions: [champion({ unfitReason: 'injured' })] })),
        `champion.${testId('title', 1)}.unfit`,
      );
      expect(need.severity.value).toBe(80);
      expect(needSummaryText(need.summary)).toBe('Champion unfit: Test Person 001, injured');
      expect(tunableKeys(need)).toContain('aip.needs.championUnfitSeverity');
    });

    it('counts a contract ending in 60 days, not in 61', () => {
      const key = `champion.${testId('title', 1)}.ending`;
      const ending = needsOf(
        inputsOf({ champions: [champion({ contractEndsOn: addDays(TODAY, 60) })] }),
      );
      const need = onlyNeed(ending, key);
      expect(need.severity.value).toBe(60);
      expect(needSummaryText(need.summary)).toBe("Champion's contract ends 31 May 2026");
      expect(tunableKeys(need)).toEqual(
        expect.arrayContaining([
          'aip.needs.contractEndingDays',
          'aip.needs.championEndingSeverity',
        ]),
      );
      const later = needsOf(
        inputsOf({ champions: [champion({ contractEndsOn: addDays(TODAY, 61) })] }),
      );
      expect(later.map((found) => found.key)).not.toContain(key);
    });
  });

  describe('crew', () => {
    it('needs 2 referees and 1 announcer', () => {
      const needs = needsOf(inputsOf({ crewCounts: { referee: 1, announcer: 0, producer: 0 } }));
      expect(onlyNeed(needs, 'crew.referee').severity.value).toBe(50);
      expect(onlyNeed(needs, 'crew.announcer').severity.value).toBe(100);
      expect(needSummaryText(onlyNeed(needs, 'crew.referee').summary)).toBe(
        'Short of referees: 1 of 2',
      );
      expect(tunableKeys(onlyNeed(needs, 'crew.referee'))).toContain('aip.needs.minReferees');
    });

    it('never needs producers at the default minimum of 0', () => {
      expect(needsOf(inputsOf()).some((need) => need.key === 'crew.producer')).toBe(false);
      const needs = needsOf(inputsOf(), { 'aip.needs.minProducers': 1 });
      expect(onlyNeed(needs, 'crew.producer').severity.value).toBe(100);
    });
  });

  it('drops needs below the minimum severity and keeps one at it', () => {
    const wrestlers = changeFirst(3, (wrestler) => wrestler.alignment === 'heel', {
      alignment: 'tweener',
    });
    // The alignment need is 15.
    expect(needsOf(inputsOf({ wrestlers }), { 'aip.needs.minSeverity': 15 })).toHaveLength(1);
    expect(needsOf(inputsOf({ wrestlers }), { 'aip.needs.minSeverity': 16 })).toEqual([]);
  });

  it('keeps every severity within 0-100', () => {
    const wrestlers = fullRoster().map((wrestler) => ({ ...wrestler, alignment: 'face' as const }));
    const need = onlyNeed(needsOf(inputsOf({ wrestlers })), 'alignment');
    // (15 − 3) × 15 = 180, kept at 100.
    expect(need.severity.value).toBe(100);
  });

  it('sorts by severity, then by key', () => {
    const needs = needsOf(
      inputsOf({
        crewCounts: { referee: 1, announcer: 0, producer: 0 },
        champions: [champion({ unfitReason: 'injured' })],
      }),
    );
    expect(needs.map((need) => [need.key, need.severity.value])).toEqual([
      ['crew.announcer', 100],
      [`champion.${testId('title', 1)}.unfit`, 80],
      ['crew.referee', 50],
    ]);
  });
});

describe('rosterReviewDecision', () => {
  it('chooses the most pressing need', () => {
    const needs = needsOf(
      inputsOf({
        crewCounts: { referee: 1, announcer: 1, producer: 0 },
        champions: [champion({ unfitReason: 'injured' })],
      }),
    );
    const result = rosterReviewDecision(needs);
    expect(result.value).toBe(`champion.${testId('title', 1)}.unfit`);
    const decision = expectTraceContains(result, {
      kind: 'decision',
      label: 'Weekly roster review',
    });
    expect(decision.reason).toBe(TOP_NEED_REASON);
    expect(decision.considered).toEqual([
      {
        option: `champion.${testId('title', 1)}.unfit`,
        score: 80,
        reason: 'Champion unfit: Test Person 001, injured',
      },
      { option: 'crew.referee', score: 50, reason: 'Short of referees: 1 of 2' },
    ]);
    expectSerialisable(result);
  });

  it("chooses 'none' when nothing is pressing", () => {
    const result = rosterReviewDecision([]);
    expect(result.value).toBe('none');
    const decision = expectTraceContains(result, { kind: 'decision' });
    expect(decision.reason).toBe(NO_NEEDS_REASON);
    expectSerialisable(result);
  });
});
