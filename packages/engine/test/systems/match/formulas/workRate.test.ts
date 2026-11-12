// Work rate. Design: docs/design/match-rating.md#work-rate
import { describe, expect, it } from 'vitest';
import { floatBetween, intBetween } from '../../../../src/core/rng/odds';
import { RngRegistry, type RngStream } from '../../../../src/core/rng/registry';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { RING_STYLES } from '../../../../src/model/entities/person';
import {
  DURATION_CLASSES,
  MATCH_RATING_STREAM,
  NO_VARIANCE_NOTE,
  matchLeaderOf,
  workerPerformance,
  workRate,
  type DurationClass,
  type WorkRateInputs,
  type WorkRateSide,
  type WorkRateWorker,
} from '../../../../src/systems/match';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const DEFAULT_TUNABLES = createEngineTunables();

/** A worker with every in-ring attribute at `inRing`, rested and healthy. */
function worker(
  id: string,
  name: string,
  stamina: number,
  inRing = 70,
  tunables: EngineTunables = DEFAULT_TUNABLES,
): WorkRateWorker {
  const performance = workerPerformance(
    {
      personId: id,
      name,
      axis: 'inRing',
      attributes: {
        ringwork: inRing,
        psychology: inRing,
        athleticism: inRing,
        safety: inRing,
        mic: 50,
        charisma: 50,
        presence: 50,
      },
      style: 'technician',
      fatigue: 0,
      injured: false,
      styleAffinity: [],
    },
    { tunables },
  );
  return { id, name, performance, stamina };
}

const DURATION_LABELS: Readonly<Record<DurationClass, string>> = {
  short: 'Opener (short)',
  standard: 'Midcard (standard)',
  long: 'Main event (long)',
};

interface SinglesOptions {
  durationClass?: DurationClass;
  stamina?: number;
  inRing?: number;
  leaderPsychology?: number;
  workRateFactor?: number;
}

function singles(options: SinglesOptions = {}): WorkRateInputs {
  const stamina = options.stamina ?? 70;
  const inRing = options.inRing ?? 70;
  const durationClass = options.durationClass ?? 'standard';
  return {
    durationClass,
    durationLabel: DURATION_LABELS[durationClass],
    sides: [
      { side: 0, members: [worker('per_kade', 'Kade Morrow', stamina, inRing)] },
      { side: 1, members: [worker('per_rook', 'Rook Vance', stamina, inRing)] },
    ],
    workerCount: 2,
    leader: { id: 'per_kade', name: 'Kade Morrow', psychology: options.leaderPsychology ?? 70 },
    matchType: { name: 'Singles', workRateFactor: options.workRateFactor ?? 1 },
  };
}

function rate(inputs: WorkRateInputs, overrides: TunableOverrides = {}, rng?: RngStream) {
  const tunables = createEngineTunables(overrides);
  const result = workRate(inputs, rng === undefined ? { tunables } : { tunables, rng });
  expectTraceReplays(result);
  expectSerialisable(result.trace);
  return result;
}

function staminaLines(result: Traced<number>): string[] {
  return findTraceNodes(result.trace, 'subtract')
    .map((node) => node.label)
    .filter((label) => label.includes('stamina check'));
}

function stream(seed: string): RngStream {
  return new RngRegistry(seed).stream(MATCH_RATING_STREAM);
}

