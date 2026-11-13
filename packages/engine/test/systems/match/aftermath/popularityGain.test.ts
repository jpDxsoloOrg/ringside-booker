// Popularity gain formula (MTCH3-01). Design: docs/design/match-aftermath.md#popularity-gain
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf, type Traced } from '../../../../src/core/trace';
import { detachedStream, floatBetween, intBetween, pick } from '../../../../src/core/rng';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  EVENT_IMPORTANCES,
  type EventImportance,
} from '../../../../src/model/entities/event-definition';
import {
  CLASSIC_MATCH_LABEL,
  MATCH_PREVIEW_STREAM,
  NO_CONTEST_LABEL,
  NO_FINISH_LABEL,
  NO_MOMENTUM_LABEL,
  NO_SCORE_LABEL,
  PER_MATCH_LIMIT_LABEL,
  POPULARITY_GAIN_DOC_REF,
  PRE_SHOW_LABEL,
  WIN_FLOOR_LABEL,
  aftermathTunables,
  popularityGain,
  type PopularityGainInputs,
  type PopularityOutcome,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function pop(value: number, label = 'Popularity'): Traced<number> {
  return inputOf(label, value, undefined, 'points');
}

const BASE: PopularityGainInputs = {
  outcome: 'win',
  popularity: pop(50),
  opponents: [{ name: 'Kara Voss', popularity: pop(50) }],
  importance: 'regular',
  finish: null,
  competitorCount: 2,
  segmentScore: null,
  preShow: false,
  priorWinStreak: 0,
  momentum: null,
};

function gain(changes: Partial<PopularityGainInputs> = {}, overrides: TunableOverrides = {}) {
  const result = popularityGain(
    { ...BASE, ...changes },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function versus(own: number, opponent: number): Partial<PopularityGainInputs> {
  return { popularity: pop(own), opponents: [{ name: 'Kara Voss', popularity: pop(opponent) }] };
}

function stepLabels(result: Traced<number>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

const ALL_ZERO: TunableOverrides = Object.fromEntries(
  Object.entries(aftermathTunables)
    .filter(([, def]) => def.min <= 0)
    .map(([key]) => [key, 0]),
);

const OUTCOMES: readonly PopularityOutcome[] = ['win', 'loss', 'draw', 'noContest'];

describe('popularityGain', () => {
  it('records the formula label, unit and design doc on the root', () => {
    const result = gain();
    expect(result.trace.label).toBe('Popularity change from this match');
    expect(result.trace).toMatchObject({ unit: 'points', docRef: POPULARITY_GAIN_DOC_REF });
  });

  it('gives 0 for every outcome when every tunable is 0', () => {
    for (const outcome of OUTCOMES) {
      for (const [own, other] of [
        [50, 50],
        [10, 90],
        [90, 10],
      ] as const) {
        const result = gain(
          {
            ...versus(own, other),
            outcome,
            segmentScore: 100,
            priorWinStreak: 5,
            momentum: pop(100),
          },
          ALL_ZERO,
        );
        expect(result.value).toBe(0);
      }
    }
  });

  describe('with default tunables (acceptance)', () => {
    it('gives +1 for a win over an equal opponent at a regular show', () => {
      const result = gain();
      expect(result.value).toBeCloseTo(1, 10);
      expect(stepLabels(result)[0]).toBe('Beat Kara Voss, equally popular');
    });

    it('caps a 30-point upset at +4 and shows the gap line and the cap', () => {
      const result = gain(versus(20, 50));
      expect(result.value).toBe(4);
      expect(stepLabels(result)[0]).toBe('Beat Kara Voss, 30 points more popular');
      const cap = expectTraceContains(result, { kind: 'clamp', label: PER_MATCH_LIMIT_LABEL });
      expect(cap.applied).toBe(true);
      expect(cap.before).toBeCloseTo(4.6, 10);
    });

    it('costs 0.5 for a loss to an equal opponent', () => {
      expect(gain({ outcome: 'loss' }).value).toBeCloseTo(-0.5, 10);
    });

    it('shrinks a +2 gain to +0.5 at momentum −100 and never below 0', () => {
      const flagship = { importance: 'flagship' } as const;
      expect(gain(flagship).value).toBeCloseTo(2, 10);
      const cold = gain({ ...flagship, momentum: pop(-100) });
      expect(cold.value).toBeCloseTo(0.5, 10);
      expect(stepLabels(cold)).toContain('Momentum −100: gains dampened');
      const frozen = gain(
        { ...flagship, momentum: pop(-100) },
        { 'match.popularity.coldMomentumFactor': 0 },
      );
      expect(frozen.value).toBe(0);
    });
  });

  describe('base', () => {
    it('hits the per-match limit on a 50-point upset', () => {
      const result = gain(versus(10, 60));
      expect(result.value).toBe(4);
      expect(
        expectTraceContains(result, { kind: 'clamp', label: PER_MATCH_LIMIT_LABEL }).applied,
      ).toBe(true);
    });

    it('floors a win over a much weaker opponent at 0', () => {
      const result = gain(versus(80, 30));
      expect(result.value).toBe(0);
      expect(stepLabels(result)[0]).toBe('Beat Kara Voss, 50 points less popular');
      expect(expectTraceContains(result, { kind: 'max', label: WIN_FLOOR_LABEL }).applied).toBe(
        true,
      );
    });

    it('shrinks a win over a slightly weaker opponent by the down-gap rate', () => {
      expect(gain(versus(60, 50)).value).toBeCloseTo(1 - 0.04 * 10, 10);
    });

    it('measures a win against the strongest beaten opponent', () => {
      const result = gain({
        popularity: pop(40),
        opponents: [
          { name: 'Weak', popularity: pop(10) },
          { name: 'Strong', popularity: pop(50) },
        ],
        competitorCount: 3,
      });
      expect(result.value).toBeCloseTo(1 + 0.12 * 10, 10);
      expect(stepLabels(result)[0]).toBe('Beat Strong, 10 points more popular');
    });

    it('costs more to lose to a weaker winner than to a stronger one', () => {
      const toWeaker = gain({ outcome: 'loss', ...versus(70, 50) });
      const toStronger = gain({ outcome: 'loss', ...versus(50, 70) });
      expect(toWeaker.value).toBeCloseTo(-(0.5 + 0.02 * 20), 10);
      expect(toStronger.value).toBeCloseTo(-0.5, 10);
      expect(toWeaker.value).toBeLessThan(toStronger.value);
      expect(stepLabels(toWeaker)).toContain('Lost to Kara Voss, 20 points less popular');
      expect(stepLabels(toStronger)).toContain('Lost to a more popular opponent');
    });

    it('moves a draw symmetrically and caps it at drawMax', () => {
      const up = gain({ outcome: 'draw', ...versus(40, 60) });
      const down = gain({ outcome: 'draw', ...versus(60, 40) });
      expect(up.value).toBeCloseTo(0.6, 10);
      expect(down.value).toBeCloseTo(-0.6, 10);
      expect(stepLabels(up)[0]).toBe('Draw against opponents averaging 60');
      expect(gain({ outcome: 'draw', ...versus(10, 90) }).value).toBeCloseTo(1, 10);
      expect(gain({ outcome: 'draw', ...versus(90, 10) }).value).toBeCloseTo(-1, 10);
      expect(gain({ outcome: 'draw' }).value).toBe(0);
    });

    it('gives 0 with a single line for a no contest', () => {
      const result = gain({ outcome: 'noContest', ...versus(10, 90), segmentScore: 100 });
      expect(result.value).toBe(0);
      expect(stepLabels(result)).toEqual([NO_CONTEST_LABEL]);
    });
  });

  describe('multipliers', () => {
    const gains: Record<EventImportance, number> = {
      house: 0.5,
      minor: 0.75,
      regular: 1,
      major: 1.5,
      flagship: 2,
    };
    const losses: Record<EventImportance, number> = {
      house: 0.5,
      minor: 0.75,
      regular: 1,
      major: 1,
      flagship: 1,
    };

    it.each(EVENT_IMPORTANCES)('scales a win and a loss at a %s show', (importance) => {
      const win = gain({ importance });
      expect(win.value).toBeCloseTo(gains[importance], 10);
      expect(stepLabels(win).some((label) => label.startsWith('Event size: '))).toBe(true);
      expect(gain({ importance, outcome: 'loss' }).value).toBeCloseTo(
        -0.5 * losses[importance],
        10,
      );
    });

    it('halves a pre-show match', () => {
      const result = gain({ preShow: true });
      expect(result.value).toBeCloseTo(0.5, 10);
      expect(stepLabels(result)).toContain(PRE_SHOW_LABEL);
      expect(stepLabels(gain())).not.toContain(PRE_SHOW_LABEL);
    });

    it('applies a disqualification finish to winner and loser', () => {
      const finish = { name: 'Disqualification', winnerFactor: 0.5, loserFactor: 0.3 };
      const win = gain({ finish });
      expect(win.value).toBeCloseTo(0.5, 10);
      expect(stepLabels(win)).toContain('Finish: Disqualification');
      expect(gain({ finish, outcome: 'loss' }).value).toBeCloseTo(-0.15, 10);
      expect(gain({ finish, outcome: 'draw', ...versus(40, 60) }).value).toBeCloseTo(0.6, 10);
      expect(stepLabels(gain())).toContain(NO_FINISH_LABEL);
    });

    it('shares popularity out in a crowded 10-way match', () => {
      const result = gain({ competitorCount: 10 });
      expect(result.value).toBeCloseTo(0.6, 10);
      expect(stepLabels(result)).toContain('Crowded match (10 competitors)');
      expect(gain({ competitorCount: 6 }).value).toBeCloseTo(1, 10);
      expect(gain({ competitorCount: 7 }).value).toBeCloseTo(6 / 7, 10);
    });
  });

  describe('bonuses', () => {
    it('stacks the great match and classic bonuses', () => {
      expect(gain({ segmentScore: 84 }).value).toBeCloseTo(1, 10);
      expect(gain({ segmentScore: 85 }).value).toBeCloseTo(1.3, 10);
      const classic = gain({ segmentScore: 95 });
      expect(classic.value).toBeCloseTo(1.6, 10);
      expect(stepLabels(classic)).toContain('Great match (score 95)');
      expect(stepLabels(classic)).toContain(CLASSIC_MATCH_LABEL);
      expect(stepLabels(gain())).toContain(NO_SCORE_LABEL);
    });

    it('lets a classic lift a narrow loss to a small gain, inside the limit', () => {
      expect(gain({ outcome: 'loss', segmentScore: 100 }).value).toBeCloseTo(0.1, 10);
    });

    it('keeps a bonus within the per-match limit', () => {
      const result = gain({ ...versus(10, 60), segmentScore: 100, priorWinStreak: 10 });
      expect(result.value).toBe(4);
    });

    it('adds a win streak bonus from the threshold on, capped at streakMax', () => {
      expect(gain({ priorWinStreak: 1 }).value).toBeCloseTo(1, 10);
      const atThreshold = gain({ priorWinStreak: 2 });
      expect(atThreshold.value).toBeCloseTo(1.2, 10);
      expect(stepLabels(atThreshold)).toContain('Win streak (2 straight before this)');
      expect(gain({ priorWinStreak: 3 }).value).toBeCloseTo(1.4, 10);
      expect(gain({ priorWinStreak: 10 }).value).toBeCloseTo(2, 10);
    });

    it('gives the win streak bonus to winners only', () => {
      expect(gain({ outcome: 'loss', priorWinStreak: 5 }).value).toBeCloseTo(-0.5, 10);
    });
  });

  describe('momentum', () => {
    const flagship = { importance: 'flagship' } as const;

    it('treats no momentum as neutral', () => {
      const result = gain({ ...flagship, momentum: null });
      expect(result.value).toBeCloseTo(2, 10);
      expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toContain(
        NO_MOMENTUM_LABEL,
      );
    });

    it('leaves a gain alone at momentum 0', () => {
      const result = gain({ ...flagship, momentum: pop(0) });
      expect(result.value).toBeCloseTo(2, 10);
      expect(stepLabels(result)).toContain('Momentum 0: neutral');
    });

    it('lifts a gain at momentum +100', () => {
      const result = gain({ ...flagship, momentum: pop(100) });
      expect(result.value).toBeCloseTo(2.5, 10);
      expect(stepLabels(result)).toContain('Momentum 100: on a roll');
    });

    it('dampens halfway at momentum −50', () => {
      expect(gain({ ...flagship, momentum: pop(-50) }).value).toBeCloseTo(2 * 0.625, 10);
    });

    it('never multiplies a loss by momentum', () => {
      for (const momentum of [-100, 0, 100]) {
        const result = gain({ outcome: 'loss', momentum: pop(momentum) });
        expect(result.value).toBeCloseTo(-0.5, 10);
        expect(stepLabels(result).some((label) => label.startsWith('Momentum'))).toBe(false);
      }
    });
  });

  describe('properties (500 seeded cases)', () => {
    // Any declared stream will do: a detached stream with its own seed draws only for this test.
    const stream = detachedStream('popularity-gain', MATCH_PREVIEW_STREAM, 'cases');
    const cases = Array.from({ length: 500 }, () => {
      const opponentCount = intBetween(stream, 1, 4);
      const inputs: PopularityGainInputs = {
        outcome: pick(stream, OUTCOMES),
        popularity: pop(floatBetween(stream, 0, 100)),
        opponents: Array.from({ length: opponentCount }, (_, index) => ({
          name: `Opponent ${String(index + 1)}`,
          popularity: pop(floatBetween(stream, 0, 100)),
        })),
        importance: pick(stream, EVENT_IMPORTANCES),
        finish:
          intBetween(stream, 0, 3) === 0
            ? null
            : {
                name: 'Finish',
                winnerFactor: floatBetween(stream, 0, 3),
                loserFactor: floatBetween(stream, 0, 3),
              },
        competitorCount: opponentCount + intBetween(stream, 1, 10),
        segmentScore: intBetween(stream, 0, 4) === 0 ? null : floatBetween(stream, 0, 100),
        preShow: intBetween(stream, 0, 1) === 0,
        priorWinStreak: intBetween(stream, 0, 12),
        momentum: intBetween(stream, 0, 4) === 0 ? null : pop(floatBetween(stream, -100, 100)),
      };
      const overrides: TunableOverrides = {
        'match.popularity.maxGain': floatBetween(stream, 0, 20),
        'match.popularity.maxLoss': floatBetween(stream, 0, 20),
        'match.popularity.winBase': floatBetween(stream, 0, 10),
        'match.popularity.lossBase': floatBetween(stream, 0, 10),
        'match.popularity.greatMatchBonus': floatBetween(stream, 0, 5),
        'match.popularity.classicBonus': floatBetween(stream, 0, 5),
        'match.popularity.coldMomentumFactor': floatBetween(stream, 0, 1),
        'match.popularity.hotMomentumBonus': floatBetween(stream, 0, 2),
        'match.popularity.neutralMomentumAt': intBetween(stream, -19, 19) * 5,
      };
      return { inputs, overrides };
    });

    it('stays within the per-match limit, keeps signs and replays its trace', () => {
      for (const { inputs, overrides } of cases) {
        const tunables = createEngineTunables(overrides);
        const result = popularityGain(inputs, { tunables });
        expectTraceReplays(result);
        expectSerialisable(result);
        expect(result.value).toBeGreaterThanOrEqual(-tunables.get('match.popularity.maxLoss'));
        expect(result.value).toBeLessThanOrEqual(tunables.get('match.popularity.maxGain'));
        if (inputs.outcome === 'win') {
          expect(result.value).toBeGreaterThanOrEqual(0);
        }
        if (inputs.outcome === 'noContest') {
          expect(result.value).toBe(0);
        }

        const neutral = popularityGain({ ...inputs, momentum: null }, { tunables });
        expect(result.value * neutral.value).toBeGreaterThanOrEqual(0);
        if (neutral.value <= 0) {
          expect(result.value).toBe(neutral.value);
        }

        if (inputs.outcome === 'loss') {
          const noBonus = popularityGain(
            { ...inputs, segmentScore: null, priorWinStreak: 0 },
            { tunables },
          );
          expect(result.value).toBeGreaterThanOrEqual(noBonus.value);
        }
      }
    });
  });
});
