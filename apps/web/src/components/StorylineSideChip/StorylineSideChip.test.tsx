import { STORYLINE_SIDES } from '@ringside/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STORYLINE_SIDE_LABELS, StorylineSideChip } from './StorylineSideChip';

describe('StorylineSideChip', () => {
  it.each(STORYLINE_SIDES)('always says %s in words, not only in colour', (side) => {
    render(<StorylineSideChip side={side} />);
    const chip = screen.getByText(STORYLINE_SIDE_LABELS[side]);
    expect(chip).toHaveAttribute('data-side', side);
    expect(chip).toHaveClass('sideChip', 'size-sm', `side-${side}`);
  });

  it('has a label for every side the engine knows', () => {
    expect(Object.keys(STORYLINE_SIDE_LABELS).sort()).toEqual([...STORYLINE_SIDES].sort());
  });

  it('takes the medium size and writes no inline styles', () => {
    const { container } = render(<StorylineSideChip side="neutral" size="md" />);
    expect(screen.getByText('Neutral')).toHaveClass('size-md');
    expect(container.querySelector('[style]')).toBeNull();
  });
});
