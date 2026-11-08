import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SPARKLINE_VIEWBOX_HEIGHT,
  SPARKLINE_VIEWBOX_WIDTH,
  Sparkline,
  sparklinePoints,
  sparklineTrend,
} from './Sparkline';

describe('sparklinePoints', () => {
  it('spreads the points across the full width, highest value at the top', () => {
    const points = sparklinePoints([10, 30, 20]);
    expect(points.map(([horizontal]) => horizontal)).toEqual([
      0,
      SPARKLINE_VIEWBOX_WIDTH / 2,
      SPARKLINE_VIEWBOX_WIDTH,
    ]);
    const [lowest, highest, middle] = points.map(([, vertical]) => vertical);
    expect(highest).toBeLessThan(middle ?? 0);
    expect(middle).toBeLessThan(lowest ?? 0);
  });

  it('keeps every point inside the box with room for the stroke', () => {
    for (const [, vertical] of sparklinePoints([5, 100, -40, 7, 63])) {
      expect(vertical).toBeGreaterThan(0);
      expect(vertical).toBeLessThan(SPARKLINE_VIEWBOX_HEIGHT);
    }
  });

  it('runs a flat series along the middle', () => {
    const heights = sparklinePoints([4, 4, 4, 4]).map(([, vertical]) => vertical);
    expect(new Set(heights)).toEqual(new Set([SPARKLINE_VIEWBOX_HEIGHT / 2]));
  });

  it('skips values that are not numbers and needs two to draw', () => {
    expect(sparklinePoints([Number.NaN, 3, Number.POSITIVE_INFINITY, 5])).toHaveLength(2);
    expect(sparklinePoints([3])).toEqual([]);
    expect(sparklinePoints([])).toEqual([]);
  });
});

describe('sparklineTrend', () => {
  it('compares the last point with the first', () => {
    expect(sparklineTrend([1, 9, 2])).toBe('rising');
    expect(sparklineTrend([9, 1, 8])).toBe('falling');
    expect(sparklineTrend([5, 9, 5])).toBe('flat');
    expect(sparklineTrend([])).toBe('flat');
  });
});

describe('Sparkline', () => {
  it('is an image named by its label, its ends and its trend', () => {
    render(<Sparkline values={[900_000, 950_000, 1_100_000]} label="TV viewers" />);
    const line = screen.getByRole('img', { name: 'TV viewers: 900,000 to 1,100,000, rising' });
    expect(line.tagName.toLowerCase()).toBe('svg');
    expect(line).toHaveAttribute('data-trend', 'rising');
    expect(line).toHaveAttribute('data-tone', 'data');
    expect(line.querySelector('polyline')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('formats the ends with the formatter it is given', () => {
    render(
      <Sparkline
        values={[0.8, 0.92]}
        label="Attendance"
        formatValue={(value) => `${String(Math.round(value * 100))}%`}
      />,
    );
    expect(screen.getByRole('img', { name: 'Attendance: 80% to 92%, rising' })).toBeInTheDocument();
  });

  it('follows the trend with the auto tone', () => {
    render(<Sparkline values={[8, 3]} label="Morale" tone="auto" />);
    expect(screen.getByRole('img')).toHaveAttribute('data-tone', 'negative');
  });

  it('draws nothing with fewer than two points', () => {
    const { container } = render(<Sparkline values={[4]} label="Morale" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws with SVG attributes, never inline styles', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} label="Hype" />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
