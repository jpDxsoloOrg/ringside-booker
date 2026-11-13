// Which challengers could take a rival title. Design: docs/design/rival-booking.md#title-changes
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  challengerPool,
  type ChallengerPool,
  type ChallengerPoolSide,
} from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

function side(
  sideNumber: number,
  popularity: number,
  extra: Partial<ChallengerPoolSide> = {},
): ChallengerPoolSide {
  return {
    side: sideNumber,
    label: `Side ${String(sideNumber)}`,
    marketPopularity: inputOf('Market popularity', popularity),
    eligibility: [],
    contractDaysLeft: null,
    ...extra,
  };
}

function run(
  prestige: number,
  sides: readonly ChallengerPoolSide[],
  tuned: TunableOverrides = {},
): ChallengerPool {
  const result = challengerPool(
    { titleName: 'World Title', prestige, sides },
    { tunables: createEngineTunables(tuned) },
  );
  expectSerialisable(result.pool);
  return result;
}

function rules(result: ChallengerPool): { label: string; taken: boolean }[] {
  return findTraceNodes(result.pool.trace, 'branch').map((node) => ({
    label: node.label,
    taken: node.taken,
  }));
}

function notes(result: ChallengerPool): string[] {
  return findTraceNodes(result.pool.trace, 'note').map((node) => node.label);
}

describe('challengerPool', () => {
  it('needs 50 for valid and 68 for strong at prestige 80', () => {
    const result = run(80, [side(1, 68), side(2, 67), side(3, 50), side(4, 49)]);
    expect(result.validNeeds).toBe(50);
    expect(result.strongNeeds).toBe(68);
    expect(result.strong).toEqual([1]);
    expect(result.valid).toEqual([1, 2, 3]);
    expect(result.eligible).toEqual([1, 2, 3, 4]);
    expect(result.pool.value).toBe('strong');
    expect(result.pool.trace.kind === 'decision' && result.pool.trace.reason).toBe(
      'Strong challengers: Side 1 (68 in our markets, needs 68)',
    );
  });

  it('uses the floors at prestige 20: 40 for valid, 62 for strong', () => {
    const result = run(20, [side(1, 39), side(2, 40), side(3, 62)]);
    expect(result.validNeeds).toBe(40);
    expect(result.strongNeeds).toBe(62);
    expect(result.valid).toEqual([2, 3]);
    expect(result.strong).toEqual([3]);
  });

  it('shows both thresholds as replayable calculations', () => {
    const result = run(80, [side(1, 70)]);
    const formulas = findTraceNodes(result.pool.trace, 'formula');
    expect(formulas.map((node) => node.label)).toEqual([
      'Valid challenger needs',
      'Strong challenger needs',
    ]);
    for (const formula of formulas) {
      expect(typeof formula.value).toBe('number');
      expectTraceReplays({ value: Number(formula.value), trace: formula });
    }
  });

  it('keeps an ineligible side out of every list and notes its reason', () => {
    const tooHeavy = 'Too heavy for the Cruiserweight title (no more than 92 kg)';
    const result = run(50, [
      side(1, 99, { eligibility: [{ code: 'tooHeavy', message: tooHeavy }] }),
      side(2, 45),
    ]);
    expect(result.eligible).toEqual([2]);
    expect(result.valid).toEqual([2]);
    expect(result.strong).toEqual([]);
    expect(notes(result)).toContain(tooHeavy);
    expect(rules(result)).toContainEqual({ label: 'Side 1 is eligible', taken: false });
  });

  it('excludes a challenger whose contract runs out too soon; an open-ended one passes', () => {
    const result = run(50, [side(1, 90, { contractDaysLeft: 30 }), side(2, 90)], {
      'aip.titles.challengerMinContractDays': 60,
    });
    expect(result.eligible).toEqual([2]);
    expect(result.strong).toEqual([2]);
    expect(rules(result)).toContainEqual({
      label: "Side 1's contract runs at least 60 more days",
      taken: false,
    });
    expect(rules(result)).toContainEqual({
      label: "Side 2's contract runs at least 60 more days",
      taken: true,
    });
  });

  it('chooses strong, then valid, then none', () => {
    expect(run(80, [side(1, 70), side(2, 55)]).pool.value).toBe('strong');
    expect(run(80, [side(1, 60), side(2, 55)]).pool.value).toBe('valid');
    const none = run(80, [side(1, 30)]);
    expect(none.pool.value).toBe('none');
    expect(none.eligible).toEqual([1]);
    expect(none.pool.trace.kind === 'decision' && none.pool.trace.reason).toBe(
      'No challenger is popular enough (needs 50 in our markets)',
    );
  });

  it('records market popularity as a number, not its whole trace', () => {
    const heavy = {
      value: 70,
      trace: { kind: 'input', label: 'Deep', value: 70, children: [] },
    } as const;
    const result = run(80, [side(1, 0, { marketPopularity: heavy })]);
    expect(findTraceNodes(result.pool.trace, 'input').map((node) => node.label)).not.toContain(
      'Deep',
    );
  });
});
