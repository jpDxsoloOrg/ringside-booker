import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { layoutSegments, SegmentedMeter } from './SegmentedMeter';

function ticks(meter: HTMLElement): Element[] {
  return Array.from(meter.querySelectorAll('[data-part="tick"]'));
}

function filledZones(meter: HTMLElement): string[] {
  return ticks(meter)
    .filter((tick) => tick.getAttribute('data-filled') === 'true')
    .map((tick) => tick.getAttribute('data-zone') ?? '');
}

describe('layoutSegments', () => {
  it('fills to the nearest tick and marks ticks past the threshold as danger', () => {
    const layout = layoutSegments(64, 100, 10, 80);

    expect(layout.filledCount).toBe(6);
    expect(layout.inDanger).toBe(false);
    expect(layout.segments.map((segment) => segment.danger)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('counts a tick as danger when its range reaches past the threshold', () => {
    expect(
      layoutSegments(0, 100, 10, 75).segments.filter((segment) => segment.danger),
    ).toHaveLength(3);
    expect(layoutSegments(0, 100, 4, 50).segments.map((segment) => segment.danger)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('is in danger from the threshold itself', () => {
    expect(layoutSegments(79, 100, 10, 80).inDanger).toBe(false);
    expect(layoutSegments(80, 100, 10, 80).inDanger).toBe(true);
  });

  it('lights a danger tick whenever the value is in danger, and never before', () => {
    // Ticks of 12.5 with danger from 75: rounding alone would fill six safe ticks for 80.
    const atEighty = layoutSegments(80, 100, 8, 75);
    expect(atEighty.inDanger).toBe(true);
    expect(atEighty.filledCount).toBe(7);
    expect(atEighty.segments[6]).toEqual({ filled: true, danger: true });

    // Rounding alone would light the 62.5–75 danger tick for 69, which is still below 70.
    const belowThreshold = layoutSegments(69, 100, 8, 70);
    expect(belowThreshold.inDanger).toBe(false);
    expect(belowThreshold.filledCount).toBe(5);
    expect(belowThreshold.segments.some((segment) => segment.filled && segment.danger)).toBe(false);
  });

  it('clamps out-of-range and non-finite values', () => {
    expect(layoutSegments(-20, 100, 10, 80).filledCount).toBe(0);
    expect(layoutSegments(140, 100, 10, 80).filledCount).toBe(10);
    expect(layoutSegments(Number.NaN, 100, 10, 80).filledCount).toBe(0);
    expect(layoutSegments(5, 0, 10, 80)).toMatchObject({ filledCount: 0, inDanger: false });
    expect(layoutSegments(5, 10, 0, 8).segments).toHaveLength(1);
  });
});

describe('SegmentedMeter', () => {
  it('is a named meter with its value, scale and value text', () => {
    render(<SegmentedMeter label="Hype" value={64} />);

    const meter = screen.getByRole('meter', { name: 'Hype' });
    expect(meter).toHaveAttribute('aria-valuenow', '64');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '64');
    expect(meter).toHaveAttribute('data-danger', 'false');
    expect(ticks(meter)).toHaveLength(10);
    expect(filledZones(meter)).toEqual(['safe', 'safe', 'safe', 'safe', 'safe', 'safe']);
    expect(meter.querySelector('[style]')).toBeNull();
  });

  it('turns red-orange near the danger end and says so in words', () => {
    render(
      <SegmentedMeter
        label="Broadcast hype"
        value={88}
        segments={8}
        dangerFrom={70}
        dangerLabel="Hot"
        valueText="88%"
      />,
    );

    const meter = screen.getByRole('meter', { name: 'Broadcast hype' });
    expect(meter).toHaveAttribute('aria-valuetext', '88%, Hot');
    expect(meter).toHaveAttribute('data-danger', 'true');
    expect(meter).toHaveTextContent('88%Hot');
    // Ticks of 12.5: the sixth (62.5–75) and later reach past 70.
    expect(filledZones(meter)).toEqual([
      'safe',
      'safe',
      'safe',
      'safe',
      'safe',
      'danger',
      'danger',
    ]);
    const dangerTick = ticks(meter)[6];
    expect(dangerTick).toHaveClass('filledDanger');
  });

  it('can hide the visible label and value', () => {
    render(<SegmentedMeter label="Fatigue" value={30} hideLabel showValue={false} />);

    const meter = screen.getByRole('meter', { name: 'Fatigue' });
    expect(meter).toHaveTextContent('');
  });

  it('draws the same ticks under reduced motion; only the fill transition stops', () => {
    const { container: withMotion } = render(<SegmentedMeter label="Heat" value={90} />);
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(<SegmentedMeter label="Heat" value={90} />);

    expect(reduced.innerHTML).toBe(withMotion.innerHTML);
  });
});
