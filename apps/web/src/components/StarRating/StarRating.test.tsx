import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StarRating, starFills, starRatingLabel } from './StarRating';

function fillsOnScreen(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-fill]')].map(
    (star) => star.getAttribute('data-fill') ?? '',
  );
}

describe('starFills', () => {
  it('fills whole stars, then the quarter of the last one', () => {
    expect(starFills(3.75)).toEqual([100, 100, 100, 75, 0]);
    expect(starFills(0.25)).toEqual([25, 0, 0, 0, 0]);
    expect(starFills(2.5)).toEqual([100, 100, 50, 0, 0]);
    expect(starFills(5)).toEqual([100, 100, 100, 100, 100]);
    expect(starFills(0)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('starRatingLabel', () => {
  it('says the rating in words', () => {
    expect(starRatingLabel(3.75)).toBe('3.75 stars out of 5');
    expect(starRatingLabel(1)).toBe('1 star out of 5');
    expect(starRatingLabel(0.25)).toBe('0.25 stars out of 5');
    expect(starRatingLabel(0)).toBe('No stars');
  });
});

describe('StarRating', () => {
  it('draws the fill classes and is named by the rating', () => {
    const { container } = render(<StarRating value={3.75} />);
    const image = screen.getByRole('img', { name: '3.75 stars out of 5' });
    expect(fillsOnScreen(container)).toEqual(['100', '100', '100', '75', '0']);
    const stars = image.querySelectorAll('[data-fill]');
    expect(stars[3]?.className).toMatch(/fill-75/);
    expect(stars[0]?.className).toMatch(/fill-100/);
    expect(stars[4]?.className).toMatch(/fill-0/);
    expect(image.querySelectorAll('svg')).toHaveLength(10);
  });

  it('says No stars for 0', () => {
    render(<StarRating value={0} />);
    expect(screen.getByRole('img', { name: 'No stars' })).toHaveTextContent('No stars');
  });

  it('takes a size and a tone', () => {
    render(<StarRating value={2} size="lg" tone="broadcast" />);
    const image = screen.getByRole('img', { name: '2 stars out of 5' });
    expect(image.className).toMatch(/size-lg/);
    expect(image.className).toMatch(/tone-broadcast/);
  });

  it('throws in development for a value off the quarter grid or past 5', () => {
    // React logs the error it is about to rethrow; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<StarRating value={3.3} />)).toThrow(RangeError);
    expect(() => render(<StarRating value={6} />)).toThrow(RangeError);
    expect(() => render(<StarRating value={-0.25} />)).toThrow(RangeError);
    consoleError.mockRestore();
  });
});
