import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeltaChip, deltaDirection, deltaTone } from './DeltaChip';

function chipFor(text: string): HTMLElement {
  const amount = screen.getByText(text);
  const chip = amount.parentElement;
  if (chip === null) throw new Error('The amount has no chip around it.');
  return chip;
}

describe('deltaDirection', () => {
  it.each([
    [3, '+3', 'up'],
    [-2, '−2', 'down'],
    [0, '0', 'flat'],
    [0.2, '0', 'flat'],
    [Number.NaN, 'NaN', 'flat'],
  ] as const)('reads %s shown as %s as %s', (value, display, direction) => {
    expect(deltaDirection(value, display)).toBe(direction);
  });
});

describe('deltaTone', () => {
  it('is positive for a rise and negative for a fall by default', () => {
    expect(deltaTone('up')).toBe('positive');
    expect(deltaTone('down')).toBe('negative');
    expect(deltaTone('flat')).toBe('neutral');
  });

  it('flips for numbers that are better lower', () => {
    expect(deltaTone('down', 'down')).toBe('positive');
    expect(deltaTone('up', 'down')).toBe('negative');
    expect(deltaTone('flat', 'down')).toBe('neutral');
  });
});

describe('DeltaChip', () => {
  it('shows an up arrow and the signed amount for a rise', () => {
    render(<DeltaChip value={3} suffix="vs last month" />);
    const chip = chipFor('+3');
    expect(chip).toHaveAttribute('data-direction', 'up');
    expect(chip).toHaveClass('tone-positive', 'variant-chip');
    expect(chip).toHaveTextContent('▲+3vs last month');
    expect(screen.getByText('▲')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a down arrow, a true minus sign and the negative colour for a fall', () => {
    render(<DeltaChip value={-2} />);
    const chip = chipFor('−2');
    expect(chip).toHaveAttribute('data-direction', 'down');
    expect(chip).toHaveClass('tone-negative');
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('has no arrow and a neutral colour when nothing changed', () => {
    render(<DeltaChip value={0} />);
    const chip = chipFor('0');
    expect(chip).toHaveAttribute('data-direction', 'flat');
    expect(chip).toHaveClass('tone-neutral');
    expect(screen.queryByText('▲')).toBeNull();
    expect(screen.queryByText('▼')).toBeNull();
  });

  it('shows a pre-formatted amount as given', () => {
    render(<DeltaChip value={0.042} display="+4.2%" />);
    expect(chipFor('+4.2%')).toHaveAttribute('data-direction', 'up');
  });

  it('draws a fall as good news when lower is better', () => {
    render(<DeltaChip value={-12000} display="−$12K" goodWhen="down" />);
    const chip = chipFor('−$12K');
    expect(chip).toHaveAttribute('data-direction', 'down');
    expect(chip).toHaveClass('tone-positive');
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('has a plain variant for table cells', () => {
    render(<DeltaChip value={5} variant="plain" />);
    expect(chipFor('+5')).toHaveClass('variant-plain');
  });

  it('writes no inline styles', () => {
    const { container } = render(<DeltaChip value={7} suffix="this week" />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
