// Decision builder. Design: docs/design/calculation-traces.md#decision-traces
import '../rng/testStreams';
import { describe, expect, it } from 'vitest';
import {
  createTunables,
  defineTunables,
  InvalidArgumentError,
  RngRegistry,
  rollChance,
  startCalc,
  startDecision,
  TRACE_MAX_NODES,
  countTraceNodes,
} from '@ringside/engine';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../support/trace';

type TitleChoice = 'retain' | 'change' | 'vacate';

describe('startDecision', () => {
  it('keeps considered options in insertion order with their scores', () => {
    const result = startDecision<TitleChoice>('Title decision')
      .consider('vacate', 5, 'Champion is out injured')
      .consider('retain', 62)
      .consider('change', 48, 'Challenger is hot')
      .choose('retain', 'Keeping the title scored highest');

    expect(result.value).toBe('retain');
    expect(result.trace).toMatchObject({ kind: 'decision', chosen: 'retain', value: 'retain' });
    const decision = expectTraceContains(result, { kind: 'decision' });
    expect(decision.considered).toStrictEqual([
      { option: 'vacate', score: 5, reason: 'Champion is out injured' },
      { option: 'retain', score: 62 },
      { option: 'change', score: 48, reason: 'Challenger is hot' },
    ]);
    expectSerialisable(result);
  });

  it('records the reason given to choose', () => {
    const result = startDecision<TitleChoice>('Title decision', { docRef: 'titles.md#ai' })
      .consider('retain', 10)
      .choose('retain', 'Only option left');
    expect(result.trace).toMatchObject({
      label: 'Title decision',
      reason: 'Only option left',
      docRef: 'titles.md#ai',
    });
    expectSerialisable(result);
  });

  it('embeds traced scores as children, and they replay', () => {
    const retainScore = startCalc('Score to keep the title', 40).add('Reign drawing', 12).done();
    const result = startDecision<TitleChoice>('Title decision')
      .consider('retain', retainScore)
      .consider('change', 30)
      .choose('retain', 'Higher score');

    expect(result.trace.children).toStrictEqual([retainScore.trace]);
    expect(expectTraceContains(result, { kind: 'decision' }).considered[0]?.score).toBe(52);
    expectTraceReplays(retainScore);
    expectSerialisable(result);
  });

  it('records a roll in the tree', () => {
    const stream = new RngRegistry('trace-decision').stream('test.gamma');
    const upset = rollChance(stream, 0.2, 'Upset check');
    const result = startDecision<boolean>('Does the underdog win?')
      .rule('Underdog is booked strong', true)
      .roll(upset.roll)
      .choose(upset.value, upset.value ? 'The upset roll came up' : 'The upset roll missed');

    expect(result.value).toBe(upset.value);
    expect(expectRollRecorded(result, 'test.gamma')).toStrictEqual(upset.roll);
    expect(expectTraceContains(result, { kind: 'roll', label: 'Upset check' }).value).toBe(
      upset.value,
    );
    expect(expectTraceContains(result, { kind: 'branch' })).toMatchObject({
      condition: 'Underdog is booked strong',
      taken: true,
    });
    expectSerialisable(result);
  });

  it('records tunables and notes as children', () => {
    const tunables = createTunables(
      defineTunables({
        'test.upsetThreshold': {
          kind: 'integer',
          default: 20,
          min: 0,
          max: 100,
          unit: 'points',
          category: 'Test',
          description: 'Gap that makes a result an upset.',
        },
      }),
      {},
    );
    const decision = startDecision<boolean>('Is it an upset?');
    const threshold = decision.tunable(tunables, 'test.upsetThreshold', 'Upset threshold');
    const result = decision
      .note('Popularity gap of 25')
      .rule(`Gap of 25 is at least ${String(threshold)}`, 25 >= threshold)
      .choose(true, 'The gap is over the threshold');

    expect(result.trace.children?.map((node) => node.kind)).toStrictEqual([
      'tunable',
      'note',
      'branch',
    ]);
    expect(expectTraceContains(result, { kind: 'tunable' })).toMatchObject({
      label: 'Upset threshold',
      value: 20,
      overridden: false,
    });
    expectSerialisable(result);
  });

  it('leaves out children when nothing but options was recorded', () => {
    const result = startDecision<'a' | 'b'>('Pick').consider('a', 1).choose('a', 'Only one');
    expect('children' in result.trace).toBe(false);
    expectSerialisable(result);
  });

  it('rejects a duplicate option, an unconsidered choice and a non-finite score', () => {
    const decision = startDecision<TitleChoice>('Title decision').consider('retain', 1);
    expect(() => decision.consider('retain', 2)).toThrow(InvalidArgumentError);
    expect(() => decision.choose('change', 'Not considered')).toThrow(InvalidArgumentError);
    expect(() => decision.consider('change', Number.NaN)).toThrow(InvalidArgumentError);
  });

  it('allows a yes/no outcome with rules only', () => {
    const result = startDecision<boolean>('Can they wrestle tonight?')
      .rule('Not injured', true)
      .rule('Fatigue under 80', false)
      .choose(false, 'Too tired');
    expect(result.value).toBe(false);
    expect(result.trace).toMatchObject({ considered: [], chosen: false });
    expectSerialisable(result);
  });

  it('caps a decision over a huge roster at the node limit', () => {
    const decision = startDecision<string>('Draft pick');
    for (let i = 0; i < 600; i++) {
      decision.consider(`worker-${String(i)}`, startCalc(`Fit for worker ${String(i)}`, i).done());
    }
    const result = decision.choose('worker-599', 'Best fit');
    expect(countTraceNodes(result.trace)).toBeLessThanOrEqual(TRACE_MAX_NODES + 1);
    expect(expectTraceContains(result, { kind: 'decision' }).considered).toHaveLength(600);
    expectTraceContains(result, { kind: 'note', label: /more steps not shown$/ });
    expectSerialisable(result);
  });

  it('nests a non-numeric decision under a label with include', () => {
    const challenger = startDecision<string>('Challenger for the Test Title')
      .consider('Haruto Ise', 71)
      .choose('Haruto Ise', 'Best card value');
    const weight = startCalc('Weight of Singles', 100).done();
    const result = startDecision<string>('Haruto Ise vs Daichi Kuroe')
      .include('Who challenges', challenger)
      .include('Match type weight', weight.trace)
      .choose('Singles', 'Rolled');

    const nested = expectTraceContains(result, { kind: 'decision', label: 'Who challenges' });
    expect(nested).toMatchObject({ chosen: 'Haruto Ise', considered: [{ option: 'Haruto Ise' }] });
    expectTraceContains(result, { kind: 'formula', label: 'Match type weight' });
    // The included traces are copied, not changed.
    expect(challenger.trace.label).toBe('Challenger for the Test Title');
    expectSerialisable(result);
  });
});

