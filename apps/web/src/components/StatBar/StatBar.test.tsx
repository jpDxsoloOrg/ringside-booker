import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MINUS_SIGN } from '../format';
import { autoStatTone, StatBar, statBarPosition } from './StatBar';

function renderBar(...args: Parameters<typeof StatBar>): {
  meter: HTMLElement;
  part: (name: string) => Element | null;
} {
  const { container } = render(<StatBar {...args[0]} />);
  return {
    meter: screen.getByRole('meter'),
    part: (name) => container.querySelector(`[data-part="${name}"]`),
  };
}

describe('StatBar', () => {
  it('is a labelled meter drawn in an SVG with no inline style', () => {
    const { meter, part } = renderBar({ value: 64, label: 'Charisma' });

    expect(meter).toHaveAccessibleName('Charisma');
    expect(meter).toHaveAttribute('aria-valuenow', '64');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    const svg = meter.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 100 8');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    expect(part('fill')).toHaveAttribute('width', '64');
    expect(meter.querySelector('[style]')).toBeNull();
    expect(meter).toHaveTextContent('Charisma64');
  });

  it('clamps 120 to a full bar but still reports 120', () => {
    const { meter, part } = renderBar({ value: 120, label: 'Popularity' });

    expect(part('fill')).toHaveAttribute('width', '100');
    expect(meter).toHaveTextContent('120');
    expect(meter).toHaveAttribute('aria-valuetext', '120');
    expect(meter).toHaveAttribute('aria-valuenow', '100');
  });

  it('clamps a negative value to an empty bar', () => {
    const { meter, part } = renderBar({ value: -15, label: 'Morale' });

    expect(part('fill')).toHaveAttribute('width', '0');
    expect(meter).toHaveTextContent(`${MINUS_SIGN}15`);
    expect(meter).toHaveAttribute('aria-valuenow', '0');
  });

  it('scales to a custom max', () => {
    const { meter, part } = renderBar({ value: 5, max: 20, label: 'Stars' });

    expect(part('fill')).toHaveAttribute('width', '25');
    expect(meter).toHaveAttribute('aria-valuemax', '20');
  });

  it('draws the ceiling marker at the right x', () => {
    const { meter, part } = renderBar({ value: 55, ceiling: 82, label: 'Technique' });

    const marker = part('ceiling');
    expect(marker).toHaveAttribute('x1', '82');
    expect(marker).toHaveAttribute('x2', '82');
    expect(meter).toHaveAttribute('aria-valuetext', '55, potential 82');
  });

  it('places the ceiling on a custom scale and clamps it to the bar', () => {
    expect(
      renderBar({ value: 1, max: 10, ceiling: 4, label: 'A' }).part('ceiling'),
    ).toHaveAttribute('x1', '40');
  });

  it('tints a recent gain as the newest part of the bar', () => {
    const { meter, part } = renderBar({ value: 72, delta: 6, label: 'Stamina' });

    expect(part('fill')).toHaveAttribute('width', '66');
    expect(part('gain')).toHaveAttribute('x', '66');
    expect(part('gain')).toHaveAttribute('width', '6');
    expect(part('loss')).toBeNull();
    expect(meter).toHaveTextContent('72+6');
    expect(meter).toHaveAttribute('aria-valuetext', '72, change +6');
  });

  it('shows a recent loss as a segment past the end of the bar', () => {
    const { meter, part } = renderBar({ value: 50, delta: -8, label: 'Condition' });

    expect(part('fill')).toHaveAttribute('width', '50');
    expect(part('loss')).toHaveAttribute('x', '50');
    expect(part('loss')).toHaveAttribute('width', '8');
    expect(part('gain')).toBeNull();
    expect(meter).toHaveTextContent(`50${MINUS_SIGN}8`);
  });

  it('can hide the value and the visible label', () => {
    const { meter } = renderBar({ value: 30, label: 'Speed', showValue: false, hideLabel: true });

    expect(meter).toHaveAccessibleName('Speed');
    expect(meter).toHaveTextContent('');
  });

  it('shows the value as a tabular number', () => {
    const { meter } = renderBar({ value: 64, label: 'Charisma' });

    expect(meter.querySelector('.value')).toHaveTextContent('64');
  });

  it.each([
    [0, 'action'],
    [39, 'action'],
    [40, 'data'],
    [79, 'data'],
    [80, 'prestige'],
    [100, 'prestige'],
    [120, 'prestige'],
  ])('auto tone for %i is %s', (value, expectedTone) => {
    const { meter, part } = renderBar({ value, label: 'Skill' });

    expect(meter).toHaveAttribute('data-tone', expectedTone);
    expect(part('fill')).toHaveClass(`tone-${expectedTone}`);
  });

  it('moves the tone bands when the thresholds change', () => {
    expect(autoStatTone(55, { lowBelow: 60, eliteFrom: 90 })).toBe('action');
    expect(autoStatTone(75, { lowBelow: 60, eliteFrom: 90 })).toBe('data');
    expect(autoStatTone(90, { lowBelow: 60, eliteFrom: 90 })).toBe('prestige');
    const { meter } = renderBar({ value: 55, label: 'Skill', lowBelow: 20, eliteFrom: 50 });
    expect(meter).toHaveAttribute('data-tone', 'prestige');
  });

  it('uses a fixed tone when given one', () => {
    const { meter, part } = renderBar({ value: 10, label: 'Hype', tone: 'data' });

    expect(meter).toHaveAttribute('data-tone', 'data');
    expect(part('fill')).toHaveClass('tone-data');
  });

  it.each([
    ['info', 'data'],
    ['warning', 'prestige'],
    ['accent', 'action'],
  ] as const)('draws the older %s tone as %s', (tone, role) => {
    const { meter, part } = renderBar({ value: 50, label: 'Older tone', tone });

    expect(meter).toHaveAttribute('data-tone', role);
    expect(part('fill')).toHaveClass(`tone-${role}`);
  });
});

describe('statBarPosition', () => {
  it('clamps and scales to the 0..100 view box', () => {
    expect(statBarPosition(50, 100)).toBe(50);
    expect(statBarPosition(150, 100)).toBe(100);
    expect(statBarPosition(-5, 100)).toBe(0);
    expect(statBarPosition(Number.NaN, 100)).toBe(0);
    expect(statBarPosition(10, 0)).toBe(0);
  });
});
