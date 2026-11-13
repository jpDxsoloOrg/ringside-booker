// Ring learning (MTCH4-03). Design: docs/design/physical-toll.md#ring-learning
import { describe, expect, it } from 'vitest';
import { findTraceNodes, walkTrace } from '../../../../src/core/trace';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import {
  LIMITED_BY_POTENTIAL_LABEL,
  computeRingLearning,
  computeRingLearningTotal,
  type RingLearningInputs,
} from '../../../../src/systems/match';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

/** A standard match against an equal opponent, no teacher, no producer: base 0.03 and nothing else. */
function inputs(overrides: Partial<RingLearningInputs> = {}): RingLearningInputs {
  return {
    name: 'Kai Moreno',
    attribute: 'ringwork',
    durationClass: 'standard',
    value: 50,
    traits: [],
    others: [{ name: 'Rex Dalton', value: 50, teacher: false }],
    producer: null,
    mentor: null,
    room: 'open',
    ...overrides,
  };
}

function learn(overrides: Partial<RingLearningInputs> = {}, tunables: TunableOverrides = {}) {
  const result = computeRingLearning(inputs(overrides), {
    tunables: createEngineTunables(tunables),
  });
  expectTraceReplays(result);
  return result;
}

function labels(result: ReturnType<typeof learn>): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

const VETERAN = { name: 'Old Man Grady', value: 80, teacher: true };

