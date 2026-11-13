import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
import { routerFutureFlags } from '@/app/router';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerStatusChip } from './statusChipRegistry';
import { OPEN_FAN_BASE_LABEL, StatusChip, StatusChips } from './StatusChips';

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

  describe('the Fan base button (DAY2-05)', () => {
    function withHeadline(): SimStatus {
      const promotion = STATUS.promotion;
      if (promotion === null) throw new Error('The sample status has a promotion');
      return {
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
      };
    }

    function renderWithEngine(
      status: SimStatus,
      placement: 'bar' | 'sheet',
      onOpenFanBase?: () => void,
    ) {
      const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
      const install = transport.host.installEngine(fakeEngineState());
      useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
      render(
        <MemoryRouter future={routerFutureFlags}>
          <EngineProvider createTransport={() => transport}>
            <StatusChips
              status={status}
              placement={placement}
              {...(onOpenFanBase === undefined ? {} : { onOpenFanBase })}
            />
          </EngineProvider>
        </MemoryRouter>,
      );
    }

    it('sits beside the headline in the bar and opens the Fan base sheet', async () => {
      renderWithEngine(withHeadline(), 'bar');
      const user = userEvent.setup({ delay: null });
      const chip = screen.getByTestId('popularity-chip');
      expect(chip).toHaveTextContent('Popularity');
      expect(chip).toHaveTextContent('Prestige 58');

      await user.click(within(chip).getByRole('button', { name: OPEN_FAN_BASE_LABEL }));
      expect(
        await screen.findByRole('dialog', { name: /^Fan base/u }, { timeout: 10_000 }),
      ).toBeInTheDocument();
    });

    it('is a full-width Fan base button in the phone status sheet', () => {
      renderWithEngine(withHeadline(), 'sheet');
      const chip = screen.getByTestId('popularity-chip');
      expect(within(chip).getByRole('button', { name: 'Fan base' })).toBeInTheDocument();
      expect(within(chip).queryByRole('button', { name: OPEN_FAN_BASE_LABEL })).toBeNull();
    });

    it('hands the opening to the top bar when it keeps the sheet', async () => {
      let opened = 0;
      renderWithEngine(withHeadline(), 'sheet', () => {
        opened += 1;
      });
      const user = userEvent.setup({ delay: null });
      await user.click(screen.getByRole('button', { name: 'Fan base' }));
      expect(opened).toBe(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each(['bar', 'sheet'] as const)(
      'is left out in the %s while there is no headline, which keeps the home region and its Why?',
      (placement) => {
        render(<StatusChips status={STATUS} placement={placement} />);
        const chip = screen.getByTestId('popularity-chip');
        expect(chip).toHaveTextContent('64');
        expect(within(chip).queryByRole('button', { name: /fan base/iu })).toBeNull();
        expect(
          within(chip).getByRole('button', { name: /^Why is Popularity in your home region /u }),
        ).toBeInTheDocument();
      },
    );
  });
});