describe('workRate', () => {
  describe('worked examples', () => {
    it('rates a standard midcard singles between two 70s with stamina 70 at 70', () => {
      const result = rate(singles());
      expect(result.value).toBeCloseTo(70, 9);
      expectTraceContains(result, { kind: 'note', label: NO_VARIANCE_NOTE });
    });

    it('costs each 6 on stamina in the main event, then the long spread turns 64 into 66.1', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 50 }));
      expect(result.value).toBeCloseTo(66.1, 9);
      expect(staminaLines(result)).toEqual([
        'Main event (long): stamina check failed for Kade Morrow, −6',
        'Main event (long): stamina check failed for Rook Vance, −6',
      ]);
    });
  });

  describe('stamina', () => {
    it('asks nothing in a short match, so no check fails', () => {
      const result = rate(singles({ durationClass: 'short', stamina: 0 }));
      expect(staminaLines(result)).toEqual([
        'Opener (short): stamina check passed for Kade Morrow',
        'Opener (short): stamina check passed for Rook Vance',
      ]);
      // 50 + (70 − 50) × 0.8
      expect(result.value).toBeCloseTo(66, 9);
    });

    it('fails a long match with stamina 50 by 15, costing 6 at the defaults', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 50 }));
      const penalty = expectTraceContains(result, {
        kind: 'formula',
        label: 'Stamina penalty for Kade Morrow',
      });
      expect(penalty.value).toBeCloseTo(6, 9);
    });

    it('passes at exactly the need', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 65 }));
      expect(staminaLines(result)[0]).toBe(
        'Main event (long): stamina check passed for Kade Morrow',
      );
    });

    it('shares the load between four workers: need × 0.707', () => {
      const tag: WorkRateInputs = {
        ...singles({ durationClass: 'long' }),
        sides: [
          { side: 0, members: [worker('a', 'Ash', 40), worker('b', 'Bram', 40)] },
          { side: 1, members: [worker('c', 'Cole', 40), worker('d', 'Dax', 40)] },
        ],
        workerCount: 4,
      };
      const result = rate(tag);
      const penalty = expectTraceContains(result, {
        kind: 'formula',
        label: 'Stamina penalty for Ash',
      });
      expect(penalty.value).toBeCloseTo((65 * Math.SQRT1_2 - 40) * 0.4, 9);
    });

    it('makes everyone carry the full load at exponent 0', () => {
      const tag: WorkRateInputs = {
        ...singles({ durationClass: 'long' }),
        sides: [
          { side: 0, members: [worker('a', 'Ash', 40), worker('b', 'Bram', 40)] },
          { side: 1, members: [worker('c', 'Cole', 40), worker('d', 'Dax', 40)] },
        ],
        workerCount: 4,
      };
      const result = rate(tag, { 'match.workRate.sharedLoadExponent': 0 });
      const penalty = expectTraceContains(result, {
        kind: 'formula',
        label: 'Stamina penalty for Ash',
      });
      expect(penalty.value).toBeCloseTo((65 - 40) * 0.4, 9);
    });

    it('costs nothing at penalty 0', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 0 }), {
        'match.workRate.staminaPenaltyPerPoint': 0,
      });
      expect(result.value).toBeCloseTo(73, 9);
    });
  });

  describe('psychology', () => {
    it('costs 9 when the leader has 52 in a long match', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 100, leaderPsychology: 52 }));
      const line = expectTraceContains(result, {
        kind: 'subtract',
        label: 'Nobody to lead a long match: best psychology 52 (Kade Morrow), needs 70',
      });
      expect(line.operand).toBeCloseTo(9, 9);
      // 50 + (70 − 9 − 50) × 1.15
      expect(result.value).toBeCloseTo(62.65, 9);
    });

    it('says the leader can lead when they have enough', () => {
      const result = rate(singles({ durationClass: 'long', stamina: 100, leaderPsychology: 70 }));
      expectTraceContains(result, {
        kind: 'subtract',
        label: 'Kade Morrow can lead a long match: psychology 70 (Kade Morrow), needs 70',
      });
    });

    it('costs nothing at penalty 0', () => {
      const result = rate(singles({ leaderPsychology: 0 }), {
        'match.workRate.psychologyPenaltyPerPoint': 0,
      });
      expect(result.value).toBeCloseTo(70, 9);
    });

    it('picks the leader by psychology, ties by id', () => {
      expect(
        matchLeaderOf([
          { id: 'per_b', name: 'Bram', psychology: 80 },
          { id: 'per_c', name: 'Cole', psychology: 60 },
          { id: 'per_a', name: 'Ash', psychology: 80 },
        ]).name,
      ).toBe('Ash');
      expect(() => matchLeaderOf([])).toThrow(RangeError);
    });
  });

  describe('spread and factor', () => {
    it('moves 70 to 73 with the long spread of 1.15', () => {
      expect(rate(singles({ durationClass: 'long', stamina: 100 })).value).toBeCloseTo(73, 9);
    });

    it('makes every match a 50 at spread 0', () => {
      expect(rate(singles({ inRing: 95 }), { 'match.workRate.spread.standard': 0 }).value).toBe(50);
    });

    it('stretches further at spread 2', () => {
      expect(rate(singles(), { 'match.workRate.spread.standard': 2 }).value).toBeCloseTo(90, 9);
    });

    it('multiplies by the match type factor, labelled with the match type', () => {
      const result = rate(singles({ workRateFactor: 1.2 }));
      expect(result.value).toBeCloseTo(84, 9);
      const constant = expectTraceContains(result, {
        kind: 'constant',
        label: 'Singles work rate factor',
      });
      expect(constant.reason).toBe('Set by the Singles match type');
    });

    it('floors at 0 and has no upper clamp', () => {
      const low = rate(singles({ inRing: 0, durationClass: 'short' }), {
        'match.workRate.spread.short': 2,
      });
      expect(low.value).toBe(0);
      expect(expectTraceContains(low, { kind: 'max', label: 'Never below 0' }).applied).toBe(true);
      const high = rate(singles({ inRing: 100, stamina: 100, workRateFactor: 1.5 }), {
        'match.workRate.spread.standard': 2,
      });
      expect(high.value).toBeCloseTo(225, 9);
    });
  });

  describe('variance', () => {
    it('rolls from the stream it is given', () => {
      const result = rate(singles(), {}, stream('variance'));
      const roll = expectRollRecorded(result, MATCH_RATING_STREAM);
      expect(roll.kind).toBe('normal');
      expect(roll.label).toBe('Night-to-night variance');
      expect(result.value).toBeCloseTo(70 + Number(roll.result), 9);
    });

    it('gives the same value as no rng at sd 0', () => {
      const without = rate(singles());
      const withRoll = rate(singles(), { 'match.workRate.varianceSd': 0 }, stream('variance'));
      expect(withRoll.value).toBe(without.value);
    });

    it('gives the same value for the same seed', () => {
      expect(rate(singles(), {}, stream('same')).value).toBe(
        rate(singles(), {}, stream('same')).value,
      );
    });
  });

  describe('trace', () => {
    it('names the duration class and shows one stamina line per worker plus the psychology line', () => {
      const result = rate(singles({ durationClass: 'long' }));
      expect(result.trace.label).toBe('Work rate');
      expect(result.trace.kind === 'formula' && result.trace.docRef).toBe(
        'match-rating.md#work-rate',
      );
      expectTraceContains(result, { kind: 'note', label: 'Duration: Main event (long)' });
      expect(staminaLines(result)).toHaveLength(2);
      expectTraceContains(result, { kind: 'subtract', label: /lead a long match/ });
      expectTraceContains(result, { kind: 'formula', label: 'Across sides' });
      expectTraceContains(result, { kind: 'formula', label: 'Side 2' });
    });
    it('keeps a tag match trace whole, with nothing cut by the size limits', () => {
      const tag: WorkRateInputs = {
        ...singles({ durationClass: 'long' }),
        sides: [
          { side: 0, members: [worker('a', 'Ash', 40), worker('b', 'Bram', 40)] },
          { side: 1, members: [worker('c', 'Cole', 40), worker('d', 'Dax', 40)] },
        ],
        workerCount: 4,
      };
      const result = rate(tag);
      const cut = findTraceNodes(result.trace, 'note').filter(
        (node) => node.hiddenSteps !== undefined,
      );
      expect(cut).toEqual([]);
      expect(findTraceNodes(result.trace, 'tunable').map((node) => node.key)).toContain(
        'match.perf.inRing.ringwork',
      );
    });
  });

  describe('invalid input', () => {
    it('refuses no sides, an empty side and a worker count below 1', () => {
      const tunables = DEFAULT_TUNABLES;
      expect(() => workRate({ ...singles(), sides: [] }, { tunables })).toThrow(/sides/);
      expect(() =>
        workRate({ ...singles(), sides: [{ side: 0, members: [] }] }, { tunables }),
      ).toThrow(RangeError);
      expect(() => workRate({ ...singles(), workerCount: 0 }, { tunables })).toThrow(/workerCount/);
    });
  });

  describe('property: 1,000 seeded line-ups', () => {
    const generator = stream('mtch1-03-line-ups');

    function randomWorker(index: number): WorkRateWorker & { psychology: number } {
      const id = `per_${String(index).padStart(3, '0')}`;
      const psychology = floatBetween(generator, 0, 100);
      const performance = workerPerformance(
        {
          personId: id,
          name: `Worker ${String(index)}`,
          axis: 'inRing',
          attributes: {
            ringwork: floatBetween(generator, 0, 100),
            psychology,
            athleticism: floatBetween(generator, 0, 100),
            safety: floatBetween(generator, 0, 100),
            mic: 50,
            charisma: 50,
            presence: 50,
          },
          style: RING_STYLES[intBetween(generator, 0, RING_STYLES.length - 1)] ?? 'allRounder',
          fatigue: floatBetween(generator, 0, 100),
          injured: intBetween(generator, 0, 4) === 0,
          styleAffinity: ['brawler', 'technician'],
        },
        { tunables: DEFAULT_TUNABLES },
      );
      return {
        id,
        name: `Worker ${String(index)}`,
        performance,
        stamina: floatBetween(generator, 0, 100),
        psychology,
      };
    }

    function randomLineUp(): WorkRateInputs {
      const sideCount = intBetween(generator, 2, 4);
      const all: (WorkRateWorker & { psychology: number })[] = [];
      const sides: WorkRateSide[] = [];
      for (let side = 0; side < sideCount; side += 1) {
        const members: WorkRateWorker[] = [];
        const size = intBetween(generator, 1, 3);
        for (let slot = 0; slot < size; slot += 1) {
          const made = randomWorker(all.length);
          all.push(made);
          members.push({
            id: made.id,
            name: made.name,
            performance: made.performance,
            stamina: made.stamina,
          });
        }
        sides.push({ side, members });
      }
      const durationClass =
        DURATION_CLASSES[intBetween(generator, 0, DURATION_CLASSES.length - 1)] ?? 'standard';
      return {
        durationClass,
        durationLabel: DURATION_LABELS[durationClass],
        sides,
        workerCount: all.length,
        leader: matchLeaderOf(all),
        matchType: { name: 'Test match', workRateFactor: floatBetween(generator, 0.5, 1.5) },
      };
    }

    /** The same line-up with the first two workers of the first side that has two swapped. */
    function swapped(inputs: WorkRateInputs): WorkRateInputs | null {
      const index = inputs.sides.findIndex((side) => side.members.length >= 2);
      const side = inputs.sides[index];
      if (side === undefined) {
        return null;
      }
      const [first, second, ...rest] = side.members;
      if (first === undefined || second === undefined) {
        return null;
      }
      const sides = inputs.sides.map((entry, at) =>
        at === index ? { side: entry.side, members: [second, first, ...rest] } : entry,
      );
      return { ...inputs, sides };
    }

    it('is never NaN or negative, and swapping two workers on a side changes nothing', () => {
      let swaps = 0;
      for (let run = 0; run < 1000; run += 1) {
        const inputs = randomLineUp();
        const seed = `run-${String(run)}`;
        const result = workRate(inputs, { tunables: DEFAULT_TUNABLES, rng: stream(seed) });
        expect(Number.isNaN(result.value)).toBe(false);
        expect(result.value).toBeGreaterThanOrEqual(0);
        if (run % 50 === 0) {
          expectTraceReplays(result);
        }
        const other = swapped(inputs);
        if (other !== null) {
          swaps += 1;
          const again = workRate(other, { tunables: DEFAULT_TUNABLES, rng: stream(seed) });
          expect(again.value).toBe(result.value);
        }
      }
      expect(swaps).toBeGreaterThan(100);
    });
  });
});
