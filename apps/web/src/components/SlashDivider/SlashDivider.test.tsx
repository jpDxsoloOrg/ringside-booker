import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { SlashDivider } from './SlashDivider';

describe('SlashDivider', () => {
  it('is a separator band by default', () => {
    render(<SlashDivider />);

    const separator = screen.getByRole('separator');
    expect(separator.tagName).toBe('HR');
    expect(separator).toHaveClass('band', 'tone-neutral');
    expect(separator).not.toHaveAttribute('style');
  });

  it('hides a decorative band from screen readers', () => {
    const { container } = render(<SlashDivider decorative tone="action" />);

    expect(screen.queryByRole('separator')).toBeNull();
    expect(container.querySelector('hr')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('hr')).toHaveClass('tone-action');
  });

  it('draws an inline // that screen readers skip', () => {
    const { container } = render(
      <p>
        Up next <SlashDivider variant="inline" tone="data" /> In 3 days
      </p>,
    );

    const mark = container.querySelector('span');
    expect(mark).toHaveTextContent('//');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveClass('inline', 'tone-data');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('can take the surrounding text colour', () => {
    const { container } = render(<SlashDivider variant="inline" tone="inherit" />);
    expect(container.querySelector('span')).toHaveClass('tone-inherit');
  });

  it('has no motion, so reduced motion renders it the same', () => {
    const { container: withMotion } = render(<SlashDivider tone="prestige" />);
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(<SlashDivider tone="prestige" />);
    expect(reduced.innerHTML).toBe(withMotion.innerHTML);
  });
});
