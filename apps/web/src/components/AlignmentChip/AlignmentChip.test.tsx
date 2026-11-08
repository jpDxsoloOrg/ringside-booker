import { ALIGNMENTS } from '@ringside/engine';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALIGNMENT_LABELS, AlignmentChip } from './AlignmentChip';

describe('AlignmentChip', () => {
  it.each(ALIGNMENTS)('always says %s in words, not only in colour', (alignment) => {
    render(<AlignmentChip alignment={alignment} />);
    const chip = screen.getByText(ALIGNMENT_LABELS[alignment]);
    expect(chip).toHaveAttribute('data-alignment', alignment);
    expect(chip).toHaveClass('alignmentChip', 'soft', 'size-md', `alignment-${alignment}`);
  });

  it('has a label for every alignment the engine knows', () => {
    expect(Object.keys(ALIGNMENT_LABELS).sort()).toEqual([...ALIGNMENTS].sort());
  });

  it('takes the solid variant and the small size', () => {
    render(<AlignmentChip alignment="heel" variant="solid" size="sm" />);
    expect(screen.getByText('Heel')).toHaveClass('solid', 'size-sm', 'alignment-heel');
  });

  it('writes no inline styles', () => {
    const { container } = render(<AlignmentChip alignment="tweener" />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
