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

  it.each([
    ['side:0', 'Side 1'],
    ['side:2', 'Side 3'],
    ['method.knockout', 'Knockout'],
    ['method.count-out', 'Count out'],
    ['finish.double-count-out', 'Double count out'],
  ])('reads the saved code %s as "%s", never as the code', (code, words) => {
    expect(choiceText(code)).toBe(words);
  });

  it('reads yes and no for a yes/no decision', () => {
    expect(choiceText(true)).toBe('yes');
    expect(choiceText(false)).toBe('no');
  });
});

describe('a rival result saved with plan codes (AIP5-06)', () => {
  const booked: TraceNode = {
    kind: 'decision',
    label: 'Who wins: Kai Moreno vs Rex Hale',
    value: 'side:1',
    chosen: 'side:1',
    reason: 'Higher value',
    considered: [
      { option: 'side:0', score: 51.8, reason: 'Kai Moreno' },
      { option: 'side:1', score: 64.2, reason: 'Rex Hale' },
    ],
  };

  it("names the chosen side by its wrestlers' names, in the headline and the row", () => {
    expect(traceValueText(booked)).toBe('Rex Hale');
    const words = describeTraceNode(booked);
    expect(words.text).toBe('Who wins: Kai Moreno vs Rex Hale: Rex Hale');
    expect(words.items).toEqual([
      'Chosen: Rex Hale, score 64.2',
      'Also considered: Kai Moreno, score 51.8',
    ]);
  });

  it('falls back to the side number, and reads a method key as its name', () => {
    const headline: TraceNode = { ...booked, considered: [] };
    expect(traceValueText(headline)).toBe('Side 2');
    const method: TraceNode = {
      kind: 'decision',
      label: 'How the match is won',
      value: 'method.knockout',
      chosen: 'method.knockout',
      reason: 'Knockout',
      considered: [{ option: 'method.knockout', score: 1, reason: 'Knockout' }],
    };
    expect(describeTraceNode(method).text).toBe('How the match is won: Knockout');
    expect(describeTraceNode(method).items).toEqual(['Chosen: Knockout, score 1']);
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

describe("an angle beat's Best stat decision (MTCH5-07)", () => {
  const bestStat: TraceNode = {
    kind: 'decision',
    label: 'Best stat',
    value: 'mic:manager',
    chosen: 'mic:manager',
    reason: 'Best stat: Mic via manager Rex Halden 65.45 (Ring work 18)',
    considered: [
      { option: 'mic:manager', score: 65.45, reason: 'Manager Rex Halden stands in on Mic' },
      { option: 'ringwork', score: 18, reason: 'Ring work 18 × morale 1 × momentum 1 = 18' },
    ],
  };

  it('names each option by the stat it is, never by its code', () => {
    expect(traceValueText(bestStat)).toBe('Mic via manager');
    const words = describeTraceNode(bestStat);
    expect(words.text).toBe('Best stat: Mic via manager');
    expect(words.items).toEqual([
      'Chosen: Mic via manager, score 65.45 · Manager Rex Halden stands in on Mic',
      'Also considered: Ring work, score 18 · Ring work 18 × morale 1 × momentum 1 = 18',
    ]);
  });

  it('leaves the same codes alone in any other decision', () => {
    const other: TraceNode = { ...bestStat, label: 'Something else', chosen: 'ringwork' };
    expect(traceValueText(other)).toBe('Ringwork');
  });
});
