import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cents, parseGameDate, parseId } from '@ringside/engine';
import type { SimStatus } from '@ringside/engine';
import { registerStatusChip } from './statusChipRegistry';
import { StatusChip, StatusChips } from './StatusChips';

const STATUS: SimStatus = {
  date: parseGameDate('2031-03-14'),
  season: { number: 3, endDate: parseGameDate('2031-06-30') },
  promotion: {
    promotionId: parseId('promotion', 'pro_00000000ab'),
    name: 'Harbor City Wrestling',
    cash: cents(-250_000),
    popularity: {
      homeRegionId: parseId('region', 'reg_00000000ab'),
      homeRegion: 64,
      prestige: 58,
      traceRef: null,
    },
  },
};

function chipIds(): (string | null)[] {
  return Array.from(document.querySelectorAll('[data-chip-id]')).map((node) =>
    node.getAttribute('data-chip-id'),
  );
}

describe('StatusChips', () => {
  it('shows the long date with the season, cash and popularity with prestige', () => {
    render(<StatusChips status={STATUS} placement="bar" />);

    expect(screen.getByTestId('date-chip')).toHaveTextContent('Friday, March 14, 2031');
    expect(screen.getByTestId('date-chip')).toHaveTextContent('Season 3');
    expect(screen.getByTestId('popularity-chip')).toHaveTextContent('64');
    expect(screen.getByTestId('popularity-chip')).toHaveTextContent('Prestige 58');
    expect(screen.getByTestId('promotion-chip')).toHaveTextContent('Harbor City Wrestling');
  });

  it('draws negative cash in the negative colour with a minus sign', () => {
    render(<StatusChips status={STATUS} placement="bar" />);
    const money = screen.getByText(/^−\$2[.,]5/);
    expect(money.className).toMatch(/negative/);
  });

  it('leaves out the season before season 1 and the promotion chips without a promotion', () => {
    render(<StatusChips status={{ ...STATUS, season: null, promotion: null }} placement="bar" />);
    expect(screen.getByTestId('date-chip')).not.toHaveTextContent('Season');
    expect(screen.queryByTestId('cash-chip')).toBeNull();
    expect(screen.queryByTestId('popularity-chip')).toBeNull();
    expect(screen.queryByTestId('promotion-chip')).toBeNull();
  });

  it('adds a registered chip in its order, and removes it again', () => {
    render(<StatusChips status={STATUS} placement="bar" />);
    expect(chipIds()).toEqual(['shell.promotion', 'shell.cash', 'shell.popularity']);

    let unregister = (): void => undefined;
    act(() => {
      unregister = registerStatusChip({
        id: 'social.morale',
        order: 15,
        render: ({ placement }) => (
          <StatusChip label="Morale" placement={placement}>
            Content
          </StatusChip>
        ),
      });
    });
    expect(chipIds()).toEqual([
      'shell.promotion',
      'shell.cash',
      'social.morale',
      'shell.popularity',
    ]);
    expect(screen.getByText('Morale')).toBeInTheDocument();

    act(() => {
      unregister();
    });
    expect(chipIds()).toEqual(['shell.promotion', 'shell.cash', 'shell.popularity']);
  });

  it('refuses two chips with the same id', () => {
    const unregister = registerStatusChip({ id: 'social.morale', order: 30, render: () => null });
    expect(() =>
      registerStatusChip({ id: 'social.morale', order: 30, render: () => null }),
    ).toThrow(/already registered/);
    unregister();
  });
});
