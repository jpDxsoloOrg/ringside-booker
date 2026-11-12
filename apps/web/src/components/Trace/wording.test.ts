import { describe, expect, it } from 'vitest';
import type { TraceNode } from '@ringside/engine';
import { choiceText, describeTraceNode, traceLineText, traceValueText } from './wording';

describe('choiceText', () => {
  it.each([
    ['mainEvent', 'Main event'],
    ['upperCard', 'Upper card'],
    ['lightHeavyweight', 'Light heavyweight'],
    ['lightweight', 'Lightweight'],
    ['none', 'None'],
    ['preferredVenue', 'Preferred venue'],
  ])('reads the code %s as "%s"', (code, words) => {
    expect(choiceText(code)).toBe(words);
  });

  it.each(['Test Promotion A', 'Keep the champion', 'per_0001', 'A+', ''])(
    'leaves "%s" alone, since it is not a code',
    (text) => {
      expect(choiceText(text)).toBe(text);
    },
  );

  it('reads yes and no for a yes/no decision', () => {
    expect(choiceText(true)).toBe('yes');
    expect(choiceText(false)).toBe('no');
  });
});

describe('traceValueText', () => {
  it('words a decision by its choice and a number by its unit', () => {
    const decision: TraceNode = {
      kind: 'decision',
      label: 'Weight class',
      value: 'superHeavyweight',
      chosen: 'superHeavyweight',
      reason: '140 kg is over the Heavyweight limit of 130 kg',
      considered: [],
    };
    const weight: TraceNode = { kind: 'input', label: 'Weight', value: 104, unit: 'kilograms' };
    expect(traceValueText(decision)).toBe('Super heavyweight');
    expect(traceValueText(weight)).toBe('104 kg');
  });
});

describe('tunable rows', () => {
  const base = {
    kind: 'tunable',
    label: 'Ring work weight',
    key: 'workers.rating.wrestler.ringwork',
    value: 3,
    defaultValue: 3,
    unit: 'ratio',
  } as const;

  it('ends with the key of the setting', () => {
    const row = describeTraceNode({ ...base, overridden: false });
    expect(traceLineText(row)).toBe(
      'Ring work weight: 3 · Game setting · workers.rating.wrestler.ringwork',
    );
  });

  it('keeps the key when the save overrides the setting, even to 0', () => {
    const row = describeTraceNode({ ...base, value: 0, overridden: true });
    expect(traceLineText(row)).toBe(
      'Ring work weight: 0 · Custom setting · default 3 · workers.rating.wrestler.ringwork',
    );
  });

  it('words a choice setting’s option instead of showing its code', () => {
    const row = describeTraceNode({
      kind: 'tunable',
      label: "Midcard's duration class",
      key: 'match.slot.durationClass.midcard',
      value: 'long',
      defaultValue: 'standard',
      overridden: true,
    });
    expect(traceLineText(row)).toBe(
      "Midcard's duration class: Long · Custom setting · default Standard · match.slot.durationClass.midcard",
    );
  });
});
