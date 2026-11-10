import { describe, expect, it } from 'vitest';
import type { TraceNode } from '@ringside/engine';
import { placementTraceInWords } from './placementWording';

function placementDecision(chosen: string): TraceNode {
  return {
    kind: 'decision',
    label: 'Where Sample Weekly is held',
    value: chosen,
    chosen,
    reason: 'The preferred venue is open and can be booked',
    considered: [],
    children: [
      {
        kind: 'branch',
        label: 'The show has a preferred venue',
        value: true,
        condition: 'The show has a preferred venue',
        taken: true,
      },
    ],
  };
}

describe('placementTraceInWords', () => {
  it('names the venue as the outcome instead of the rule key', () => {
    const original = placementDecision('preferredVenue');
    const worded = placementTraceInWords(original, 'Sample Arena');
    expect(worded).toMatchObject({
      kind: 'decision',
      value: 'Sample Arena',
      chosen: 'Sample Arena',
    });
    expect(JSON.stringify(worded)).not.toContain('preferredVenue');
  });

  it('says the venue is not chosen yet when there is none', () => {
    const worded = placementTraceInWords(placementDecision('notChosen'), null);
    expect(worded).toMatchObject({ value: 'Not chosen yet', chosen: 'Not chosen yet' });
    expect(JSON.stringify(worded)).not.toContain('notChosen');
  });

  it('keeps the reason and the rules, and leaves the engine’s trace untouched', () => {
    const original = placementDecision('preferredVenue');
    const worded = placementTraceInWords(original, 'Sample Arena');
    expect(worded).toMatchObject({
      label: original.label,
      reason: 'The preferred venue is open and can be booked',
      children: original.children,
    });
    expect(original).toMatchObject({ value: 'preferredVenue', chosen: 'preferredVenue' });
  });

  it('passes through a trace that is not a decision', () => {
    const note: TraceNode = { kind: 'note', label: 'Held at home', value: null };
    expect(placementTraceInWords(note, 'Sample Arena')).toBe(note);
  });
});
