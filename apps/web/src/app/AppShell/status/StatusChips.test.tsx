import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  cashTraceRef,
  cents,
  parseGameDate,
  parseId,
  popularityTraceRef,
  startCalc,
} from '@ringside/engine';
import type { SimStatus } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerStatusChip } from './statusChipRegistry';
import { StatusChip, StatusChips } from './StatusChips';

const STATUS: SimStatus = {
  date: parseGameDate('2031-03-14'),
  season: { number: 3, endDate: parseGameDate('2031-06-30') },
  promotion: {
    promotionId: parseId('promotion', 'pro_00000000ab'),
    name: 'Harbor City Wrestling',
    shortName: 'HCW',
    cash: cents(-250_000),
    cashTraceRef: null,
    popularity: {
      homeRegionId: parseId('region', 'reg_00000000ab'),
      homeRegion: 64,
      prestige: 58,
      headline: null,
      headlineLabel: null,
      traceRef: null,
      trace: startCalc('Popularity in Harbor City', 64).done().trace,
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
    // The popularity has a Why? even before a system stores a trace for it (UI-19).
    expect(
      within(screen.getByTestId('popularity-chip')).getByRole('button', { name: /^Why is /u }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('promotion-chip')).toHaveTextContent('Harbor City Wrestling');
  });

  it('draws negative cash in the negative colour with a minus sign', () => {
    render(<StatusChips status={STATUS} placement="bar" />);
    const money = screen.getByText(/^−\$2[.,]5/);
    expect(money.className).toMatch(/negative/);
  });

  it.each(['bar', 'sheet'] as const)(
    'gives the cash a Why? in the %s when the engine keeps a breakdown of it',
    (placement) => {
      const promotion = STATUS.promotion;
      if (promotion === null) throw new Error('The sample status has a promotion');
      // A reference is fetched from the engine, so the chip needs one around it.
      const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
      transport.host.installEngine(fakeEngineState());
      render(
        <EngineProvider createTransport={() => transport}>
          <StatusChips
            status={{
              ...STATUS,
              promotion: { ...promotion, cashTraceRef: cashTraceRef(promotion.promotionId) },
            }}
            placement={placement}
          />
        </EngineProvider>,
      );
      expect(
        within(screen.getByTestId('cash-chip')).getByRole('button', { name: /^Why is Cash /u }),
      ).toBeInTheDocument();
    },
  );

  it('shows the headline popularity with its stored Why? once the engine records one', () => {
    const promotion = STATUS.promotion;
    if (promotion === null) throw new Error('The sample status has a promotion');
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    transport.host.installEngine(fakeEngineState());
    render(
      <EngineProvider createTransport={() => transport}>
        <StatusChips
          status={{
            ...STATUS,
            promotion: {
              ...promotion,
              popularity: {
                ...promotion.popularity,
                headline: 57.3,
                headlineLabel: 'Harbor City Wrestling popularity',
                traceRef: popularityTraceRef(promotion.promotionId),
              },
            },
          }}
          placement="bar"
        />
      </EngineProvider>,
    );
    const chip = screen.getByTestId('popularity-chip');
    expect(chip).toHaveTextContent('57.3');
    expect(
      within(chip).getByRole('button', { name: /^Why is Harbor City Wrestling popularity /u }),
    ).toBeInTheDocument();
  });

  it('shows the cash without a Why? while there is no breakdown of it', () => {
    render(<StatusChips status={STATUS} placement="bar" />);
    expect(within(screen.getByTestId('cash-chip')).queryByRole('button')).toBeNull();
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