describe('computeRingLearning', () => {
  it('is 0 when the base is 0', () => {
    expect(learn({}, { 'match.learning.base': 0 }).value).toBe(0);
  });

  it('is the base for a standard match with nothing else moving it', () => {
    expect(learn().value).toBeCloseTo(0.03);
  });

  it('teaches more the longer the match: long > standard > short', () => {
    const [short, standard, long] = (['short', 'standard', 'long'] as const).map(
      (durationClass) => learn({ durationClass }).value,
    );
    expect(short).toBeCloseTo(0.018);
    expect(standard).toBeCloseTo(0.03);
    expect(long).toBeCloseTo(0.042);
    expect(labels(learn({ durationClass: 'long' }))).toContain('Long duration class');
  });

  it('doubles a taught attribute next to someone better by at least the gap, naming them', () => {
    const better = learn({ others: [{ name: 'Rex Dalton', value: 55, teacher: false }] });
    expect(better.value).toBeCloseTo(0.06);
    expect(labels(better)).toContain('Learned from a better worker: Rex Dalton');
    const notEnough = learn({ others: [{ name: 'Rex Dalton', value: 54, teacher: false }] });
    expect(notEnough.value).toBeCloseTo(0.03);
  });

  it('names the best of several better workers', () => {
    const result = learn({
      others: [
        { name: 'Rex Dalton', value: 60, teacher: false },
        { name: 'Ana Silva', value: 70, teacher: false },
      ],
    });
    expect(labels(result)).toContain('Learned from a better worker: Ana Silva');
  });

  it('learns more with a teacher in the match, and the Why? names the teacher', () => {
    const without = learn({ others: [{ ...VETERAN, teacher: false }] });
    const withTeacher = learn({ others: [VETERAN] });
    expect(withTeacher.value).toBeGreaterThan(without.value);
    expect(withTeacher.value).toBeCloseTo(0.03 * 2 * 1.5);
    expect(labels(withTeacher)).toContain('Worked with a teacher: Old Man Grady');
  });

  it('counts a teaching producer, and caps two or more teachers at maxTeacherFactor', () => {
    const two = learn({
      others: [VETERAN],
      producer: { name: 'Pat Kole', producing: 10, teacher: true },
    });
    expect(labels(two)).toContain('Worked with a teacher: Old Man Grady, Pat Kole');
    expect(two.value).toBeCloseTo(0.03 * 2 * 2);
    const three = learn({
      others: [VETERAN, { name: 'Ana Silva', value: 50, teacher: true }],
      producer: { name: 'Pat Kole', producing: 10, teacher: true },
    });
    expect(three.value).toBeCloseTo(0.03 * 2 * 2);
    const limit = findTraceNodes(three.trace, 'min').find(
      (node) => node.label === 'Most teachers can add',
    );
    expect(limit?.applied).toBe(true);
  });

  it('never gives stamina the better-worker or teacher lines: it is learned by doing', () => {
    const result = learn({
      attribute: 'stamina',
      others: [VETERAN],
      producer: { name: 'Pat Kole', producing: 90, teacher: true },
    });
    expect(result.value).toBeCloseTo(0.03);
    expect(findTraceNodes(result.trace, 'branch').map((node) => node.label)).toEqual([
      'Learned by doing',
    ]);
    const all = labels(result).join('|');
    expect(all).not.toMatch(/better worker|teacher|Produced by/);
  });

  it('helps ring work and psychology only when the producer is skilled enough', () => {
    const below = learn({ producer: { name: 'Pat Kole', producing: 59, teacher: false } });
    expect(below.value).toBeCloseTo(0.03);
    expect(labels(below).join('|')).not.toContain('Produced by');
    const at = learn({ producer: { name: 'Pat Kole', producing: 60, teacher: false } });
    expect(at.value).toBeCloseTo(0.036);
    expect(labels(at)).toContain('Produced by Pat Kole');
    const psychology = learn({
      attribute: 'psychology',
      producer: { name: 'Pat Kole', producing: 60, teacher: false },
    });
    expect(labels(psychology)).toContain('Produced by Pat Kole');
    const safety = learn({
      attribute: 'safety',
      producer: { name: 'Pat Kole', producing: 90, teacher: false },
    });
    expect(labels(safety).join('|')).not.toContain('Produced by');
  });

  it('scales by the learning traits', () => {
    const fast = learn({ traits: ['fastLearner'] });
    expect(fast.value).toBeCloseTo(0.045);
    expect(labels(fast)).toContain('Fast learner');
    const slow = learn({ traits: ['slowLearner'] });
    expect(slow.value).toBeCloseTo(0.018);
    expect(labels(slow)).toContain('Slow learner');
  });

  it('adds the mentor bonus with a line naming the mentor', () => {
    const result = learn({ mentor: { name: 'Old Man Grady' } });
    expect(result.value).toBeCloseTo(0.0375);
    expect(labels(result)).toContain('Mentor on the card: Old Man Grady');
    expect(labels(learn()).join('|')).not.toContain('Mentor');
  });

  it('reads "Limited by potential" for a slowing and a closed room, and nothing when open', () => {
    const slowing = learn({ room: 'slowing' });
    expect(slowing.value).toBeCloseTo(0.012);
    expect(labels(slowing)).toContain(LIMITED_BY_POTENTIAL_LABEL);
    const closed = learn({ room: 'closed' });
    expect(labels(closed)).toContain(LIMITED_BY_POTENTIAL_LABEL);
    expect(labels(learn()).join('|')).not.toContain(LIMITED_BY_POTENTIAL_LABEL);
  });

  it('gives exactly 0 in a closed room, whatever bonuses came before', () => {
    const closed = learn({
      room: 'closed',
      durationClass: 'long',
      traits: ['fastLearner'],
      others: [VETERAN],
      mentor: { name: 'Old Man Grady' },
    });
    expect(closed.value).toBe(0);
  });

  it('applies the gate as the last step before the clamp', () => {
    const steps = labels(learn({ room: 'slowing', mentor: { name: 'Old Man Grady' } }));
    expect(steps.slice(-2)).toEqual([
      LIMITED_BY_POTENTIAL_LABEL,
      'Between 0 and the most one match can teach',
    ]);
  });

  it('is clamped at maxPerSegment', () => {
    const result = learn(
      { durationClass: 'long', traits: ['fastLearner'], others: [VETERAN] },
      { 'match.learning.base': 1 },
    );
    expect(result.value).toBe(0.2);
    expect(findTraceNodes(result.trace, 'clamp')[0]?.applied).toBe(true);
  });

  it('records a serialisable trace with the doc anchor', () => {
    const result = learn({
      others: [VETERAN],
      producer: { name: 'Pat Kole', producing: 70, teacher: false },
      mentor: { name: 'Old Man Grady' },
      room: 'slowing',
    });
    expect(result.trace.docRef).toBe('physical-toll.md#ring-learning');
    expectSerialisable(result);
  });
});

describe('computeRingLearningTotal', () => {
  it('adds each attribute as a labelled line that opens to its own trace', () => {
    const ringwork = learn({ others: [VETERAN] });
    const stamina = learn({ attribute: 'stamina' });
    const total = computeRingLearningTotal({ ringwork, stamina });
    expectTraceReplays(total);
    expect(total.trace.label).toBe('Learning in this match');
    expect(total.value).toBeCloseTo(ringwork.value + stamina.value);
    expect(labels(total)).toEqual(['Nothing yet', 'Ring work +0.09', 'Stamina +0.03']);
    const lines = findTraceNodes(total.trace, 'add');
    expect(lines[0]?.children?.[0]).toEqual(ringwork.trace);
  });

  it('is 0 with nothing learned', () => {
    const total = computeRingLearningTotal({});
    expect(total.value).toBe(0);
    let nodes = 0;
    walkTrace(total.trace, () => {
      nodes += 1;
    });
    expect(nodes).toBe(2);
  });
});
