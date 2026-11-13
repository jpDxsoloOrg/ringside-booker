import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard, KpiCardGrid } from './KpiCard';

describe('KpiCard', () => {
  it('is a group named by its label, holding the big number', () => {
    render(<KpiCard label="Avg show score" value="74" />);
    const card = screen.getByRole('group', { name: 'Avg show score' });
    expect(within(card).getByText('74')).toHaveClass('value', 'tone-neutral');
  });

  it('shows the unit, the delta chip and the footer', () => {
    render(
      <KpiCard
        label="Locker room morale"
        value="81"
        unit="/100"
        delta={{ value: 1, suffix: 'this week' }}
        footer="High"
      />,
    );
    const card = screen.getByRole('group', { name: 'Locker room morale' });
    expect(within(card).getByText('/100')).toHaveClass('unit');
    const chip = within(card).getByText('+1').parentElement;
    expect(chip).toHaveAttribute('data-direction', 'up');
    expect(chip).toHaveTextContent('this week');
    expect(within(card).getByText('High')).toHaveClass('footerText');
  });

  it('passes "better lower" through to the chip', () => {
    render(
      <KpiCard
        label="Monthly payroll"
        value="$410K"
        delta={{ value: -12_000, display: '−$12K', goodWhen: 'down' }}
      />,
    );
    const chip = screen.getByText('−$12K').parentElement;
    expect(chip).toHaveAttribute('data-tone', 'positive');
  });

  it('names its sparkline after the card and the period', () => {
    render(
      <KpiCard
        label="TV viewers"
        value="1.1M"
        trend={{
          values: [0.9, 1, 1.1],
          period: 'last 3 weeks',
          formatValue: (millions) => `${millions.toFixed(1)}M`,
        }}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'TV viewers, last 3 weeks: 0.9M to 1.1M, rising' }),
    ).toBeInTheDocument();
  });

  it('hides its corner icon and keeps the Why? slot working', () => {
    const { container } = render(
      <KpiCard
        label="Avg attendance"
        value="92%"
        icon="ticket"
        why={<button type="button">Why? Avg attendance</button>}
      />,
    );
    expect(container.querySelector('[data-icon="ticket"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Why? Avg attendance' })).toBeInTheDocument();
  });

  it('colours the number by tone', () => {
    render(<KpiCard label="Best rating" value="91" tone="prestige" />);
    expect(screen.getByText('91')).toHaveClass('tone-prestige');
  });

  it('draws a figure in the red in the negative tone', () => {
    render(<KpiCard label="Cash" value="−$2,500" tone="negative" />);
    expect(screen.getByText('−$2,500')).toHaveClass('tone-negative');
  });

  it('leaves out the parts it is not given and writes no inline styles', () => {
    const { container } = render(<KpiCard label="Cash" value="$1.2M" />);
    expect(container.querySelector('.footer')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('KpiCardGrid', () => {
  it('is a named group of cards', () => {
    render(
      <KpiCardGrid label="Key numbers">
        <KpiCard label="Cash" value="$1.2M" />
        <KpiCard label="Fans" value="48K" />
      </KpiCardGrid>,
    );
    const grid = screen.getByRole('group', { name: 'Key numbers' });
    expect(grid).toHaveClass('grid');
    expect(within(grid).getAllByRole('group')).toHaveLength(2);
  });
});
