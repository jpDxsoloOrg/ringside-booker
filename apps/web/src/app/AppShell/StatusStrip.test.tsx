import { render, screen, within } from '@testing-library/react';
import { cents, parseGameDate } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import type { ShellStatus } from './shellPreview';
import { StatusStrip } from './StatusStrip';

const STATUS: ShellStatus = {
  date: parseGameDate('2031-03-14'),
  week: 11,
  season: 2,
  cash: cents(124_000_000),
  cashDelta: cents(4_850_000),
  popularity: 82,
};

describe('StatusStrip', () => {
  it('shows the week, season, date, cash with its weekly change, and popularity', () => {
    render(<StatusStrip status={STATUS} compact={false} />);

    const status = screen.getByRole('group', { name: 'Status' });
    expect(status).toHaveTextContent('Week 11 · Season 2');
    expect(status).toHaveTextContent('Mar 14, 2031');
    expect(status).toHaveTextContent('$1.2M');
    expect(status).toHaveTextContent('+$48.5K');
    expect(status).toHaveTextContent('/wk');
    expect(status).toHaveTextContent('Popularity82');
    expect(within(status).queryByText('Sample')).toBeNull();
  });

  it('shows a falling cash change with a true minus sign', () => {
    render(<StatusStrip status={{ ...STATUS, cashDelta: cents(-1_200_000) }} compact={false} />);

    expect(screen.getByRole('group', { name: 'Status' })).toHaveTextContent('−$12K');
  });

  it('shows just the week before the first season', () => {
    render(<StatusStrip status={{ ...STATUS, season: null }} compact />);

    const status = screen.getByRole('group', { name: 'Status' });
    expect(status).toHaveTextContent('Wk 11');
    expect(status).not.toHaveTextContent('S2');
  });

  it('marks sample figures on screen and for screen readers', () => {
    render(<StatusStrip status={STATUS} compact={false} sample />);

    const status = screen.getByRole('group', { name: 'Status (sample figures)' });
    expect(within(status).getByText('Sample')).toBeInTheDocument();
  });

  it('drops cash and popularity for a player with no promotion', () => {
    render(
      <StatusStrip
        status={{ ...STATUS, cash: null, cashDelta: null, popularity: null }}
        compact={false}
      />,
    );

    const status = screen.getByRole('group', { name: 'Status' });
    expect(within(status).queryByText('Cash')).toBeNull();
    expect(within(status).queryByText('Popularity')).toBeNull();
  });
});
