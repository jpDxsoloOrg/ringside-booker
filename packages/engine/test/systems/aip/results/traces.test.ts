// The rival results' trace kinds (AIP5-01). Design: docs/design/rival-booking.md#winners
import { describe, expect, it } from 'vitest';
import type { SegmentId, TitleId } from '../../../../src/core/ids';
import { refKey, TRACE_REF_KIND_PATTERN } from '../../../../src/core/trace/store';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { rollFloat } from '../../../../src/core/rng/rolls';
import {
  startCalc,
  startDecision,
  walkTrace,
  type TraceNode,
  type Traced,
} from '../../../../src/core/trace';
import {
  leanTrace,
  optionWords,
  TITLE_TRACE_KIND,
  titleTraceRef,
  WINNER_TRACE_KIND,
  WINNERS_DOC_REF,
  WINNERS_STREAM,
  winnerTraceRef,
  wordedOptions,
} from '../../../../src/systems/aip';
import { testId } from '../../../support/ids';
import { worldBuilder } from '../../../support/world-builder';

describe('the rival results trace kinds', () => {
  const segmentId: SegmentId = testId('segment');
  const titleId: TitleId = testId('title');

  it('are valid trace kinds of their own', () => {
    expect(TRACE_REF_KIND_PATTERN.test(WINNER_TRACE_KIND)).toBe(true);
    expect(TRACE_REF_KIND_PATTERN.test(TITLE_TRACE_KIND)).toBe(true);
    expect(WINNER_TRACE_KIND).not.toBe(TITLE_TRACE_KIND);
    expect(WINNER_TRACE_KIND).not.toBe('segment.rating');
  });

  it('round-trip through refKey', () => {
    const winner = winnerTraceRef(segmentId);
    expect(winner).toEqual({ kind: 'aip.winner', id: segmentId });
    expect(refKey(winner)).toBe(`aip.winner:${segmentId}`);

    const title = titleTraceRef(segmentId, titleId);
    expect(title).toEqual({ kind: 'aip.title', id: `${segmentId}|${titleId}` });
    const key = refKey(title);
    expect(key).toBe(`aip.title:${segmentId}|${titleId}`);
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    expect({ kind, id }).toEqual(title);
    expect(id.split('|')).toEqual([segmentId, titleId]);
  });
});

describe('stored rival results (AIP5-06)', () => {
  const world = worldBuilder().withGeography('mini').withCatalogs().build().world;

  function sample(): Traced<string> {
    const value = startCalc("Kai: booker's value", 30, { docRef: WINNERS_DOC_REF });
    const roll = rollFloat(
      new RngRegistry('lean').stream(WINNERS_STREAM),
      -0.1,
      0.1,
      'Gut feeling',
    );
    value.add('Gut feeling', roll.value);
    const who = startDecision<string>('Who wins: Kai vs Rex', { docRef: WINNERS_DOC_REF })
      .consider('side:0', value.done(), 'Kai')
      .consider('side:1', 20, 'Rex')
      .roll(roll.roll)
      .choose('side:0', 'Higher value');
    const method = startDecision<string>('How the match is won', { docRef: WINNERS_DOC_REF })
      .consider('method.pinfall', 1, 'Pinfall')
      .choose('method.pinfall', 'Pinfall');
    // A roll with the steps that set its range under it, as the side values record them.
    const rollWithSteps: TraceNode = {
      kind: 'roll',
      label: 'Gut feeling',
      value: roll.value,
      roll: roll.roll,
      children: [{ kind: 'note', label: '1 more step not shown', value: null }],
    };
    return startDecision<string>('Booked result: Kai vs Rex', { docRef: WINNERS_DOC_REF })
      .include('Gut feeling', rollWithSteps)
      .include('Who wins', who)
      .include('How the match is won', method)
      .choose('side:0', 'Higher value');
  }

  it('drops repeated doc links and the steps under a roll, keeping every value', () => {
    const traced = sample();
    const lean = leanTrace(traced);
    expect(lean.value).toBe('side:0');
    expect(lean.trace.docRef).toBe(WINNERS_DOC_REF);
    const nodes: TraceNode[] = [];
    walkTrace(lean.trace, (node) => {
      nodes.push(node);
    });
    expect(nodes.filter((node) => node.docRef !== undefined)).toHaveLength(1);
    expect(nodes.filter((node) => node.kind === 'roll' && node.children !== undefined)).toEqual([]);
    expect(nodes.length).toBeGreaterThan(5);
    expect(JSON.stringify(lean.trace).length).toBeLessThan(JSON.stringify(traced.trace).length);
  });

  it('words side and method codes, keeping the plan code as the value', () => {
    const words = optionWords(world, [
      { side: 0, label: 'Kai' },
      { side: 1, label: 'Rex' },
    ]);
    const [method] = Object.values(world.meta.catalogs.methods ?? {});
    expect(method).toBeDefined();
    expect(words.get(method?.key ?? 'none')).toBe(method?.name);
    const worded = wordedOptions(sample(), words);
    expect(worded.value).toBe('side:0');
    const text = JSON.stringify(worded.trace);
    expect(text).not.toMatch(/side:\d/);
    const root = worded.trace;
    expect(root.kind === 'decision' && root.chosen).toBe('Kai');
    const who = root.children?.find((child) => child.label === 'Who wins');
    expect(who?.kind === 'decision' && who.considered).toEqual([
      { option: 'Kai', score: expect.any(Number) as unknown },
      { option: 'Rex', score: 20 },
    ]);
  });

  it('tells two sides with the same names apart', () => {
    const words = optionWords(world, [
      { side: 0, label: 'The Twins' },
      { side: 1, label: 'The Twins' },
    ]);
    expect(words.get('side:0')).toBe('The Twins (side 1)');
    expect(words.get('side:1')).toBe('The Twins (side 2)');
  });
});
