import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Histogram, histogramGeometry } from './Histogram';
import type { HistogramBin } from './Histogram';

/** 20 bins of 5 points, 0 to 100, with `counts` from the bin at 50 up. */
function scoreBins(counts: Readonly<Record<number, number>>): HistogramBin[] {
  return Array.from({ length: 20 }, (_, index) => ({
    from: index * 5,
    to: (index + 1) * 5,
    count: counts[index * 5] ?? 0,
  }));
}

const BINS = scoreBins({ 50: 4, 55: 12, 60: 20, 65: 9, 70: 3 });

describe('Histogram', () => {
  it('has a hidden table that matches its bins', () => {
    render(<Histogram bins={BINS} label="Score over 48 runs" unit="points" />);
    const table = screen.getByRole('table', { name: 'Score over 48 runs' });
    expect(within(table).getByRole('columnheader', { name: 'Range (points)' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(BINS.length);
    rows.forEach((row, index) => {
      const bin = BINS[index];
      if (bin === undefined) throw new Error('missing bin');
      expect(within(row).getByRole('rowheader')).toHaveTextContent(
        `${String(bin.from)}–${String(bin.to)}`,
      );
      expect(within(row).getByRole('cell')).toHaveTextContent(String(bin.count));
    });
  });

  it('draws a bar per bin and the mean line with its band', () => {
    const { container } = render(
      <Histogram bins={BINS} mean={60.4} sd={5.1} label="Score" unit="points" />,
    );
    expect(container.querySelector('[data-part="mean"]')).not.toBeNull();
    expect(container.querySelector('[data-part="sd-band"]')).not.toBeNull();
    expect(screen.getByText('Mean 60.4 points, spread ±5.1')).toBeInTheDocument();
  });

  it('leaves out the mean line without a mean', () => {
    const { container } = render(<Histogram bins={BINS} label="Score" unit="points" />);
    expect(container.querySelector('[data-part="mean"]')).toBeNull();
    expect(container.querySelector('[data-part="sd-band"]')).toBeNull();
  });

  it('says No runs yet when every bin is empty, or there are none', () => {
    const { container, rerender } = render(
      <Histogram bins={scoreBins({})} label="Score" unit="points" />,
    );
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Histogram bins={[]} label="Score" unit="points" />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('histogramGeometry', () => {
  it('gives the tallest bin the full height and keeps the band inside the bins', () => {
    const geometry = histogramGeometry(BINS, 2, 10);
    const tallest = geometry.bars[12];
    expect(tallest?.y).toBe(geometry.plot.top);
    expect(geometry.maxCount).toBe(20);
    expect(geometry.band?.from).toBe(geometry.plot.left);
    expect(geometry.ticks[0]?.value).toBe(0);
    expect(geometry.ticks.at(-1)?.value).toBe(100);
  });

  it('drops a mean outside the bins', () => {
    expect(histogramGeometry(BINS, 140).meanX).toBeNull();
  });
});
