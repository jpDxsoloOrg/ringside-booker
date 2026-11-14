import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TraceNode } from '@ringside/engine';
import { ReactionMeter, reactionMeterPosition, reactionZones } from './ReactionMeter';

const THRESHOLDS = { walkAway: 0.45, counter: 0.55, accept: 0.95 };
const TRACE: TraceNode = { kind: 'input', label: 'Offer as a share of their ask', value: 0.62 };

describe('ReactionMeter', () => {
  it('places the zones at the thresholds and caps the marker at 125%', () => {
    expect(reactionZones(THRESHOLDS).map((zone) => [zone.label, zone.from, zone.to])).toEqual([
      ['Walk away', 0, 36],
      ['Reject', 36, 44],
      ['Counter', 44, 76],
      ['Likely', 76, 100],
    ]);
    expect(reactionMeterPosition(2)).toBe(100);
    expect(reactionMeterPosition(-1)).toBe(0);
  });

  it('is a meter whose value text is the label, said politely, with a Why?', () => {
    render(
      <ReactionMeter
        ratio={0.62}
        band="counter"
        label="Will counter"
        thresholds={THRESHOLDS}
        trace={TRACE}
      />,
    );
    const meter = screen.getByRole('meter', { name: 'Their likely reaction' });
    expect(meter).toHaveAttribute('aria-valuetext', 'Will counter, 62% of their ask');
    const label = screen.getByText('Will counter');
    expect(label).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Why will counter?' })).toBeInTheDocument();
  });

  it('shows a refusal without a marker or a share', () => {
    const { container } = render(
      <ReactionMeter ratio={1} band="refuse" label="Won't sign" thresholds={THRESHOLDS} />,
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', "Won't sign");
    expect(container.querySelector('[data-part="marker"]')).toBeNull();
    expect(screen.queryByText(/of their ask/u)).toBeNull();
  });
});
